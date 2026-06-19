#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { canTransition } = require("./lib/state-machine");
const { appendEvent } = require("./lib/memory-store");

const [file, ...noteParts] = process.argv.slice(2);
const note = noteParts.join(" ").trim() || "Delivery reopened for rework";

if (!file) {
  console.error("Usage: node scripts/reopen-delivery.js path/to/workflow-state.json [NOTE]");
  console.error("");
  console.error("What this does:");
  console.error("  1. Validates current state can transition to task_breakdown");
  console.error("  2. Resets clean_state fields for next loop");
  console.error("  3. Resets final_review gate + human_instructions for fresh review");
  console.error("  4. Records reopen event in memory");
  console.error("  5. Transitions state to task_breakdown for PM re-planning");
  console.error("");
  console.error("After this, the PM must update task breakdown, then:");
  console.error("  node scripts/transition.js \"${file}\" waiting_for_delivery_plan_review \"Updated task breakdown\"");
  console.error("  → Human approves delivery plan");
  console.error("  → implementation_in_progress");
  process.exit(1);
}

const statePath = path.resolve(file);
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const currentState = state.current_state;

const REOPENABLE_FROM = ["waiting_for_final_review", "done", "implementation_in_progress", "integration_verification", "blocked"];

if (!REOPENABLE_FROM.includes(currentState)) {
  console.error(`Cannot reopen from state: ${currentState}`);
  console.error(`Reopenable from: ${REOPENABLE_FROM.join(", ")}`);
  process.exit(1);
}

if (!canTransition(currentState, "task_breakdown")) {
  console.error(`State machine does not allow ${currentState} → task_breakdown`);
  console.error("Add this transition to scripts/lib/state-machine.js first");
  process.exit(1);
}

const now = new Date().toISOString();
const deliveryId = state.delivery && state.delivery.id ? state.delivery.id : "unknown";

state.current_state = "task_breakdown";
state.delivery.updated_at = now;

state.clean_state = {
  state_validated: { status: "unknown", evidence: "" },
  tasks_closed: { status: "unknown", evidence: "" },
  verification_complete: { status: "unknown", evidence: "" },
  handoff_complete: { status: "unknown", evidence: "" }
};

if (state.gates && state.gates.final_review) {
  state.gates.final_review.status = "waiting";
  state.gates.final_review.approver = "";
  state.gates.final_review.approval_note = "";
  state.gates.final_review.decided_at = "";
}

if (state.human_instructions && state.human_instructions.final_review) {
  state.human_instructions.final_review.status = "not_prepared";
  state.human_instructions.final_review.audience = [];
  state.human_instructions.final_review.instructions = "";
  state.human_instructions.final_review.questions = [];
  state.human_instructions.final_review.evidence = [];
}

if (state.artifacts && state.artifacts.handoff_report) {
  state.artifacts.handoff_report.status = "not_started";
  state.artifacts.handoff_report.path = "";
  state.artifacts.handoff_report.evidence = [];
}

state.log = state.log || [];
state.log.push({
  at: now,
  state: "task_breakdown",
  note: `Reopened: ${currentState} → task_breakdown. ${note}`
});

fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
console.log(`OK: ${deliveryId} reopened (${currentState} → task_breakdown)`);
console.log(`Note: ${note}`);
console.log("");

appendEvent(statePath, {
  type: "delivery_reopened",
  role_context: "orchestrator",
  task_id: "",
  target: "task_breakdown",
  summary: `Delivery ${deliveryId} reopened for rework: ${note}`,
  details: `Transitioned from ${currentState} to task_breakdown. Clean state reset. Final review gate reset.`,
  severity: "info",
  tags: ["reopen", currentState, "task_breakdown"]
});

console.log("Next steps for the agent:");
console.log("  1. PM updates task breakdown with new/revised tasks");
console.log("  2. node scripts/transition.js <statefile> waiting_for_delivery_plan_review \"Updated breakdown\"");
console.log("  3. Human approves delivery plan");
console.log("  4. node scripts/transition.js <statefile> implementation_in_progress \"Plan approved\"");
console.log("  5. Tasks moved through lane state machine via scripts/transition-task.js");
