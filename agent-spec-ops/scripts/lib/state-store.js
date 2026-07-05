"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const INTEGRITY_ALGORITHM = "sha256:agent-spec-ops-state-v1";

function loadWorkflowState(statePath, options = {}) {
  const resolved = path.resolve(statePath);
  const state = JSON.parse(fs.readFileSync(resolved, "utf8"));
  assertWorkflowStateIntegrity(resolved, state, options);
  return state;
}

function writeWorkflowState(statePath, state, options = {}) {
  const resolved = path.resolve(statePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  sealWorkflowState(state, options.writer || callingScriptName());
  fs.writeFileSync(resolved, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

function sealWorkflowState(state, writer = "unknown") {
  state.harness = state.harness || { name: "agent-spec-ops", version: "" };
  state.harness.state_integrity = {
    algorithm: INTEGRITY_ALGORITHM,
    hash: "",
    sealed_at: new Date().toISOString(),
    sealed_by: writer
  };
  state.harness.state_integrity.hash = hashWorkflowState(state);
  return state;
}

function assertWorkflowStateIntegrity(statePath, state, options = {}) {
  const errors = stateIntegrityErrors(statePath, state, options);
  if (!errors.length) return;
  const message = [
    "Workflow state integrity check failed:",
    ...errors.map((error) => `- ${error}`),
    "Repair the state intentionally, then run seal-state.js to create a new trusted seal."
  ].join("\n");
  throw new Error(message);
}

function stateIntegrityErrors(statePath, state, options = {}) {
  const errors = [];
  const integrity = state && state.harness && state.harness.state_integrity;
  const requireSeal = options.require === true || isRunStatePath(statePath);

  if (!integrity) {
    if (requireSeal && options.allowUnsealed !== true) {
      errors.push("missing harness.state_integrity seal; this run cannot be continued safely");
    }
    return errors;
  }

  if (integrity.algorithm !== INTEGRITY_ALGORITHM) {
    errors.push(`unsupported state integrity algorithm: ${integrity.algorithm || "(missing)"}`);
  }
  if (!integrity.sealed_at) errors.push("state integrity seal is missing sealed_at");
  if (!integrity.sealed_by) errors.push("state integrity seal is missing sealed_by");
  if (!/^[a-f0-9]{64}$/.test(String(integrity.hash || ""))) {
    errors.push("state integrity hash is missing or malformed");
    return errors;
  }

  const actual = hashWorkflowState(state);
  if (actual !== integrity.hash) {
    errors.push(`state hash mismatch; expected ${integrity.hash}, got ${actual}`);
  }

  return errors;
}

function hashWorkflowState(state) {
  return crypto
    .createHash("sha256")
    .update(stableStringify(withoutIntegrity(state)))
    .digest("hex");
}

function withoutIntegrity(value) {
  const copy = JSON.parse(JSON.stringify(value || {}));
  if (copy.harness) delete copy.harness.state_integrity;
  return copy;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function isRunStatePath(statePath) {
  const normalized = path.resolve(statePath).replace(/\\/g, "/");
  return /\/runs\/[^/]+\/workflow-state\.json$/.test(normalized);
}

function callingScriptName() {
  return path.basename(process.argv[1] || "unknown");
}

module.exports = {
  INTEGRITY_ALGORITHM,
  assertWorkflowStateIntegrity,
  hashWorkflowState,
  loadWorkflowState,
  sealWorkflowState,
  stateIntegrityErrors,
  writeWorkflowState
};
