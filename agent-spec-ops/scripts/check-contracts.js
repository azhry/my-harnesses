#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const file = process.argv[2];

if (!file) {
  console.error("Usage: node scripts/check-contracts.js runs/<DELIVERY_ID>/workflow-state.json");
  process.exit(1);
}

const statePath = path.resolve(file);
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const now = new Date().toISOString();
const tasks = new Map((state.task_graph.tasks || []).map((task) => [task.id, task]));
const interfaces = state.contracts && Array.isArray(state.contracts.interfaces)
  ? state.contracts.interfaces
  : [];

function fieldKey(field) {
  return String(field.name || "").trim();
}

function fieldMap(fields) {
  const map = new Map();
  for (const field of fields || []) {
    const key = fieldKey(field);
    if (key) {
      map.set(key, field);
    }
  }
  return map;
}

function compareFields(sideName, expectedFields, actualFields) {
  const mismatches = [];
  const expected = fieldMap(expectedFields);
  const actual = fieldMap(actualFields);

  for (const [name, expectedField] of expected.entries()) {
    const actualField = actual.get(name);
    if (!actualField) {
      mismatches.push(`${sideName} missing expected field ${name}`);
      continue;
    }
    if (expectedField.type !== actualField.type) {
      mismatches.push(`${sideName} field ${name} type mismatch: expected ${expectedField.type}, actual ${actualField.type}`);
    }
    if (Boolean(expectedField.required) !== Boolean(actualField.required)) {
      mismatches.push(`${sideName} field ${name} required mismatch: expected ${expectedField.required}, actual ${actualField.required}`);
    }
  }

  for (const [name] of actual.entries()) {
    if (!expected.has(name)) {
      mismatches.push(`${sideName} has unapproved field ${name}`);
    }
  }

  return mismatches;
}

function checkInterface(contract) {
  const evidence = [];
  const blockers = [];
  const mismatches = [];

  if (!contract.id) {
    blockers.push("Contract interface is missing id");
  }
  if (!Array.isArray(contract.expected_fields) || contract.expected_fields.length === 0) {
    blockers.push(`${contract.id || "contract"} has no expected_fields baseline`);
  }
  if (!Array.isArray(contract.actual_producer_fields) || contract.actual_producer_fields.length === 0) {
    blockers.push(`${contract.id || "contract"} has no actual_producer_fields evidence`);
  }
  if (!Array.isArray(contract.actual_consumer_fields) || contract.actual_consumer_fields.length === 0) {
    blockers.push(`${contract.id || "contract"} has no actual_consumer_fields evidence`);
  }
  if (contract.producer_task_id && !tasks.has(contract.producer_task_id)) {
    blockers.push(`${contract.id} references missing producer task ${contract.producer_task_id}`);
  }
  if (contract.consumer_task_id && !tasks.has(contract.consumer_task_id)) {
    blockers.push(`${contract.id} references missing consumer task ${contract.consumer_task_id}`);
  }

  if (!blockers.length) {
    mismatches.push(...compareFields("producer", contract.expected_fields, contract.actual_producer_fields));
    mismatches.push(...compareFields("consumer", contract.expected_fields, contract.actual_consumer_fields));
  }

  if (blockers.length) {
    contract.status = "blocked";
    contract.blockers = blockers;
    contract.evidence = [`Blocked contract check at ${now}`, ...blockers];
  } else if (mismatches.length) {
    contract.status = "failed";
    contract.blockers = [];
    contract.evidence = [`Failed contract check at ${now}`, ...mismatches];
  } else {
    contract.status = "passed";
    contract.blockers = [];
    contract.evidence = [`Passed contract check at ${now}`];
  }

  evidence.push(...contract.evidence);

  return {
    id: contract.id || `contract-${Date.now()}`,
    description: `${contract.kind || "contract"} ${contract.id || ""}`.trim(),
    status: contract.status === "passed" ? "passed" : contract.status === "failed" ? "failed" : "blocked",
    evidence
  };
}

const checks = [];

if (!interfaces.length) {
  checks.push({
    id: "contract-baseline-missing",
    description: "No contracts.interfaces[] entries exist to measure frontend/backend or task contract alignment.",
    status: "blocked",
    evidence: ["Add approved expected fields plus actual producer/consumer fields before contract verification."]
  });
  state.contracts = state.contracts || { status: "not_started", interfaces: [] };
  state.contracts.status = "blocked";
} else {
  for (const contract of interfaces) {
    checks.push(checkInterface(contract));
  }
  const hasFailure = checks.some((check) => check.status === "failed");
  const hasBlocked = checks.some((check) => check.status === "blocked");
  state.contracts.status = hasBlocked ? "blocked" : hasFailure ? "checked" : "checked";
}

state.integration = state.integration || {};
state.integration.contract_checks = checks;
if (checks.some((check) => check.status === "failed")) {
  state.integration.status = "failed";
}
if (checks.some((check) => check.status === "blocked") && state.integration.status !== "failed") {
  state.integration.status = "blocked";
}
state.integration.evidence = Array.from(new Set([...(state.integration.evidence || []), `Contract checks ran at ${now}`]));
state.delivery.updated_at = now;
state.log.push({
  at: now,
  state: state.current_state,
  note: `Contract checks completed: ${checks.map((check) => check.status).join(", ")}`
});

fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

const failed = checks.filter((check) => check.status === "failed");
const blocked = checks.filter((check) => check.status === "blocked");
console.log(`Contract checks: ${checks.length} total, ${failed.length} failed, ${blocked.length} blocked`);
if (failed.length || blocked.length) {
  process.exit(2);
}
