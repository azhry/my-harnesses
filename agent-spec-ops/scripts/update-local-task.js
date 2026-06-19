#!/usr/bin/env node
"use strict";

const path = require("path");
const {
  TASK_STATUSES,
  appendEvent,
  defaultLocalTasks,
  ensureRunMemory,
  loadJson,
  nowIso,
  writeJson
} = require("./lib/memory-store");
const { roleNames } = require("./lib/state-machine");

const args = parseArgs(process.argv.slice(2));

if (!args.stateFile || !args.id) {
  console.error([
    "Usage: node scripts/update-local-task.js runs/<DELIVERY_ID>/workflow-state.json --id TASK_ID [options]",
    "",
    "Options:",
    "  --title TEXT",
    "  --role ROLE",
    "  --status STATUS",
    "  --description TEXT",
    "  --depends-on TASK_ID      repeatable or comma-separated",
    "  --acceptance TEXT        repeatable",
    "  --evidence REF           repeatable",
    "  --external-provider NAME",
    "  --external-id ID",
    "  --external-url URL"
  ].join("\n"));
  process.exit(1);
}

if (args.role && !roleNames.includes(args.role)) {
  console.error(`Unknown role: ${args.role}`);
  process.exit(1);
}

if (args.status && !TASK_STATUSES.includes(args.status)) {
  console.error(`Unknown task status: ${args.status}`);
  process.exit(1);
}

const { state, memory, runDir } = ensureRunMemory(args.stateFile);
const taskFile = path.join(runDir, memory.local_tasks_path);
const localTasks = loadJson(taskFile, defaultLocalTasks(state.delivery.id));
const at = nowIso();
const existing = localTasks.tasks.find((task) => task.id === args.id);
const task = existing || {
  id: args.id,
  title: "",
  role: "",
  status: "planned",
  description: "",
  depends_on: [],
  acceptance_criteria: [],
  evidence: [],
  external: {
    provider: "",
    id: "",
    url: "",
    sync_status: "local_only"
  },
  created_at: at,
  updated_at: at
};

if (args.title) task.title = args.title;
if (args.role) task.role = args.role;
if (args.status) task.status = args.status;
if (args.description) task.description = args.description;
if (args.dependsOn.length) task.depends_on = unique([...task.depends_on, ...args.dependsOn]);
if (args.acceptance.length) task.acceptance_criteria = unique([...task.acceptance_criteria, ...args.acceptance]);
if (args.evidence.length) task.evidence = unique([...task.evidence, ...args.evidence]);
if (args.externalProvider) task.external.provider = args.externalProvider;
if (args.externalId) task.external.id = args.externalId;
if (args.externalUrl) task.external.url = args.externalUrl;
if (task.external.provider || task.external.id || task.external.url) {
  task.external.sync_status = "linked";
}
task.updated_at = at;

if (!existing) {
  localTasks.tasks.push(task);
}
localTasks.delivery_id = state.delivery.id;
localTasks.updated_at = at;
writeJson(taskFile, localTasks);

appendEvent(args.stateFile, {
  type: "local_task_updated",
  role_context: task.role,
  task_id: task.id,
  summary: `Local task updated: ${task.id}`,
  details: task.title,
  evidence: [path.relative(runDir, taskFile), ...args.evidence]
});

console.log(`Updated local task ${task.id}`);
console.log(path.relative(runDir, taskFile));

function parseArgs(rawArgs) {
  const parsed = {
    stateFile: "",
    id: "",
    title: "",
    role: "",
    status: "",
    description: "",
    dependsOn: [],
    acceptance: [],
    evidence: [],
    externalProvider: "",
    externalId: "",
    externalUrl: ""
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--") && !parsed.stateFile) {
      parsed.stateFile = arg;
      continue;
    }
    const value = rawArgs[index + 1] || "";
    switch (arg) {
      case "--id":
        parsed.id = value;
        index += 1;
        break;
      case "--title":
        parsed.title = value;
        index += 1;
        break;
      case "--role":
        parsed.role = value;
        index += 1;
        break;
      case "--status":
        parsed.status = value;
        index += 1;
        break;
      case "--description":
        parsed.description = value;
        index += 1;
        break;
      case "--depends-on":
        parsed.dependsOn.push(...splitList(value));
        index += 1;
        break;
      case "--acceptance":
        parsed.acceptance.push(value);
        index += 1;
        break;
      case "--evidence":
        parsed.evidence.push(value);
        index += 1;
        break;
      case "--external-provider":
        parsed.externalProvider = value;
        index += 1;
        break;
      case "--external-id":
        parsed.externalId = value;
        index += 1;
        break;
      case "--external-url":
        parsed.externalUrl = value;
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
