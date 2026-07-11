"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { parseArgs, required } = require("./args");
const { writeState, readState, mutateState, acquireLock, releaseLock } = require("./state-store");
const { TASK_STATES, createTask, recordAgent, recordEvidence, recordReview, transitionTask, taskById, event } = require("./workflow");
const { auditMergeGate, auditState } = require("./gates");
const { LinearClient, syncLinearState } = require("./linear");
const github = require("./github");
const dispatcher = require("./dispatcher");
const planner = require("./planner");
const { spawnWorker } = require("./worker-process");
const { readiness } = require("./readiness");

function help() {
  return `DevCircuit — from request to verified delivery

Commands:
  intake --request-file <text> --planner-adapter <executable> plus all init identity/integration flags
  change-request --state <file> --request-file <text> --planner-adapter <executable>
  init --run <id> --title <title> --project-key <key> --team-id <linear-team-id> --github-repo <owner/repo> --spec-file <md> --tasks-file <json>
  dispatch-agent --state <file> --task <id> --role implementer|reviewer|gatekeeper|merger --adapter <executable>
  prepare-task --state <file> --task <id> --repo <path> [--workspace-root <path>]
  start-task --state <file> --task <id> --repo <path>
  capture-head --state <file> --task <id> --repo <path>
  evidence --state <file> --task <id> --kind implementation|test --producer <id> --result pass|fail --head-sha <sha> [--command <cmd>] [--exit-code <n>] [--artifact <path-or-url>]
  run-check --state <file> --task <id> --repo <path> --producer <id> --label <name> [--timeout-ms <n>] -- <executable> [args...]
  publish-pr --state <file> --task <id> --repo <path> --body-file <md>
  submit-review --state <file> --task <id>
  review --state <file> --task <id> --repo <path> --verdict pass|fail --reviewer-id <id> --head-sha <sha> --summary <text>
  sync-linear --state <file>
  audit --state <file> [--task <id> --gatekeeper-id <id> --repo <path>]
  merge --state <file> --task <id> --repo <path> --merger-id <id>
  post-merge-verify --state <file> --task <id> --repo <path>
  status --state <file>
`;
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function init(args, root = process.cwd()) {
  const runId = required(args, "run");
  const spec = fs.readFileSync(path.resolve(required(args, "specFile")), "utf8");
  const tasksInput = loadJson(required(args, "tasksFile"));
  if (!Array.isArray(tasksInput) || tasksInput.length === 0) throw new Error("Tasks file must contain a non-empty JSON array");
  const ids = new Set();
  const tasks = tasksInput.map((item) => {
    if (!item.id || !item.title || !item.description) throw new Error("Every task needs id, title, and description");
    if (ids.has(item.id)) throw new Error(`Duplicate task id ${item.id}`);
    ids.add(item.id);
    return createTask({ ...item, repo: args.githubRepo, base_branch: args.baseBranch || "main" });
  });
  for (const task of tasks) for (const dependency of task.contract.dependencies) if (!ids.has(dependency)) throw new Error(`${task.id} has unknown dependency ${dependency}`);
  const now = new Date().toISOString();
  const state = {
    version: 1,
    policy_version: "devcircuit-2026-01",
    run: { id: runId, title: required(args, "title"), summary: args.summary || "", project_key: required(args, "projectKey"), status: "planned", created_at: now, updated_at: now },
    specification: { revision: 1, content: spec, sha256: crypto.createHash("sha256").update(spec).digest("hex") },
    integrations: {
      linear: { team_id: required(args, "teamId"), project_id: null, project_url: null, document_id: null, document_url: null },
      github: { repository: required(args, "githubRepo"), base_branch: args.baseBranch || "main" }
    },
    tasks,
    supervisor: { status: "required", heartbeat_at: null, findings: [], audit_count: 0 },
    submission_journal: {},
    events: []
  };
  event(state, "run.created", { run_id: runId, task_count: tasks.length });
  const statePath = path.join(root, "runs", runId, "workflow-state.json");
  if (fs.existsSync(statePath)) throw new Error(`Run already exists: ${statePath}`);
  writeState(statePath, state, "init");
  return statePath;
}

function ensureDependencies(state, task) {
  for (const dependency of task.contract.dependencies) {
    const prior = taskById(state, dependency);
    if (prior.status !== TASK_STATES.POST_MERGE_VERIFIED) throw new Error(`${task.id} is blocked by ${dependency}:${prior.status}`);
  }
}

async function execute(argv, options = {}) {
  const separator = argv.indexOf("--");
  const commandVector = separator === -1 ? [] : argv.slice(separator + 1);
  const args = parseArgs(separator === -1 ? argv : argv.slice(0, separator));
  const command = args._[0] || "help";
  if (["help", "--help", "-h"].includes(command)) return { output: help() };
  if (command === "intake") {
    const runId = required(args, "run");
    const root = options.root || process.cwd();
    const report = await readiness({ repo: required(args, "repo"), githubRepository: required(args, "githubRepo"), baseBranch: args.baseBranch || "main", linearTeamId: required(args, "teamId") });
    if (!report.ready) throw new Error(`Readiness blocked: ${report.checks.filter((item) => item.required && item.status !== "ready").map((item) => item.id).join(", ")}. Run npm run readiness -- --repo ... for details.`);
    const artifacts = planner.analyzeRequest({ requestFile: required(args, "requestFile"), adapter: args.plannerAdapter || process.env.DEVCIRCUIT_PLANNER_ADAPTER, outputDirectory: path.join(root, "runs", runId, "planning") });
    return { output: init({ ...args, specFile: artifacts.specificationPath, tasksFile: artifacts.tasksPath }, root) };
  }
  if (command === "init") return { output: init(args, options.root) };
  const statePath = path.resolve(required(args, "state"));

  if (command === "change-request") {
    const before = readState(statePath);
    const active = before.tasks.filter((task) => ![TASK_STATES.PLANNED, TASK_STATES.POST_MERGE_VERIFIED].includes(task.status));
    if (active.length) throw new Error(`Change request requires a safe planning boundary; active: ${active.map((task) => `${task.id}:${task.status}`).join(", ")}`);
    const revision = before.specification.revision + 1;
    const artifacts = planner.analyzeRequest({ requestFile: required(args, "requestFile"), adapter: args.plannerAdapter || process.env.DEVCIRCUIT_PLANNER_ADAPTER, outputDirectory: path.join(path.dirname(statePath), "planning", `revision-${revision}`) });
    const content = fs.readFileSync(artifacts.specificationPath, "utf8");
    const taskInputs = loadJson(artifacts.tasksPath);
    mutateState(statePath, command, (state) => {
      const prior = { revision: state.specification.revision, sha256: state.specification.sha256, content: state.specification.content, superseded_at: new Date().toISOString() };
      state.specification.history = [...(state.specification.history || []), prior];
      state.specification.revision = revision;
      state.specification.content = content;
      state.specification.sha256 = crypto.createHash("sha256").update(content).digest("hex");
      const delivered = state.tasks.filter((task) => task.status === TASK_STATES.POST_MERGE_VERIFIED);
      const deliveredIds = new Set(delivered.map((task) => task.id));
      const replacements = taskInputs.filter((item) => !deliveredIds.has(item.id)).map((item) => createTask({ ...item, repo: state.integrations.github.repository, base_branch: state.integrations.github.base_branch }));
      state.tasks = [...delivered, ...replacements];
      state.run.status = "planned";
      event(state, "specification.revised", { revision, prior_sha256: prior.sha256, new_sha256: state.specification.sha256 });
    });
    return { output: `Specification revised to ${revision}` };
  }

  if (command === "dispatch-agent") {
    let dispatched;
    mutateState(statePath, command, (state) => {
      const task = taskById(state, required(args, "task"));
      const role = required(args, "role");
      dispatched = dispatcher.dispatch({ statePath, state, task, role, adapter: required(args, "adapter") });
      recordAgent(state, task.id, role, dispatched.lease);
      event(state, "agent.dispatched", { task_id: task.id, role, agent_id: dispatched.lease.agent_id, context_path: dispatched.contextPath });
    });
    return { output: JSON.stringify(dispatched, null, 2) };
  } else if (command === "prepare-task") {
    mutateState(statePath, command, (state) => {
      const task = taskById(state, required(args, "task"));
      ensureDependencies(state, task);
      if (!task.git.worktree_path) github.prepareWorktree(task, path.resolve(required(args, "repo")), state.run.id, path.resolve(args.workspaceRoot || path.join(path.dirname(statePath), "worktrees")));
    });
  } else if (command === "start-task") {
    mutateState(statePath, command, (state) => {
      const task = taskById(state, required(args, "task"));
      ensureDependencies(state, task);
      if (!task.git.worktree_path) github.prepareWorktree(task, path.resolve(required(args, "repo")), state.run.id, path.resolve(args.workspaceRoot || path.join(path.dirname(statePath), "worktrees")));
      transitionTask(state, task.id, TASK_STATES.IMPLEMENTING, task.agents.implementer, "Implementation started");
    });
  } else if (command === "evidence") {
    mutateState(statePath, command, (state) => recordEvidence(state, required(args, "task"), {
      kind: required(args, "kind"),
      producer: required(args, "producer"),
      result: required(args, "result"),
      head_sha: required(args, "headSha"),
      command: args.command || null,
      exit_code: args.exitCode === undefined ? null : Number(args.exitCode),
      artifact: args.artifact || null,
      step: args.step || null,
      criterion: args.criterion || null,
      submission_id: args.submissionId || null
    }));
  } else if (command === "capture-head") {
    let head;
    mutateState(statePath, command, (state) => {
      const task = taskById(state, required(args, "task"));
      head = github.captureHead(task, github.taskRepository(task, path.resolve(required(args, "repo"))));
      event(state, "git.head_captured", { task_id: args.task, head_sha: head });
    });
    return { output: head };
  } else if (command === "run-check") {
    if (!commandVector.length) throw new Error("run-check requires '-- <executable> [args...]'");
    const repoRoot = path.resolve(required(args, "repo"));
    const producer = required(args, "producer");
    const taskId = required(args, "task");
    const stateBefore = readState(statePath);
    const taskBefore = taskById(stateBefore, taskId);
    const repo = github.taskRepository(taskBefore, repoRoot);
    if (![taskBefore.agents.implementer, taskBefore.agents.reviewer].includes(producer)) throw new Error("Producer does not hold an implementer or reviewer lease");
    const headSha = github.captureHead(taskBefore, repo);
    const evidenceCommand = args.contractCommand || commandVector.join(" ");
    const existingEvidence = taskBefore.evidence.find((item) => item.kind === "test" && item.source === "executed" && item.producer === producer && item.head_sha === headSha && item.command === evidenceCommand && item.exit_code === 0);
    if (existingEvidence) return { output: existingEvidence.artifact || existingEvidence.id };
    const started = new Date().toISOString();
    const result = spawnWorker(commandVector[0], commandVector.slice(1), { cwd: repo, timeout: Number(args.timeoutMs || 120000) });
    const output = `${result.stdout || ""}${result.stderr || ""}`;
    const evidenceDir = path.join(path.dirname(statePath), "evidence");
    fs.mkdirSync(evidenceDir, { recursive: true });
    const artifact = path.join(evidenceDir, `${taskId}-${Date.now()}-${String(args.label || "check").replace(/[^a-z0-9]+/gi, "-")}.log`);
    fs.writeFileSync(artifact, output, { mode: 0o600 });
    const exitCode = result.error && result.error.code === "ETIMEDOUT" ? 124 : (result.status === null ? 1 : result.status);
    mutateState(statePath, command, (state) => {
      const task = taskById(state, taskId);
      task.git.head_sha = headSha;
      recordEvidence(state, taskId, { kind: "test", source: "executed", producer, head_sha: headSha, result: exitCode === 0 ? "pass" : "fail", command: evidenceCommand, exit_code: exitCode, artifact, started_at: started });
    });
    if (exitCode !== 0) throw new Error(`Check failed with exit ${exitCode}; evidence recorded at ${artifact}`);
    return { output: artifact };
  } else if (command === "publish-pr") {
    mutateState(statePath, command, (state) => {
      const task = taskById(state, required(args, "task"));
      return github.publishPullRequest(task, github.taskRepository(task, path.resolve(required(args, "repo"))), path.resolve(required(args, "bodyFile")));
    });
  } else if (command === "submit-review") {
    mutateState(statePath, command, (state) => transitionTask(state, required(args, "task"), TASK_STATES.IN_REVIEW, "controller", "Submitted for independent review"));
  } else if (command === "review") {
    mutateState(statePath, command, (state) => {
      const taskId = required(args, "task");
      const verdict = required(args, "verdict");
      const summary = required(args, "summary");
      const task = taskById(state, taskId);
      if (args.submissionId && task.reviews.some((item) => item.submission_id === args.submissionId)) return;
      const repo = github.taskRepository(task, path.resolve(required(args, "repo")));
      github.verifyPullRequest(task, repo);
      const candidate = structuredClone(state);
      recordReview(candidate, taskId, verdict, required(args, "reviewerId"), required(args, "headSha"), summary, args.submissionId || null);
      github.submitReview(task, repo, verdict, summary);
      Object.assign(state, candidate);
    });
  } else if (command === "sync-linear") {
    const lock = acquireLock(statePath);
    try {
      const state = readState(statePath);
      const client = options.linearClient || new LinearClient();
      await syncLinearState(state, client);
      state.run.updated_at = new Date().toISOString();
      event(state, "linear.synced", { project_id: state.integrations.linear.project_id });
      writeState(statePath, state, command);
    } finally {
      releaseLock(lock);
    }
  } else if (command === "audit") {
    let result;
    mutateState(statePath, command, (state) => {
      const task = args.task ? taskById(state, args.task) : null;
      const repo = task ? github.taskRepository(task, path.resolve(required(args, "repo"))) : null;
      if (task) github.verifyPullRequest(task, repo);
      result = args.task ? auditMergeGate(state, args.task, required(args, "gatekeeperId")) : auditState(state);
      if (task && result.decision === "ALLOW") github.publishGateStatus(task, repo, state.integrations.github.repository);
    });
    return { output: JSON.stringify(result, null, 2), result };
  } else if (command === "merge") {
    mutateState(statePath, command, (state) => {
      const task = taskById(state, required(args, "task"));
      const mergerId = required(args, "mergerId");
      if (task.agents.merger !== mergerId) throw new Error("Merger does not hold the recorded lease");
      if (Object.entries(task.agents).some(([role, id]) => role !== "merger" && id === mergerId)) throw new Error("Merger identity must be independent");
      github.mergePullRequest(task, github.taskRepository(task, path.resolve(required(args, "repo"))), state.integrations.github.repository);
      transitionTask(state, task.id, TASK_STATES.MERGED, mergerId, `Merged at ${task.git.merge_sha}`);
    });
  } else if (command === "post-merge-verify") {
    mutateState(statePath, command, (state) => {
      const task = taskById(state, required(args, "task"));
      if (task.status !== TASK_STATES.MERGED) throw new Error(`${task.id} must be merged`);
      const checks = github.verifyPostMergeChecks(task, path.resolve(required(args, "repo")), state.integrations.github.repository);
      recordEvidence(state, task.id, { kind: "post_merge", source: "ci_verified", producer: "github:checks", result: "pass", head_sha: task.git.merge_sha, artifact: checks });
      transitionTask(state, task.id, TASK_STATES.POST_MERGE_VERIFIED, "github:checks", "Post-merge checks passed");
      github.cleanupWorktree(task);
    });
  } else if (command === "status") {
    const state = readState(statePath);
    return { output: JSON.stringify({ run: state.run, supervisor: state.supervisor, tasks: state.tasks.map((task) => ({ id: task.id, status: task.status, linear: task.linear, branch: task.git.branch, pr_url: task.git.pr_url, review: task.review && task.review.verdict, gate: task.gate && task.gate.decision })) }, null, 2) };
  } else throw new Error(`Unknown command '${command}'\n\n${help()}`);
  return { output: "OK" };
}

module.exports = { execute, init, help };
