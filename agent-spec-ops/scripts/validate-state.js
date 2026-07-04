#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { states } = require("./lib/state-machine");

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/validate-state.js runs/<DELIVERY_ID>/workflow-state.json");
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
const errors = [];

if (!state.harness || state.harness.name !== "agent-spec-ops") {
  errors.push("harness.name must be agent-spec-ops");
}

if (!states.includes(state.current_state)) {
  errors.push(`"${state.current_state}" is not a valid state`);
}

const tasks = state.task_graph && Array.isArray(state.task_graph.tasks) ? state.task_graph.tasks : [];
for (const task of tasks) validateTask(task, errors);

const index = states.indexOf(state.current_state);
const atOrAfter = (name) => index >= states.indexOf(name) && state.current_state !== "blocked";

if (atOrAfter("knowledge_discovery")) validateReadiness(state, errors);
if (state.current_state === "product_review") validateProductReviewReady(state, errors);
if (atOrAfter("design_assembly")) validateGate(state, "product_review", errors);
if (state.current_state === "system_rules_review") validateSystemRulesReady(state, errors);
if (atOrAfter("task_breakdown")) validateGate(state, "system_rules_review", errors);
if (atOrAfter("implementation_in_progress")) validateTaskBreakdown(state, errors);
if (state.current_state === "implementation_review") validateImplementationReview(state, errors);
if (state.current_state === "done") validateGate(state, "implementation_review", errors);

for (const task of tasks) {
  const loop = task.loop || {};
  if (loop.status === "failed" && Number(loop.attempt || 0) >= Number(loop.max_attempts || 3)) {
    errors.push(`${task.id}: dev/test loop reached ${loop.attempt}/${loop.max_attempts || 3}; user intervention required`);
  }
}

