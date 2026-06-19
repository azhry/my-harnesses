#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { appendEvent } = require("./lib/memory-store");

const [file] = process.argv.slice(2);
if (!file) {
  console.error("Usage: node scripts/generate-api-docs.js runs/<DELIVERY_ID>/workflow-state.json");
  process.exit(1);
}

const statePath = path.resolve(file);
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const runDir = path.dirname(statePath);
const deliveryId = state.delivery && state.delivery.id ? state.delivery.id : path.basename(runDir);
const contracts = state.contracts && Array.isArray(state.contracts.interfaces) ? state.contracts.interfaces : [];

if (!contracts.length) {
  console.log("No API contracts found — nothing to document");
  process.exit(0);
}

const lines = [];
lines.push(`# API Documentation — ${deliveryId}`);
lines.push(``);
lines.push(`> Generated from contract interfaces defined in the delivery plan.`);
lines.push(`> **Generated at:** ${new Date().toISOString()}`);
lines.push(``);

for (const contract of contracts) {
  lines.push(`## ${contract.id}`);
  lines.push(``);
  lines.push(`- **Kind:** ${contract.kind}`);
  lines.push(`- **Producer:** ${contract.producer_task_id || "—"}`);
  lines.push(`- **Consumer:** ${contract.consumer_task_id || "—"}`);
  lines.push(`- **Status:** ${contract.status}`);
  lines.push(``);

  if (Array.isArray(contract.expected_fields) && contract.expected_fields.length) {
    lines.push(`### Expected Fields`);
    lines.push(``);
    lines.push(`| Name | Type | Required |`);
    lines.push(`| --- | --- | --- |`);
    for (const field of contract.expected_fields) {
      lines.push(`| ${field.name} | ${field.type} | ${field.required ? "Yes" : "No"} |`);
    }
    lines.push(``);
  }

  if (Array.isArray(contract.actual_producer_fields) && contract.actual_producer_fields.length) {
    lines.push(`### Actual Producer Fields`);
    lines.push(``);
    lines.push(`| Name | Type | Required |`);
    lines.push(`| --- | --- | --- |`);
    for (const field of contract.actual_producer_fields) {
      lines.push(`| ${field.name} | ${field.type} | ${field.required ? "Yes" : "No"} |`);
    }
    lines.push(``);
  }

  if (Array.isArray(contract.actual_consumer_fields) && contract.actual_consumer_fields.length) {
    lines.push(`### Actual Consumer Fields`);
    lines.push(``);
    lines.push(`| Name | Type | Required |`);
    lines.push(`| --- | --- | --- |`);
    for (const field of contract.actual_consumer_fields) {
      lines.push(`| ${field.name} | ${field.type} | ${field.required ? "Yes" : "No"} |`);
    }
    lines.push(``);
  }

  if (Array.isArray(contract.evidence) && contract.evidence.length) {
    lines.push(`### Evidence`);
    for (const evidence of contract.evidence) {
      lines.push(`- ${evidence}`);
    }
    lines.push(``);
  }

  if (Array.isArray(contract.blockers) && contract.blockers.length) {
    lines.push(`### Blockers`);
    for (const blocker of contract.blockers) {
      lines.push(`- ${blocker}`);
    }
    lines.push(``);
  }
}

const apiPath = path.join(runDir, "api-docs.md");
fs.writeFileSync(apiPath, lines.join("\n") + "\n");
console.log(`Generated: ${apiPath}`);

appendEvent(statePath, {
  type: "artifact_generated",
  role_context: "orchestrator",
  task_id: "",
  target: "api-docs.md",
  summary: `Generated API docs for ${deliveryId}`,
  details: `Documented ${contracts.length} contracts in ${apiPath}`,
  severity: "info",
  tags: ["artifact", "api-docs", deliveryId]
});
