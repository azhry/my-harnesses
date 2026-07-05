#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { sealWorkflowState, writeWorkflowState } = require("./lib/state-store");

const [file, ...reasonParts] = process.argv.slice(2);
const reason = reasonParts.join(" ").trim();

if (!file || !reason) {
  console.error('Usage: node scripts/seal-state.js runs/<DELIVERY_ID>/workflow-state.json "repair reason"');
  process.exit(1);
}

const statePath = path.resolve(file);
if (!fs.existsSync(statePath)) {
  console.error(`State file not found: ${statePath}`);
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const validation = validateOperationalState(state);
if (validation.status !== 0) {
  console.error([
    "Refusing to seal invalid workflow state.",
    "seal-state.js may only repair a missing or broken integrity seal after the workflow data itself validates.",
    "",
    validation.stderr || validation.stdout || "validate-state.js failed without output"
  ].join("\n").trim());
  process.exit(validation.status || 1);
}

const now = new Date().toISOString();
state.delivery = state.delivery || {};
state.delivery.updated_at = now;
state.log = Array.isArray(state.log) ? state.log : [];
state.log.push({
  at: now,
  state: state.current_state || "unknown",
  note: `Workflow state sealed after repair: ${reason}`
});

writeWorkflowState(statePath, state, { writer: "seal-state.js" });
console.log(`OK: sealed ${statePath}`);

function validateOperationalState(candidate) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-spec-ops-seal-"));
  const tempFile = path.join(tempDir, "workflow-state.json");
  try {
    const preflight = JSON.parse(JSON.stringify(candidate));
    sealWorkflowState(preflight, "seal-state-preflight");
    fs.writeFileSync(tempFile, `${JSON.stringify(preflight, null, 2)}\n`);
    return spawnSync(process.execPath, [path.join(__dirname, "validate-state.js"), tempFile], {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
      env: process.env
    });
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}
