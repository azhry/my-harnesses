#!/usr/bin/env node
"use strict";

const path = require("path");
const { appendEvent } = require("./lib/memory-store");
const { loadWorkflowState, writeWorkflowState } = require("./lib/state-store");

const args = parseArgs(process.argv.slice(2));

if (!args.stateFile || !args.note) {
  console.error([
    'Usage: node scripts/record-completion-approval.js runs/<DELIVERY_ID>/workflow-state.json --approver NAME --note "Human explicitly approved completion" [--evidence TEXT]',
    "",
    "Use only when the human explicitly says this delivery/project is complete."
  ].join("\n"));
  process.exit(1);
}

const statePath = path.resolve(args.stateFile);
let state;
try {
  state = loadWorkflowState(statePath);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

if (state.current_state !== "implementation_review") {
  console.error(`record-completion-approval.js requires current_state=implementation_review; got ${state.current_state || "(missing)"}`);
  process.exit(1);
}

if (!explicitCompletion(args.note)) {
  console.error("Completion approval note must explicitly say the delivery/project is complete, finished, or approved to close.");
  process.exit(1);
}

const now = new Date().toISOString();
state.delivery = state.delivery || {};
state.delivery.completion_approved = true;
state.delivery.completion_approved_by = args.approver || "human";
state.delivery.completion_approved_at = now;
state.delivery.completion_note = args.note;
state.delivery.completion_evidence = Array.isArray(state.delivery.completion_evidence)
  ? state.delivery.completion_evidence
  : [];
if (args.evidence) state.delivery.completion_evidence.push(args.evidence);
state.delivery.updated_at = now;

state.log = state.log || [];
state.log.push({
  at: now,
  state: state.current_state,
  note: `Completion approved by ${state.delivery.completion_approved_by}: ${args.note}`
});

writeWorkflowState(statePath, state, { writer: "record-completion-approval.js" });

appendEvent(statePath, {
  type: "completion_approval",
  role_context: "orchestrator",
  task_id: "",
  target: "done",
  summary: "Human explicitly approved delivery/project completion",
  details: args.note,
  severity: "info",
  tags: ["completion", "human_gate"]
});

console.log(`OK: completion approved by ${state.delivery.completion_approved_by}`);

function explicitCompletion(note) {
  return /\b(project|delivery|run|work)\b/i.test(note) &&
    /\b(complete|completed|finished|done|close|closed|approve(?:d)? to close)\b/i.test(note);
}

function parseArgs(rawArgs) {
  const parsed = { stateFile: "", approver: "", note: "", evidence: "" };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--") && !parsed.stateFile) {
      parsed.stateFile = arg;
      continue;
    }
    if (arg === "--approver") {
      parsed.approver = rawArgs[++index] || "";
      continue;
    }
    if (arg === "--note") {
      parsed.note = rawArgs[++index] || "";
      continue;
    }
    if (arg === "--evidence") {
      parsed.evidence = rawArgs[++index] || "";
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}
