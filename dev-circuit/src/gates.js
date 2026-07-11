"use strict";

const { TASK_STATES, assertSupervisor, taskById, event } = require("./workflow");

function check(id, pass, reason, evidenceIds = []) {
  return { id, result: pass ? "pass" : "fail", reason, evidence_ids: evidenceIds };
}

function auditMergeGate(state, taskId, gatekeeperId) {
  assertSupervisor(state);
  const task = taskById(state, taskId);
  const currentEvidence = task.evidence.filter((item) => item.head_sha === task.git.head_sha);
  const passedCommands = currentEvidence.filter((item) => item.kind === "test" && item.result === "pass" && ["executed", "ci_verified"].includes(item.source));
  const reviewerTests = passedCommands.filter((item) => item.producer === task.agents.reviewer);
  const reviewerManual = currentEvidence.filter((item) => item.kind === "manual_test" && item.result === "pass" && item.producer === task.agents.reviewer);
  const reviewerAcceptance = currentEvidence.filter((item) => item.kind === "acceptance" && item.result === "pass" && item.producer === task.agents.reviewer);
  const implementation = currentEvidence.filter((item) => item.kind === "implementation" && item.result === "pass");
  const checks = [
    check("state.review_passed", task.status === TASK_STATES.REVIEW_PASSED, `status=${task.status}`),
    check("roles.gatekeeper", task.agents.gatekeeper === gatekeeperId, "gatekeeper must hold the recorded lease"),
    check("roles.separated", !Object.entries(task.agents).some(([role, id]) => role !== "gatekeeper" && id && id === gatekeeperId), "gatekeeper identity must be independent"),
    check("git.head_sha", Boolean(task.git.head_sha), task.git.head_sha || "missing HEAD"),
    check("git.branch", Boolean(task.git.branch), task.git.branch || "missing feature branch"),
    check("git.pr", Boolean(task.git.pr_url && task.git.pr_number), task.git.pr_url || "missing PR"),
    check("git.remote_head", task.git.remote && task.git.remote.head_sha === task.git.head_sha, task.git.remote ? `${task.git.remote.head_sha} vs ${task.git.head_sha}` : "GitHub PR not verified"),
    check("git.remote_open", task.git.remote && task.git.remote.state === "OPEN", task.git.remote ? task.git.remote.state : "GitHub PR not verified"),
    check("git.remote_review", task.git.remote && task.git.remote.review_decision === "APPROVED", task.git.remote ? task.git.remote.review_decision : "GitHub PR not verified"),
    check("git.remote_base", task.git.remote && task.git.remote.base_branch === task.git.base_branch && task.git.remote.is_cross_repository === false, task.git.remote ? `${task.git.remote.base_branch}, cross=${task.git.remote.is_cross_repository}` : "GitHub PR not verified"),
    check("git.required_checks", task.git.remote && task.git.remote.required_checks_passed === true, task.git.remote ? String(task.git.remote.required_checks_passed) : "GitHub PR not verified"),
    check("evidence.implementation", implementation.length > 0, "current-SHA implementation evidence required", implementation.map((item) => item.id)),
    ...task.contract.verification_commands.map((command, index) => {
      const matches = reviewerTests.filter((item) => item.command === command && item.exit_code === 0);
      return check(`evidence.command.${index}`, matches.length === 1, `reviewer must execute exactly once: ${command}; matches=${matches.length}`, matches.map((item) => item.id));
    }),
    ...task.contract.manual_test_steps.map((step, index) => {
      const matches = reviewerManual.filter((item) => item.step === step);
      return check(`evidence.manual.${index}`, matches.length === 1, `reviewer must attest exactly once: ${step}; matches=${matches.length}`, matches.map((item) => item.id));
    }),
    ...task.contract.acceptance_criteria.map((criterion, index) => {
      const matches = reviewerAcceptance.filter((item) => item.criterion === criterion);
      return check(`evidence.acceptance.${index}`, matches.length === 1, `reviewer must verify exactly once: ${criterion}; matches=${matches.length}`, matches.map((item) => item.id));
    }),
    check("review.pass", task.review && task.review.verdict === "pass", task.review ? task.review.verdict : "missing review"),
    check("review.current_sha", task.review && task.review.head_sha === task.git.head_sha, task.review ? `${task.review.head_sha} vs ${task.git.head_sha}` : "missing review"),
    check("review.independent", task.review && task.review.reviewer_id !== task.agents.implementer, "reviewer must differ from implementer"),
    check("linear.done", task.linear.desired_status === "Done", `desired=${task.linear.desired_status}`),
    check("linear.synced", task.linear.sync_pending === false && task.linear.actual_status === "Done", `actual=${task.linear.actual_status || "unknown"}, pending=${task.linear.sync_pending}`)
  ];
  const allowed = checks.every((item) => item.result === "pass");
  task.gate = {
    decision: allowed ? "ALLOW" : "DENY",
    gatekeeper_id: gatekeeperId,
    head_sha: task.git.head_sha,
    policy_version: state.policy_version,
    checks,
    decided_at: new Date().toISOString()
  };
  event(state, "gate.decided", { task_id: taskId, decision: task.gate.decision, head_sha: task.git.head_sha, gatekeeper_id: gatekeeperId });
  if (allowed) {
    task.status = TASK_STATES.MERGE_READY;
    task.updated_at = new Date().toISOString();
  }
  return task.gate;
}

function auditState(state) {
  const findings = [];
  const active = state.tasks.filter((task) => [TASK_STATES.IMPLEMENTING, TASK_STATES.IN_REVIEW, TASK_STATES.REVIEW_PASSED, TASK_STATES.MERGE_READY, TASK_STATES.MERGED].includes(task.status));
  if (active.length > 1) findings.push({ severity: "critical", code: "wip.exceeded", message: `WIP=1 violated by ${active.map((task) => task.id).join(", ")}` });
  for (const task of state.tasks) {
    if (task.review && task.review.head_sha !== task.git.head_sha) findings.push({ severity: "critical", code: "review.stale", task_id: task.id, message: "Review SHA does not match current HEAD" });
    if (task.gate && task.gate.head_sha !== task.git.head_sha) findings.push({ severity: "critical", code: "gate.stale", task_id: task.id, message: "Gate decision SHA does not match current HEAD" });
    if (task.git.remote && task.git.remote.head_sha !== task.git.head_sha) findings.push({ severity: "critical", code: "github.head_mismatch", task_id: task.id, message: "Recorded GitHub PR head differs from local workflow HEAD" });
    if (task.status === TASK_STATES.REVIEW_PASSED && (!task.review || task.review.verdict !== "pass")) findings.push({ severity: "critical", code: "review.missing", task_id: task.id, message: "review_passed without PASS evidence" });
    if (task.linear.desired_status === "Done" && (!task.review || task.review.verdict !== "pass")) findings.push({ severity: "critical", code: "linear.false_done", task_id: task.id, message: "Linear Done desired without independent PASS" });
  }
  return { ok: findings.length === 0, findings };
}

module.exports = { auditMergeGate, auditState };
