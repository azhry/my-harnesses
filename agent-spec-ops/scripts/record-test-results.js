#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { appendEvent } = require("./lib/memory-store");

const args = parseArgs(process.argv.slice(2));

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
    "  --case NAME               Test case name (repeatable)"
  ].join("\n"));
  process.exit(1);
}

const statePath = path.resolve(args.stateFile);
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const tasks = state.task_graph && Array.isArray(state.task_graph.tasks) ? state.task_graph.tasks : [];
const taskIndex = tasks.findIndex((t) => t.id === args.taskId);

if (taskIndex === -1) {
  console.error(`Task not found: ${args.taskId}`);
  process.exit(1);
}

const task = tasks[taskIndex];
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
  task.test.output_file = path.relative(path.dirname(statePath), outputPath);

  const testOutputRef = `runs/${state.delivery && state.delivery.id ? state.delivery.id : path.basename(path.dirname(statePath))}/test-output/${slug}.log`;
  task.test.evidence.push(testOutputRef);
}

const now = new Date().toISOString();
task.test.last_run_at = now;
task.test.status = args.status;

if (task.test.status === "passed") {
  task.git_flow = task.git_flow || {};
  task.git_flow.local_tests_passed = true;
  task.git_flow.test_evidence = [...new Set([...(task.git_flow.test_evidence || []), ...args.evidence])];
}

state.delivery.updated_at = now;
fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");

const summary = args.status === "passed"
  ? `Tests passed for ${args.taskId}`
  : `Tests FAILED for ${args.taskId}${args.failures.length ? ": " + args.failures.join("; ") : ""}`;

appendEvent(statePath, {
  type: args.status === "passed" ? "test_passed" : "test_failed",
  role_context: task.role,
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
    cases: []
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--") && !parsed.stateFile) {
      parsed.stateFile = arg;
      continue;
    }
    if (!arg.startsWith("--")) continue;
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
  }
  if (parsed.taskId && !parsed.stateFile) {
    parsed.stateFile = parsed.taskId;
    parsed.taskId = "";
  }
  return parsed;
}
