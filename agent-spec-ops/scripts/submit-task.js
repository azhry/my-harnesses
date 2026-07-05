#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { loadSecretEnv } = require("./lib/env-loader");
const { hasValidLease, expectedAgentName } = require("./lib/agent-identity");
const { loadWorkflowState, writeWorkflowState } = require("./lib/state-store");

const args = parseArgs(process.argv.slice(2));

if (!args.stateFile || !args.taskId || !args.commitMsg) {
  console.error("Usage: node scripts/submit-task.js <workflow-state.json> <TASK_ID> --commit-msg \"<msg>\" [--test-command \"<cmd>\"] [--repo-path <repo>]");
  process.exit(1);
}

const statePath = path.resolve(args.stateFile);
loadSecretEnv(statePath);

if (!fs.existsSync(statePath)) {
  console.error(`State file not found: ${statePath}`);
  process.exit(1);
}

let state;
try {
  state = loadWorkflowState(statePath);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const tasks = state.task_graph && Array.isArray(state.task_graph.tasks) ? state.task_graph.tasks : [];
const task = tasks.find((item) => item.id === args.taskId);

if (!task) {
  console.error(`Task not found: ${args.taskId}`);
  process.exit(1);
}
if (!isDevTask(task)) {
  console.error(`${args.taskId} is ${task.role}. submit-task.js only handles frontend_dev/backend_dev tasks.`);
  process.exit(1);
}
if (!["implemented", "testing"].includes(task.status)) {
  console.error(`${args.taskId} is ${task.status}. submit-task.js only runs after implementation is recorded and the task is in implemented/testing.`);
  process.exit(1);
}
if (!hasValidLease(state, args.taskId, task.role)) {
  console.error(`${args.taskId}: missing valid ${task.role} OpenCode lease. Spawn ${expectedAgentName(task.role)} and record it with record-agent-spawn.js --agent ${expectedAgentName(task.role)} before submitting.`);
  process.exit(1);
}

const runDir = path.dirname(statePath);
const deliveryId = state.delivery && state.delivery.id ? state.delivery.id : path.basename(runDir);
const policy = (state.implementation && state.implementation.git_policy) || {};
const repoPath = path.resolve(args.repoPath || policy.repo_path || state.workspace_root || process.cwd());
const baseBranch = policy.base_branch || "main";
const targetBranch = policy.target_branch || baseBranch;
const branchName = formatBranch(policy.branch_name_pattern || "delivery/<DELIVERY_ID>/<TASK_ID>", deliveryId, args.taskId);
const blockers = [];

console.log(`[submit] ${args.taskId}`);
console.log(`repo: ${repoPath}`);
console.log(`branch: ${branchName}`);

const insideRepo = run(repoPath, "git", ["rev-parse", "--is-inside-work-tree"]);
if (!insideRepo.ok) fail(`Not a git repository: ${repoPath}`);

const initialDirtyFiles = dirtyFiles(repoPath);
const outOfScope = initialDirtyFiles.filter((file) => !isPathAllowedForTask(file, task));
if (outOfScope.length) {
  fail([
    "Dirty worktree contains files outside this task scope. Refusing to submit.",
    ...outOfScope.map((file) => `- ${file}`),
    "Commit/stash unrelated files or update the task scope before submitting."
  ].join("\n"));
}
if (initialDirtyFiles.length) {
  task.implementation = task.implementation || { changed_files: [], evidence: [], deviations: [] };
  const stateFiles = initialDirtyFiles.map((file) => normalizeChangedFileForState(file, task));
  task.implementation.changed_files = [
    ...new Set([...(task.implementation.changed_files || []), ...stateFiles])
  ];
  task.implementation.evidence = [
    ...new Set([...(task.implementation.evidence || []), `submit-task saw ${initialDirtyFiles.length} dirty scoped file(s)`])
  ];
}

checkoutBranch(repoPath, branchName);
runRequired(repoPath, "git", ["add", "-A"], "git add failed");

const status = runRequired(repoPath, "git", ["status", "--porcelain"], "git status failed");
if (status.stdout.trim()) {
  runRequired(repoPath, "git", ["commit", "-m", args.commitMsg], "git commit failed");
  console.log("commit: created");
} else {
  console.log("commit: no changes");
}

const test = runTest(repoPath, args.testCommand);
const testOutputFile = writeTestOutput(runDir, args.taskId, test.output);
task.test = {
  status: test.passed ? "passed" : "failed",
  last_run_at: new Date().toISOString(),
  commands: [args.testCommand || "none"],
  failures: test.passed ? [] : [test.summary],
  output_file: testOutputFile
};

const push = run(repoPath, "git", ["push", "-u", "origin", branchName], { timeout: 60000 });
if (!push.ok) blockers.push(`push failed: ${push.stderr || push.stdout || push.error}`);

const pr = push.ok ? ensureMergeRequest(repoPath, {
  deliveryId,
  task,
  taskId: args.taskId,
  branchName,
  targetBranch
}) : { ok: false, url: "", number: "", evidence: [], error: "push failed" };
if (!pr.ok) blockers.push(pr.error || "merge request creation failed");

const comment = pr.ok ? commentMergeRequest(repoPath, pr.number || pr.url, {
  taskId: args.taskId,
  status: test.passed ? "passed" : "failed",
  command: args.testCommand || "none",
  evidence: testOutputFile,
  summary: test.summary
}) : { ok: false, url: "", evidence: [], error: "merge request missing" };
if (!comment.ok) blockers.push(comment.error || "merge request status comment failed");

const merge = pr.ok && comment.ok && test.passed
  ? mergeMergeRequest(repoPath, pr.number || pr.url, policy)
  : { ok: false, attempted: false, commit: "", evidence: [], checkEvidence: [], checksPassed: false, error: "merge skipped until tests and MR comment pass" };
if (pr.ok && comment.ok && test.passed && !merge.ok) {
  blockers.push(merge.error || "merge failed");
}

task.git_flow = {
  base_branch: baseBranch,
  target_branch: targetBranch,
  feature_branch: branchName,
  branch_created: true,
  branch_evidence: [`checked out ${branchName}`],
  local_tests_passed: test.passed,
  test_evidence: [testOutputFile],
  pushed: push.ok,
  push_evidence: push.ok ? [`pushed origin/${branchName}`] : [],
  merge_request_status: merge.ok ? "merged" : pr.ok ? "open" : "blocked",
  merge_request_url: pr.url || "",
  merge_request_evidence: pr.evidence || [],
  merge_request_comment_status: comment.ok ? (test.passed ? "passed" : "failed") : "blocked",
  merge_request_comment_url: comment.url || "",
  merge_request_comment_evidence: comment.evidence || [],
  auto_merge: merge.attempted || false,
  auto_merge_disabled_reason: merge.disabledReason || policy.auto_merge_disabled_reason || "",
  merge_checks_passed: merge.checksPassed || false,
  merge_check_evidence: merge.checkEvidence || [],
  merged: merge.ok,
  merge_commit: merge.commit || "",
  merge_evidence: merge.evidence || [],
  blockers
};

state.delivery.updated_at = new Date().toISOString();
writeWorkflowState(statePath, state, { writer: "submit-task.js" });

if (!test.passed || blockers.length) {
  console.error("submit incomplete:");
  if (!test.passed) console.error(`- tests failed: ${test.summary}`);
  for (const blocker of blockers) console.error(`- ${blocker}`);
  process.exit(1);
}

console.log("submit complete");
console.log(`next: node scripts/transition-task.js "${args.stateFile}" ${args.taskId} verified`);

function parseArgs(raw) {
  const parsed = { stateFile: raw[0] || "", taskId: raw[1] || "", commitMsg: "", testCommand: "", repoPath: "" };
  for (let i = 2; i < raw.length; i += 1) {
    if (raw[i] === "--commit-msg") parsed.commitMsg = raw[++i] || "";
    else if (raw[i] === "--test-command") parsed.testCommand = raw[++i] || "";
    else if (raw[i] === "--repo-path") parsed.repoPath = raw[++i] || "";
  }
  return parsed;
}

function isDevTask(task) {
  return task.role === "frontend_dev" || task.role === "backend_dev";
}

function dirtyFiles(repo) {
  const status = runRequired(repo, "git", ["status", "--porcelain"], "git status failed");
  return status.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .flatMap(parseStatusPath)
    .filter(Boolean);
}

function normalizeChangedFileForState(filePath, task) {
  const cleaned = cleanStatusPath(filePath).replace(/^\.\//, "");
  const repos = task.scope && Array.isArray(task.scope.allowed_repos) ? task.scope.allowed_repos.filter(Boolean) : [];
  if (repos.length === 1 && !cleaned.startsWith(`${repos[0]}/`)) {
    return `${repos[0]}/${cleaned}`;
  }
  return cleaned;
}

function parseStatusPath(line) {
  const body = line.length > 3 ? line.slice(3).trim() : "";
  if (!body) return [];
  if (body.includes(" -> ")) {
    return body.split(" -> ").map(cleanStatusPath);
  }
  return [cleanStatusPath(body)];
}

function cleanStatusPath(value) {
  return String(value).replace(/^"|"$/g, "").replace(/\\/g, "/");
}

function isPathAllowedForTask(filePath, task) {
  const normalizedFile = cleanStatusPath(filePath).replace(/^\.\//, "");
  const scope = task.scope || {};
  const allowedPaths = Array.isArray(scope.allowed_paths) ? scope.allowed_paths : [];
  const allowedRepos = Array.isArray(scope.allowed_repos) ? scope.allowed_repos : [];
  return allowedPaths.some((allowedPath) => {
    const normalizedAllowed = staticAllowedPath(allowedPath).replace(/^\.\//, "").replace(/\/?$/, "/");
    if (normalizedAllowed === "/" || normalizedAllowed === "./" || normalizedAllowed === ".") return true;
    if (normalizedFile === normalizedAllowed.replace(/\/$/, "") || normalizedFile.startsWith(normalizedAllowed)) return true;
    for (const repo of allowedRepos) {
      const repoPrefix = `${cleanStatusPath(repo).replace(/\/?$/, "/")}`;
      if (normalizedAllowed.startsWith(repoPrefix)) {
        const withoutRepo = normalizedAllowed.slice(repoPrefix.length);
        if (normalizedFile === withoutRepo.replace(/\/$/, "") || normalizedFile.startsWith(withoutRepo)) return true;
      }
    }
    return false;
  });
}

function staticAllowedPath(allowedPath) {
  const normalized = cleanStatusPath(allowedPath);
  const wildcard = normalized.search(/[*?]/);
  if (wildcard === -1) return normalized || ".";
  const prefix = normalized.slice(0, wildcard);
  const slash = prefix.lastIndexOf("/");
  if (slash === -1) return prefix || ".";
  return prefix.slice(0, slash + 1) || ".";
}

function formatBranch(pattern, deliveryId, taskId) {
  return pattern
    .replace(/<DELIVERY_ID>/g, deliveryId)
    .replace(/<TASK_ID>/g, taskId)
    .replace(/[^A-Za-z0-9._/-]+/g, "-");
}

function checkoutBranch(repo, branchName) {
  const current = run(repo, "git", ["branch", "--show-current"]);
  if (current.ok && current.stdout.trim() === branchName) return;
  const existing = run(repo, "git", ["checkout", branchName]);
  if (existing.ok) return;
  runRequired(repo, "git", ["checkout", "-b", branchName], `failed to create branch ${branchName}`);
}

function runTest(repo, command) {
  if (!command) return { passed: true, output: "No test command provided.", summary: "no test command" };
  const result = spawnSync(command, {
    cwd: repo,
    shell: true,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim() || `(exit ${result.status})`;
  return {
    passed: result.status === 0,
    output,
    summary: result.status === 0 ? "passed" : `exit ${result.status === null ? "unknown" : result.status}`
  };
}

function writeTestOutput(runDir, taskId, output) {
  const outputDir = path.join(runDir, "test-output");
  fs.mkdirSync(outputDir, { recursive: true });
  const fileName = `${taskId.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "task"}.log`;
  fs.writeFileSync(path.join(outputDir, fileName), `${output}\n`);
  return `test-output/${fileName}`;
}

function ensureMergeRequest(repo, options) {
  const existing = run(repo, "gh", ["pr", "view", "--head", options.branchName, "--json", "number,url,state"]);
  if (existing.ok) {
    const parsed = parseJson(existing.stdout);
    if (parsed && parsed.url) {
      return { ok: true, url: parsed.url, number: parsed.number, evidence: [`found MR #${parsed.number}`] };
    }
  }

  const title = `[${options.deliveryId}] ${options.taskId}: ${options.task.title || options.taskId}`;
  const bodyFile = writePrBody(repo, options);
  const created = run(repo, "gh", [
    "pr", "create",
    "--title", title,
    "--body-file", bodyFile,
    "--head", options.branchName,
    "--base", options.targetBranch,
    "--json", "number,url"
  ]);
  fs.rmSync(bodyFile, { force: true });

  if (!created.ok) return { ok: false, url: "", number: "", evidence: [], error: created.stderr || created.stdout || created.error };
  const parsed = parseJson(created.stdout);
  if (!parsed || !parsed.url) return { ok: false, url: "", number: "", evidence: [], error: "gh pr create did not return a URL" };
  return { ok: true, url: parsed.url, number: parsed.number, evidence: [`created MR #${parsed.number}`] };
}

function writePrBody(repo, options) {
  const templatePath = path.resolve(__dirname, "../templates/pull-request-template.md");
  const fallback = `Task: ${options.taskId}\n\n${options.task.description || ""}\n`;
  const body = fs.existsSync(templatePath)
    ? fs.readFileSync(templatePath, "utf8")
      .replace(/<TASK_ID>/g, options.taskId)
      .replace(/<DELIVERY_ID>/g, options.deliveryId)
    : fallback;
  const file = path.join(repo, `.agent-spec-ops-${options.taskId}-mr.md`);
  fs.writeFileSync(file, body);
  return file;
}

function commentMergeRequest(repo, prRef, details) {
  const body = [
    `Harness test status: ${details.status}`,
    "",
    `Task: ${details.taskId}`,
    `Command: ${details.command}`,
    `Evidence: ${details.evidence}`,
    `Summary: ${details.summary}`
  ].join("\n");
  const result = run(repo, "gh", ["pr", "comment", String(prRef), "--body", body]);
  if (!result.ok) return { ok: false, url: "", evidence: [], error: result.stderr || result.stdout || result.error };
  const url = result.stdout.trim();
  if (!isMergeRequestCommentUrl(url)) {
    return { ok: false, url: "", evidence: [], error: "gh pr comment did not return a real comment URL" };
  }
  return { ok: true, url, evidence: [`commented MR status ${details.status}`, url] };
}

function isMergeRequestCommentUrl(commentUrl) {
  const normalizedComment = String(commentUrl || "").replace(/\/$/, "");
  return /#(note|discussion_r)_?\d+/i.test(normalizedComment) || /#issuecomment-\d+/i.test(normalizedComment);
}

function mergeMergeRequest(repo, prRef, policy) {
  const existing = inspectMergeRequest(repo, prRef);
  if (existing.ok && existing.merged) return existing;
  if (!existing.checksPassed) {
    const automatic = run(repo, "gh", ["pr", "merge", String(prRef), "--squash", "--auto", "--delete-branch"], { timeout: 60000 });
    if (!automatic.ok) {
      return {
        ok: false,
        attempted: true,
        commit: "",
        evidence: [],
        checkEvidence: existing.checkEvidence || [],
        checksPassed: false,
        error: automatic.stderr || automatic.stdout || automatic.error || existing.error || "MR checks are not passed; merge refused"
      };
    }
    return {
      ok: false,
      attempted: true,
      commit: "",
      evidence: ["gh pr merge --auto accepted"],
      checkEvidence: existing.checkEvidence || [],
      checksPassed: false,
      error: "auto-merge enabled but MR checks have not passed yet"
    };
  }
  if (policy.auto_merge_default === false) {
    return {
      ok: false,
      attempted: false,
      commit: "",
      evidence: [],
      checkEvidence: [],
      checksPassed: false,
      disabledReason: policy.auto_merge_disabled_reason || "auto_merge_default=false",
      error: policy.auto_merge_disabled_reason || "auto merge disabled by git policy"
    };
  }

  const immediate = run(repo, "gh", ["pr", "merge", String(prRef), "--squash", "--delete-branch"], { timeout: 60000 });
  const mergeEvidence = [];
  if (immediate.ok) {
    mergeEvidence.push("gh pr merge accepted");
  } else if (policy.auto_merge_requires_checks !== false) {
    const automatic = run(repo, "gh", ["pr", "merge", String(prRef), "--squash", "--auto", "--delete-branch"], { timeout: 60000 });
    if (!automatic.ok) {
      return {
        ok: false,
        attempted: true,
        commit: "",
        evidence: [],
        checkEvidence: [],
        checksPassed: false,
        error: automatic.stderr || automatic.stdout || automatic.error || immediate.stderr || immediate.stdout || immediate.error || "gh pr merge failed"
      };
    }
    mergeEvidence.push("gh pr merge --auto accepted");
  } else {
    return {
      ok: false,
      attempted: true,
      commit: "",
      evidence: [],
      checkEvidence: [],
      checksPassed: false,
      error: immediate.stderr || immediate.stdout || immediate.error || "gh pr merge failed"
    };
  }

  const updated = inspectMergeRequest(repo, prRef);
  if (updated.ok && updated.merged) {
    return {
      ...updated,
      attempted: true,
      evidence: [...new Set([...mergeEvidence, ...updated.evidence])]
    };
  }
  return {
    ok: false,
    attempted: true,
    commit: "",
    evidence: mergeEvidence,
    checkEvidence: updated.checkEvidence || [],
    checksPassed: updated.checksPassed || false,
    error: mergeEvidence.some((item) => item.includes("--auto"))
      ? "auto-merge enabled but the MR is not merged yet"
      : "merge command finished but the MR is not merged"
  };
}

function inspectMergeRequest(repo, prRef) {
  const result = run(repo, "gh", ["pr", "view", String(prRef), "--json", "number,url,state,mergeCommit,statusCheckRollup"]);
  if (!result.ok) {
    return { ok: false, merged: false, commit: "", evidence: [], checkEvidence: [], checksPassed: false, error: result.stderr || result.stdout || result.error };
  }
  const parsed = parseJson(result.stdout);
  if (!parsed) {
    return { ok: false, merged: false, commit: "", evidence: [], checkEvidence: [], checksPassed: false, error: "gh pr view did not return JSON" };
  }
  const state = String(parsed.state || "").toUpperCase();
  const checkEvidence = checkEvidenceFor(parsed.statusCheckRollup);
  const passedChecks = checksPassed(parsed.statusCheckRollup);
  const commit = parsed.mergeCommit && (parsed.mergeCommit.oid || parsed.mergeCommit.abbreviatedOid)
    ? String(parsed.mergeCommit.oid || parsed.mergeCommit.abbreviatedOid)
    : "";
  const merged = state === "MERGED" && Boolean(commit);
  return {
    ok: merged && passedChecks,
    attempted: false,
    merged,
    commit,
    evidence: merged ? [`merged MR ${parsed.url}`, `merge commit ${commit}`] : [],
    checkEvidence,
    checksPassed: passedChecks,
    error: merged
      ? (passedChecks ? "" : "MR is merged but checks are not recorded as passed")
      : `MR state is ${state || "unknown"}`
  };
}

function checkEvidenceFor(rollup) {
  if (!Array.isArray(rollup) || !rollup.length) return ["no required provider checks reported"];
  return rollup.map((check) => {
    const name = check.name || check.workflowName || check.context || check.__typename || "check";
    const conclusion = check.conclusion || check.state || check.status || "unknown";
    return `${name}: ${conclusion}`;
  });
}

function checksPassed(rollup) {
  if (!Array.isArray(rollup) || !rollup.length) return true;
  return rollup.every((check) => {
    const value = String(check.conclusion || check.state || check.status || "").toUpperCase();
    return ["SUCCESS", "COMPLETED", "PASSED", "NEUTRAL", "SKIPPED"].includes(value);
  });
}

function runRequired(cwd, command, args, message) {
  const result = run(cwd, command, args);
  if (!result.ok) fail(`${message}: ${result.stderr || result.stdout || result.error}`);
  return result;
}

function run(cwd, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: options.timeout || 30000,
    maxBuffer: 10 * 1024 * 1024
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? result.error.message : ""
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
