#!/usr/bin/env node
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
const { validLease } = require("./lib/agent-identity");
const { loadWorkflowState, writeWorkflowState } = require("./lib/state-store");

const args = parseArgs(process.argv.slice(2));
if (args.errors.length || !args.stateFile || !args.taskId || !args.role || !args.label || !args.command) {
  console.error(args.errors.join("\n"));
  console.error("Usage: node scripts/run-task-command.js <workflow-state.json> <TASK_ID> --role <ROLE> --label \"short label\" [--timeout-ms 120000] [--cwd <path>] -- <executable> [args...]");
  process.exit(1);
}
if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1000 || args.timeoutMs > 120000) {
  fail("--timeout-ms must be between 1000 and 120000. Split longer work into smaller task-scoped commands.");
}

const statePath = path.resolve(args.stateFile);
const state = loadWorkflowState(statePath);
const task = (state.task_graph && state.task_graph.tasks || []).find((item) => item.id === args.taskId);
if (!task) fail(`Task not found: ${args.taskId}`);
if (!validLease(state, args.taskId, args.role)) fail(`${args.taskId}: missing active ${args.role} lease.`);
const allowed = task.status === "active" && task.role === args.role ||
  task.status === "testing" && ((task.role === "frontend_dev" && args.role === "frontend_test") || (task.role === "backend_dev" && args.role === "backend_test"));
if (!allowed) fail(`${args.taskId}: ${args.role} cannot run commands while task status is ${task.status}.`);

const policy = state.implementation && state.implementation.git_policy || {};
const cwd = path.resolve(args.cwd || policy.repo_path || state.workspace_root || process.cwd());
const started = Date.now();
const result = spawnSync(args.command, args.commandArgs, {
  cwd,
  encoding: "utf8",
  timeout: args.timeoutMs,
  maxBuffer: 10 * 1024 * 1024,
  windowsHide: true
});
const durationMs = Date.now() - started;
const timedOut = Boolean(result.error && result.error.code === "ETIMEDOUT");
const status = timedOut ? "timed_out" : result.status === 0 ? "passed" : "failed";
task.command_runs = Array.isArray(task.command_runs) ? task.command_runs : [];
task.command_runs.push({
  at: new Date().toISOString(), role: args.role, label: args.label,
  executable: path.basename(args.command), status, exit_code: result.status,
  timeout_ms: args.timeoutMs, duration_ms: durationMs,
  evidence: timedOut ? `timed out after ${args.timeoutMs}ms` : `exit ${result.status}`
});
state.delivery.updated_at = new Date().toISOString();
writeWorkflowState(statePath, state, { writer: "run-task-command.js" });

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (timedOut) {
  console.error(`${args.taskId}: ${args.label} timed out after ${args.timeoutMs}ms. Failure recorded; return to dev instead of retrying an unbounded command.`);
  process.exit(124);
}
if (result.error) {
  console.error(`${args.taskId}: ${args.label} could not start: ${result.error.message}`);
  process.exit(127);
}
if (result.status !== 0) {
  console.error(`${args.taskId}: ${args.label} failed with exit ${result.status}. Failure recorded.`);
  process.exit(result.status || 1);
}
console.log(`${args.taskId}: ${args.label} passed in ${durationMs}ms`);

function parseArgs(raw) {
  const parsed = { stateFile: raw[0] || "", taskId: raw[1] || "", role: "", label: "", timeoutMs: 120000, cwd: "", command: "", commandArgs: [], errors: [] };
  for (let i = 2; i < raw.length; i += 1) {
    if (raw[i] === "--") {
      parsed.command = raw[i + 1] || "";
      parsed.commandArgs = raw.slice(i + 2);
      break;
    }
    if (raw[i] === "--role") parsed.role = raw[++i] || "";
    else if (raw[i] === "--label") parsed.label = raw[++i] || "";
    else if (raw[i] === "--timeout-ms") parsed.timeoutMs = Number(raw[++i]);
    else if (raw[i] === "--cwd") parsed.cwd = raw[++i] || "";
    else parsed.errors.push(`Unknown argument: ${raw[i]}`);
  }
  return parsed;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