if (errors.length) {
  console.error("State validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`OK: ${file} is valid`);

function validateReadiness(candidate, result) {
  const readiness = candidate.tool_readiness || {};
  if (!["ready", "partial"].includes(readiness.status)) result.push("tool_readiness.status must be ready or partial after tool_readiness");
  if (!readiness.choices || !readiness.choices.product_tracker) result.push("tool_readiness.choices.product_tracker is required");
  if (!readiness.choices || !readiness.choices.code_host) result.push("tool_readiness.choices.code_host is required");
}

function validateProductReviewReady(candidate, result) {
  requireArtifact(candidate, "product_requirements", result);
  if (!candidate.knowledge || !Array.isArray(candidate.knowledge.sources) || !candidate.knowledge.sources.length) {
    result.push("product_review requires knowledge.sources");
  }
  if (!candidate.knowledge || !Array.isArray(candidate.knowledge.findings) || !candidate.knowledge.findings.length) {
    result.push("product_review requires knowledge.findings");
  }
}

function validateSystemRulesReady(candidate, result) {
  requireArtifact(candidate, "design_assets", result);
  requireArtifact(candidate, "system_rules", result);
}

function validateTaskBreakdown(candidate, result) {
  if (!tasks.length) result.push("task_breakdown requires task_graph.tasks");
  if (!candidate.task_graph || candidate.task_graph.dependencies_checked !== true) {
    result.push("task_graph.dependencies_checked must be true before implementation");
  }
  for (const task of tasks) {
    if (!task.linear_id) result.push(`${task.id}: linear_id is required before implementation`);
  }
}

function validateImplementationReview(candidate, result) {
  const devTasks = tasks.filter((task) => ["frontend_dev", "frontend_test", "backend_dev", "backend_test"].includes(task.role));
  const unverified = devTasks.filter((task) => !["verified", "waived", "not_applicable"].includes(task.status));
  if (unverified.length) {
    result.push(`implementation_review requires all frontend/backend tasks verified. Unverified: ${unverified.map((task) => `${task.id}:${task.status}`).join(", ")}`);
  }
  requireArtifact(candidate, "product_requirements", result);
}

function validateTask(task, result) {
  for (const key of ["id", "title", "role", "lane", "status", "description"]) {
    if (!task[key]) result.push(`task missing ${key}`);
  }
  if (!Array.isArray(task.definition_of_done) || !task.definition_of_done.length) result.push(`${task.id}: definition_of_done is required`);
  if (!Array.isArray(task.expected_changes) || !task.expected_changes.length) result.push(`${task.id}: expected_changes is required`);
  if (!Array.isArray(task.verification) || !task.verification.length) result.push(`${task.id}: verification is required`);
  if (!task.scope || !Array.isArray(task.scope.allowed_paths) || !task.scope.allowed_paths.length) result.push(`${task.id}: scope.allowed_paths is required`);
  if (!["frontend", "backend", "planning", "product", "handoff", "integration"].includes(task.lane)) result.push(`${task.id}: lane is invalid`);
  if (!["planned", "active", "implemented", "testing", "failed", "verified", "blocked", "waived", "not_applicable"].includes(task.status)) result.push(`${task.id}: status is invalid`);
  if (task.status === "verified") validateVerifiedTask(task, result);
}

function validateVerifiedTask(task, result) {
  const implementation = task.implementation || {};
  const test = task.test || {};
  if (isDevTask(task)) {
    if (!Array.isArray(implementation.changed_files) || !implementation.changed_files.length) {
      result.push(`${task.id}: verified requires implementation.changed_files`);
    }
    if (!Array.isArray(implementation.evidence) || !implementation.evidence.length) {
      result.push(`${task.id}: verified requires implementation.evidence`);
    }
  }
  if (test.status !== "passed" || !test.last_run_at || !Array.isArray(test.commands) || !test.commands.length || !test.output_file) {
    result.push(`${task.id}: verified requires passed test status, command, last_run_at, and output_file`);
  }
  if (Array.isArray(test.failures) && test.failures.length) {
    result.push(`${task.id}: verified cannot have recorded test failures`);
  }
  if (isDevTask(task)) validateVerifiedDevGit(task, result);
}

function validateVerifiedDevGit(task, result) {
  const git = task.git_flow || {};
  if (!git.branch_created || !git.feature_branch) {
    result.push(`${task.id}: verified requires feature branch evidence`);
  }
  if (!git.local_tests_passed || !Array.isArray(git.test_evidence) || !git.test_evidence.length) {
    result.push(`${task.id}: verified requires local test evidence in git_flow`);
  }
  if (!git.pushed || !Array.isArray(git.push_evidence) || !git.push_evidence.length) {
    result.push(`${task.id}: verified requires push evidence`);
  }
  if (git.merge_request_status !== "merged" || !git.merge_request_url) {
    result.push(`${task.id}: verified requires merged MR status and MR URL`);
  }
  if (git.merge_request_comment_status !== "passed" || !git.merge_request_comment_url || !Array.isArray(git.merge_request_comment_evidence) || !git.merge_request_comment_evidence.length) {
    result.push(`${task.id}: verified requires passed MR status comment evidence`);
  }
  if (git.merged !== true || !git.merge_commit || !Array.isArray(git.merge_evidence) || !git.merge_evidence.length) {
    result.push(`${task.id}: verified requires merged=true, merge_commit, and merge_evidence`);
  }
}

function isDevTask(task) {
  return task.role === "frontend_dev" || task.role === "backend_dev";
}

function requireArtifact(candidate, key, result) {
  const artifact = candidate.artifacts && candidate.artifacts[key];
  if (!artifact) {
    result.push(`artifacts.${key} is missing`);
    return;
  }
  if (!["ready_for_review", "approved", "published"].includes(artifact.status)) {
    result.push(`artifacts.${key}.status must be ready_for_review, approved, or published`);
  }
  if (!artifact.path && !artifact.url) {
    result.push(`artifacts.${key}.path or url is required`);
  }
}

function validateGate(candidate, key, result) {
  const gate = candidate.gates && candidate.gates[key];
  if (!gate || gate.status !== "approved") result.push(`gates.${key}.status must be approved`);
  if (!gate || !gate.approver) result.push(`gates.${key}.approver is required`);
  if (!gate || !gate.decided_at) result.push(`gates.${key}.decided_at is required`);
}
