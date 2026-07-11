#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { loadSecretEnv } = require("./lib/env-loader");
const { validLease, expectedAgentName } = require("./lib/agent-identity");
const { loadWorkflowState, writeWorkflowState } = require("./lib/state-store");

const args = parseArgs(process.argv.slice(2));
if (args.errors.length || !args.stateFile || !args.taskId || !args.status || !args.role || !args.summary || !args.evidence) {
  console.error(args.errors.join("\n"));
  console.error("Usage: node scripts/record-pr-review.js <workflow-state.json> <TASK_ID> --status passed|failed --role frontend_test|backend_test --summary \"...\" --evidence \"...\" [--repo-path <repo>]");
  process.exit(1);
}
if (!["passed", "failed"].includes(args.status)) fail("Review status must be passed or failed.");

const statePath = path.resolve(args.stateFile);
loadSecretEnv(statePath);
if (!fs.existsSync(statePath)) fail(`State file not found: ${statePath}`);
const state = loadWorkflowState(statePath);
const task = (state.task_graph && state.task_graph.tasks || []).find((item) => item.id === args.taskId);
if (!task) fail(`Task not found: ${args.taskId}`);
const expectedRole = task.role === "frontend_dev" ? "frontend_test" : task.role === "backend_dev" ? "backend_test" : "";
if (!expectedRole || args.role !== expectedRole) fail(`${args.taskId}: PR review must be recorded by ${expectedRole || "the matching test role"}.`);
if (task.status !== "testing") fail(`${args.taskId}: PR review requires task status testing; current status is ${task.status}.`);
const lease = validLease(state, args.taskId, args.role);
if (!lease) fail(`${args.taskId}: missing active ${args.role} lease. Spawn ${expectedAgentName(args.role)} and record it before PR review.`);
const git = task.git_flow || {};
if (!git.merge_request_url || git.merge_request_status !== "open") fail(`${args.taskId}: create/push the PR with submit-task.js before recording review.`);

const policy = state.implementation && state.implementation.git_policy || {};
const repoPath = path.resolve(args.repoPath || policy.repo_path || state.workspace_root || process.cwd());
const branch = git.feature_branch || "HEAD";
const head = spawnSync("git", ["rev-parse", branch], { cwd: repoPath, encoding: "utf8", timeout: 10000 });
if (head.status !== 0) fail(`Cannot resolve review HEAD for ${branch}: ${head.stderr || head.error && head.error.message || "git failed"}`);
const headSha = head.stdout.trim();
if (git.submitted_head_sha && git.submitted_head_sha !== headSha) {
  fail(`${args.taskId}: PR branch moved after submission (${git.submitted_head_sha} -> ${headSha}). Rerun submit-task.js before review.`);
}

task.review = {
  status: args.status,
  role: args.role,
  reviewer_agent_id: lease.agent_id,
  reviewed_at: new Date().toISOString(),
  head_sha: headSha,
  merge_request_url: git.merge_request_url,
  summary: args.summary,
  evidence: [args.evidence]
};
git.blockers = (git.blockers || []).filter((item) => !String(item).startsWith("PR review failed:"));
if (args.status === "failed") git.blockers.push(`PR review failed: ${args.summary}`);
state.delivery.updated_at = new Date().toISOString();
state.log = state.log || [];
state.log.push({ at: state.delivery.updated_at, state: state.current_state, note: `PR review ${args.status}: ${args.taskId} at ${headSha}` });
writeWorkflowState(statePath, state, { writer: "record-pr-review.js" });
console.log(`Recorded ${args.status} independent PR review for ${args.taskId} at ${headSha}`);
if (args.status === "failed") {
  console.error("Review failed. Return to dev, fix the same task, retest, and review the new HEAD. Do not start another task.");
  process.exit(2);
}

function parseArgs(raw) {
  const parsed = { stateFile: raw[0] || "", taskId: raw[1] || "", status: "", role: "", summary: "", evidence: "", repoPath: "", errors: [] };
  for (let i = 2; i < raw.length; i += 1) {
    const key = raw[i];
    if (key === "--status") parsed.status = raw[++i] || "";
    else if (key === "--role") parsed.role = raw[++i] || "";
    else if (key === "--summary") parsed.summary = raw[++i] || "";
    else if (key === "--evidence") parsed.evidence = raw[++i] || "";
    else if (key === "--repo-path") parsed.repoPath = raw[++i] || "";
    else parsed.errors.push(`Unknown argument: ${key}`);
  }
  return parsed;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
