#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { appendEvent } = require("./lib/memory-store");

const [file, taskId] = process.argv.slice(2);

if (!file || !taskId) {
  console.error("Usage: node scripts/enforce-git-lifecycle.js path/to/workflow-state.json TASK_ID");
  process.exit(1);
}

const statePath = path.resolve(file);
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const tasks = state.task_graph && Array.isArray(state.task_graph.tasks) ? state.task_graph.tasks : [];
const task = tasks.find((item) => item.id === taskId);

if (!task) {
  console.error(`Task not found: ${taskId}`);
  process.exit(1);
}

const checks = checkTask(task);
const failures = checks.filter((check) => check.status === "failed");

console.log(`[git] ${taskId}`);
for (const check of checks) {
  console.log(`${check.status === "passed" ? "PASS" : check.status === "skipped" ? "SKIP" : "FAIL"} ${check.name}: ${check.detail}`);
}

appendEvent(statePath, {
  type: failures.length ? "git_lifecycle_failed" : "git_lifecycle_passed",
  role_context: task.role,
  task_id: taskId,
  target: task.status,
  summary: failures.length ? `Git lifecycle failed for ${taskId}` : `Git lifecycle passed for ${taskId}`,
  details: checks.map((check) => `${check.name}: ${check.detail}`).join("\n"),
  severity: failures.length ? "warning" : "info",
  tags: ["git_lifecycle", taskId, failures.length ? "failed" : "passed"]
});

if (failures.length) process.exit(1);

function checkTask(task) {
  if (!isDevTask(task)) {
    return [{ name: "dev task", status: "skipped", detail: `${task.role} does not require MR lifecycle` }];
  }

  const git = task.git_flow || {};
  return [
    boolCheck("branch", git.branch_created && git.feature_branch, git.feature_branch || "missing branch"),
    boolCheck("local tests", git.local_tests_passed && hasItems(git.test_evidence), hasItems(git.test_evidence) ? git.test_evidence.join("; ") : "missing test evidence"),
    boolCheck("push", git.pushed && hasItems(git.push_evidence), hasItems(git.push_evidence) ? git.push_evidence.join("; ") : "missing push evidence"),
    boolCheck("merge request", git.merge_request_url, git.merge_request_url || "missing MR URL"),
    boolCheck("MR status comment", git.merge_request_comment_status === "passed" && hasItems(git.merge_request_comment_evidence), hasItems(git.merge_request_comment_evidence) ? git.merge_request_comment_evidence.join("; ") : "missing passed comment evidence"),
    boolCheck("merged MR", git.merge_request_status === "merged" && git.merged === true && git.merge_commit && hasItems(git.merge_evidence), git.merge_commit || "missing merged MR evidence")
  ];
}

function boolCheck(name, ok, detail) {
  return { name, status: ok ? "passed" : "failed", detail: String(detail || "") };
}

function hasItems(value) {
  return Array.isArray(value) && value.length > 0;
}

function isDevTask(task) {
  return task.role === "frontend_dev" || task.role === "backend_dev";
}
