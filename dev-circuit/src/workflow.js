"use strict";

const crypto = require("node:crypto");

const TASK_STATES = Object.freeze({
  PLANNED: "planned",
  IMPLEMENTING: "implementing",
  IN_REVIEW: "in_review",
  REVIEW_PASSED: "review_passed",
  MERGE_READY: "merge_ready",
  MERGED: "merged",
  POST_MERGE_VERIFIED: "post_merge_verified",
  BLOCKED: "blocked"
});

const LINEAR_STATUS = Object.freeze({
  TODO: "Todo",
  IN_PROGRESS: "In Progress",
  IN_REVIEW: "In Review",
  DONE: "Done"
});

const ALLOWED = new Map([
  [TASK_STATES.PLANNED, new Set([TASK_STATES.IMPLEMENTING, TASK_STATES.BLOCKED])],
  [TASK_STATES.IMPLEMENTING, new Set([TASK_STATES.IN_REVIEW, TASK_STATES.BLOCKED])],
  [TASK_STATES.IN_REVIEW, new Set([TASK_STATES.IMPLEMENTING, TASK_STATES.REVIEW_PASSED, TASK_STATES.BLOCKED])],
  [TASK_STATES.REVIEW_PASSED, new Set([TASK_STATES.IMPLEMENTING, TASK_STATES.MERGE_READY, TASK_STATES.BLOCKED])],
  [TASK_STATES.MERGE_READY, new Set([TASK_STATES.IMPLEMENTING, TASK_STATES.MERGED, TASK_STATES.BLOCKED])],
  [TASK_STATES.MERGED, new Set([TASK_STATES.POST_MERGE_VERIFIED, TASK_STATES.BLOCKED])],
  [TASK_STATES.BLOCKED, new Set([TASK_STATES.IMPLEMENTING])],
  [TASK_STATES.POST_MERGE_VERIFIED, new Set()]
]);

function assertSupervisor(state, maxAgeMs = 30000) {
  const supervisor = state.supervisor || {};
  if (supervisor.status !== "watching") throw new Error(`Supervisor is not allowing transitions (status=${supervisor.status || "missing"})`);
  if (!supervisor.heartbeat_at) throw new Error("Supervisor heartbeat is missing");
  const age = Date.now() - Date.parse(supervisor.heartbeat_at);
  if (!Number.isFinite(age) || age > maxAgeMs) throw new Error(`Supervisor heartbeat is stale (${age}ms)`);
  if (Array.isArray(supervisor.findings) && supervisor.findings.length) throw new Error(`Supervisor denies transition: ${supervisor.findings.map((item) => item.code).join(", ")}`);
}

function linearStatusFor(taskState) {
  if (taskState === TASK_STATES.PLANNED) return LINEAR_STATUS.TODO;
  if ([TASK_STATES.IMPLEMENTING, TASK_STATES.BLOCKED].includes(taskState)) return LINEAR_STATUS.IN_PROGRESS;
  if (taskState === TASK_STATES.IN_REVIEW) return LINEAR_STATUS.IN_REVIEW;
  return LINEAR_STATUS.DONE;
}

function taskById(state, taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`Unknown task ${taskId}`);
  return task;
}

function event(state, type, details = {}) {
  state.events.push({ id: crypto.randomUUID(), at: new Date().toISOString(), type, ...details });
}

