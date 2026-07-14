#!/usr/bin/env node
"use strict";

const path = require("path");
const { appendEvent } = require("./lib/memory-store");
const { loadSecretEnv } = require("./lib/env-loader");
const { loadWorkflowState, writeWorkflowState } = require("./lib/state-store");

const args = parseArgs(process.argv.slice(2));

if (!args.stateFile) {
  console.error([
    "Usage: node scripts/record-run-directives.js runs/<DELIVERY_ID>/workflow-state.json [options]",
    "",
    "Options:",
    "  --do-not-reask-approval",
    "  --continue-end-to-end",
    "  --never-complete-project",
    "  --require-run-secrets NAME,NAME",
    "  --approved-action TEXT     repeatable",
    "  --evidence TEXT            repeatable",
    "  --note TEXT                repeatable"
  ].join("\n"));
  process.exit(1);
}

const statePath = path.resolve(args.stateFile);
loadSecretEnv(statePath);

let state;
try {
  state = loadWorkflowState(statePath);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const now = new Date().toISOString();
const directives = ensureDirectives(state);

if (args.doNotReaskApproval) {
  directives.approval.do_not_reask_for_approved_workflow = true;
}
for (const action of args.approvedActions) {
  if (action && !directives.approval.approved_actions.includes(action)) {
    directives.approval.approved_actions.push(action);
  }
}
if (args.continueEndToEnd) {
  directives.execution.continue_until_end_to_end = true;
  directives.execution.do_not_stop_until_blocked = true;
}
if (args.neverCompleteProject) {
  directives.project_completion.never_complete_project_until_user_says_so = true;
  directives.project_completion.linear_project_completion_allowed = false;
}
if (args.requiredSecretKeys.length) {
  directives.credentials.run_secrets_required = true;
  for (const key of args.requiredSecretKeys) {
    if (key && !directives.credentials.expected_secret_keys.includes(key)) {
      directives.credentials.expected_secret_keys.push(key);
    }
  }
}

for (const evidence of args.evidence) {
  if (!evidence) continue;
  directives.approval.evidence.push(evidence);
  directives.execution.evidence.push(evidence);
  directives.project_completion.evidence.push(evidence);
  directives.credentials.evidence.push(evidence);
}
for (const note of args.notes) {
  if (note) directives.notes.push(note);
}

state.delivery = state.delivery || {};
state.delivery.updated_at = now;
state.log = state.log || [];
state.log.push({
  at: now,
  state: state.current_state || "",
  note: "Run directives updated from repeated human instructions."
});

writeWorkflowState(statePath, state, { writer: "record-run-directives.js" });

appendEvent(statePath, {
  type: "run_directives_updated",
  role_context: "orchestrator",
  task_id: "",
  target: "run_directives",
  summary: "Recorded durable user operating directives for this run",
  details: args.notes.join("\n"),
  severity: "info",
  tags: ["run_directives", "user_intent"],
  evidence: args.evidence
});

console.log("OK: run directives updated");
printDirectives(directives);

function ensureDirectives(state) {
  state.run_directives = state.run_directives || {};
  const d = state.run_directives;
  d.status = d.status || "active";
  d.approval = d.approval || {};
  d.approval.do_not_reask_for_approved_workflow = Boolean(d.approval.do_not_reask_for_approved_workflow);
  d.approval.approved_actions = Array.isArray(d.approval.approved_actions) ? d.approval.approved_actions : [];
  d.approval.evidence = Array.isArray(d.approval.evidence) ? d.approval.evidence : [];
  d.execution = d.execution || {};
  d.execution.continue_until_end_to_end = Boolean(d.execution.continue_until_end_to_end);
  d.execution.do_not_stop_until_blocked = Boolean(d.execution.do_not_stop_until_blocked);
  d.execution.evidence = Array.isArray(d.execution.evidence) ? d.execution.evidence : [];
  d.project_completion = d.project_completion || {};
  d.project_completion.never_complete_project_until_user_says_so = Boolean(d.project_completion.never_complete_project_until_user_says_so);
  d.project_completion.linear_project_completion_allowed = Boolean(d.project_completion.linear_project_completion_allowed);
  d.project_completion.evidence = Array.isArray(d.project_completion.evidence) ? d.project_completion.evidence : [];
  d.credentials = d.credentials || {};
  d.credentials.run_secrets_required = Boolean(d.credentials.run_secrets_required);
  d.credentials.expected_secret_keys = Array.isArray(d.credentials.expected_secret_keys) ? d.credentials.expected_secret_keys : [];
  d.credentials.evidence = Array.isArray(d.credentials.evidence) ? d.credentials.evidence : [];
  d.notes = Array.isArray(d.notes) ? d.notes : [];
  return d;
}

function printDirectives(d) {
  console.log(`- do_not_reask_for_approved_workflow: ${d.approval.do_not_reask_for_approved_workflow}`);
  console.log(`- continue_until_end_to_end: ${d.execution.continue_until_end_to_end}`);
  console.log(`- do_not_stop_until_blocked: ${d.execution.do_not_stop_until_blocked}`);
  console.log(`- never_complete_project_until_user_says_so: ${d.project_completion.never_complete_project_until_user_says_so}`);
  console.log(`- linear_project_completion_allowed: ${d.project_completion.linear_project_completion_allowed}`);
  console.log(`- run_secrets_required: ${d.credentials.run_secrets_required}`);
  console.log(`- expected_secret_keys: ${d.credentials.expected_secret_keys.join(", ") || "(none)"}`);
}

function parseArgs(rawArgs) {
  const parsed = {
    stateFile: "",
    doNotReaskApproval: false,
    continueEndToEnd: false,
    neverCompleteProject: false,
    requiredSecretKeys: [],
    approvedActions: [],
    evidence: [],
    notes: []
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--") && !parsed.stateFile) {
      parsed.stateFile = arg;
      continue;
    }
    if (arg === "--do-not-reask-approval") {
      parsed.doNotReaskApproval = true;
      continue;
    }
    if (arg === "--continue-end-to-end") {
      parsed.continueEndToEnd = true;
      continue;
    }
    if (arg === "--never-complete-project") {
      parsed.neverCompleteProject = true;
      continue;
    }
    if (arg === "--require-run-secrets") {
      parsed.requiredSecretKeys.push(...splitList(rawArgs[++index] || ""));
      continue;
    }
    if (arg === "--approved-action") {
      parsed.approvedActions.push(rawArgs[++index] || "");
      continue;
    }
    if (arg === "--evidence") {
      parsed.evidence.push(rawArgs[++index] || "");
      continue;
    }
    if (arg === "--note") {
      parsed.notes.push(rawArgs[++index] || "");
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function splitList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}
