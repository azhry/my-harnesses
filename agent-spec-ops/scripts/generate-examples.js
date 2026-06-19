#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { appendEvent } = require("./lib/memory-store");

const [file] = process.argv.slice(2);
if (!file) {
  console.error("Usage: node scripts/generate-examples.js runs/<DELIVERY_ID>/workflow-state.json");
  process.exit(1);
}

const statePath = path.resolve(file);
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const runDir = path.dirname(statePath);
const deliveryId = state.delivery && state.delivery.id ? state.delivery.id : path.basename(runDir);
const contracts = state.contracts && Array.isArray(state.contracts.interfaces) ? state.contracts.interfaces : [];

if (!contracts.length) {
  console.log("No API contracts found — nothing to generate");
  process.exit(0);
}

const generateValue = (type) => {
  const typeMap = {
    string: '"example-string"',
    number: "42",
    integer: "1",
    boolean: "true",
    array: "[]",
    object: "{}",
    date: '"2026-06-19"',
    datetime: '"2026-06-19T00:00:00Z"',
    uuid: '"550e8400-e29b-41d4-a716-446655440000"',
    email: '"user@example.com"',
    url: '"https://example.com"',
    id: '"abc-123"'
  };
  return typeMap[type] || '"value"';
};

const fieldToExample = (field, indent = 2) => {
  const padding = " ".repeat(indent);
  const value = field.required ? generateValue(field.type) : `"${field.name}"`;
  return `${padding}"${field.name}": ${value}`;
};

const lines = [];
lines.push(`# Example Payloads — ${deliveryId}`);
lines.push(``);
lines.push(`> Auto-generated from contract interface definitions.`);
lines.push(`> **Generated at:** ${new Date().toISOString()}`);
lines.push(``);

for (const contract of contracts) {
  const fields = contract.expected_fields || [];
  if (!fields.length) continue;

  lines.push(`## ${contract.id}`);
  lines.push(``);
  lines.push(`### Request`);
  lines.push(``);
  lines.push("\`\`\`json");
  lines.push(`{`);
  const requestFields = fields.filter((f) => contract.consumer_task_id);
  if (requestFields.length) {
    for (let index = 0; index < requestFields.length; index++) {
      const comma = index < requestFields.length - 1 ? "," : "";
      lines.push(`${fieldToExample(requestFields[index])}${comma}`);
    }
  } else {
    lines.push(fieldToExample(fields[0]) + ",");
    lines.push(`  "example_field": "value"`);
  }
  lines.push(`}`);
  lines.push("\`\`\`");
  lines.push(``);

  lines.push(`### Response`);
  lines.push(``);
  lines.push("\`\`\`json");
  lines.push(`{`);
  const responseFields = fields.filter((f) => contract.producer_task_id);
  if (responseFields.length) {
    for (let index = 0; index < responseFields.length; index++) {
      const comma = index < responseFields.length - 1 ? "," : "";
      lines.push(`${fieldToExample(responseFields[index])}${comma}`);
    }
  } else if (fields.length) {
    for (let index = 0; index < fields.length; index++) {
      const comma = index < fields.length - 1 ? "," : "";
      lines.push(`${fieldToExample(fields[index])}${comma}`);
    }
  }
  lines.push(`}`);
  lines.push("\`\`\`");
  lines.push(``);
}

const examplesPath = path.join(runDir, "example-payloads.md");
fs.writeFileSync(examplesPath, lines.join("\n") + "\n");
console.log(`Generated: ${examplesPath}`);

appendEvent(statePath, {
  type: "artifact_generated",
  role_context: "orchestrator",
  task_id: "",
  target: "example-payloads.md",
  summary: `Generated example payloads for ${deliveryId}`,
  details: `Generated ${contracts.length} contract examples in ${examplesPath}`,
  severity: "info",
  tags: ["artifact", "examples", deliveryId]
});
