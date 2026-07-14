#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { appendEvent } = require("./lib/memory-store");
const { hasValidLease, expectedAgentName } = require("./lib/agent-identity");
const { loadWorkflowState, writeWorkflowState } = require("./lib/state-store");

const args = parseArgs(process.argv.slice(2));

if (args.errors.length) {
  console.error(args.errors.join("\n"));
  process.exit(1);
}

if (!args.stateFile || !args.taskId) {
  console.error([
    "Usage: node scripts/record-test-results.js runs/<DELIVERY_ID>/workflow-state.json --task TASK_ID --status passed|failed [options]",
    "",
    "Options:",
    "  --status passed|failed    Test result status (required)",
    "  --command CMD             Test command that was run (repeatable)",
    "  --evidence TEXT           Evidence of test execution (repeatable)",
    "  --output TEXT             Test output or path to log file",
    "  --failure TEXT            Failure description (repeatable)",
    "  --case NAME               Test case name (repeatable)",
    "  --role ROLE               Test role recording the result",
    "  --mr-url URL              MR URL for this task",
    "  --mr-comment-url URL      MR comment URL after posting passed/failed status",
    "  --mr-comment-evidence TXT Evidence that the MR status comment was posted",
    "",
    "Dev-task MR checks and merge evidence are not accepted here. Use submit-task.js after the separate test agent records a pass."
  ].join("\n"));
  process.exit(1);
}

