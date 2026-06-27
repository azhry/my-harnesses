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
  "history/evals.csv",
  "history/remarks.csv",
  "history/token-usage.csv",
  "knowledge/cards/.gitkeep",
  "docs/workflow.md",
  "docs/agent-boot.md",
  "docs/usage.md",
  "docs/state-size.md",
  "docs/roles.md",
  "docs/human-gates.md",
  "docs/tool-readiness.md",
  "docs/measurement.md",
  "docs/agent-dispatch.md",
  "docs/knowledge-discovery.md",
  "docs/local-memory.md",
  "docs/monitor-ui.md",
  "docs/loops.md",
  "docs/verification.md",
  "docs/design-assembly.md",
  "schemas/workflow-state.schema.json",
  "schemas/event.schema.json",
  "schemas/knowledge-card.schema.json",
  "schemas/local-tasks.schema.json",
  "schemas/token-usage.schema.json",
  "templates/workflow-state.json",
  "templates/tasks.json",
  "templates/evals.csv",
  "templates/remarks.csv",
  "templates/token-usage.csv",
  "ui/monitor/index.html",
  "ui/monitor/styles.css",
  "ui/monitor/app.js",
  "templates/tool-readiness-report.md",
  "templates/product-requirements.md",
  "templates/stitch-ui-prompt.md",
  "templates/system-rules.md",
  "templates/task-breakdown.md",
  "templates/knowledge-discovery-report.md",
  "templates/frontend-test-plan.md",
  "templates/backend-test-plan.md",
  "templates/failure-report.md",
  "templates/handoff-report.md",
  "examples/workflow-state.example.json",
  "scripts/lib/state-machine.js",
  "scripts/lib/memory-store.js",
  "scripts/lib/monitor-data.js",
  "scripts/lib/policy.js",
  "scripts/new-delivery.js",
  "scripts/check-tool-readiness.js",
  "scripts/check-contracts.js",
  "scripts/check-scope.js",
  "scripts/plan-agent-dispatch.js",
  "scripts/record-agent-spawn.js",
  "scripts/record-event.js",
  "scripts/record-knowledge.js",
  "scripts/promote-knowledge.js",
  "scripts/query-knowledge.js",
  "scripts/record-eval.js",
  "scripts/record-remark.js",
  "scripts/record-token-usage.js",
  "scripts/update-local-task.js",
  "scripts/monitor-runs.js",
  "scripts/read-instructions.js",
  "scripts/compact-state.js",
  "scripts/enforce-policy.js",
  "scripts/transition.js",
  "scripts/validate-state.js"
];

const errors = [];

for (const relative of requiredFiles) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) {
    errors.push(`Missing required file: ${relative}`);
  }
}

for (const relative of [
  "scripts/lib/state-machine.js",
  "scripts/lib/memory-store.js",
  "scripts/lib/monitor-data.js",
  "scripts/lib/policy.js",
  "scripts/new-delivery.js",
  "scripts/check-tool-readiness.js",
  "scripts/check-contracts.js",
  "scripts/check-scope.js",
  "scripts/plan-agent-dispatch.js",
  "scripts/record-agent-spawn.js",
  "scripts/record-event.js",
  "scripts/record-knowledge.js",
  "scripts/promote-knowledge.js",
  "scripts/query-knowledge.js",
  "scripts/record-eval.js",
  "scripts/record-remark.js",
  "scripts/record-token-usage.js",
  "scripts/update-local-task.js",
  "scripts/monitor-runs.js",
  "scripts/read-instructions.js",
  "scripts/compact-state.js",
  "scripts/enforce-policy.js",
  "scripts/transition.js",
  "scripts/validate-state.js",
  "scripts/validate-harness.js"
]) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, relative)], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    errors.push(`${relative} failed node --check:\n${result.stderr || result.stdout}`);
  }
}

for (const relative of [
  "templates/workflow-state.json",
  "templates/tasks.json",
  "examples/workflow-state.example.json",
  "schemas/workflow-state.schema.json",
  "schemas/event.schema.json",
  "schemas/knowledge-card.schema.json",
  "schemas/local-tasks.schema.json",
  "schemas/token-usage.schema.json",
  "package.json",
  "harness-policy.json"
]) {
  try {
    JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  } catch (error) {
    errors.push(`${relative} is not valid JSON: ${error.message}`);
  }
}

const schemaPath = path.join(root, "schemas", "workflow-state.schema.json");
if (fs.existsSync(schemaPath)) {
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const schemaStates = schema.properties && schema.properties.current_state
    ? schema.properties.current_state.enum || []
    : [];
  compareStateLists("schemas/workflow-state.schema.json current_state enum", schemaStates);
}

const harnessYamlPath = path.join(root, "harness.yaml");
if (fs.existsSync(harnessYamlPath)) {
  const harnessYaml = fs.readFileSync(harnessYamlPath, "utf8");
  const match = harnessYaml.match(/state_order:\r?\n([\s\S]*?)(?:\r?\n\S|$)/);
  const yamlStates = match
    ? match[1].split(/\r?\n/)
        .map((line) => line.match(/^\s*-\s*([a-z0-9_]+)/))
        .filter(Boolean)
        .map((lineMatch) => lineMatch[1])
    : [];
  compareStateLists("harness.yaml state_order", yamlStates);
}

function compareStateLists(label, candidateStates) {
  const expected = new Set(states);
  const actual = new Set(candidateStates);
  const missing = states.filter((state) => !actual.has(state));
  const extra = candidateStates.filter((state) => !expected.has(state));
  if (missing.length || extra.length) {
    errors.push(`${label} drifted from scripts/lib/state-machine.js. Missing: ${missing.join(", ") || "(none)"}; Extra: ${extra.join(", ") || "(none)"}`);
  }
}

const validator = path.join(root, "scripts", "validate-state.js");
for (const relative of ["templates/workflow-state.json", "examples/workflow-state.example.json"]) {
  if (fs.existsSync(validator) && fs.existsSync(path.join(root, relative))) {
    const result = spawnSync(process.execPath, [validator, path.join(root, relative)], {
      cwd: root,
      encoding: "utf8"
    });
    if (result.status !== 0) {
      errors.push(`${relative} failed state validation:\n${result.stderr || result.stdout}`);
    }
  }
}

if (errors.length) {
  console.error("Harness validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("OK: agent-spec-ops files, scripts, template, and example are valid");
