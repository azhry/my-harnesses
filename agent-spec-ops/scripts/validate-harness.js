#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { states } = require("./lib/state-machine");

const root = path.resolve(__dirname, "..");

const requiredFiles = [
  "AGENTS.md",
  "README.md",
  "harness.yaml",
  "harness-policy.json",
  "package.json",
  "docs/agent-boot.md",
  "docs/workflow.md",
  "docs/state-transitions.md",
  "docs/state-machine.svg",
  "docs/roles.md",
  "docs/human-gates.md",
  "docs/knowledge-discovery.md",
  "docs/design-assembly.md",
  "docs/git-lifecycle.md",
  "docs/agent-dispatch.md",
  "docs/monitor-ui.md",
  "schemas/workflow-state.schema.json",
  "schemas/event.schema.json",
  "schemas/knowledge-card.schema.json",
  "templates/workflow-state.json",
  "templates/product-requirements.md",
  "templates/stitch-ui-prompt.md",
  "templates/ui-design-spec.md",
  "templates/system-rules.md",
  "templates/task-breakdown.md",
  "templates/pull-request-template.md",
  "templates/frontend-test-plan.md",
  "templates/backend-test-plan.md",
  "templates/failure-report.md",
  "ui/monitor/index.html",
  "ui/monitor/styles.css",
  "ui/monitor/app.js",
  "scripts/lib/state-machine.js",
  "scripts/lib/memory-store.js",
  "scripts/lib/state-store.js",
  "scripts/lib/monitor-data.js",
  "scripts/lib/env-loader.js",
  "scripts/lib/policy.js",
  "scripts/new-delivery.js",
  "scripts/check-tool-readiness.js",
  "scripts/fetch-stitch-designs.js",
  "scripts/plan-agent-dispatch.js",
  "scripts/record-agent-spawn.js",
  "scripts/record-task-breakdown.js",
  "scripts/record-event.js",
  "scripts/record-knowledge.js",
  "scripts/record-test-results.js",
  "scripts/record-pr-review.js",
  "scripts/run-task-command.js",
  "scripts/submit-task.js",
  "scripts/monitor-runs.js",
  "scripts/read-context.js",
  "scripts/read-instructions.js",
  "scripts/enforce-policy.js",
  "scripts/transition.js",
  "scripts/transition-task.js",
  "scripts/enforce-git-lifecycle.js",
  "scripts/generate-project-agents.js",
  "scripts/sync-linear-task.js",
  "scripts/reopen-delivery.js",
  "scripts/check-write-scope.js",
  "scripts/check-harness-integrity.js",
  "scripts/check-linear-connectivity.js",
  "scripts/seal-state.js",
  "scripts/verify-integration.js",
  "scripts/validate-state.js"
];

const scriptFiles = requiredFiles.filter((file) => file.startsWith("scripts/") && file.endsWith(".js"));
const jsonFiles = [
  "templates/workflow-state.json",
  "schemas/workflow-state.schema.json",
  "schemas/event.schema.json",
  "schemas/knowledge-card.schema.json",
  "package.json",
  "harness-policy.json"
];

const errors = [];

for (const relative of requiredFiles) {
  if (!fs.existsSync(path.join(root, relative))) errors.push(`Missing required file: ${relative}`);
}

for (const relative of scriptFiles) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, relative)], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.status !== 0) errors.push(`${relative} failed node --check:\n${result.stderr || result.stdout}`);
}

for (const relative of jsonFiles) {
  try {
    JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  } catch (error) {
    errors.push(`${relative} is not valid JSON: ${error.message}`);
  }
}

const schema = JSON.parse(fs.readFileSync(path.join(root, "schemas/workflow-state.schema.json"), "utf8"));
const schemaStates = schema.properties.current_state.enum || [];
const missing = states.filter((state) => !schemaStates.includes(state));
const extra = schemaStates.filter((state) => !states.includes(state));
if (missing.length || extra.length) {
  errors.push(`Schema state enum drift. Missing: ${missing.join(", ") || "(none)"}; Extra: ${extra.join(", ") || "(none)"}`);
}

const validator = path.join(root, "scripts", "validate-state.js");
const result = spawnSync(process.execPath, [validator, path.join(root, "templates/workflow-state.json")], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, LINEAR_API_KEY: process.env.LINEAR_API_KEY || "lin_test_12345678901234567890", LINEAR_TEAM_ID: process.env.LINEAR_TEAM_ID || "team-test" }
});
if (result.status !== 0) {
  errors.push(`templates/workflow-state.json failed state validation:\n${result.stderr || result.stdout}`);
}

if (errors.length) {
  console.error("Harness validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("OK: compact agent-spec-ops harness is valid");
