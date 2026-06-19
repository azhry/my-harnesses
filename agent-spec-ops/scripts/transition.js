#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { states, transitions, canTransition } = require("./lib/state-machine");

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

const now = new Date().toISOString();
state.current_state = nextState;
state.delivery.updated_at = now;
state.log.push({
  at: now,
  state: nextState,
  note: note || `Transitioned from ${currentState} to ${nextState}.`
});

fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
console.log(`OK: ${currentState} -> ${nextState}`);
