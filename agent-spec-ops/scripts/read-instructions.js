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
console.log("GIT POLICY:");
for (const line of gitPolicyLines(state)) {
  console.log(line);
}
console.log("");
console.log("RUN DIRECTIVES:");
for (const line of runDirectiveLines(state)) {
  console.log(line);
}
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
    task_breakdown: "Write task-breakdown JSON, run record-task-breakdown.js, then sync Linear with --create. Do not mutate task_graph.tasks directly. Rework always returns here.",
    implementation_in_progress: "Spawn separate dev/test subagents. Frontend and backend may run in parallel.",
    implementation_review: "Verify implementation against product requirements, then stop for human review. Do not mark the delivery/project done unless the human explicitly approved completion with record-completion-approval.js.",
    done: "Delivery slice is closed, not project victory. If the human identifies remaining scope, route rework to task_breakdown.",
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
    "task_breakdown->implementation_in_progress": ["tasks recorded with record-task-breakdown.js", "Linear tasks created", "each task has description/template/checklist/MR description", "dependencies checked", "dispatch planned"],
    "implementation_in_progress->implementation_review": ["all frontend/backend tasks verified", "MR comments recorded passed/failed", "task MRs merged", "implementation mapped to requirements"],
    "implementation_in_progress->task_breakdown": ["human rework or scope change recorded"],
    "implementation_review->done": ["implementation_review gate approved by human", "explicit completion approval recorded with record-completion-approval.js"],
    "implementation_review->implementation_in_progress": ["human requested implementation fixes"],
    "implementation_review->task_breakdown": ["human requested rework or task/scope changes"],
    "done->task_breakdown": ["human requested remaining scope or rework"]
  };
  return checks[`${from}->${to}`] || ["blocker/reason recorded"];
}

function roleRule(roleName) {
  const rules = {
    product_manager: "Owns product requirements. Output must be reviewable by a human.",
    project_manager: "Owns Linear task breakdown. Write task JSON, run record-task-breakdown.js, then sync Linear. Every task needs title, description, scope, DoD, test plan, dependencies, and MR description template.",
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
    if (stateName === "done") {
      return [
        "- DENIED: declare the whole project complete, mark the Linear project Completed, or celebrate victory unless the human explicitly says to close the project.",
        "- ALLOWED: if the human identifies remaining scope, transition done -> task_breakdown and record new tasks."
      ];
    }
    return ["- Follow the transition checklist for this state.", "- Do not skip human review gates."];
  }
  if (roleName === "orchestrator") {
    return [
      "- ALLOWED: read state, plan-agent-dispatch, record-agent-spawn, inspect status, route rework.",
      "- DENIED: edit project files, run dev/test directly, start dev servers or E2E suites, transition tasks without a recorded role lease, claim implementation complete, mark the Linear project Completed.",
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
      "- ALLOWED: verify the assigned implemented task with bounded, task-scoped commands and record passed/failed evidence.",
      "- DENIED: edit implementation files, implement planned work, rerun full suites repeatedly, hide long output behind tail, silently run local browser E2E headless, bypass MR status comment or merge evidence.",
      "- REQUIRED: for local Cypress/Playwright browser E2E, use visible/headed mode by default; headless is only for CI, explicit user request, or final artifact-only checks.",
      "- REQUIRED: transition implemented -> testing, run one focused check loop, record-test-results without manual merge/check flags, then hand back for submit-task.js or dev rework."
    ];
  }
  return ["- DENIED: implementation actions are reserved for orchestrator, dev, and test roles."];
}

function gitPolicyLines(candidate) {
  const policy = candidate.implementation && candidate.implementation.git_policy || {};
  const lines = [
    `- independent PR review required: ${policy.review_required_before_merge === true ? "yes" : "no"}`,
    `- same GitHub account review allowed: ${policy.allow_same_github_account_review === true ? "yes" : "no"}`,
    `- admin merge allowed: ${policy.allow_admin_merge === true ? "yes" : "no"}`,
    `- protected checks required before merge: ${policy.auto_merge_requires_checks === true ? "yes" : "no"}`
  ];
  if (policy.review_required_before_merge === false && policy.allow_admin_merge === true && policy.auto_merge_requires_checks === false) {
    lines.push("- REQUIRED: do not ask for independent reviewer/protected-merge approval; submit-task.js may use same-account/admin flow according to this run policy.");
  }
  return lines;
}

function runDirectiveLines(candidate) {
  const directives = candidate.run_directives || {};
  const approval = directives.approval || {};
  const execution = directives.execution || {};
  const completion = directives.project_completion || {};
  const credentials = directives.credentials || {};
  const lines = [];
  if (approval.do_not_reask_for_approved_workflow) {
    lines.push("- REQUIRED: do not ask the user to approve already-approved workflow actions; use the recorded run policy and harness scripts.");
  }
  if (Array.isArray(approval.approved_actions) && approval.approved_actions.length) {
    for (const action of approval.approved_actions) lines.push(`- APPROVED ACTION: ${action}`);
  }
  if (execution.continue_until_end_to_end) {
    lines.push("- REQUIRED: continue the delivery toward end-to-end app completion; do not stop after one backend/frontend slice unless blocked.");
  }
  if (execution.do_not_stop_until_blocked) {
    lines.push("- REQUIRED: if legal next work exists, continue or dispatch it; only stop for a real blocker, human gate, or exhausted loop limit.");
  }
  if (completion.never_complete_project_until_user_says_so) {
    lines.push("- DENIED: do not declare victory, mark the Linear project Completed, or call the project done until the user explicitly says the project is complete.");
  }
  if (credentials.run_secrets_required) {
    const expected = Array.isArray(credentials.expected_secret_keys) ? credentials.expected_secret_keys.join(", ") : "";
    lines.push(`- REQUIRED: run-scoped secrets are expected (${expected || "unspecified"}); if missing, report the missing run secret file and use record-run-secrets.js rather than proceeding as if credentials do not exist.`);
  }
  if (!lines.length) lines.push("- none recorded");
  return lines;
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
