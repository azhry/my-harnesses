#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadJson, readNdjson, readCsv } = require("./lib/memory-store");

const file = process.argv[2];

if (!file) {
  console.error("Usage: node scripts/read-context.js path/to/workflow-state.json");
  process.exit(1);
}

const statePath = path.resolve(file);
if (!fs.existsSync(statePath)) {
  console.error(`State file not found: ${statePath}`);
  process.exit(1);
}

const state = loadJson(statePath);
if (!state || !state.delivery) {
  console.error("Invalid workflow-state.json");
  process.exit(1);
}

const runDir = path.dirname(statePath);
const deliveryId = state.delivery.id || "unknown";
const title = state.delivery.title || "";
const currentState = state.current_state || "unknown";
const updatedAt = state.delivery.updated_at || "";

const HARNESS_ROOT = path.resolve(__dirname, "..");

const separator = "=".repeat(60);
const subSep = "-".repeat(40);

console.log(`\n${separator}`);
console.log(`  CONTEXT RECOVERY — ${deliveryId}`);
console.log(`  ${title}`);
console.log(`${separator}\n`);

console.log(`Current State:  ${currentState}`);
console.log(`Last Updated:   ${updatedAt}`);

if (state.gates && state.gates.final_review) {
  const fr = state.gates.final_review;
  console.log(`Final Review:   ${fr.status}${fr.approver ? ` by ${fr.approver}` : ""}`);
}

const humanInstructions = state.human_instructions && state.human_instructions.final_review;
if (humanInstructions && humanInstructions.status === "sent") {
  console.log(`Review Sent:    yes (${humanInstructions.questions ? humanInstructions.questions.length : 0} questions)`);
}

console.log(`\n${subSep}`);
console.log("  TOOL READINESS & TOKENS");
console.log(`${subSep}`);

const tr = state.tool_readiness || {};
console.log(`  Status:     ${tr.status || "not_started"}`);
const tracker = (tr.choices && tr.choices.product_tracker) || "";
const codeHost = (tr.choices && tr.choices.code_host) || "";
console.log(`  Tracker:    ${tracker || "none"}`);
console.log(`  Code Host:  ${codeHost || "none"}`);

if (Array.isArray(tr.capabilities)) {
  for (const cap of tr.capabilities) {
    const icon = cap.status === "available" ? "✓" : cap.status === "missing" ? "✗" : "?";
    const provider = cap.provider || "unknown";
    console.log(`  ${icon} ${cap.name}: ${provider} (${cap.status})`);
  }
}

const tokens = state.memory && state.memory.token_totals;
if (tokens) {
  console.log(`  Tokens:     ${(tokens.total_tokens || 0).toLocaleString()} total, $${(tokens.total_cost_usd || 0).toFixed(4)} USD`);
} else {
  console.log(`  Tokens:     none recorded`);
}

console.log(`\n${subSep}`);
console.log("  PROJECT / TEAM CONTEXT");
console.log(`${subSep}`);

console.log(`  Delivery ID:   ${deliveryId}`);
console.log(`  Title:         ${title}`);

const taskProvider = state.memory && state.memory.local_task_provider;
if (taskProvider) {
  console.log(`  Task Provider: ${taskProvider.mode || "local"}${taskProvider.external_provider ? ` (${taskProvider.external_provider})` : ""}`);
  console.log(`  Sync Status:   ${taskProvider.sync_status || "local_only"}`);
  if (taskProvider.last_synced_at) {
    console.log(`  Last Synced:   ${taskProvider.last_synced_at}`);
  }
}

const linearIds = [];
const tasks = (state.task_graph && state.task_graph.tasks) || [];
for (const t of tasks) {
  if (t.linear_id) linearIds.push(`${t.id} → ${t.linear_id}`);
}
if (linearIds.length) {
  console.log(`\n  Linear Issues:`);
  for (const line of linearIds) {
    console.log(`    ${line}`);
  }
} else {
  console.log(`\n  Linear Issues: none mapped`);
}

console.log(`\n${subSep}`);
console.log("  TASKS SUMMARY");
console.log(`${subSep}`);

