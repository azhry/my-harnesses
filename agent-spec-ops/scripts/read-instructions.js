#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { transitions } = require("./lib/state-machine");
const { loadWorkflowState } = require("./lib/state-store");

const args = parseArgs(process.argv.slice(2));
if (!args.stateFile) {
  console.error("Usage: node scripts/read-instructions.js runs/<DELIVERY_ID>/workflow-state.json [--role ROLE]");
  process.exit(1);
}

let state;
try {
  state = loadWorkflowState(path.resolve(args.stateFile));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const current = state.current_state || "unknown";
const allowed = transitions[current] || [];
const role = args.role || inferRole(state);

console.log(`STATE ${current}`);
console.log(`ROLE ${role}`);
console.log("");
console.log(stateRule(current));
console.log("");
console.log("LEGAL NEXT:");
for (const next of allowed) console.log(`- ${next}: ${checklist(current, next).join("; ")}`);
console.log("");
console.log(roleRule(role));
console.log("");
console.log("ROLE GATES:");
for (const line of roleGates(current, role)) {
  console.log(line);
}

function stateRule(stateName) {
  const rules = {
    intake: "Normalize request and create/select the run.",
    tool_readiness: "Check Linear, code host, repo access, and frontend/backend tooling. Linear is required before task execution.",
    knowledge_discovery: "Gather source-backed facts. Do not invent requirements.",
    product_requirements: "Write product requirements with acceptance criteria and source evidence.",
    product_review: "Stop for human product review. If rejected, go back to knowledge_discovery.",
    design_assembly: "Assemble approved design inputs/assets.",
    system_rules: "Write implementation rules from approved product requirements and design.",
    system_rules_review: "Stop for human system-rules review. If rejected, go back to design_assembly.",
    task_breakdown: "Create Linear tasks using the required task template. Rework always returns here.",
    implementation_in_progress: "Spawn separate dev/test subagents. Frontend and backend may run in parallel.",
    implementation_review: "Verify implementation against product requirements, then stop for human review.",
    done: "Delivery complete.",
    blocked: "Stop until user intervention clears the blocker."
  };
  return rules[stateName] || "Unknown state. Validate state before acting.";
}

function checklist(from, to) {
  const checks = {
    "intake->tool_readiness": ["delivery id/title/request recorded"],
    "tool_readiness->knowledge_discovery": ["Linear ready", "code host ready", "repo access known"],
    "knowledge_discovery->product_requirements": ["sources listed", "findings recorded", "gaps listed"],
    "product_requirements->product_review": ["requirements artifact ready", "acceptance criteria present", "sources linked"],
    "product_review->design_assembly": ["product_review gate approved by human"],
    "product_review->knowledge_discovery": ["human requested product changes"],
    "design_assembly->system_rules": ["design assets or approved fallback recorded"],
    "system_rules->system_rules_review": ["system rules artifact ready", "design/product traceable"],
    "system_rules_review->task_breakdown": ["system_rules_review gate approved by human"],
    "system_rules_review->design_assembly": ["human requested design/rules changes"],
    "task_breakdown->implementation_in_progress": ["Linear tasks created", "each task has description/template/checklist", "dependencies checked", "dispatch planned"],
    "implementation_in_progress->implementation_review": ["all frontend/backend tasks verified", "MR comments recorded passed/failed", "task MRs merged", "implementation mapped to requirements"],
    "implementation_in_progress->task_breakdown": ["human rework or scope change recorded"],
    "implementation_review->done": ["implementation_review gate approved by human"],
    "implementation_review->implementation_in_progress": ["human requested implementation fixes"],
    "implementation_review->task_breakdown": ["human requested rework or task/scope changes"]
  };
  return checks[`${from}->${to}`] || ["blocker/reason recorded"];
}

function roleRule(roleName) {
  const rules = {
    product_manager: "Owns product requirements. Output must be reviewable by a human.",
    project_manager: "Owns Linear task breakdown. Every task needs title, description, scope, DoD, test plan, dependencies, and MR description template.",
    frontend_dev: "Implement only assigned frontend task scope. Do not test-sign off your own work.",
    frontend_test: "Test assigned frontend work. On pass/fail, record evidence and MR comment status only. Do not record dev-task merge/check evidence manually.",
    backend_dev: "Implement only assigned backend task scope. Do not test-sign off your own work.",
    backend_test: "Test assigned backend work. On pass/fail, record evidence and MR comment status only. Do not record dev-task merge/check evidence manually.",
    orchestrator: "Owns state transitions, subagent dispatch, review gates, and rework routing. Valid only inside the agent-spec-orchestrator OpenCode agent, not a default build/general session."
  };
  return rules[roleName] || rules.orchestrator;
}

function roleGates(stateName, roleName) {
  if (stateName !== "implementation_in_progress") {
    return ["- Follow the transition checklist for this state.", "- Do not skip human review gates."];
  }
  if (roleName === "orchestrator") {
    return [
      "- ALLOWED: read state, plan-agent-dispatch, record-agent-spawn, inspect status, route rework.",
      "- DENIED: edit project files, run dev/test directly, transition tasks without a recorded role lease, claim implementation complete.",
      "- REQUIRED: spawn separate dev and test agents; record each returned agent id before task transitions."
    ];
  }
  if (roleName === "frontend_dev" || roleName === "backend_dev") {
    return [
      "- ALLOWED: edit only active assigned task scope after check-write-scope passes for this role.",
      "- DENIED: test-sign off your own work, verify the task, edit planned tasks, edit unrelated dirty files.",
      "- REQUIRED: record changed files/evidence, then transition active -> implemented."
    ];
  }
  if (roleName === "frontend_test" || roleName === "backend_test") {
    return [
      "- ALLOWED: verify the assigned implemented task and record passed/failed evidence.",
      "- DENIED: edit implementation files, implement planned work, bypass MR status comment or merge evidence.",
      "- REQUIRED: transition implemented -> testing, run checks, record-test-results without manual merge/check flags, then hand back for submit-task.js."
    ];
  }
  return ["- DENIED: implementation actions are reserved for orchestrator, dev, and test roles."];
}

function inferRole(state) {
  const active = Object.entries(state.roles || {}).find(([, value]) => value && value.status === "in_progress");
  return active ? active[0] : "orchestrator";
}

function parseArgs(rawArgs) {
  const parsed = { stateFile: "", role: "" };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--") && !parsed.stateFile) {
      parsed.stateFile = arg;
      continue;
    }
    if (arg === "--role") {
      parsed.role = rawArgs[++index] || "";
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}