const statePath = path.resolve(args.stateFile);
let state;
try {
  state = loadWorkflowState(statePath);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const tasks = state.task_graph && Array.isArray(state.task_graph.tasks) ? state.task_graph.tasks : [];
const taskIndex = tasks.findIndex((t) => t.id === args.taskId);

if (taskIndex === -1) {
  console.error(`Task not found: ${args.taskId}`);
  process.exit(1);
}

const task = tasks[taskIndex];
const expectedRole = expectedTestRole(task);

if (!["passed", "failed"].includes(args.status)) {
  console.error("--status must be passed or failed");
  process.exit(1);
}
if (!expectedRole) {
  console.error(`${args.taskId} (${task.role || "no-role"}) does not accept test result recording.`);
  process.exit(1);
}
if (isDevTask(task) && hasManualMergeEvidence(args) && process.env.AGENT_SPEC_OPS_ALLOW_MANUAL_MR_EVIDENCE !== "1") {
  console.error(`${args.taskId}: dev-task MR check/merge evidence must come from submit-task.js after the separate ${expectedRole} agent records a pass. record-test-results.js may only record tests and MR status comments.`);
  process.exit(1);
}
if (args.role && args.role !== expectedRole) {
  console.error(`${args.taskId}: test results must be recorded by ${expectedRole}, not ${args.role}.`);
  process.exit(1);
}
if (task.status !== "testing") {
  console.error(`${args.taskId}: cannot record test results while task status is ${task.status}. Transition to testing after spawning ${expectedRole}.`);
  process.exit(1);
}
if (!hasValidLease(state, args.taskId, expectedRole)) {
  console.error(`${args.taskId}: missing valid ${expectedRole} OpenCode lease. Spawn ${expectedAgentName(expectedRole)} and record it with record-agent-spawn.js --agent ${expectedAgentName(expectedRole)} before testing.`);
  process.exit(1);
}
if (args.mrCommentUrl && !isMergeRequestCommentUrl(args.mrUrl || task.git_flow && task.git_flow.merge_request_url, args.mrCommentUrl)) {
  console.error(`${args.taskId}: --mr-comment-url must point to a real MR comment, not the MR itself.`);
  process.exit(1);
}

task.test = task.test || {};
task.test.cases = [...new Set([...(task.test.cases || []), ...args.cases])];
task.test.commands = [...new Set([...(task.test.commands || []), ...args.commands])];
task.test.evidence = [...new Set([...(task.test.evidence || []), ...args.evidence])];
task.test.failures = [...new Set([...(task.test.failures || []), ...args.failures])];

if (args.output) {
  const outputDir = path.join(path.dirname(statePath), "test-output");
  fs.mkdirSync(outputDir, { recursive: true });
  const slug = args.taskId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "test";
  const outputPath = path.join(outputDir, `${slug}.log`);
  fs.writeFileSync(outputPath, args.output);
  const runRelPath = `test-output/${slug}.log`;
  task.test.output_file = runRelPath;

  task.test.evidence.push(runRelPath);
}

if (args.status === "passed") {
  const allFailures = [...new Set([...(task.test.failures || []), ...args.failures])];
  if (allFailures.length > 0) {
    console.error(`Cannot mark ${args.taskId} as passed: ${allFailures.length} failure(s) exist`);
    for (const f of allFailures) {
      console.error(`  - ${f}`);
    }
    console.error("Resolve all failures before marking passed, or use --status failed");
    process.exit(1);
  }
}

const now = new Date().toISOString();
task.test.last_run_at = now;
task.test.status = args.status;

if (task.test.status === "passed") {
  const git = ensureGitFlow(task);
  git.local_tests_passed = true;
  git.test_evidence = [...new Set([...(git.test_evidence || []), ...args.evidence])];
}

if (args.mrCommentUrl || args.mrCommentEvidence.length) {
  const git = ensureGitFlow(task);
  git.merge_request_comment_status = args.status;
  git.merge_request_comment_url = args.mrCommentUrl;
  git.merge_request_comment_evidence = [
    ...new Set([...(git.merge_request_comment_evidence || []), ...args.mrCommentEvidence, args.mrCommentUrl].filter(Boolean))
  ];
}

if (args.mrUrl || args.merged || args.mergeCommit || args.mergeEvidence.length || args.mergeCheckEvidence.length) {
  const git = ensureGitFlow(task);
  if (args.mrUrl) git.merge_request_url = args.mrUrl;
  if (args.merged) {
    git.merge_request_status = "merged";
    git.merged = true;
  }
  if (args.mergeCheckEvidence.length) git.merge_checks_passed = true;
  if (args.mergeCommit) git.merge_commit = args.mergeCommit;
  git.merge_evidence = [
    ...new Set([
      ...(git.merge_evidence || []),
      ...args.mergeEvidence,
      args.merged ? "MR merged" : "",
      args.mergeCommit ? `merge commit ${args.mergeCommit}` : "",
      args.mrUrl || ""
    ].filter(Boolean))
  ];
  git.merge_check_evidence = [
    ...new Set([
      ...(git.merge_check_evidence || []),
      ...args.mergeCheckEvidence
    ].filter(Boolean))
  ];
}

state.delivery.updated_at = now;
writeWorkflowState(statePath, state, { writer: "record-test-results.js" });

const summary = args.status === "passed"
  ? `Tests passed for ${args.taskId}`
  : `Tests FAILED for ${args.taskId}${args.failures.length ? ": " + args.failures.join("; ") : ""}`;

appendEvent(statePath, {
  type: args.status === "passed" ? "test_passed" : "test_failed",
  role_context: expectedRole,
  task_id: args.taskId,
  target: "test",
  summary,
  details: [
    `Status: ${args.status}`,
    args.commands.length ? `Commands: ${args.commands.join(", ")}` : "",
    args.failures.length ? `Failures: ${args.failures.join("; ")}` : "",
    task.test.output_file ? `Output: ${task.test.output_file}` : ""
  ].filter(Boolean).join("\n"),
  severity: args.status === "passed" ? "info" : "warning",
  tags: ["test_result", args.taskId, args.status]
});

console.log(`Recorded test result: ${args.taskId} -> ${args.status}`);

function parseArgs(rawArgs) {
  const parsed = {
    stateFile: "",
    taskId: "",
    status: "",
    commands: [],
    evidence: [],
    output: "",
    failures: [],
    cases: [],
    role: "",
    mrCommentUrl: "",
    mrCommentEvidence: [],
    mrUrl: "",
    merged: false,
    mergeCommit: "",
    mergeEvidence: [],
    mergeCheckEvidence: [],
    errors: []
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--") && !parsed.stateFile) {
      parsed.stateFile = arg;
      continue;
    }
    if (!arg.startsWith("--")) {
      parsed.errors.push(`Unexpected positional argument: ${arg}`);
      continue;
    }
    if (arg === "--task" || arg === "--task-id") {
      parsed.taskId = rawArgs[++index];
      continue;
    }
    if (arg === "--status") {
      parsed.status = rawArgs[++index];
      continue;
    }
    if (arg === "--command") {
      parsed.commands.push(rawArgs[++index]);
      continue;
    }
    if (arg === "--evidence") {
      parsed.evidence.push(rawArgs[++index]);
      continue;
    }
    if (arg === "--output") {
      parsed.output = rawArgs[++index];
      continue;
    }
    if (arg === "--failure") {
      parsed.failures.push(rawArgs[++index]);
      continue;
    }
    if (arg === "--case") {
      parsed.cases.push(rawArgs[++index]);
      continue;
    }
    if (arg === "--role") {
      parsed.role = rawArgs[++index];
      continue;
    }
    if (arg === "--mr-comment-url") {
      parsed.mrCommentUrl = rawArgs[++index];
      continue;
    }
    if (arg === "--mr-url") {
      parsed.mrUrl = rawArgs[++index];
      continue;
    }
    if (arg === "--mr-comment-evidence") {
      parsed.mrCommentEvidence.push(rawArgs[++index]);
      continue;
    }
    if (arg === "--merged") {
      parsed.merged = true;
      continue;
    }
    if (arg === "--merge-commit") {
      parsed.mergeCommit = rawArgs[++index];
      continue;
    }
    if (arg === "--merge-evidence") {
      parsed.mergeEvidence.push(rawArgs[++index]);
      continue;
    }
    if (arg === "--merge-check-evidence") {
      parsed.mergeCheckEvidence.push(rawArgs[++index]);
      continue;
    }
    parsed.errors.push(`Unknown argument: ${arg}`);
  }
  if (parsed.taskId && !parsed.stateFile) {
    parsed.stateFile = parsed.taskId;
    parsed.taskId = "";
  }
  return parsed;
}

