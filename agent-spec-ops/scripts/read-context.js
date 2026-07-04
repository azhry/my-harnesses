#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { transitions } = require("./lib/state-machine");
const { loadSecretEnv } = require("./lib/env-loader");

const file = process.argv[2];
const role = argValue("--role") || "orchestrator";

if (!file) {
  console.error("Usage: node scripts/read-context.js runs/<DELIVERY_ID>/workflow-state.json [--role ROLE]");
  process.exit(1);
}

const statePath = path.resolve(file);
loadSecretEnv(statePath);
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const runDir = path.dirname(statePath);
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
console.log("");

console.log("GATES");
for (const name of ["product_review", "system_rules_review", "implementation_review"]) {
  const gate = gates[name] || {};
  console.log(`- ${name}: ${gate.status || "not_ready"}${gate.approver ? ` by ${gate.approver}` : ""}`);
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
