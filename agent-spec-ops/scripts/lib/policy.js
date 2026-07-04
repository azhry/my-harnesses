"use strict";

const fs = require("fs");
const path = require("path");
const { states } = require("./state-machine");
const { getLinearConfig, linearMetadataFromEnv } = require("./linear-config");
const { loadSecretEnv } = require("./env-loader");

const root = path.resolve(__dirname, "../..");

const SECRET_PATTERNS = [
  { name: "Linear API key", pattern: /lin_api_[A-Za-z0-9]{20,}/g },
  { name: "GitHub token", pattern: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g },
  { name: "GitHub fine-grained token", pattern: /github_pat_[A-Za-z0-9_]{40,}/g },
  { name: "GitLab token", pattern: /glpat-[A-Za-z0-9_-]{20,}/g },
  { name: "Atlassian token", pattern: /ATATT[A-Za-z0-9_-]{20,}/g }
];

function loadPolicy() {
  const policyPath = path.join(root, "harness-policy.json");
  return JSON.parse(fs.readFileSync(policyPath, "utf8"));
}

function stateIndex(stateName) {
  const index = states.indexOf(stateName || "");
  return index < 0 ? -1 : index;
}

function isAtOrAfter(stateName, threshold) {
  return stateIndex(stateName) >= stateIndex(threshold);
}

function shouldEnforceLinear(state, nextState = "") {
  const effectiveState = nextState || state.current_state || "";
  return isAtOrAfter(effectiveState, "knowledge_discovery") && effectiveState !== "blocked";
}

function enforcePolicy(statePath, options = {}) {
  const policy = loadPolicy();
  const resolved = path.resolve(statePath);
  loadSecretEnv(resolved);
  const state = JSON.parse(fs.readFileSync(resolved, "utf8"));
  const nextState = options.nextState || "";
  const errors = [];

  errors.push(...scanForSecrets(resolved, state, policy));

  if (policy.task_management.required_provider === "linear" && shouldEnforceLinear(state, nextState)) {
    enforceLinearTaskPolicy(state, nextState, options, errors);
  }

  if (errors.length) {
    const message = [
      "Policy enforcement failed:",
      ...errors.map((error) => `- ${error}`)
    ].join("\n");
    const err = new Error(message);
    err.policyErrors = errors;
    throw err;
  }

  return { policy, state };
}

function enforceLinearTaskPolicy(state, nextState, options, errors) {
  const effectiveState = nextState || state.current_state || "";
  const cfg = getLinearConfig(state);
  const tracker = state.tool_readiness && state.tool_readiness.choices
    ? state.tool_readiness.choices.product_tracker
    : "";

  if (tracker && tracker !== "linear") {
    errors.push(`Product tracker must be Linear; found "${tracker}".`);
  }

  if (!cfg.api_key) {
    errors.push("LINEAR_API_KEY or LINEAR_ACCESS_TOKEN must be present in the environment. Raw keys must not be stored in workflow-state.json.");
  }

  if (!cfg.team_id && isAtOrAfter(effectiveState, "task_breakdown")) {
    errors.push("LINEAR_TEAM_ID must be present in the environment or safe linear_config.team_id metadata before task creation/sync.");
  }

  const tasks = state.task_graph && Array.isArray(state.task_graph.tasks)
    ? state.task_graph.tasks
    : [];
  if (tasks.length && isAtOrAfter(effectiveState, "implementation_in_progress")) {
    const missing = tasks.filter((task) => !task.linear_id).map((task) => task.id);
    if (missing.length) {
      errors.push(`All tasks must have Linear IDs before implementation. Missing: ${missing.join(", ")}.`);
    }
  }

  const provider = state.memory && state.memory.local_task_provider;
  if (provider && isAtOrAfter(effectiveState, "implementation_in_progress") && options.phase !== "linear_task_sync") {
    if (provider.mode === "local" || provider.sync_status === "local_only") {
      errors.push("Local-only task management is forbidden during implementation; sync tasks to Linear and set memory.local_task_provider to external.");
    }
  }
}

function scanForSecrets(statePath, state, policy) {
  const errors = [];
  const runDir = path.dirname(statePath);
  const files = [statePath];
  if (policy.secrets.scan_run_files) {
    files.push(...listScanFiles(runDir));
  }

  for (const file of new Set(files)) {
    if (!fs.existsSync(file) || fs.statSync(file).size > 1024 * 1024) {
      continue;
    }
    const text = fs.readFileSync(file, "utf8");
    for (const { name, pattern } of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        errors.push(`${name} appears in ${path.relative(root, file)}. Store raw secrets only in environment variables.`);
      }
    }
  }

  const legacyKey = state.linear_config && state.linear_config.api_key;
  if (legacyKey) {
    errors.push("linear_config.api_key contains a raw key. Remove it and rerun read-context.js with LINEAR_API_KEY in the environment.");
  }
  return errors;
}

function listScanFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }
  const ignored = new Set(["node_modules", ".git", "archives", "design-assets"]);
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) {
      continue;
    }
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...listScanFiles(full));
      continue;
    }
    if (/\.(json|ndjson|md|csv|txt|log)$/i.test(entry.name)) {
      result.push(full);
    }
  }
  return result;
}

function safeLinearMetadata() {
  return linearMetadataFromEnv();
}

module.exports = {
  enforcePolicy,
  loadPolicy,
  safeLinearMetadata,
  scanForSecrets
};
