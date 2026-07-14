#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { states, transitions, canTransition } = require("./lib/state-machine");
const { appendEvent } = require("./lib/memory-store");
const { checkContext, updateSessionMarker } = require("./lib/context-check");
const { enforcePolicy } = require("./lib/policy");
const { loadSecretEnv } = require("./lib/env-loader");
const { loadWorkflowState, writeWorkflowState } = require("./lib/state-store");

const [file, nextState, ...noteParts] = process.argv.slice(2);
const note = noteParts.join(" ").trim();

if (!file || !nextState) {
  console.error("Usage: node scripts/transition.js path/to/workflow-state.json NEXT_STATE [NOTE]");
  process.exit(1);
}

const unexpectedOptions = noteParts.filter((part) => /^--[A-Za-z0-9-]+$/.test(part));
if (unexpectedOptions.length) {
  console.error(`Unexpected option(s): ${unexpectedOptions.join(", ")}`);
  console.error("Usage: node scripts/transition.js path/to/workflow-state.json NEXT_STATE [NOTE]");
  process.exit(1);
}

if (!states.includes(nextState)) {
  console.error(`Invalid next state: ${nextState}`);
  console.error(`Allowed states: ${states.join(", ")}`);
  process.exit(1);
}

const statePath = path.resolve(file);
loadSecretEnv(statePath);
let state;
try {
  state = loadWorkflowState(statePath);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const currentState = state.current_state;

if (!canTransition(currentState, nextState)) {
  const allowed = transitions[currentState] || [];
  console.error(`Illegal transition: ${currentState} -> ${nextState}`);
  console.error(`Allowed from ${currentState}: ${allowed.join(", ") || "(none)"}`);
  process.exit(1);
}

checkContext("transition.js");

const tasks = state.task_graph && Array.isArray(state.task_graph.tasks) ? state.task_graph.tasks : [];
const errors = checklistErrors(state, currentState, nextState);

try {
  enforcePolicy(statePath, { phase: "transition", nextState });
} catch (error) {
  errors.push(error.message);
}

if (errors.length) {
  console.error("Transition rejected:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const now = new Date().toISOString();

if (nextState === "implementation_in_progress") {
  state.agent_dispatch = state.agent_dispatch || {};
  state.agent_dispatch.mode = state.agent_dispatch.mode || "multi_agent";
  state.agent_dispatch.parallel_allowed = true;
  state.agent_dispatch.max_parallel_agents = Math.max(Number(state.agent_dispatch.max_parallel_agents || 0), 2);
}

if (nextState === "task_breakdown" && ["implementation_in_progress", "implementation_review", "done"].includes(currentState)) {
  resetImplementationReview(state);
}

state.current_state = nextState;
state.delivery = state.delivery || {};
state.delivery.updated_at = now;
state.log = state.log || [];
state.log.push({
  at: now,
  state: nextState,
  note: note || `Transitioned from ${currentState} to ${nextState}.`
});

writeWorkflowState(statePath, state, { writer: "transition.js" });
updateSessionMarker(statePath, {
  state: nextState,
  state_updated_at: state.delivery.updated_at
});

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

console.log(`OK: ${currentState} -> ${nextState}`);

function checklistErrors(candidate, from, to) {
  const result = [];
  const taskList = candidate.task_graph && Array.isArray(candidate.task_graph.tasks)
    ? candidate.task_graph.tasks
    : [];

  if (to === "knowledge_discovery") {
    const readiness = candidate.tool_readiness || {};
    if (!["ready", "partial"].includes(readiness.status)) result.push("tool_readiness.status must be ready or partial");
    if (!readiness.choices || !readiness.choices.product_tracker) result.push("tool_readiness.choices.product_tracker is required");
    if (!readiness.choices || !readiness.choices.code_host) result.push("tool_readiness.choices.code_host is required");
  }

  if (to === "product_review") {
    requireArtifact(candidate, "product_requirements", result);
    if (!candidate.knowledge || !Array.isArray(candidate.knowledge.sources) || !candidate.knowledge.sources.length) {
      result.push("knowledge.sources must list evidence sources");
    }
    if (!candidate.knowledge || !Array.isArray(candidate.knowledge.findings) || !candidate.knowledge.findings.length) {
      result.push("knowledge.findings must contain source-backed findings");
    }
  }

  if (from === "product_review" && to === "design_assembly") {
    requireGate(candidate, "product_review", result);
  }

  if (to === "system_rules_review") {
    requireArtifact(candidate, "design_assets", result);
    requireArtifact(candidate, "system_rules", result);
  }

  if (from === "system_rules_review" && to === "task_breakdown") {
    requireGate(candidate, "system_rules_review", result);
  }

  if (from === "task_breakdown" && to === "implementation_in_progress") {
    if (!taskList.length) result.push("task_graph.tasks must contain Linear-backed tasks");
    if (!candidate.task_graph || candidate.task_graph.dependencies_checked !== true) {
      result.push("task_graph.dependencies_checked must be true");
    }
    for (const task of taskList) {
      requireTaskTemplate(task, result);
    }
    const dispatch = candidate.agent_dispatch || {};
    if (dispatch.mode !== "multi_agent" && taskList.some((task) => ["frontend", "backend"].includes(task.lane))) {
      result.push("agent_dispatch.mode must be multi_agent for frontend/backend implementation");
    }
  }

  if (to === "implementation_review") {
    const devTasks = taskList.filter((task) => ["frontend_dev", "frontend_test", "backend_dev", "backend_test"].includes(task.role));
    const unverified = devTasks.filter((task) => !["verified", "waived", "not_applicable"].includes(task.status));
    if (unverified.length) {
      result.push(`all frontend/backend tasks must be verified before implementation_review: ${unverified.map((task) => `${task.id}:${task.status}`).join(", ")}`);
    }
    if (!candidate.artifacts || !candidate.artifacts.product_requirements || !candidate.artifacts.product_requirements.path) {
      result.push("product requirements artifact is required for implementation review");
    }
  }

  if (from === "implementation_review" && to === "done") {
    requireGate(candidate, "implementation_review", result);
    requireCompletionApproval(candidate, result);
  }

  return result;
}

function requireArtifact(candidate, key, result) {
  const artifact = candidate.artifacts && candidate.artifacts[key];
  if (!artifact) {
    result.push(`artifacts.${key} is missing`);
    return;
  }
  if (!["ready_for_review", "approved", "published"].includes(artifact.status)) {
    result.push(`artifacts.${key}.status must be ready_for_review, approved, or published`);
  }
  if (!artifact.path && !artifact.url) {
    result.push(`artifacts.${key}.path or url is required`);
  }
}

function requireGate(candidate, key, result) {
  const gate = candidate.gates && candidate.gates[key];
  if (!gate || gate.status !== "approved") {
    result.push(`gates.${key}.status must be approved`);
  }
  if (!gate || !gate.approver) {
    result.push(`gates.${key}.approver is required`);
  }
  if (!gate || !gate.decided_at) {
    result.push(`gates.${key}.decided_at is required`);
  }
}

function requireCompletionApproval(candidate, result) {
  const delivery = candidate.delivery || {};
  if (delivery.completion_approved !== true) {
    result.push("delivery.completion_approved must be true before transitioning to done. Use record-completion-approval.js only after the human explicitly says this delivery/project is complete.");
  }
  if (!delivery.completion_approved_by) {
    result.push("delivery.completion_approved_by is required before done");
  }
  if (!delivery.completion_approved_at) {
    result.push("delivery.completion_approved_at is required before done");
  }
}

function requireTaskTemplate(task, result) {
  const prefix = task.id || "(unknown task)";
  if (!task.linear_id) result.push(`${prefix}: linear_id is required`);
  if (!task.description) result.push(`${prefix}: description is required`);
  if (!Array.isArray(task.definition_of_done) || !task.definition_of_done.length) result.push(`${prefix}: definition_of_done is required`);
  if (!Array.isArray(task.verification) || !task.verification.length) result.push(`${prefix}: verification/test plan is required`);
  if (!Array.isArray(task.expected_changes) || !task.expected_changes.length) result.push(`${prefix}: expected_changes is required`);
  if (!task.scope || !Array.isArray(task.scope.allowed_paths) || !task.scope.allowed_paths.length) result.push(`${prefix}: scope.allowed_paths is required`);
}

function resetImplementationReview(candidate) {
  if (candidate.gates && candidate.gates.implementation_review) {
    candidate.gates.implementation_review.status = "not_ready";
    candidate.gates.implementation_review.approver = "";
    candidate.gates.implementation_review.approval_note = "";
    candidate.gates.implementation_review.decided_at = "";
    candidate.gates.implementation_review.evidence = [];
  }
}
