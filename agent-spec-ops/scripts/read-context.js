#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { transitions } = require("./lib/state-machine");
const { loadSecretEnv, runSecretFile } = require("./lib/env-loader");
const { loadWorkflowState } = require("./lib/state-store");

const file = process.argv[2];
const role = argValue("--role") || "orchestrator";

if (!file) {
  console.error("Usage: node scripts/read-context.js runs/<DELIVERY_ID>/workflow-state.json [--role ROLE]");
  process.exit(1);
}

const statePath = path.resolve(file);
const loadedSecretFiles = loadSecretEnv(statePath);
let state;
try {
  state = loadWorkflowState(statePath);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const runDir = path.dirname(statePath);
const runSecretsPath = runSecretFile(statePath);
const delivery = state.delivery || {};
const tasks = state.task_graph && Array.isArray(state.task_graph.tasks) ? state.task_graph.tasks : [];
const gates = state.gates || {};
const dispatch = state.agent_dispatch || {};

console.log(`DELIVERY ${delivery.id || "(unset)"} - ${delivery.title || "(untitled)"}`);
console.log(`STATE ${state.current_state || "unknown"}`);
console.log(`ROLE ${role}`);
console.log(`UPDATED ${delivery.updated_at || "unknown"}`);
console.log("");
console.log(`NEXT ${((transitions[state.current_state] || []).join(", ") || "(none)")}`);
console.log("");

console.log("READINESS");
const readiness = state.tool_readiness || {};
console.log(`- status: ${readiness.status || "unknown"}`);
console.log(`- tracker: ${readiness.choices && readiness.choices.product_tracker || "unset"}`);
console.log(`- code host: ${readiness.choices && readiness.choices.code_host || "unset"}`);
console.log(`- Linear key: ${process.env.LINEAR_API_KEY || process.env.LINEAR_ACCESS_TOKEN ? "present" : "missing"}`);
console.log(`- GitHub token: ${process.env.GITHUB_TOKEN || process.env.GH_TOKEN ? "present" : "missing"}`);
console.log(`- run secrets: ${fs.existsSync(runSecretsPath) ? "present" : "missing"} (${runSecretsPath})`);
if (!loadedSecretFiles.includes(path.resolve(runSecretsPath))) {
  console.log("- run secrets loaded: no");
} else {
  console.log("- run secrets loaded: yes");
}
console.log("");

console.log("GATES");
for (const name of ["product_review", "system_rules_review", "implementation_review"]) {
  const gate = gates[name] || {};
  console.log(`- ${name}: ${gate.status || "not_ready"}${gate.approver ? ` by ${gate.approver}` : ""}`);
}
console.log("");

console.log("GIT POLICY");
const gitPolicy = state.implementation && state.implementation.git_policy || {};
console.log(`- independent review required: ${gitPolicy.review_required_before_merge === true ? "yes" : "no"}`);
console.log(`- same account review allowed: ${gitPolicy.allow_same_github_account_review === true ? "yes" : "no"}`);
console.log(`- admin merge allowed: ${gitPolicy.allow_admin_merge === true ? "yes" : "no"}`);
console.log(`- protected checks required: ${gitPolicy.auto_merge_requires_checks === true ? "yes" : "no"}`);
console.log("");

console.log("RUN DIRECTIVES");
for (const line of runDirectiveLines(state)) {
  console.log(line);
}
console.log("");

console.log("TASKS");
if (!tasks.length) {
  console.log("- none");
} else {
  for (const task of tasks) {
    const lane = task.lane || laneForRole(task.role || "");
    const linear = task.linear_id ? ` ${task.linear_id}` : " NO_LINEAR_ID";
    const mr = task.git_flow && task.git_flow.merge_request_url ? ` MR=${task.git_flow.merge_request_status}` : "";
    console.log(`- ${task.id} [${lane}/${task.role || "unassigned"}] ${task.status || "unknown"}${linear}${mr} :: ${task.title || ""}`);
  }
}
console.log("");

console.log("LANES");
for (const lane of ["frontend", "backend"]) {
  const laneTasks = tasks.filter((task) => (task.lane || laneForRole(task.role || "")) === lane);
  const verified = laneTasks.filter((task) => ["verified", "waived", "not_applicable"].includes(task.status)).length;
  const failed = laneTasks.filter((task) => task.status === "failed").length;
  console.log(`- ${lane}: ${verified}/${laneTasks.length} verified, ${failed} failed`);
}
console.log("");

console.log("DISPATCH");
const requests = Array.isArray(dispatch.spawn_requests) ? dispatch.spawn_requests : [];
console.log(`- mode: ${dispatch.mode || "single_agent"}`);
console.log(`- parallel: ${dispatch.parallel_allowed ? `yes max ${dispatch.max_parallel_agents || 2}` : "no"}`);
console.log(`- planned: ${requests.filter((request) => request.status === "planned").length}`);
console.log("");

const sessionDir = path.basename(path.dirname(runDir)) === "runs"
  ? runDir
  : path.join(path.resolve(__dirname, ".."), "runs", delivery.id || "unknown");
fs.mkdirSync(sessionDir, { recursive: true });
fs.writeFileSync(path.join(sessionDir, ".session.json"), JSON.stringify({
  delivery_id: delivery.id || "",
  started_at: new Date().toISOString(),
  state_updated_at: delivery.updated_at || "",
  state: state.current_state || "",
  role,
  tasks_total: tasks.length,
  tasks_verified: tasks.filter((task) => task.status === "verified").length
}, null, 2) + "\n");

console.log(`Run instructions next: node scripts/read-instructions.js ${file} --role ${role}`);

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

function laneForRole(roleName) {
  if (roleName.startsWith("frontend")) return "frontend";
  if (roleName.startsWith("backend")) return "backend";
  if (roleName === "project_manager") return "planning";
  if (roleName === "product_manager") return "product";
  return "handoff";
}

function runDirectiveLines(candidate) {
  const directives = candidate.run_directives || {};
  const approval = directives.approval || {};
  const execution = directives.execution || {};
  const completion = directives.project_completion || {};
  const credentials = directives.credentials || {};
  const expected = Array.isArray(credentials.expected_secret_keys) ? credentials.expected_secret_keys : [];
  const lines = [
    `- do not re-ask approved workflow: ${approval.do_not_reask_for_approved_workflow ? "yes" : "no"}`,
    `- continue until end-to-end: ${execution.continue_until_end_to_end ? "yes" : "no"}`,
    `- do not stop until blocked: ${execution.do_not_stop_until_blocked ? "yes" : "no"}`,
    `- never complete project until user says so: ${completion.never_complete_project_until_user_says_so ? "yes" : "no"}`,
    `- Linear project completion allowed: ${completion.linear_project_completion_allowed ? "yes" : "no"}`,
    `- run secrets required: ${credentials.run_secrets_required ? "yes" : "no"}`,
    `- expected secrets: ${expected.join(", ") || "(none)"}`
  ];
  if (credentials.run_secrets_required) {
    const missing = expected.filter((key) => !process.env[key]);
    lines.push(`- missing expected secrets: ${missing.join(", ") || "(none)"}`);
  }
  return lines;
}
