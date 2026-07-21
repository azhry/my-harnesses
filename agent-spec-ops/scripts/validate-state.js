#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { states } = require("./lib/state-machine");
const { expectedAgentName, leaseIdentityErrors, validateSpawnIdentity } = require("./lib/agent-identity");
const { stateIntegrityErrors } = require("./lib/state-store");

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/validate-state.js runs/<DELIVERY_ID>/workflow-state.json");
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
const errors = [];

for (const error of stateIntegrityErrors(file, state)) {
  errors.push(error);
}

if (!state.harness || state.harness.name !== "agent-spec-ops") {
  errors.push("harness.name must be agent-spec-ops");
}

if (!states.includes(state.current_state)) {
  errors.push(`"${state.current_state}" is not a valid state`);
}

const tasks = state.task_graph && Array.isArray(state.task_graph.tasks) ? state.task_graph.tasks : [];
const gitPolicy = state.implementation && state.implementation.git_policy || {};
const requireIndependentReview = Boolean(gitPolicy.review_required_before_merge === true);
for (const task of tasks) validateTask(task, errors, requireIndependentReview, gitPolicy);
validateAgentDispatch(state, errors);
validateUniqueMergeRequests(tasks, errors);
if (state.agent_dispatch && state.agent_dispatch.parallel_allowed === false) validateDeliveryWip(tasks, errors);
validateStaleTasks(state, errors);
validateExpiredLeases(state, errors);

const index = states.indexOf(state.current_state);
const atOrAfter = (name) => index >= states.indexOf(name) && state.current_state !== "blocked";

if (atOrAfter("knowledge_discovery")) validateReadiness(state, errors);
if (state.current_state === "product_review") validateProductReviewReady(state, errors);
if (atOrAfter("design_assembly")) validateGate(state, "product_review", errors);
if (state.current_state === "system_rules_review") validateSystemRulesReady(state, errors);
if (atOrAfter("system_rules_review")) validateGate(state, "system_rules_review", errors);
if (atOrAfter("task_breakdown")) validateTaskBreakdown(state, errors);
if (state.current_state === "implementation_review") validateImplementationReview(state, errors);
if (state.current_state === "done") {
  validateGate(state, "implementation_review", errors);
  validateCompletionApproval(state, errors);
}
validateLinearDrift(state, errors);

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

function validateTask(task, result, requireReview, policy) {
  for (const key of ["id", "title", "role", "lane", "status", "description"]) {
    if (!task[key]) result.push(`task missing ${key}`);
  }
  if (!Array.isArray(task.definition_of_done) || !task.definition_of_done.length) result.push(`${task.id}: definition_of_done is required`);
  if (!Array.isArray(task.expected_changes) || !task.expected_changes.length) result.push(`${task.id}: expected_changes is required`);
  if (!Array.isArray(task.verification) || !task.verification.length) result.push(`${task.id}: verification is required`);
  if (!task.scope || !Array.isArray(task.scope.allowed_paths) || !task.scope.allowed_paths.length) result.push(`${task.id}: scope.allowed_paths is required`);
  if (!["frontend", "backend", "planning", "product", "handoff", "integration"].includes(task.lane)) result.push(`${task.id}: lane is invalid`);
  if (!["planned", "active", "implemented", "testing", "failed", "verified", "blocked", "waived", "not_applicable"].includes(task.status)) result.push(`${task.id}: status is invalid`);
  if (task.status === "implemented" && isDevTask(task)) validateImplementedTask(task, result);
  if (task.status === "verified") validateVerifiedTask(task, result, requireReview, policy);
}

function validateDeliveryWip(allTasks, result) {
  const inFlight = allTasks.filter((task) => task.lifecycle_enforced === true && ["active", "implemented", "testing", "failed", "blocked"].includes(task.status));
  if (inFlight.length > 1) {
    result.push(`delivery WIP=1 requires exactly one unfinished task lifecycle at a time; found ${inFlight.map((task) => `${task.id}:${task.status}`).join(", ")}`);
  }
}

function validateImplementedTask(task, result) {
  const implementation = task.implementation || {};
  if (!Array.isArray(implementation.changed_files) || !implementation.changed_files.length) {
    result.push(`${task.id}: implemented requires implementation.changed_files`);
  }
  if (!Array.isArray(implementation.evidence) || !implementation.evidence.length) {
    result.push(`${task.id}: implemented requires implementation.evidence`);
  }
}

function validateVerifiedTask(task, result, requireReview, policy) {
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
  if (isDevTask(task)) validateVerifiedDevGit(task, result, requireReview, policy);
}

function validateVerifiedDevGit(task, result, requireReview, policy) {
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
  if (git.merge_request_comment_url && !isMergeRequestCommentUrl(git.merge_request_url, git.merge_request_comment_url)) {
    result.push(`${task.id}: merge_request_comment_url must be a real MR comment URL, not the MR URL itself`);
  }
  const checksRequired = policy.auto_merge_requires_checks !== false;
  if (checksRequired && (git.merge_checks_passed !== true || !Array.isArray(git.merge_check_evidence) || !git.merge_check_evidence.length)) {
    result.push(`${task.id}: verified requires passed MR checks evidence`);
  }
  if (git.merged !== true || !git.merge_commit || !Array.isArray(git.merge_evidence) || !git.merge_evidence.length) {
    result.push(`${task.id}: verified requires merged=true, merge_commit, and merge_evidence`);
  }
  if (requireReview) {
    const review = task.review || {};
    if (review.status !== "passed" || !review.reviewed_at || !review.reviewer_agent_id || !Array.isArray(review.evidence) || !review.evidence.length) {
      result.push(`${task.id}: verified requires passed independent PR review evidence`);
    }
    if (!review.head_sha || !git.submitted_head_sha || review.head_sha !== git.submitted_head_sha) {
      result.push(`${task.id}: verified PR review must cover the exact submitted HEAD`);
    }
  }
}

