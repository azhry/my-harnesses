"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execute } = require("./cli");
const { readState, mutateState, acquireLock, releaseLock } = require("./state-store");
const { TASK_STATES, event } = require("./workflow");
const submissions = require("./submissions");

function currentTask(state) {
  return state.tasks.find((task) => task.status !== TASK_STATES.POST_MERGE_VERIFIED) || null;
}

function agentArgs(statePath, taskId, role, adapter) {
  return ["dispatch-agent", "--state", statePath, "--task", taskId, "--role", role, "--adapter", adapter];
}

function implementationReady(task) {
  const evidence = task.evidence.filter((item) => item.head_sha === task.git.head_sha);
  return evidence.some((item) => item.kind === "implementation" && item.result === "pass") &&
    task.contract.verification_commands.every((command) => evidence.some((item) => item.kind === "test" && item.source === "executed" && item.producer === task.agents.implementer && item.command === command && item.exit_code === 0));
}

function renderPr(task, state) {
  const evidence = task.evidence.filter((item) => item.head_sha === task.git.head_sha);
  return `## Linear task\n${task.linear.issue_url || task.id}\n\n## Purpose\n${task.contract.description}\n\n## Scope\n${task.contract.scope.map((item) => `- ${item}`).join("\n") || "- None"}\n\n## Non-goals\n${task.contract.exclusions.map((item) => `- ${item}`).join("\n") || "- None"}\n\n## Implementation\nSee commits on \`${task.git.branch}\`. Contract: \`${task.contract_hash}\`.\n\n## Automated verification\n${evidence.filter((item) => item.kind === "test").map((item) => `- \`${item.command}\`: ${item.result}, exit ${item.exit_code}, ${item.artifact || "artifact recorded in run state"}`).join("\n")}\n\n## Manual test procedure\n${task.contract.manual_test_steps.map((item, index) => `${index + 1}. ${item}`).join("\n") || "No manual steps specified."}\n\n## Risks and rollback\nReview the task contract and specification revision ${state.specification.revision}. Revert the PR if post-merge verification fails.\n`;
}

