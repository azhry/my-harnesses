#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { states, transitions, canTransition } = require("./lib/state-machine");
const { appendEvent } = require("./lib/memory-store");
const { checkContext } = require("./lib/context-check");

const [file, nextState, ...noteParts] = process.argv.slice(2);
const note = noteParts.join(" ").trim();

if (!file || !nextState) {
  console.error("Usage: node scripts/transition.js path/to/workflow-state.json NEXT_STATE [NOTE]");
  process.exit(1);
}

if (!states.includes(nextState)) {
  console.error(`Invalid next state: ${nextState}`);
  console.error(`Allowed states: ${states.join(", ")}`);
  process.exit(1);
}

const statePath = path.resolve(file);
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const currentState = state.current_state;

if (!canTransition(currentState, nextState)) {
  const allowed = transitions[currentState] || [];
  console.error(`Illegal transition: ${currentState} -> ${nextState}`);
  console.error(`Allowed from ${currentState}: ${allowed.join(", ") || "(none)"}`);
  process.exit(1);
}

checkContext("transition.js");

const taskList = state.task_graph && Array.isArray(state.task_graph.tasks)
  ? state.task_graph.tasks
  : [];

const LANE_ROLE_MAP = {
  frontend_dev: "frontend",
  frontend_test: "frontend",
  backend_dev: "backend",
  backend_test: "backend",
  orchestrator: "integration"
};

const errors = [];

if (nextState === "integration_verification") {
  const devTasks = taskList.filter((t) =>
    ["frontend_dev", "frontend_test", "backend_dev", "backend_test"].includes(t.role)
  );
  const unverified = devTasks.filter((t) =>
    !["verified", "not_applicable", "waived"].includes(t.status)
  );
  if (unverified.length > 0) {
    const ids = unverified.map((t) => `${t.id} (${t.status})`).join(", ");
    errors.push(`Cannot transition to integration_verification: unverified tasks: ${ids}`);
  }
}

if (nextState === "frontend_verified") {
  const feTasks = taskList.filter((t) =>
    ["frontend_dev", "frontend_test"].includes(t.role)
  );
  const unverified = feTasks.filter((t) =>
    !["verified", "not_applicable", "waived"].includes(t.status)
  );
  if (unverified.length > 0) {
    const ids = unverified.map((t) => `${t.id} (${t.status})`).join(", ");
    errors.push(`Cannot transition to frontend_verified: unverified frontend tasks: ${ids}`);
  }
}

if (nextState === "backend_verified") {
  const beTasks = taskList.filter((t) =>
    ["backend_dev", "backend_test"].includes(t.role)
  );
  const unverified = beTasks.filter((t) =>
    !["verified", "not_applicable", "waived"].includes(t.status)
  );
  if (unverified.length > 0) {
    const ids = unverified.map((t) => `${t.id} (${t.status})`).join(", ");
    errors.push(`Cannot transition to backend_verified: unverified backend tasks: ${ids}`);
  }
}

if (nextState === "frontend_dev" && currentState === "implementation_in_progress") {
  const activeFeTasks = taskList.filter((t) =>
    LANE_ROLE_MAP[t.role] === "frontend" && t.status === "active"
  );
  if (activeFeTasks.length > 0) {
    errors.push(`Frontend lane already has active tasks: ${activeFeTasks.map((t) => t.id).join(", ")}`);
  }
}

if (nextState === "backend_dev" && currentState === "implementation_in_progress") {
  const activeBeTasks = taskList.filter((t) =>
    LANE_ROLE_MAP[t.role] === "backend" && t.status === "active"
  );
  if (activeBeTasks.length > 0) {
    errors.push(`Backend lane already has active tasks: ${activeBeTasks.map((t) => t.id).join(", ")}`);
  }
}

if (nextState === "waiting_for_final_review") {
  const instructions = state.human_instructions && state.human_instructions.final_review;
  if (!instructions || !instructions.instructions || !instructions.instructions.trim()) {
    errors.push("Cannot transition to waiting_for_final_review: human_instructions.final_review.instructions is empty. Generate review instructions first using scripts/record-event.js with type=human_instruction.");
  }
  if (!instructions || instructions.status !== "sent") {
    errors.push("Cannot transition to waiting_for_final_review: human_instructions.final_review.status must be 'sent'. Use scripts/record-event.js to record that instructions were sent to the reviewer.");
  }
}

if (errors.length) {
  console.error("Transition rejected:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

const now = new Date().toISOString();
state.current_state = nextState;
state.delivery.updated_at = now;
state.log = state.log || [];
state.log.push({
  at: now,
  state: nextState,
  note: note || `Transitioned from ${currentState} to ${nextState}.`
});

fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
console.log(`OK: ${currentState} -> ${nextState}`);

appendEvent(statePath, {
  type: "state_transition",
  role_context: "orchestrator",
  task_id: "",
  target: nextState,
  summary: `State transition: ${currentState} -> ${nextState}`,
  details: note || "",
  severity: "info",
  tags: ["state_transition", currentState, nextState]
});
