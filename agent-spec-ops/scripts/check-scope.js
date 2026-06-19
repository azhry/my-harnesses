#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const file = process.argv[2];

if (!file) {
  console.error("Usage: node scripts/check-scope.js runs/<DELIVERY_ID>/workflow-state.json");
  process.exit(1);
}

const statePath = path.resolve(file);
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const now = new Date().toISOString();
const tasks = new Map((state.task_graph.tasks || []).map((task) => [task.id, task]));
const approvedScope = state.implementation && state.implementation.approved_scope
  ? state.implementation.approved_scope
  : { task_ids: [], paths: [] };

function globToRegExp(pattern) {
  const escaped = String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesPattern(filePath, pattern) {
  if (!pattern) {
    return false;
  }
  if (pattern.endsWith("/")) {
    return filePath.startsWith(pattern);
  }
  if (pattern.includes("*")) {
    return globToRegExp(pattern).test(filePath);
  }
  return filePath === pattern || filePath.startsWith(`${pattern}/`);
}

function isAllowedPath(filePath, task) {
  const taskPaths = task && task.scope && Array.isArray(task.scope.allowed_paths)
    ? task.scope.allowed_paths
    : [];
  const approvedPaths = Array.isArray(approvedScope.paths) ? approvedScope.paths : [];
  const patterns = [...taskPaths, ...approvedPaths];
  return patterns.some((pattern) => matchesPattern(filePath, pattern));
}

function actualChangesFromState() {
  const explicit = state.implementation && Array.isArray(state.implementation.actual_changes)
    ? state.implementation.actual_changes
    : [];
  if (explicit.length) {
    return explicit;
  }

  const derived = [];
  for (const task of state.task_graph.tasks || []) {
    const files = task.implementation && Array.isArray(task.implementation.changed_files)
      ? task.implementation.changed_files
      : [];
    for (const filePath of files) {
      derived.push({
        path: filePath,
        repo: "",
        service: "",
        task_id: task.id,
        change_type: "unknown",
        evidence: [`Derived from task ${task.id} implementation.changed_files`]
      });
    }
  }
  return derived;
}

function checkChange(change, index) {
  const evidence = [];
  const failures = [];
  const task = tasks.get(change.task_id);

  if (!change.path) {
    failures.push("Change is missing path");
  }
  if (!change.task_id) {
    failures.push(`${change.path || `change ${index}`} is missing task_id`);
  } else if (!task) {
    failures.push(`${change.path || `change ${index}`} references missing task ${change.task_id}`);
  }

  if (Array.isArray(approvedScope.task_ids) && approvedScope.task_ids.length && !approvedScope.task_ids.includes(change.task_id)) {
    failures.push(`${change.path} task ${change.task_id} is not in approved_scope.task_ids`);
  }

  if (task && change.path && !isAllowedPath(change.path, task)) {
    const allowed = [
      ...((task.scope && task.scope.allowed_paths) || []),
      ...((approvedScope && approvedScope.paths) || [])
    ];
    failures.push(`${change.path} is outside approved scope for ${change.task_id}. Allowed: ${allowed.join(", ") || "(none)"}`);
  }

  evidence.push(...(change.evidence || []));
  if (!evidence.length) {
    evidence.push(`Observed change ${change.path || index} for task ${change.task_id || "(missing)"}`);
  }

  return {
    id: `scope-${index + 1}`,
    description: change.path ? `Scope check for ${change.path}` : `Scope check ${index + 1}`,
    status: failures.length ? "failed" : "passed",
    evidence: failures.length ? [...evidence, ...failures] : evidence
  };
}

const changes = actualChangesFromState();
let checks = [];

if (!changes.length) {
  checks = [{
    id: "scope-actual-changes-missing",
    description: "No actual changes were recorded; scope cannot be measured.",
    status: "blocked",
    evidence: ["Record implementation.actual_changes[] or task implementation.changed_files[] before scope verification."]
  }];
} else {
  checks = changes.map(checkChange);
}

state.implementation = state.implementation || {};
state.implementation.actual_changes = changes;
state.implementation.scope_checks = checks;
state.integration = state.integration || {};
state.integration.scope_checks = checks;
if (checks.some((check) => check.status === "failed")) {
  state.integration.status = "failed";
}
if (checks.some((check) => check.status === "blocked") && state.integration.status !== "failed") {
  state.integration.status = "blocked";
}
state.integration.evidence = Array.from(new Set([...(state.integration.evidence || []), `Scope checks ran at ${now}`]));
state.delivery.updated_at = now;
state.log.push({
  at: now,
  state: state.current_state,
  note: `Scope checks completed: ${checks.map((check) => check.status).join(", ")}`
});

fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

const failed = checks.filter((check) => check.status === "failed");
const blocked = checks.filter((check) => check.status === "blocked");
console.log(`Scope checks: ${checks.length} total, ${failed.length} failed, ${blocked.length} blocked`);
if (failed.length || blocked.length) {
  process.exit(2);
}
