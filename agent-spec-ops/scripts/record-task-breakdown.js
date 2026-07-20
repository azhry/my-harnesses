#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { appendEvent } = require("./lib/memory-store");
const { loadSecretEnv } = require("./lib/env-loader");
const { loadWorkflowState, writeWorkflowState } = require("./lib/state-store");

const args = parseArgs(process.argv.slice(2));

if (!args.stateFile || !args.file) {
  console.error([
    "Usage: node scripts/record-task-breakdown.js runs/<DELIVERY_ID>/workflow-state.json --file tasks.json [options]",
    "",
    "Options:",
    "  --file PATH                 JSON array or { tasks: [...] } task breakdown file",
    "  --dependencies-checked      Mark task_graph.dependencies_checked=true"
  ].join("\n"));
  process.exit(1);
}

const statePath = path.resolve(args.stateFile);
loadSecretEnv(statePath);

let state;
try {
  state = loadWorkflowState(statePath);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

if (state.current_state !== "task_breakdown") {
  console.error(`record-task-breakdown.js requires current_state=task_breakdown; got ${state.current_state || "(missing)"}`);
  process.exit(1);
}

let input;
try {
  input = JSON.parse(fs.readFileSync(path.resolve(args.file), "utf8"));
} catch (error) {
  console.error(`Failed to read task breakdown JSON: ${error.message}`);
  process.exit(1);
}

const rawTasks = Array.isArray(input) ? input : Array.isArray(input.tasks) ? input.tasks : [];
if (!rawTasks.length) {
  console.error("Task breakdown JSON must be an array or an object with a non-empty tasks array");
  process.exit(1);
}

state.task_graph = state.task_graph || {};
state.task_graph.tasks = Array.isArray(state.task_graph.tasks) ? state.task_graph.tasks : [];

const existingIds = new Set(state.task_graph.tasks.map((task) => task.id).filter(Boolean));
const seenIds = new Set();
const normalized = [];
const errors = [];

for (const rawTask of rawTasks) {
  const task = normalizeTask(rawTask || {});
  validateTask(task, errors);
  if (task.id) {
    if (seenIds.has(task.id)) errors.push(`${task.id}: duplicate task id in input`);
    if (existingIds.has(task.id)) errors.push(`${task.id}: task already exists; do not overwrite existing task state`);
    seenIds.add(task.id);
  }
  normalized.push(task);
}

if (errors.length) {
  console.error("Task breakdown rejected:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

state.task_graph.tasks.push(...normalized);
state.task_graph.dependencies_checked = args.dependenciesChecked === true;
state.task_graph.status = args.dependenciesChecked ? "approved" : "draft";
state.artifacts = state.artifacts || {};
state.artifacts.task_breakdown = {
  ...(state.artifacts.task_breakdown || {}),
  status: args.dependenciesChecked ? "approved" : "draft",
  path: slash(path.relative(path.dirname(statePath), path.resolve(args.file))),
  url: (state.artifacts.task_breakdown && state.artifacts.task_breakdown.url) || "",
  content_hash: (state.artifacts.task_breakdown && state.artifacts.task_breakdown.content_hash) || "",
  evidence: [
    ...arrayValue(state.artifacts.task_breakdown && state.artifacts.task_breakdown.evidence),
    slash(path.relative(path.dirname(statePath), path.resolve(args.file)))
  ].filter(unique)
};
state.delivery = state.delivery || {};
state.delivery.updated_at = new Date().toISOString();

writeWorkflowState(statePath, state, { writer: "record-task-breakdown.js" });

appendEvent(statePath, {
  type: "task_breakdown",
  role_context: "project_manager",
  task_id: "",
  target: "task_graph.tasks",
  summary: `Recorded ${normalized.length} task breakdown item(s)`,
  details: normalized.map((task) => `${task.id}: ${task.title}`).join("; "),
  severity: "info",
  tags: ["task_breakdown"]
});

console.log(`Added ${normalized.length} task(s): ${normalized.map((task) => task.id).join(", ")}`);
if (!args.dependenciesChecked) {
  console.log("Note: task_graph.dependencies_checked=false. Pass --dependencies-checked after reviewing dependencies.");
}

function normalizeTask(task) {
  const nowEmptyGitFlow = {
    base_branch: "main",
    target_branch: "main",
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
    auto_merge: true,
    auto_merge_disabled_reason: "",
    merge_checks_passed: false,
    merge_check_evidence: [],
    merged: false,
    merge_commit: "",
    merge_evidence: [],
    blockers: []
  };

  return {
    id: stringValue(task.id),
    linear_id: stringValue(task.linear_id),
    title: stringValue(task.title),
    role: stringValue(task.role),
    lane: stringValue(task.lane),
    depends_on: arrayValue(task.depends_on),
    status: task.status ? stringValue(task.status) : "planned",
    lifecycle_enforced: true,
    source_requirements: arrayValue(task.source_requirements),
    knowledge_refs: arrayValue(task.knowledge_refs),
    description: stringValue(task.description),
    expected_changes: arrayValue(task.expected_changes),
    scope: {
      allowed_paths: arrayValue(task.scope && task.scope.allowed_paths),
      allowed_repos: arrayValue(task.scope && task.scope.allowed_repos),
      allowed_services: arrayValue(task.scope && task.scope.allowed_services),
      contract_refs: arrayValue(task.scope && task.scope.contract_refs)
    },
    definition_of_done: arrayValue(task.definition_of_done),
    verification: arrayValue(task.verification),
    expected_mr_description: stringValue(task.expected_mr_description || task.merge_request_description),
    implementation: {
      changed_files: [],
      evidence: [],
      deviations: []
    },
    test: {
      status: "not_started",
      last_run_at: "",
      output_file: "",
      cases: [],
      commands: [],
      evidence: [],
      failures: []
    },
    git_flow: nowEmptyGitFlow,
    loop: {
      status: "not_started",
      attempt: 0,
      max_attempts: 3,
      last_failure: "",
      history: []
    }
  };
}

function validateTask(task, errors) {
  const prefix = task.id || "(missing id)";
  if (!task.id) errors.push("id is required");
  if (!/^[A-Z]{2,4}-\d{3}$/.test(task.id)) errors.push(`${prefix}: id must look like FE-001, BE-001, QT-001, or CE-001`);
  if (!task.title) errors.push(`${prefix}: title is required`);
  if (!task.description) errors.push(`${prefix}: description is required`);
  if (!["frontend", "backend", "planning", "product", "integration"].includes(task.lane)) {
    errors.push(`${prefix}: lane must be frontend, backend, planning, product, or integration`);
  }
  if (!["orchestrator", "product_manager", "project_manager", "frontend_dev", "frontend_test", "backend_dev", "backend_test"].includes(task.role)) {
    errors.push(`${prefix}: role is not a supported harness role`);
  }
  if (task.status !== "planned") errors.push(`${prefix}: new task status must be planned`);
  if (!task.scope.allowed_paths.length) errors.push(`${prefix}: scope.allowed_paths is required`);
  if (!task.expected_changes.length) errors.push(`${prefix}: expected_changes is required`);
  if (!task.definition_of_done.length) errors.push(`${prefix}: definition_of_done is required`);
  if (!task.verification.length) errors.push(`${prefix}: verification is required`);
  if (!task.expected_mr_description) errors.push(`${prefix}: expected_mr_description is required`);
}

function arrayValue(value) {
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function slash(value) {
  return String(value || "").replace(/\\/g, "/");
}

function unique(value, index, values) {
  return values.indexOf(value) === index;
}

function parseArgs(rawArgs) {
  const parsed = { stateFile: "", file: "", dependenciesChecked: false };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--") && !parsed.stateFile) {
      parsed.stateFile = arg;
      continue;
    }
    switch (arg) {
      case "--file":
        parsed.file = rawArgs[++index] || "";
        break;
      case "--dependencies-checked":
        parsed.dependenciesChecked = true;
        break;
      default:
        console.error(`Unexpected option: ${arg}`);
        process.exit(1);
    }
  }
  return parsed;
}