function validateAgentDispatch(candidate, result) {
  const dispatch = candidate.agent_dispatch || {};
  for (const request of Array.isArray(dispatch.spawn_requests) ? dispatch.spawn_requests : []) {
    const expected = expectedAgentName(request.role);
    if (!expected) continue;
    if (request.agent_name && request.agent_name !== expected) {
      result.push(`${request.id}: spawn request for ${request.role} must use ${expected}, got ${request.agent_name}`);
    }
    if (["spawned", "active"].includes(request.status)) {
      const errors = validateSpawnIdentity(request.role, request.agent_id, request.agent_name);
      for (const error of errors) result.push(`${request.id}: ${error}`);
    }
  }
  for (const lease of Array.isArray(dispatch.leases) ? dispatch.leases : []) {
    if (!["requested", "leased", "active"].includes(lease.status || "leased")) continue;
    for (const error of leaseIdentityErrors(lease)) {
      result.push(`${lease.task_id || "(unknown task)"}: invalid ${lease.role || "(unknown role)"} lease: ${error}`);
    }
  }
}

function validateUniqueMergeRequests(items, result) {
  const seen = new Map();
  for (const task of items) {
    if (!isDevTask(task) || !task.git_flow || !task.git_flow.merge_request_url) continue;
    const url = task.git_flow.merge_request_url;
    if (!seen.has(url)) {
      seen.set(url, task.id);
      continue;
    }
    result.push(`${task.id}: merge_request_url is shared with ${seen.get(url)}; each task requires its own MR`);
  }
}

function isDevTask(task) {
  return task.role === "frontend_dev" || task.role === "backend_dev";
}

function isMergeRequestCommentUrl(mrUrl, commentUrl) {
  const normalizedMr = String(mrUrl || "").replace(/\/$/, "");
  const normalizedComment = String(commentUrl || "").replace(/\/$/, "");
  if (!normalizedComment || normalizedComment === normalizedMr) return false;
  return /#(issuecomment|discussion_r|note)_?\d+/i.test(normalizedComment) || /#issuecomment-\d+/i.test(normalizedComment);
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

function validateLinearDrift(candidate, result) {
  const tasks = candidate.task_graph && Array.isArray(candidate.task_graph.tasks) ? candidate.task_graph.tasks : [];
  for (const task of tasks) {
    if (!task.linear_id || !task.linear_sync) continue;
    const sync = task.linear_sync;
    if (sync.status === "failed" && sync.error) {
      result.push(`${task.id}: Linear sync failed — ${sync.error}. Repair with sync-linear-task.js --task ${task.id}`);
    }
    if (task.status === "verified" && sync.status !== "synced") {
      result.push(`${task.id}: Task is verified locally but Linear sync status is ${sync.status || "missing"}. Run sync-linear-task.js --task ${task.id}`);
    }
  }
}

function validateGate(candidate, key, result) {
  const gate = candidate.gates && candidate.gates[key];
  if (!gate || gate.status !== "approved") result.push(`gates.${key}.status must be approved`);
  if (!gate || !gate.approver) result.push(`gates.${key}.approver is required`);
  if (!gate || !gate.decided_at) result.push(`gates.${key}.decided_at is required`);
}

function validateCompletionApproval(candidate, result) {
  const delivery = candidate.delivery || {};
  if (delivery.completion_approved !== true) {
    result.push("done requires delivery.completion_approved=true");
  }
  if (!delivery.completion_approved_by) {
    result.push("done requires delivery.completion_approved_by");
  }
  if (!delivery.completion_approved_at) {
    result.push("done requires delivery.completion_approved_at");
  }
}

function validateStaleTasks(state, result) {
  const tasks = state.task_graph && Array.isArray(state.task_graph.tasks) ? state.task_graph.tasks : [];
  for (const task of tasks) {
    if (task.status === "active" && task.role === "frontend_dev" && !hasValidLease(state, task.id, "frontend_dev")) {
      result.push(`${task.id}: active frontend_dev task requires a valid frontend_dev lease`);
    }
    if (task.status === "active" && task.role === "backend_dev" && !hasValidLease(state, task.id, "backend_dev")) {
      result.push(`${task.id}: active backend_dev task requires a valid backend_dev lease`);
    }
  }
}

function validateExpiredLeases(state, result) {
  const leases = state.agent_dispatch && Array.isArray(state.agent_dispatch.leases) ? state.agent_dispatch.leases : [];
  const now = new Date().toISOString();
  for (const lease of leases) {
    if (lease.status === "leased" && lease.expires_at && lease.expires_at < now) {
      result.push(`${lease.task_id || "(unknown)"}: lease for ${lease.role} expired at ${lease.expires_at}`);
    }
  }
}
