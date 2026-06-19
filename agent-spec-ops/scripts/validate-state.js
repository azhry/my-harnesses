#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  states,
  roleNames,
  roleStatuses,
  knowledgeBuckets,
  taskStatuses,
  gateStatuses,
  loopStatuses
} = require("./lib/state-machine");

const file = process.argv[2];

if (!file) {
  console.error("Usage: node scripts/validate-state.js path/to/workflow-state.json");
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
const errors = [];
const stateIndex = states.indexOf(state.current_state);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireObject(pathName, value) {
  if (!isObject(value)) {
    errors.push(`${pathName} must be an object`);
    return false;
  }
  return true;
}

function requireArray(pathName, value) {
  if (!Array.isArray(value)) {
    errors.push(`${pathName} must be an array`);
    return false;
  }
  return true;
}

function requireString(pathName, value, allowEmpty = true) {
  if (typeof value !== "string") {
    errors.push(`${pathName} must be a string`);
    return;
  }
  if (!allowEmpty && value.trim() === "") {
    errors.push(`${pathName} must be a non-empty string`);
  }
}

function requireBoolean(pathName, value) {
  if (typeof value !== "boolean") {
    errors.push(`${pathName} must be a boolean`);
  }
}

function requireInteger(pathName, value, min) {
  if (!Number.isInteger(value) || value < min) {
    errors.push(`${pathName} must be an integer >= ${min}`);
  }
}

function requireEnum(pathName, value, allowed) {
  if (!allowed.includes(value)) {
    errors.push(`${pathName} must be one of: ${allowed.join(", ")}`);
  }
}

function hasEvidence(values) {
  return Array.isArray(values) && values.some((value) => typeof value === "string" && value.trim() !== "");
}

if (!requireObject("harness", state.harness)) {
  process.exit(1);
}

if (state.harness.name !== "agent-spec-ops") {
  errors.push("harness.name must be agent-spec-ops");
}

requireString("harness.version", state.harness.version, false);
requireEnum("current_state", state.current_state, states);

if (requireObject("delivery", state.delivery)) {
  requireString("delivery.id", state.delivery.id);
  requireString("delivery.title", state.delivery.title);
  requireString("delivery.request_summary", state.delivery.request_summary);
  requireArray("delivery.source_links", state.delivery.source_links);
  requireArray("delivery.target_users", state.delivery.target_users);
  requireString("delivery.created_at", state.delivery.created_at);
  requireString("delivery.updated_at", state.delivery.updated_at);
}

if (requireObject("roles", state.roles)) {
  for (const roleName of roleNames) {
    const role = state.roles[roleName];
    if (!requireObject(`roles.${roleName}`, role)) {
      continue;
    }
    requireEnum(`roles.${roleName}.status`, role.status, roleStatuses);
    requireString(`roles.${roleName}.current_task_id`, role.current_task_id);
    requireArray(`roles.${roleName}.artifacts`, role.artifacts);
    requireArray(`roles.${roleName}.evidence`, role.evidence);
    requireArray(`roles.${roleName}.blockers`, role.blockers);
  }
}

if (requireObject("tool_readiness", state.tool_readiness)) {
  requireEnum("tool_readiness.status", state.tool_readiness.status, ["not_started", "checking", "ready", "partial", "blocked"]);
  requireString("tool_readiness.checked_at", state.tool_readiness.checked_at);

  if (requireObject("tool_readiness.choices", state.tool_readiness.choices)) {
    requireEnum("tool_readiness.choices.product_tracker", state.tool_readiness.choices.product_tracker, ["", "linear", "atlassian"]);
    requireEnum("tool_readiness.choices.code_host", state.tool_readiness.choices.code_host, ["", "github", "gitlab"]);
  }

  requireArray("tool_readiness.capabilities", state.tool_readiness.capabilities);
  if (Array.isArray(state.tool_readiness.capabilities)) {
    state.tool_readiness.capabilities.forEach((capability, index) => {
      requireEnum(`tool_readiness.capabilities[${index}].name`, capability.name, ["product_tracker", "code_host"]);
      requireString(`tool_readiness.capabilities[${index}].provider`, capability.provider);
      requireBoolean(`tool_readiness.capabilities[${index}].required`, capability.required);
      requireEnum(`tool_readiness.capabilities[${index}].status`, capability.status, ["unknown", "available", "available_session", "missing", "partial", "blocked"]);
      requireString(`tool_readiness.capabilities[${index}].verification`, capability.verification);
      requireArray(`tool_readiness.capabilities[${index}].evidence`, capability.evidence);
      requireString(`tool_readiness.capabilities[${index}].blocker`, capability.blocker);
      if (["available", "available_session"].includes(capability.status) && !hasEvidence(capability.evidence)) {
        errors.push(`tool_readiness.capabilities[${index}] available status needs evidence`);
      }
      if (["missing", "blocked"].includes(capability.status) && !capability.blocker) {
        errors.push(`tool_readiness.capabilities[${index}] missing/blocked status needs blocker`);
      }
    });
  }

  validateToolingGroup("tool_readiness.frontend", state.tool_readiness.frontend);
  validateToolingGroup("tool_readiness.backend", state.tool_readiness.backend);
}

function validateToolingGroup(pathName, group) {
  if (!requireObject(pathName, group)) {
    return;
  }
  requireEnum(`${pathName}.status`, group.status, ["unknown", "ready", "partial", "missing", "blocked"]);
  requireArray(`${pathName}.commands`, group.commands);
  requireArray(`${pathName}.evidence`, group.evidence);
  requireArray(`${pathName}.blockers`, group.blockers);
  if (Array.isArray(group.commands)) {
    group.commands.forEach((command, index) => {
      requireString(`${pathName}.commands[${index}].name`, command.name, false);
      requireEnum(`${pathName}.commands[${index}].status`, command.status, ["available", "missing", "error"]);
      requireString(`${pathName}.commands[${index}].path`, command.path);
      requireString(`${pathName}.commands[${index}].version`, command.version);
    });
  }
}

if (requireObject("knowledge", state.knowledge)) {
  requireEnum("knowledge.status", state.knowledge.status, ["not_started", "in_progress", "partial", "complete", "blocked"]);
  if (requireObject("knowledge.budgets", state.knowledge.budgets)) {
    requireInteger("knowledge.budgets.max_queries_per_source", state.knowledge.budgets.max_queries_per_source, 1);
    requireInteger("knowledge.budgets.max_source_documents", state.knowledge.budgets.max_source_documents, 1);
    requireInteger("knowledge.budgets.max_repo_files_per_service", state.knowledge.budgets.max_repo_files_per_service, 1);
    requireInteger("knowledge.budgets.max_unresolved_gaps", state.knowledge.budgets.max_unresolved_gaps, 0);
  }
  requireArray("knowledge.queries", state.knowledge.queries);
  requireArray("knowledge.sources", state.knowledge.sources);
  requireArray("knowledge.findings", state.knowledge.findings);
  requireArray("knowledge.claims", state.knowledge.claims);
  requireArray("knowledge.gaps", state.knowledge.gaps);

  const sourceIds = new Set();
  if (Array.isArray(state.knowledge.sources)) {
    state.knowledge.sources.forEach((source, index) => {
      requireString(`knowledge.sources[${index}].id`, source.id, false);
      sourceIds.add(source.id);
      requireEnum(`knowledge.sources[${index}].authority`, source.authority, ["authoritative", "supporting", "candidate", "stale", "unknown"]);
    });
  }

  if (Array.isArray(state.knowledge.findings)) {
    state.knowledge.findings.forEach((finding, index) => {
      requireString(`knowledge.findings[${index}].id`, finding.id, false);
      requireEnum(`knowledge.findings[${index}].bucket`, finding.bucket, knowledgeBuckets);
      requireString(`knowledge.findings[${index}].claim`, finding.claim, false);
      requireEnum(`knowledge.findings[${index}].confidence`, finding.confidence, ["low", "medium", "high", "unknown"]);
      requireArray(`knowledge.findings[${index}].sources`, finding.sources);
      requireArray(`knowledge.findings[${index}].used_by`, finding.used_by);
      if (Array.isArray(finding.sources)) {
        finding.sources.forEach((sourceRef) => {
          if (!sourceIds.has(sourceRef)) {
            errors.push(`knowledge.findings[${index}] references missing source: ${sourceRef}`);
          }
        });
      }
    });
  }

  if (Array.isArray(state.knowledge.gaps)) {
    const openGaps = state.knowledge.gaps.filter((gap) => gap && gap.status === "open");
    const maxGaps = state.knowledge.budgets && state.knowledge.budgets.max_unresolved_gaps;
    if (Number.isInteger(maxGaps) && openGaps.length > maxGaps) {
      errors.push(`knowledge.gaps has ${openGaps.length} open gaps, exceeding max_unresolved_gaps ${maxGaps}`);
    }
    state.knowledge.gaps.forEach((gap, index) => {
      requireEnum(`knowledge.gaps[${index}].bucket`, gap.bucket, knowledgeBuckets);
      requireEnum(`knowledge.gaps[${index}].status`, gap.status, ["open", "accepted_risk", "resolved", "blocked"]);
    });
  }
}

if (requireObject("artifacts", state.artifacts)) {
  for (const artifactName of ["product_requirements", "stitch_prompt", "design_assets", "system_rules", "task_breakdown", "handoff_report"]) {
    const artifact = state.artifacts[artifactName];
    if (!requireObject(`artifacts.${artifactName}`, artifact)) {
      continue;
    }
    requireEnum(`artifacts.${artifactName}.status`, artifact.status, ["not_started", "draft", "ready_for_review", "approved", "published", "blocked"]);
    requireString(`artifacts.${artifactName}.path`, artifact.path);
    requireString(`artifacts.${artifactName}.url`, artifact.url);
    requireString(`artifacts.${artifactName}.content_hash`, artifact.content_hash);
    requireArray(`artifacts.${artifactName}.evidence`, artifact.evidence);
  }
}

if (requireObject("task_graph", state.task_graph)) {
  requireEnum("task_graph.status", state.task_graph.status, ["not_started", "draft", "approved", "in_progress", "complete", "blocked"]);
  requireBoolean("task_graph.dependencies_checked", state.task_graph.dependencies_checked);
  requireBoolean("task_graph.frontend_required", state.task_graph.frontend_required);
  requireBoolean("task_graph.backend_required", state.task_graph.backend_required);
  requireArray("task_graph.tasks", state.task_graph.tasks);

  const taskIds = new Set();
  const activeByRole = new Map();
  if (Array.isArray(state.task_graph.tasks)) {
    state.task_graph.tasks.forEach((task, index) => {
      requireString(`task_graph.tasks[${index}].id`, task.id, false);
      if (taskIds.has(task.id)) {
        errors.push(`task_graph.tasks[${index}].id is duplicated: ${task.id}`);
      }
      taskIds.add(task.id);
      requireEnum(`task_graph.tasks[${index}].role`, task.role, roleNames);
      requireEnum(`task_graph.tasks[${index}].status`, task.status, taskStatuses);
      requireArray(`task_graph.tasks[${index}].depends_on`, task.depends_on);
      requireArray(`task_graph.tasks[${index}].source_requirements`, task.source_requirements);
      requireArray(`task_graph.tasks[${index}].knowledge_refs`, task.knowledge_refs);
      validateTaskScope(`task_graph.tasks[${index}].scope`, task.scope);
      requireArray(`task_graph.tasks[${index}].definition_of_done`, task.definition_of_done);
      requireArray(`task_graph.tasks[${index}].verification`, task.verification);
      validateGitFlow(`task_graph.tasks[${index}].git_flow`, task.git_flow, task);

      if (task.status === "active") {
        const existing = activeByRole.get(task.role);
        if (existing) {
          errors.push(`WIP=1 violation for ${task.role}: ${existing} and ${task.id} are active`);
        }
        activeByRole.set(task.role, task.id);
      }

      if (task.status === "verified" && !hasEvidence(task.test && task.test.evidence) && !hasEvidence(task.implementation && task.implementation.evidence)) {
        errors.push(`task_graph.tasks[${index}] is verified but has no implementation or test evidence`);
      }

      if (task.loop) {
        validateLoop(`task_graph.tasks[${index}].loop`, task.loop);
      } else {
        errors.push(`task_graph.tasks[${index}].loop is required`);
      }
    });

    state.task_graph.tasks.forEach((task, index) => {
      if (Array.isArray(task.depends_on)) {
        task.depends_on.forEach((dep) => {
          if (!taskIds.has(dep)) {
            errors.push(`task_graph.tasks[${index}] depends on missing task: ${dep}`);
          }
        });
      }
    });
  }
}

function validateTaskScope(pathName, scope) {
  if (!requireObject(pathName, scope)) {
    return;
  }
  requireArray(`${pathName}.allowed_paths`, scope.allowed_paths);
  requireArray(`${pathName}.allowed_repos`, scope.allowed_repos);
  requireArray(`${pathName}.allowed_services`, scope.allowed_services);
  requireArray(`${pathName}.contract_refs`, scope.contract_refs);
}

function validateGitFlow(pathName, gitFlow, task) {
  if (!requireObject(pathName, gitFlow)) {
    return;
  }

  const isDevTask = ["frontend_dev", "backend_dev"].includes(task.role);
  const policy = state.implementation && state.implementation.git_policy
    ? state.implementation.git_policy
    : { base_branch: "main", target_branch: "main" };

  requireString(`${pathName}.base_branch`, gitFlow.base_branch);
  requireString(`${pathName}.target_branch`, gitFlow.target_branch);
  requireString(`${pathName}.feature_branch`, gitFlow.feature_branch);
  requireBoolean(`${pathName}.branch_created`, gitFlow.branch_created);
  requireArray(`${pathName}.branch_evidence`, gitFlow.branch_evidence);
  requireBoolean(`${pathName}.local_tests_passed`, gitFlow.local_tests_passed);
  requireArray(`${pathName}.test_evidence`, gitFlow.test_evidence);
  requireBoolean(`${pathName}.pushed`, gitFlow.pushed);
  requireArray(`${pathName}.push_evidence`, gitFlow.push_evidence);
  requireEnum(`${pathName}.merge_request_status`, gitFlow.merge_request_status, ["not_started", "created", "open", "merged", "closed", "blocked", "not_applicable"]);
  requireString(`${pathName}.merge_request_url`, gitFlow.merge_request_url);
  requireArray(`${pathName}.merge_request_evidence`, gitFlow.merge_request_evidence);
  requireBoolean(`${pathName}.auto_merge`, gitFlow.auto_merge);
  requireString(`${pathName}.auto_merge_disabled_reason`, gitFlow.auto_merge_disabled_reason);
  requireBoolean(`${pathName}.merge_checks_passed`, gitFlow.merge_checks_passed);
  requireArray(`${pathName}.merge_check_evidence`, gitFlow.merge_check_evidence);
  requireBoolean(`${pathName}.merged`, gitFlow.merged);
  requireString(`${pathName}.merge_commit`, gitFlow.merge_commit);
  requireArray(`${pathName}.merge_evidence`, gitFlow.merge_evidence);
  requireArray(`${pathName}.blockers`, gitFlow.blockers);

  if (!isDevTask) {
    return;
  }

  if (gitFlow.base_branch !== policy.base_branch) {
    errors.push(`${pathName}.base_branch must match implementation.git_policy.base_branch (${policy.base_branch})`);
  }
  if (gitFlow.target_branch !== policy.target_branch) {
    errors.push(`${pathName}.target_branch must match implementation.git_policy.target_branch (${policy.target_branch})`);
  }

  if (["active", "implemented", "testing", "verified"].includes(task.status)) {
    requireString(`${pathName}.feature_branch`, gitFlow.feature_branch, false);
    if (!gitFlow.branch_created || !hasEvidence(gitFlow.branch_evidence)) {
      errors.push(`${pathName} must record feature branch creation before dev task ${task.id} is active/implemented`);
    }
  }

  if (gitFlow.pushed && (!gitFlow.local_tests_passed || !hasEvidence(gitFlow.test_evidence))) {
    errors.push(`${pathName} cannot be pushed before successful test evidence is recorded`);
  }

  if (!gitFlow.auto_merge && !gitFlow.auto_merge_disabled_reason) {
    errors.push(`${pathName}.auto_merge=false requires auto_merge_disabled_reason`);
  }

  if (["created", "open", "merged"].includes(gitFlow.merge_request_status)) {
    if (!gitFlow.pushed || !hasEvidence(gitFlow.push_evidence)) {
      errors.push(`${pathName} cannot create a merge request before the feature branch is pushed`);
    }
    if (!gitFlow.merge_request_url || !hasEvidence(gitFlow.merge_request_evidence)) {
      errors.push(`${pathName} merge request status ${gitFlow.merge_request_status} needs URL and evidence`);
    }
  }

  if (gitFlow.merged) {
    if (!gitFlow.auto_merge && !gitFlow.auto_merge_disabled_reason) {
      errors.push(`${pathName} merged=true with auto_merge=false needs disabled reason explaining manual override`);
    }
    if (!gitFlow.merge_checks_passed || !hasEvidence(gitFlow.merge_check_evidence)) {
      errors.push(`${pathName} cannot merge before merge checks pass with evidence`);
    }
    if (gitFlow.merge_request_status !== "merged") {
      errors.push(`${pathName}.merge_request_status must be merged when merged=true`);
    }
    if (!hasEvidence(gitFlow.merge_evidence)) {
      errors.push(`${pathName}.merged=true needs merge_evidence`);
    }
  }

  if (task.status === "verified") {
    if (!gitFlow.local_tests_passed || !hasEvidence(gitFlow.test_evidence)) {
      errors.push(`${pathName} must record successful test evidence before dev task ${task.id} is verified`);
    }
    if (!gitFlow.pushed || !hasEvidence(gitFlow.push_evidence)) {
      errors.push(`${pathName} must record pushed feature branch before dev task ${task.id} is verified`);
    }
    if (!["created", "open", "merged"].includes(gitFlow.merge_request_status) || !gitFlow.merge_request_url || !hasEvidence(gitFlow.merge_request_evidence)) {
      errors.push(`${pathName} must record merge request to ${policy.target_branch} before dev task ${task.id} is verified`);
    }
    if (gitFlow.auto_merge) {
      if (!gitFlow.merge_checks_passed || !hasEvidence(gitFlow.merge_check_evidence)) {
        errors.push(`${pathName} auto-merge requires merge checks passed before dev task ${task.id} is verified`);
      }
      if (!gitFlow.merged || gitFlow.merge_request_status !== "merged" || !hasEvidence(gitFlow.merge_evidence)) {
        errors.push(`${pathName} auto-merge requires merged MR evidence before dev task ${task.id} is verified`);
      }
    }
  }
}

if (requireObject("contracts", state.contracts)) {
  requireEnum("contracts.status", state.contracts.status, ["not_started", "draft", "approved", "checked", "blocked"]);
  requireArray("contracts.interfaces", state.contracts.interfaces);
  if (Array.isArray(state.contracts.interfaces)) {
    state.contracts.interfaces.forEach((contract, index) => {
      requireString(`contracts.interfaces[${index}].id`, contract.id, false);
      requireEnum(`contracts.interfaces[${index}].kind`, contract.kind, ["api_payload", "api_response", "event", "data_model", "ui_state", "other"]);
      requireString(`contracts.interfaces[${index}].producer_task_id`, contract.producer_task_id);
      requireString(`contracts.interfaces[${index}].consumer_task_id`, contract.consumer_task_id);
      validateContractFields(`contracts.interfaces[${index}].expected_fields`, contract.expected_fields);
      validateContractFields(`contracts.interfaces[${index}].actual_producer_fields`, contract.actual_producer_fields);
      validateContractFields(`contracts.interfaces[${index}].actual_consumer_fields`, contract.actual_consumer_fields);
      requireEnum(`contracts.interfaces[${index}].status`, contract.status, ["not_started", "draft", "passed", "failed", "blocked"]);
      requireArray(`contracts.interfaces[${index}].evidence`, contract.evidence);
      requireArray(`contracts.interfaces[${index}].blockers`, contract.blockers);
    });
  }
}

function validateContractFields(pathName, fields) {
  requireArray(pathName, fields);
  if (!Array.isArray(fields)) {
    return;
  }
  fields.forEach((field, index) => {
    requireString(`${pathName}[${index}].name`, field.name, false);
    requireString(`${pathName}[${index}].type`, field.type, false);
    requireBoolean(`${pathName}[${index}].required`, field.required);
  });
}

if (requireObject("implementation", state.implementation)) {
  requireEnum("implementation.status", state.implementation.status, ["not_started", "in_progress", "complete", "blocked"]);
  if (requireObject("implementation.git_policy", state.implementation.git_policy)) {
    const gitPolicy = state.implementation.git_policy;
    requireString("implementation.git_policy.base_branch", gitPolicy.base_branch, false);
    requireString("implementation.git_policy.target_branch", gitPolicy.target_branch, false);
    requireString("implementation.git_policy.branch_name_pattern", gitPolicy.branch_name_pattern, false);
    requireBoolean("implementation.git_policy.push_after_tests_pass", gitPolicy.push_after_tests_pass);
    requireBoolean("implementation.git_policy.merge_request_required", gitPolicy.merge_request_required);
    requireBoolean("implementation.git_policy.auto_merge_default", gitPolicy.auto_merge_default);
    requireBoolean("implementation.git_policy.auto_merge_requires_checks", gitPolicy.auto_merge_requires_checks);
    requireString("implementation.git_policy.auto_merge_disabled_reason", gitPolicy.auto_merge_disabled_reason);
    requireArray("implementation.git_policy.evidence", gitPolicy.evidence);
    if (gitPolicy.base_branch !== "main") {
      errors.push("implementation.git_policy.base_branch must be main");
    }
    if (gitPolicy.target_branch !== "main") {
      errors.push("implementation.git_policy.target_branch must be main");
    }
    if (!gitPolicy.push_after_tests_pass) {
      errors.push("implementation.git_policy.push_after_tests_pass must be true");
    }
    if (!gitPolicy.merge_request_required) {
      errors.push("implementation.git_policy.merge_request_required must be true");
    }
    if (!gitPolicy.auto_merge_default && !gitPolicy.auto_merge_disabled_reason) {
      errors.push("implementation.git_policy.auto_merge_default=false requires auto_merge_disabled_reason");
    }
    if (gitPolicy.auto_merge_default && !gitPolicy.auto_merge_requires_checks) {
      errors.push("implementation.git_policy.auto_merge_requires_checks must be true when auto_merge_default is true");
    }
  }
  if (requireObject("implementation.approved_scope", state.implementation.approved_scope)) {
    const approvedScope = state.implementation.approved_scope;
    requireEnum("implementation.approved_scope.status", approvedScope.status, ["not_started", "draft", "approved", "blocked"]);
    requireArray("implementation.approved_scope.task_ids", approvedScope.task_ids);
    requireArray("implementation.approved_scope.repos", approvedScope.repos);
    requireArray("implementation.approved_scope.services", approvedScope.services);
    requireArray("implementation.approved_scope.paths", approvedScope.paths);
    requireArray("implementation.approved_scope.api_contracts", approvedScope.api_contracts);
    requireString("implementation.approved_scope.approved_at", approvedScope.approved_at);
    requireString("implementation.approved_scope.approved_by", approvedScope.approved_by);
    requireArray("implementation.approved_scope.evidence", approvedScope.evidence);
  }
  requireArray("implementation.actual_changes", state.implementation.actual_changes);
  if (Array.isArray(state.implementation.actual_changes)) {
    state.implementation.actual_changes.forEach((change, index) => {
      requireString(`implementation.actual_changes[${index}].path`, change.path, false);
      requireString(`implementation.actual_changes[${index}].repo`, change.repo);
      requireString(`implementation.actual_changes[${index}].service`, change.service);
      requireString(`implementation.actual_changes[${index}].task_id`, change.task_id);
      requireEnum(`implementation.actual_changes[${index}].change_type`, change.change_type, ["added", "modified", "deleted", "renamed", "unknown"]);
      requireArray(`implementation.actual_changes[${index}].evidence`, change.evidence);
    });
  }
  requireArray("implementation.scope_checks", state.implementation.scope_checks);
}

if (requireObject("agent_dispatch", state.agent_dispatch)) {
  const dispatch = state.agent_dispatch;
  requireEnum("agent_dispatch.mode", dispatch.mode, ["single_agent", "multi_agent"]);
  requireBoolean("agent_dispatch.auto_spawn", dispatch.auto_spawn);
  requireBoolean("agent_dispatch.parallel_allowed", dispatch.parallel_allowed);
  requireInteger("agent_dispatch.max_parallel_agents", dispatch.max_parallel_agents, 1);
  requireEnum("agent_dispatch.status", dispatch.status, ["not_started", "planned", "spawning", "active", "complete", "blocked"]);
  requireString("agent_dispatch.planned_at", dispatch.planned_at);
  requireArray("agent_dispatch.spawn_requests", dispatch.spawn_requests);
  requireArray("agent_dispatch.leases", dispatch.leases);
  requireArray("agent_dispatch.history", dispatch.history);

  const leasedTaskIds = new Set();
  if (Array.isArray(dispatch.leases)) {
    dispatch.leases.forEach((lease, index) => {
      requireString(`agent_dispatch.leases[${index}].task_id`, lease.task_id, false);
      requireEnum(`agent_dispatch.leases[${index}].role`, lease.role, roleNames);
      requireString(`agent_dispatch.leases[${index}].agent_id`, lease.agent_id);
      requireEnum(`agent_dispatch.leases[${index}].status`, lease.status, ["requested", "leased", "released", "complete", "expired"]);
      requireString(`agent_dispatch.leases[${index}].started_at`, lease.started_at);
      requireString(`agent_dispatch.leases[${index}].expires_at`, lease.expires_at);
      if (["requested", "leased"].includes(lease.status)) {
        if (leasedTaskIds.has(lease.task_id)) {
          errors.push(`agent_dispatch has duplicate active lease for task ${lease.task_id}`);
        }
        leasedTaskIds.add(lease.task_id);
      }
    });
  }

  if (Array.isArray(dispatch.spawn_requests)) {
    dispatch.spawn_requests.forEach((request, index) => {
      requireString(`agent_dispatch.spawn_requests[${index}].id`, request.id, false);
      requireEnum(`agent_dispatch.spawn_requests[${index}].role`, request.role, roleNames);
      requireEnum(`agent_dispatch.spawn_requests[${index}].lane`, request.lane, ["frontend", "backend", "integration", "handoff"]);
      requireArray(`agent_dispatch.spawn_requests[${index}].task_ids`, request.task_ids);
      requireEnum(`agent_dispatch.spawn_requests[${index}].status`, request.status, ["planned", "spawned", "active", "complete", "blocked", "cancelled"]);
      requireString(`agent_dispatch.spawn_requests[${index}].agent_id`, request.agent_id);
      requireString(`agent_dispatch.spawn_requests[${index}].prompt`, request.prompt);
      requireArray(`agent_dispatch.spawn_requests[${index}].write_scope`, request.write_scope);
      requireString(`agent_dispatch.spawn_requests[${index}].created_at`, request.created_at);
      requireString(`agent_dispatch.spawn_requests[${index}].updated_at`, request.updated_at);
      requireArray(`agent_dispatch.spawn_requests[${index}].blockers`, request.blockers);
    });
  }
}

function validateLoop(pathName, loop) {
  if (!requireObject(pathName, loop)) {
    return;
  }
  requireEnum(`${pathName}.status`, loop.status, loopStatuses);
  requireInteger(`${pathName}.attempt`, loop.attempt, 0);
  requireInteger(`${pathName}.max_attempts`, loop.max_attempts, 1);
  requireString(`${pathName}.last_failure`, loop.last_failure);
  requireArray(`${pathName}.history`, loop.history);
  if (Number.isInteger(loop.attempt) && Number.isInteger(loop.max_attempts) && loop.attempt > loop.max_attempts) {
    errors.push(`${pathName}.attempt exceeds max_attempts`);
  }
  if (loop.status === "failed" && loop.attempt >= loop.max_attempts && !loop.last_failure) {
    errors.push(`${pathName} reached max attempts and needs last_failure`);
  }
}

if (requireObject("loops", state.loops)) {
  for (const loopName of ["product", "planning", "frontend_dev_test", "backend_dev_test", "integration", "knowledge_improvement"]) {
    validateLoop(`loops.${loopName}`, state.loops[loopName]);
  }
}

if (requireObject("gates", state.gates)) {
  for (const gateName of ["product_review", "delivery_plan_review", "final_review"]) {
    const gate = state.gates[gateName];
    if (!requireObject(`gates.${gateName}`, gate)) {
      continue;
    }
    requireEnum(`gates.${gateName}.status`, gate.status, gateStatuses);
    requireArray(`gates.${gateName}.evidence`, gate.evidence);
    if (gate.status === "approved") {
      requireString(`gates.${gateName}.approver`, gate.approver, false);
      requireString(`gates.${gateName}.approval_note`, gate.approval_note, false);
    }
  }
}

if (requireObject("human_instructions", state.human_instructions)) {
  for (const gateName of ["product_review", "delivery_plan_review", "final_review"]) {
    const instruction = state.human_instructions[gateName];
    if (!requireObject(`human_instructions.${gateName}`, instruction)) {
      continue;
    }
    requireEnum(`human_instructions.${gateName}.status`, instruction.status, ["not_prepared", "prepared", "sent"]);
    requireArray(`human_instructions.${gateName}.audience`, instruction.audience);
    requireString(`human_instructions.${gateName}.instructions`, instruction.instructions);
    requireArray(`human_instructions.${gateName}.decision_options`, instruction.decision_options);
    requireArray(`human_instructions.${gateName}.questions`, instruction.questions);
    requireArray(`human_instructions.${gateName}.evidence`, instruction.evidence);
  }
}

if (requireObject("integration", state.integration)) {
  requireEnum("integration.status", state.integration.status, ["not_started", "in_progress", "passed", "failed", "blocked", "waived"]);
  requireArray("integration.contract_checks", state.integration.contract_checks);
  requireArray("integration.scope_checks", state.integration.scope_checks);
  requireArray("integration.acceptance_mapping", state.integration.acceptance_mapping);
  requireArray("integration.evidence", state.integration.evidence);
  requireArray("integration.blockers", state.integration.blockers);
}

if (requireObject("observability", state.observability)) {
  requireArray("observability.task_trace", state.observability.task_trace);
  requireArray("observability.verification_records", state.observability.verification_records);
  requireArray("observability.diagnostic_log", state.observability.diagnostic_log);
}

if (requireObject("memory", state.memory)) {
  requireEnum("memory.status", state.memory.status, ["not_started", "recording", "ready", "blocked"]);
  requireString("memory.events_path", state.memory.events_path, false);
  requireString("memory.local_tasks_path", state.memory.local_tasks_path, false);
  requireString("memory.evals_csv_path", state.memory.evals_csv_path, false);
  requireString("memory.remarks_csv_path", state.memory.remarks_csv_path, false);
  requireString("memory.token_usage_csv_path", state.memory.token_usage_csv_path, false);
  requireArray("memory.knowledge_dirs", state.memory.knowledge_dirs);
  requireString("memory.last_event_id", state.memory.last_event_id);
  requireInteger("memory.event_count", state.memory.event_count, 0);
  requireString("memory.last_eval_at", state.memory.last_eval_at);
  requireString("memory.last_remark_at", state.memory.last_remark_at);
  requireString("memory.last_knowledge_query_at", state.memory.last_knowledge_query_at);
  requireArray("memory.evidence", state.memory.evidence);

  if (requireObject("memory.token_totals", state.memory.token_totals)) {
    const totals = state.memory.token_totals;
    requireInteger("memory.token_totals.input_tokens", totals.input_tokens, 0);
    requireInteger("memory.token_totals.output_tokens", totals.output_tokens, 0);
    requireInteger("memory.token_totals.cached_input_tokens", totals.cached_input_tokens, 0);
    requireInteger("memory.token_totals.reasoning_tokens", totals.reasoning_tokens, 0);
    requireInteger("memory.token_totals.total_tokens", totals.total_tokens, 0);
    if (typeof totals.total_cost_usd !== "number" || totals.total_cost_usd < 0) {
      errors.push("memory.token_totals.total_cost_usd must be a number >= 0");
    }
    requireString("memory.token_totals.currency", totals.currency, false);
    requireString("memory.token_totals.last_recorded_at", totals.last_recorded_at);
  }

  if (requireObject("memory.local_task_provider", state.memory.local_task_provider)) {
    const provider = state.memory.local_task_provider;
    requireBoolean("memory.local_task_provider.enabled", provider.enabled);
    requireEnum("memory.local_task_provider.mode", provider.mode, ["local", "external", "hybrid"]);
    requireString("memory.local_task_provider.reason", provider.reason);
    requireString("memory.local_task_provider.external_provider", provider.external_provider);
    requireEnum("memory.local_task_provider.sync_status", provider.sync_status, ["local_only", "linked", "synced", "blocked"]);
    requireString("memory.local_task_provider.last_synced_at", provider.last_synced_at);
    requireString("memory.local_task_provider.path", provider.path, false);
    if (provider.enabled && provider.mode === "local" && provider.path !== state.memory.local_tasks_path) {
      errors.push("memory.local_task_provider.path must match memory.local_tasks_path in local mode");
    }
  }
}

requireObject("clean_state", state.clean_state);
requireObject("evaluation", state.evaluation);
requireArray("log", state.log);

if (state.current_state === "waiting_for_tool_readiness_review") {
  if (state.gates && state.gates.tool_readiness_review) {
    if (state.gates.tool_readiness_review.status !== "approved" && state.current_state !== "blocked") {
    }
  }
}

if (state.current_state === "waiting_for_product_review") {
  if (!["ready_for_review", "approved", "published"].includes(state.artifacts.product_requirements.status)) {
    errors.push("waiting_for_product_review requires product_requirements ready for review");
  }
  if (!["ready_for_review", "approved", "published"].includes(state.artifacts.stitch_prompt.status)) {
    errors.push("waiting_for_product_review requires stitch_prompt ready for review");
  }
  if (!["ready_for_review", "approved", "published"].includes(state.artifacts.design_assets.status)) {
    errors.push("waiting_for_product_review requires design_assets ready for review");
  }
  if (!["ready_for_review", "approved", "published"].includes(state.artifacts.system_rules.status)) {
    errors.push("waiting_for_product_review requires system_rules ready for review");
  }
}

if (stateIndex >= states.indexOf("knowledge_discovery") && state.current_state !== "blocked") {
  if (!state.gates || !state.gates.tool_readiness_review || state.gates.tool_readiness_review.status !== "approved") {
    errors.push(`${state.current_state} requires gates.tool_readiness_review.status=approved`);
  }
}

if (stateIndex >= states.indexOf("product_approved") && state.current_state !== "blocked") {
  if (!state.gates || !state.gates.product_review || state.gates.product_review.status !== "approved") {
    errors.push(`${state.current_state} requires gates.product_review.status=approved`);
  }
}

if (state.tool_readiness && state.current_state === "tool_readiness") {
  if (!["checking", "ready", "partial", "blocked"].includes(state.tool_readiness.status)) {
    errors.push("tool_readiness state requires tool_readiness.status checking, ready, partial, or blocked");
  }
}

if (state.current_state === "waiting_for_tool_readiness_review") {
  if (!["ready", "partial"].includes(state.tool_readiness.status)) {
    errors.push("waiting_for_tool_readiness_review requires tool_readiness.status ready or partial");
  }
  if (!state.tool_readiness.choices || !state.tool_readiness.choices.product_tracker) {
    errors.push("waiting_for_tool_readiness_review requires tool_readiness.choices.product_tracker");
  }
  if (!state.tool_readiness.choices || !state.tool_readiness.choices.code_host) {
    errors.push("waiting_for_tool_readiness_review requires tool_readiness.choices.code_host");
  }
}

if (state.current_state === "waiting_for_delivery_plan_review") {
  if (state.current_state !== "blocked") {
    if (Array.isArray(state.task_graph.tasks)) {
      state.task_graph.tasks.forEach((task, index) => {
        if (typeof task.description !== "string" || task.description.trim() === "") {
          errors.push(`task_graph.tasks[${index}] requires non-empty description for delivery plan review`);
        }
        if (!Array.isArray(task.definition_of_done) || task.definition_of_done.length === 0) {
          errors.push(`task_graph.tasks[${index}] requires at least one definition_of_done for delivery plan review`);
        }
        if (!Array.isArray(task.verification) || task.verification.length === 0) {
          errors.push(`task_graph.tasks[${index}] requires at least one verification for delivery plan review`);
        }
      });
    }
  }
}

if (state.tool_readiness && !["intake", "tool_readiness", "blocked"].includes(state.current_state)) {
  if (!["ready", "partial"].includes(state.tool_readiness.status)) {
    errors.push(`${state.current_state} requires tool_readiness.status ready or partial`);
  }
}

if (state.current_state === "waiting_for_delivery_plan_review") {
  if (!["draft", "approved"].includes(state.task_graph.status)) {
    errors.push("waiting_for_delivery_plan_review requires task_graph.status draft or approved");
  }
  if (!state.task_graph.dependencies_checked) {
    errors.push("waiting_for_delivery_plan_review requires task_graph.dependencies_checked=true");
  }
  if (!Array.isArray(state.task_graph.tasks) || state.task_graph.tasks.length === 0) {
    errors.push("waiting_for_delivery_plan_review requires task_graph.tasks");
  }
}

if (stateIndex >= states.indexOf("delivery_plan_approved") && state.current_state !== "blocked") {
  if (!state.gates || !state.gates.delivery_plan_review || state.gates.delivery_plan_review.status !== "approved") {
    errors.push(`${state.current_state} requires gates.delivery_plan_review.status=approved`);
  }
}

if (state.current_state === "waiting_for_final_review") {
  if (!["passed", "waived"].includes(state.integration.status)) {
    errors.push("waiting_for_final_review requires integration.status passed or waived");
  }
  const failedContractChecks = Array.isArray(state.integration.contract_checks)
    ? state.integration.contract_checks.filter((check) => check.status === "failed" || check.status === "blocked")
    : [];
  const failedScopeChecks = Array.isArray(state.integration.scope_checks)
    ? state.integration.scope_checks.filter((check) => check.status === "failed" || check.status === "blocked")
    : [];
  if (failedContractChecks.length) {
    errors.push("waiting_for_final_review requires zero failed/blocked contract checks");
  }
  if (failedScopeChecks.length) {
    errors.push("waiting_for_final_review requires zero failed/blocked scope checks");
  }
}

if (state.current_state === "done") {
  if (state.gates.final_review.status !== "approved") {
    errors.push("done requires gates.final_review.status=approved");
  }
  if (state.artifacts.handoff_report.status === "not_started") {
    errors.push("done requires handoff_report artifact");
  }
}

if (errors.length) {
  console.error("State validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`OK: ${file} is valid`);