function transitionTask(state, taskId, nextState, actor, reason) {
  assertSupervisor(state);
  const task = taskById(state, taskId);
  const allowed = ALLOWED.get(task.status);
  if (!allowed || !allowed.has(nextState)) throw new Error(`Illegal task transition ${task.status} -> ${nextState}`);

  if (nextState === TASK_STATES.IMPLEMENTING) {
    const other = state.tasks.find((item) => item.id !== taskId && [TASK_STATES.IMPLEMENTING, TASK_STATES.IN_REVIEW, TASK_STATES.REVIEW_PASSED, TASK_STATES.MERGE_READY, TASK_STATES.MERGED].includes(item.status));
    if (other) throw new Error(`WIP=1 violation: ${other.id} is ${other.status}`);
    if (task.status === TASK_STATES.PLANNED && !task.agents.implementer) throw new Error(`${taskId} has no implementer lease`);
    if ([TASK_STATES.IN_REVIEW, TASK_STATES.REVIEW_PASSED, TASK_STATES.MERGE_READY].includes(task.status)) {
      task.review = null;
      task.gate = null;
      task.attempt += 1;
    }
  }

  if (nextState === TASK_STATES.IN_REVIEW) {
    if (!task.git.head_sha) throw new Error(`${taskId} requires git.head_sha before review`);
    if (!task.evidence.some((item) => item.kind === "implementation" && item.head_sha === task.git.head_sha)) {
      throw new Error(`${taskId} requires implementation evidence for ${task.git.head_sha}`);
    }
  }

  task.status = nextState;
  task.linear.desired_status = linearStatusFor(nextState);
  task.linear.sync_pending = true;
  task.updated_at = new Date().toISOString();
  event(state, "task.transition", { task_id: taskId, to: nextState, actor, reason, desired_linear_status: task.linear.desired_status });
  return task;
}

function recordAgent(state, taskId, role, lease) {
  const task = taskById(state, taskId);
  if (!lease || typeof lease !== "object") throw new Error("Agent lease must come from a runtime adapter");
  const { agent_id: agentId, principal, workspace_id: workspaceId } = lease;
  if (!agentId || !principal || !workspaceId) throw new Error("Agent lease requires agent_id, principal, and workspace_id");
  if (!Object.hasOwn(task.agents, role)) throw new Error(`Unsupported task role ${role}`);
  if (Object.values(task.agents).includes(agentId)) throw new Error(`Agent ${agentId} cannot hold multiple task roles`);
  if (Object.values(task.agent_leases).some((item) => item && (item.principal === principal || item.workspace_id === workspaceId))) throw new Error("Agent roles require distinct principals and workspaces");
  task.agents[role] = agentId;
  task.agent_leases[role] = { agent_id: agentId, principal, workspace_id: workspaceId, adapter_sha256: lease.adapter_sha256, capability_hash: lease.capability_hash, inbox: lease.inbox, attempt: lease.attempt, issued_at: new Date().toISOString() };
  event(state, "agent.assigned", { task_id: taskId, role, agent_id: agentId, principal, workspace_id: workspaceId });
}

function recordEvidence(state, taskId, evidence) {
  const task = taskById(state, taskId);
  if (evidence.submission_id) {
    const existing = task.evidence.find((item) => item.submission_id === evidence.submission_id && item.kind === evidence.kind);
    if (existing) return existing;
  }
  const required = ["kind", "producer", "head_sha", "result"];
  for (const name of required) if (!evidence[name]) throw new Error(`Evidence requires ${name}`);
  const expectedSha = evidence.kind === "post_merge" ? task.git.merge_sha : task.git.head_sha;
  if (evidence.head_sha !== expectedSha) throw new Error(`Evidence SHA ${evidence.head_sha} is stale; expected ${expectedSha}`);
  if (["implementation", "test", "manual_test", "acceptance"].includes(evidence.kind) && ![task.agents.implementer, task.agents.reviewer].includes(evidence.producer)) {
    throw new Error(`${evidence.producer} does not hold an implementer or reviewer lease`);
  }
  if (evidence.kind === "implementation" && evidence.producer !== task.agents.implementer) throw new Error("Only the implementer may record implementation evidence");
  const item = { id: crypto.randomUUID(), at: new Date().toISOString(), source: "attested", ...evidence };
  task.evidence.push(item);
  event(state, "evidence.recorded", { task_id: taskId, evidence_id: item.id, kind: item.kind, result: item.result, head_sha: item.head_sha });
  return item;
}

