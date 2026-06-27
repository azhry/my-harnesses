#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadPolicy } = require("./lib/policy");
const { compactTimestamp, ensureDir } = require("./lib/memory-store");

const args = parseArgs(process.argv.slice(2));

if (!args.stateFile) {
  console.error([
    "Usage: node scripts/compact-state.js runs/<DELIVERY_ID>/workflow-state.json [options]",
    "",
    "Options:",
    "  --max-log N              Keep latest N workflow log entries",
    "  --max-loop-history N     Keep latest N loop history entries",
    "  --dry-run                Report what would be compacted"
  ].join("\n"));
  process.exit(1);
}

const statePath = path.resolve(args.stateFile);
const runDir = path.dirname(statePath);
const archiveDir = path.join(runDir, "archives");
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const policy = loadPolicy();
const maxLog = args.maxLog || policy.state_compaction.max_log_entries || 80;
const maxLoopHistory = args.maxLoopHistory || policy.state_compaction.max_loop_history_entries || 20;
const maxTaskLoopHistory = args.maxLoopHistory || policy.state_compaction.max_task_loop_history_entries || 20;
const now = new Date().toISOString();
const stamp = compactTimestamp(new Date());

const archive = {
  compacted_at: now,
  state_file: path.relative(runDir, statePath),
  delivery_id: state.delivery && state.delivery.id || "",
  current_state: state.current_state,
  log: [],
  loops: {},
  task_loop_history: {}
};

let removedCount = 0;

if (Array.isArray(state.log) && state.log.length > maxLog) {
  archive.log = state.log.slice(0, state.log.length - maxLog);
  state.log = state.log.slice(-maxLog);
  removedCount += archive.log.length;
}

if (state.loops && typeof state.loops === "object") {
  for (const [name, loop] of Object.entries(state.loops)) {
    if (loop && Array.isArray(loop.history) && loop.history.length > maxLoopHistory) {
      archive.loops[name] = loop.history.slice(0, loop.history.length - maxLoopHistory);
      loop.history = loop.history.slice(-maxLoopHistory);
      removedCount += archive.loops[name].length;
    }
  }
}

const tasks = state.task_graph && Array.isArray(state.task_graph.tasks)
  ? state.task_graph.tasks
  : [];
for (const task of tasks) {
  const history = task.loop && Array.isArray(task.loop.history) ? task.loop.history : [];
  if (history.length > maxTaskLoopHistory) {
    archive.task_loop_history[task.id] = history.slice(0, history.length - maxTaskLoopHistory);
    task.loop.history = history.slice(-maxTaskLoopHistory);
    removedCount += archive.task_loop_history[task.id].length;
  }
}

state.memory = state.memory || {};
state.memory.evidence = Array.isArray(state.memory.evidence) ? state.memory.evidence : [];
state.memory.evidence.push(`State compacted at ${now}; archived ${removedCount} historical entries`);
state.delivery.updated_at = now;
state.log = Array.isArray(state.log) ? state.log : [];
state.log.push({
  at: now,
  state: state.current_state,
  note: `State compacted; archived ${removedCount} historical entries`
});

const summary = buildSummary(state, now, removedCount);

if (args.dryRun) {
  console.log(`Would archive ${removedCount} historical entries`);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

ensureDir(archiveDir);
const archivePath = path.join(archiveDir, `workflow-state-archive-${stamp}.json`);
fs.writeFileSync(archivePath, JSON.stringify(archive, null, 2) + "\n");
fs.writeFileSync(path.join(runDir, "workflow-summary.json"), JSON.stringify(summary, null, 2) + "\n");
fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");

console.log(`Compacted ${path.relative(process.cwd(), statePath)}`);
console.log(`Archived ${removedCount} historical entries to ${path.relative(process.cwd(), archivePath)}`);
console.log(`Wrote ${path.relative(process.cwd(), path.join(runDir, "workflow-summary.json"))}`);

function buildSummary(nextState, compactedAt, archivedEntries) {
  const allTasks = nextState.task_graph && Array.isArray(nextState.task_graph.tasks)
    ? nextState.task_graph.tasks
    : [];
  const taskSummary = allTasks.map((task) => ({
    id: task.id,
    title: task.title,
    role: task.role,
    lane: task.lane,
    status: task.status,
    linear_id: task.linear_id || "",
    blockers: [
      ...((task.git_flow && task.git_flow.blockers) || []),
      ...((task.loop && task.loop.last_failure) ? [task.loop.last_failure] : [])
    ].filter(Boolean)
  }));

  return {
    compacted_at: compactedAt,
    archived_entries: archivedEntries,
    delivery: nextState.delivery,
    current_state: nextState.current_state,
    tool_readiness: {
      status: nextState.tool_readiness && nextState.tool_readiness.status || "",
      choices: nextState.tool_readiness && nextState.tool_readiness.choices || {}
    },
    gates: nextState.gates || {},
    tasks: taskSummary,
    token_totals: nextState.memory && nextState.memory.token_totals || {},
    open_blockers: collectBlockers(nextState, taskSummary)
  };
}

function collectBlockers(nextState, taskSummary) {
  const blockers = [];
  for (const [role, data] of Object.entries(nextState.roles || {})) {
    for (const blocker of data.blockers || []) {
      blockers.push({ owner: role, blocker });
    }
  }
  for (const task of taskSummary) {
    for (const blocker of task.blockers) {
      blockers.push({ owner: task.id, blocker });
    }
  }
  for (const blocker of (nextState.integration && nextState.integration.blockers) || []) {
    blockers.push({ owner: "integration", blocker });
  }
  return blockers;
}

function parseArgs(rawArgs) {
  const parsed = {
    stateFile: "",
    maxLog: 0,
    maxLoopHistory: 0,
    dryRun: false
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--") && !parsed.stateFile) {
      parsed.stateFile = arg;
      continue;
    }
    switch (arg) {
      case "--max-log":
        parsed.maxLog = Number(rawArgs[++index] || 0);
        break;
      case "--max-loop-history":
        parsed.maxLoopHistory = Number(rawArgs[++index] || 0);
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}