function ensureGitFlow(task) {
  task.git_flow = task.git_flow || {
    base_branch: "",
    target_branch: "",
    feature_branch: "",
    branch_created: false,
    branch_evidence: [],
    local_tests_passed: false,
    test_evidence: [],
    pushed: false,
    push_evidence: [],
    merge_request_status: "not_started",
    merge_request_url: "",
    merge_request_evidence: [],
    merge_request_comment_status: "not_started",
    merge_request_comment_url: "",
    merge_request_comment_evidence: [],
    auto_merge: false,
    auto_merge_disabled_reason: "",
    merge_checks_passed: false,
    merge_check_evidence: [],
    merged: false,
    merge_commit: "",
    merge_evidence: [],
    blockers: []
  };
  return task.git_flow;
}

function isMergeRequestCommentUrl(mrUrl, commentUrl) {
  const normalizedMr = String(mrUrl || "").replace(/\/$/, "");
  const normalizedComment = String(commentUrl || "").replace(/\/$/, "");
  if (!normalizedComment || normalizedComment === normalizedMr) return false;
  return /#(note|discussion_r)_?\d+/i.test(normalizedComment) || /#issuecomment-\d+/i.test(normalizedComment);
}

function expectedTestRole(task) {
  if (task.role === "frontend_dev") return "frontend_test";
  if (task.role === "backend_dev") return "backend_test";
  if (task.role === "frontend_test" || task.role === "backend_test") return task.role;
  return "";
}

function isDevTask(task) {
  return task.role === "frontend_dev" || task.role === "backend_dev";
}

function hasManualMergeEvidence(parsed) {
  return Boolean(parsed.merged || parsed.mergeCommit || parsed.mergeEvidence.length || parsed.mergeCheckEvidence.length);
}