function recordReview(state, taskId, verdict, reviewerId, headSha, summary, submissionId = null) {
  const task = taskById(state, taskId);
  if (submissionId && task.reviews.some((item) => item.submission_id === submissionId)) return task;
  if (task.status !== TASK_STATES.IN_REVIEW) throw new Error(`${taskId} must be in_review`);
  if (reviewerId !== task.agents.reviewer) throw new Error(`${reviewerId} does not hold the reviewer lease`);
  if (reviewerId === task.agents.implementer) throw new Error("Implementer cannot review its own work");
  if (headSha !== task.git.head_sha) throw new Error(`Review is stale: ${headSha} != ${task.git.head_sha}`);
  if (!summary) throw new Error("Review summary is required");
  if (verdict === "pass") {
    const evidence = task.evidence.filter((item) => item.head_sha === headSha && item.producer === reviewerId);
    const errors = [];
    for (const command of task.contract.verification_commands) {
      const matches = evidence.filter((item) => item.kind === "test" && item.source === "executed" && item.command === command && item.exit_code === 0);
      if (matches.length !== 1) errors.push(`reviewer must execute exactly once: ${command}`);
    }
    for (const step of task.contract.manual_test_steps) {
      const matches = evidence.filter((item) => item.kind === "manual_test" && item.result === "pass" && item.step === step);
      if (matches.length !== 1) errors.push(`reviewer must verify manual step exactly once: ${step}`);
    }
    for (const criterion of task.contract.acceptance_criteria) {
      const matches = evidence.filter((item) => item.kind === "acceptance" && item.result === "pass" && item.criterion === criterion);
      if (matches.length !== 1) errors.push(`reviewer must verify acceptance criterion exactly once: ${criterion}`);
    }
    if (!task.git.remote || task.git.remote.head_sha !== headSha || task.git.remote.state !== "OPEN" || task.git.remote.base_branch !== task.git.base_branch || task.git.remote.is_cross_repository !== false) errors.push("current GitHub PR head/base must be verified before PASS");
    if (errors.length) throw new Error(`Review checklist incomplete: ${errors.join("; ")}`);
  }
  task.review = { verdict, reviewer_id: reviewerId, head_sha: headSha, summary, submission_id: submissionId, reviewed_at: new Date().toISOString() };
  task.reviews.push(structuredClone(task.review));
  event(state, "review.recorded", { task_id: taskId, verdict, reviewer_id: reviewerId, head_sha: headSha });
  if (verdict === "fail") {
    const result = transitionTask(state, taskId, TASK_STATES.IMPLEMENTING, reviewerId, `Review failed: ${summary}`);
    task.agents.implementer = null;
    task.agents.reviewer = null;
    task.agents.gatekeeper = null;
    task.agents.merger = null;
    task.agent_leases.implementer = null;
    task.agent_leases.reviewer = null;
    task.agent_leases.gatekeeper = null;
    task.agent_leases.merger = null;
    return result;
  }
  if (verdict !== "pass") throw new Error("Review verdict must be pass or fail");
  return transitionTask(state, taskId, TASK_STATES.REVIEW_PASSED, reviewerId, `Review passed: ${summary}`);
}

function createTask(input) {
  const now = new Date().toISOString();
  const contract = {
    description: input.description,
    scope: input.scope || [],
    exclusions: input.exclusions || [],
    acceptance_criteria: input.acceptance_criteria || [],
    verification_commands: input.verification_commands || [],
    manual_test_steps: input.manual_test_steps || [],
    dependencies: input.dependencies || []
  };
  const contractHash = crypto.createHash("sha256").update(JSON.stringify(contract)).digest("hex");
  return {
    id: input.id,
    title: input.title,
    status: TASK_STATES.PLANNED,
    attempt: 1,
    contract,
    contract_hash: contractHash,
    agents: { implementer: null, reviewer: null, gatekeeper: null, merger: null },
    agent_leases: { implementer: null, reviewer: null, gatekeeper: null, merger: null },
    linear: { issue_id: null, issue_url: null, desired_status: LINEAR_STATUS.TODO, actual_status: null, sync_pending: true },
    git: { repo: input.repo || null, base_branch: input.base_branch || "main", branch: null, head_sha: null, pr_number: null, pr_url: null, merge_sha: null, remote: null },
    evidence: [],
    reviews: [],
    review: null,
    gate: null,
    created_at: now,
    updated_at: now
  };
}

module.exports = { TASK_STATES, LINEAR_STATUS, assertSupervisor, linearStatusFor, taskById, event, transitionTask, recordAgent, recordEvidence, recordReview, createTask };