const byStatus = {};
const byLane = {};
for (const t of tasks) {
  byStatus[t.status] = (byStatus[t.status] || 0) + 1;
  const lane = t.lane || t.role || "unknown";
  byLane[lane] = (byLane[lane] || 0) + 1;
}
console.log(`  Total: ${tasks.length} tasks`);
console.log(`  By Status:`);
for (const [status, count] of Object.entries(byStatus).sort()) {
  console.log(`    ${status}: ${count}`);
}
console.log(`  By Lane:`);
for (const [lane, count] of Object.entries(byLane).sort()) {
  console.log(`    ${lane}: ${count}`);
}

console.log(`\n  Task List:`);
for (const t of tasks) {
  const depMarker = (Array.isArray(t.depends_on) && t.depends_on.length) ? ` [depends: ${t.depends_on.join(", ")}]` : "";
  console.log(`    ${t.status.padEnd(14)} ${t.id.padEnd(10)} ${t.role.padEnd(18)} ${t.title}${depMarker}`);
}

console.log(`\n${subSep}`);
console.log("  GATES");
console.log(`${subSep}`);

const gateOrder = ["tool_readiness_review", "design_stitch", "product_review", "delivery_plan_review", "final_review"];
const gates = state.gates || {};
for (const name of gateOrder) {
  const g = gates[name];
  if (g) {
    const icon = g.status === "approved" ? "✓" : g.status === "waiting" ? "⏳" : g.status === "blocked" ? "✗" : "?";
    console.log(`  ${icon} ${name}: ${g.status}${g.approver ? ` by ${g.approver}` : ""}`);
  }
}

if (state.current_state === "waiting_for_final_review" && humanInstructions) {
  console.log(`\n${subSep}`);
  console.log("  REVIEW INSTRUCTIONS (sent)");
  console.log(`${subSep}`);
  console.log(`  Decision options: ${(humanInstructions.decision_options || []).join(", ")}`);
  if (humanInstructions.questions && humanInstructions.questions.length) {
    console.log(`  Questions:`);
    for (const q of humanInstructions.questions) {
      console.log(`    ? ${q}`);
    }
  }
  console.log(`\n  To approve:   node scripts/transition.js "${file}" done "Approved"`);
  console.log(`  To rework:    node scripts/reopen-delivery.js "${file}" "reason for rework"`);
}

console.log(`\n${subSep}`);
console.log("  RECENT LOG ENTRIES");
console.log(`${subSep}`);

const log = Array.isArray(state.log) ? state.log : [];
const recentLog = log.slice(-8).reverse();
for (const entry of recentLog) {
  console.log(`  ${(entry.at || "").slice(11, 19)} [${entry.state}] ${entry.note}`);
}

const eventsPath = path.join(runDir, "events.ndjson");
if (fs.existsSync(eventsPath)) {
  const events = readNdjson(eventsPath);
  const recentEvents = events.slice(-5).reverse();
  console.log(`\n${subSep}`);
  console.log("  RECENT EVENTS");
  console.log(`${subSep}`);
  for (const evt of recentEvents) {
    console.log(`  ${(evt.created_at || "").slice(11, 19)} ${evt.type.padEnd(25)} ${evt.summary || ""}`);
  }
}

const markerDir = path.basename(path.dirname(runDir)) === "runs"
  ? runDir
  : path.join(HARNESS_ROOT, "runs", deliveryId);
fs.mkdirSync(markerDir, { recursive: true });
fs.writeFileSync(path.join(markerDir, ".session.json"), JSON.stringify({
  delivery_id: deliveryId,
  started_at: new Date().toISOString(),
  state: currentState,
  tasks_total: tasks.length,
  tasks_verified: tasks.filter((t) => t.status === "verified").length,
  tokens: tokens ? tokens.total_tokens : 0,
  cost: tokens ? tokens.total_cost_usd : 0
}, null, 2) + "\n");

console.log(`\n${separator}`);
console.log(`  Run this at session start to restore context.`);
console.log(`  Agent: read the output carefully before taking any action.`);
console.log(`${separator}\n`);
