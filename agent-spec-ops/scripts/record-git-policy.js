#!/usr/bin/env node
"use strict";

const path = require("path");
const { appendEvent } = require("./lib/memory-store");
const { loadSecretEnv } = require("./lib/env-loader");
const { loadWorkflowState, writeWorkflowState } = require("./lib/state-store");

const args = parseArgs(process.argv.slice(2));

if (!args.stateFile) {
  console.error([
    "Usage: node scripts/record-git-policy.js runs/<DELIVERY_ID>/workflow-state.json [options]",
    "",
    "Options:",
    "  --same-account-admin-no-protection",
    "  --approver NAME",
    "  --evidence TEXT       repeatable"
  ].join("\n"));
  process.exit(1);
}

if (!args.sameAccountAdminNoProtection) {
  console.error("No policy change requested. Use --same-account-admin-no-protection.");
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
state.implementation = state.implementation || {};
state.implementation.git_policy = state.implementation.git_policy || {};
const policy = state.implementation.git_policy;

if (args.sameAccountAdminNoProtection) {
  policy.review_required_before_merge = false;
  policy.allow_same_github_account_review = true;
  policy.allow_admin_merge = true;
  policy.auto_merge_requires_checks = false;
  policy.auto_merge_default = true;
  policy.auto_merge_disabled_reason = "";
}

policy.evidence = Array.isArray(policy.evidence) ? policy.evidence : [];
for (const evidence of args.evidence) {
  if (evidence) policy.evidence.push(evidence);
}
policy.evidence.push(`Git policy recorded by ${args.approver || "orchestrator"} at ${now}`);

state.delivery = state.delivery || {};
state.delivery.updated_at = now;
state.log = state.log || [];
state.log.push({
  at: now,
  state: state.current_state || "",
  note: `Git policy updated by ${args.approver || "orchestrator"}: same-account admin merge allowed; independent review/protected checks not required.`
});

writeWorkflowState(statePath, state, { writer: "record-git-policy.js" });

appendEvent(statePath, {
  type: "git_policy_updated",
  role_context: "orchestrator",
  task_id: "",
  target: "implementation.git_policy",
  summary: "Recorded same-account/admin GitHub policy for this run",
  details: "Same GitHub account review/admin merge is allowed; independent PR review and protected check gates are not required by this run policy.",
  severity: "info",
  tags: ["git_policy", "same_account", "admin_merge"],
  evidence: args.evidence
});

console.log("OK: git policy updated");
console.log(`- review_required_before_merge: ${policy.review_required_before_merge}`);
console.log(`- allow_same_github_account_review: ${policy.allow_same_github_account_review}`);
console.log(`- allow_admin_merge: ${policy.allow_admin_merge}`);
console.log(`- auto_merge_requires_checks: ${policy.auto_merge_requires_checks}`);

function parseArgs(rawArgs) {
  const parsed = {
    stateFile: "",
    sameAccountAdminNoProtection: false,
    approver: "",
    evidence: []
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--") && !parsed.stateFile) {
      parsed.stateFile = arg;
      continue;
    }
    if (arg === "--same-account-admin-no-protection") {
      parsed.sameAccountAdminNoProtection = true;
      continue;
    }
    if (arg === "--approver") {
      parsed.approver = rawArgs[++index] || "";
      continue;
    }
    if (arg === "--evidence") {
      parsed.evidence.push(rawArgs[++index] || "");
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}