async function runOnceUnlocked({ statePath, repo, adapter, linearClient }) {
  let state = readState(statePath);
  if (state.supervisor.status !== "watching") return { action: "denied", reason: `supervisor=${state.supervisor.status}` };
  for (const submission of submissions.pending(statePath, state)) {
    const { envelope, task, agentId } = submission;
    const payload = envelope.payload || {};
    let journalStatus;
    mutateState(statePath, "submission.begin", (current) => { journalStatus = submissions.begin(current, envelope, `orchestrator:${process.pid}`); });
    if (journalStatus === "processed") {
      submissions.archive(submission.file);
      state = readState(statePath);
      continue;
    }
    if (journalStatus === "claimed") continue;
    if (envelope.type === "implementation") {
      const captured = await execute(["capture-head", "--state", statePath, "--task", task.id, "--repo", repo]);
      if (payload.head_sha !== captured.output) throw new Error(`Implementation submission SHA ${payload.head_sha} != repository HEAD ${captured.output}`);
      await execute(["evidence", "--state", statePath, "--task", task.id, "--kind", "implementation", "--producer", agentId, "--result", "pass", "--head-sha", payload.head_sha, "--artifact", payload.artifact || "worker submission", "--submission-id", envelope.id]);
      for (const command of task.contract.verification_commands) await execute(["run-check", "--state", statePath, "--task", task.id, "--repo", repo, "--producer", agentId, "--label", "implementer", "--contract-command", command, "--", "/bin/sh", "-lc", command]);
    } else if (envelope.type === "manual_test") {
      await execute(["evidence", "--state", statePath, "--task", task.id, "--kind", "manual_test", "--producer", agentId, "--result", payload.result, "--head-sha", payload.head_sha, "--step", payload.step, "--submission-id", envelope.id]);
    } else if (envelope.type === "acceptance") {
      await execute(["evidence", "--state", statePath, "--task", task.id, "--kind", "acceptance", "--producer", agentId, "--result", payload.result, "--head-sha", payload.head_sha, "--criterion", payload.criterion, "--submission-id", envelope.id]);
    } else if (envelope.type === "review") {
      if (payload.verdict === "pass") for (const command of task.contract.verification_commands) await execute(["run-check", "--state", statePath, "--task", task.id, "--repo", repo, "--producer", agentId, "--label", "reviewer", "--contract-command", command, "--", "/bin/sh", "-lc", command]);
      await execute(["review", "--state", statePath, "--task", task.id, "--repo", repo, "--verdict", payload.verdict, "--reviewer-id", agentId, "--head-sha", payload.head_sha, "--summary", payload.summary, "--submission-id", envelope.id]);
    }
    mutateState(statePath, "submission.complete", (current) => submissions.complete(current, envelope));
    submissions.archive(submission.file);
    state = readState(statePath);
  }
  const task = currentTask(state);
  if (!task) {
    mutateState(statePath, "orchestrator", (current) => {
      current.run.status = "completed";
      event(current, "run.completed", { task_count: current.tasks.length });
    });
    return { action: "complete" };
  }

  if (task.status === TASK_STATES.PLANNED) {
    await execute(["sync-linear", "--state", statePath], { linearClient });
    await execute(["prepare-task", "--state", statePath, "--task", task.id, "--repo", repo]);
    if (!task.agents.implementer) await execute(agentArgs(statePath, task.id, "implementer", adapter));
    await execute(["start-task", "--state", statePath, "--task", task.id, "--repo", repo]);
    await execute(["sync-linear", "--state", statePath], { linearClient });
    return { action: "implementer_dispatched", task: task.id };
  }

  if (task.status === TASK_STATES.IMPLEMENTING) {
    state = readState(statePath);
    const fresh = currentTask(state);
    if (!fresh.agents.implementer) {
      await execute(agentArgs(statePath, fresh.id, "implementer", adapter));
      return { action: "repair_implementer_dispatched", task: fresh.id };
    }
    if (!implementationReady(fresh)) return { action: "waiting_for_implementation", task: fresh.id };
    if (!fresh.git.pr_url) {
      const body = path.join(path.dirname(statePath), `${fresh.id}-pull-request.md`);
      fs.writeFileSync(body, renderPr(fresh, state));
      await execute(["publish-pr", "--state", statePath, "--task", fresh.id, "--repo", repo, "--body-file", body]);
    }
    state = readState(statePath);
    if (!currentTask(state).agents.reviewer) await execute(agentArgs(statePath, fresh.id, "reviewer", adapter));
    await execute(["submit-review", "--state", statePath, "--task", fresh.id]);
    await execute(["sync-linear", "--state", statePath], { linearClient });
    return { action: "reviewer_dispatched", task: fresh.id };
  }

  if (task.status === TASK_STATES.IN_REVIEW) return { action: "waiting_for_review", task: task.id };

  if (task.status === TASK_STATES.REVIEW_PASSED) {
    await execute(["sync-linear", "--state", statePath], { linearClient });
    state = readState(statePath);
    if (!currentTask(state).agents.gatekeeper) await execute(agentArgs(statePath, task.id, "gatekeeper", adapter));
    state = readState(statePath);
    await execute(["audit", "--state", statePath, "--task", task.id, "--gatekeeper-id", currentTask(state).agents.gatekeeper, "--repo", repo]);
    return { action: "gate_audited", task: task.id };
  }

  if (task.status === TASK_STATES.MERGE_READY) {
    if (!task.agents.merger) await execute(agentArgs(statePath, task.id, "merger", adapter));
    state = readState(statePath);
    await execute(["merge", "--state", statePath, "--task", task.id, "--repo", repo, "--merger-id", currentTask(state).agents.merger]);
    return { action: "merged", task: task.id };
  }

  if (task.status === TASK_STATES.MERGED) {
    await execute(["post-merge-verify", "--state", statePath, "--task", task.id, "--repo", repo]);
    return { action: "post_merge_verified", task: task.id };
  }

  return { action: "blocked", task: task.id, status: task.status };
}

async function runOnce(options) {
  const lock = acquireLock(`${options.statePath}.orchestrator`);
  try { return await runOnceUnlocked(options); }
  finally { releaseLock(lock); }
}

module.exports = { currentTask, implementationReady, renderPr, runOnce };
