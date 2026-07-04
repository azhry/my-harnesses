#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { appendEvent } = require("./lib/memory-store");

const [file, ...reasonParts] = process.argv.slice(2);
const reason = reasonParts.join(" ").trim();

if (!file || !reason) {
  console.error('Usage: node scripts/reopen-delivery.js runs/<DELIVERY_ID>/workflow-state.json "Reason for rework"');
  process.exit(1);
}

const statePath = path.resolve(file);
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const allowed = ["implementation_in_progress", "implementation_review", "done", "blocked"];

if (!allowed.includes(state.current_state)) {
  console.error(`Cannot reopen from ${state.current_state}. Rework is only valid from: ${allowed.join(", ")}`);
  process.exit(1);
}

const now = new Date().toISOString();
const from = state.current_state;

state.current_state = "task_breakdown";
state.delivery = state.delivery || {};
state.delivery.updated_at = now;
state.gates = state.gates || {};
state.gates.implementation_review = {
  status: "not_ready",
  approver: "",
  approval_note: "",
  decided_at: "",
  evidence: []
};
state.human_instructions = state.human_instructions || {};
state.human_instructions.implementation_review = {
  status: "not_prepared",
  audience: [],
  instructions: "",
  decision_options: ["approve", "request_changes", "request_rework", "block"],
  questions: [],
  evidence: []
};
state.log = state.log || [];
state.log.push({
  at: now,
  state: "task_breakdown",
  note: `Reopened from ${from}: ${reason}`
});

fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");

appendEvent(statePath, {
  type: "rework_requested",
  role_context: "orchestrator",
  task_id: "",
  target: "task_breakdown",
  summary: "Human requested rework; returned to task breakdown",
  details: reason,
  severity: "warning",
  tags: ["rework", "task_breakdown"]
});

console.log(`OK: ${from} -> task_breakdown`);
