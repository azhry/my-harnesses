"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 120000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function assertClean(repo) {
  const dirty = run("git", ["status", "--porcelain"], repo);
  if (dirty) throw new Error(`Repository has unrelated dirty files:\n${dirty}`);
}

function prepareWorktree(task, repo, runId, workspaceRoot) {
  run("git", ["fetch", "origin", task.git.base_branch], repo);
  const slug = task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  const branch = `agent/${String(runId).toLowerCase().replace(/[^a-z0-9-]+/g, "-")}/${task.id.toLowerCase()}-${slug}`;
  const worktree = path.join(workspaceRoot, `${task.id.toLowerCase()}-${task.attempt}`);
  fs.mkdirSync(workspaceRoot, { recursive: true });
  if (fs.existsSync(worktree)) throw new Error(`Task worktree already exists: ${worktree}`);
  run("git", ["worktree", "add", "-b", branch, worktree, `origin/${task.git.base_branch}`], repo);
  task.git.branch = branch;
  task.git.repo_root = path.resolve(repo);
  task.git.worktree_path = worktree;
  task.git.head_sha = run("git", ["rev-parse", "HEAD"], worktree);
  return task.git;
}

function taskRepository(task, fallback) {
  return task.git.worktree_path && fs.existsSync(task.git.worktree_path) ? task.git.worktree_path : fallback;
}

function cleanupWorktree(task) {
  if (!task.git.worktree_path || !task.git.repo_root) return;
  run("git", ["worktree", "remove", "--force", task.git.worktree_path], task.git.repo_root);
  task.git.worktree_removed_at = new Date().toISOString();
}

function captureHead(task, repo) {
  const branch = run("git", ["branch", "--show-current"], repo);
  if (branch !== task.git.branch) throw new Error(`Expected branch ${task.git.branch}, got ${branch}`);
  task.git.head_sha = run("git", ["rev-parse", "HEAD"], repo);
  task.review = null;
  task.gate = null;
  return task.git.head_sha;
}

function publishPullRequest(task, repo, bodyFile) {
  captureHead(task, repo);
  run("git", ["push", "-u", "origin", task.git.branch], repo);
  const url = run("gh", ["pr", "create", "--base", task.git.base_branch, "--head", task.git.branch, "--title", `${task.id}: ${task.title}`, "--body-file", bodyFile], repo);
  task.git.pr_url = url.split(/\s+/).find((value) => value.startsWith("http")) || url;
  const number = run("gh", ["pr", "view", task.git.pr_url, "--json", "number", "--jq", ".number"], repo);
  task.git.pr_number = Number(number);
  return task.git;
}

function submitReview(task, repo, verdict, summary) {
  if (!task.git.pr_number) throw new Error("PR must exist before review");
  const flag = verdict === "pass" ? "--approve" : "--request-changes";
  run("gh", ["pr", "review", String(task.git.pr_number), flag, "--body", summary], repo);
}

function verifyPullRequest(task, repo) {
  if (!task.git.pr_number || !task.git.pr_url) throw new Error("PR metadata is missing");
  const requiredChecks = JSON.parse(run("gh", ["pr", "checks", String(task.git.pr_number), "--required", "--json", "name,state,bucket"], repo) || "[]");
  const nonGateChecks = requiredChecks.filter((item) => item.name !== "devcircuit/gate");
  const failed = nonGateChecks.filter((item) => !["pass", "skipping"].includes(String(item.bucket).toLowerCase()));
  if (failed.length) throw new Error(`Required checks are not ready: ${failed.map((item) => `${item.name}:${item.state}`).join(", ")}`);
  const data = JSON.parse(run("gh", ["pr", "view", String(task.git.pr_number), "--json", "headRefOid,baseRefName,state,reviewDecision,mergeStateStatus,url,isCrossRepository"], repo));
  task.git.remote = {
    head_sha: data.headRefOid,
    state: data.state,
    review_decision: data.reviewDecision,
    merge_state: data.mergeStateStatus,
    url: data.url,
    base_branch: data.baseRefName,
    is_cross_repository: data.isCrossRepository,
    required_checks_passed: true,
    verified_at: new Date().toISOString()
  };
  return task.git.remote;
}

function publishGateStatus(task, repo, repository) {
  if (!repository || !task.git.head_sha) throw new Error("Repository and HEAD are required for gate status");
  const expectedActor = process.env.DEVCIRCUIT_GATE_ACTOR;
  if (!expectedActor) throw new Error("DEVCIRCUIT_GATE_ACTOR is required");
  const status = JSON.parse(run("gh", ["api", `repos/${repository}/statuses/${task.git.head_sha}`, "-X", "POST", "-f", "state=success", "-f", "context=devcircuit/gate", "-f", "description=DevCircuit evidence gate passed"], repo));
  if (!status.creator || status.creator.login !== expectedActor) throw new Error(`Gate publisher identity mismatch: ${status.creator && status.creator.login} != ${expectedActor}`);
}

function verifyGateStatus(task, repo, repository) {
  const payload = JSON.parse(run("gh", ["api", `repos/${repository}/commits/${task.git.head_sha}/status`], repo));
  const status = (payload.statuses || []).find((item) => item.context === "devcircuit/gate");
  if (!status || status.state !== "success") throw new Error("Trusted devcircuit/gate status is missing or not successful");
  const expectedActor = process.env.DEVCIRCUIT_GATE_ACTOR;
  if (!expectedActor) throw new Error("DEVCIRCUIT_GATE_ACTOR is required");
  if (!status.creator || status.creator.login !== expectedActor) throw new Error(`devcircuit/gate was published by ${status.creator && status.creator.login}, expected ${expectedActor}`);
}

function verifyPostMergeChecks(task, repo, repository) {
  if (!task.git.merge_sha) throw new Error("Merge SHA is missing");
  const payload = JSON.parse(run("gh", ["api", `repos/${repository}/commits/${task.git.merge_sha}/check-runs`], repo));
  const runs = payload.check_runs || [];
  const requiredNames = String(process.env.DEVCIRCUIT_POST_MERGE_CHECKS || "").split(",").map((item) => item.trim()).filter(Boolean);
  const selected = requiredNames.length ? requiredNames.map((name) => runs.find((item) => item.name === name)).filter(Boolean) : runs;
  if (!selected.length || (requiredNames.length && selected.length !== requiredNames.length)) throw new Error("Required post-merge check runs are missing");
  const failed = selected.filter((item) => item.status !== "completed" || !["success", "neutral", "skipped"].includes(item.conclusion));
  if (failed.length) throw new Error(`Post-merge checks not successful: ${failed.map((item) => `${item.name}:${item.status}/${item.conclusion}`).join(", ")}`);
  return selected.map((item) => ({ id: item.id, name: item.name, conclusion: item.conclusion, url: item.html_url }));
}

function mergePullRequest(task, repo, repository) {
  if (!task.gate || task.gate.decision !== "ALLOW" || task.gate.head_sha !== task.git.head_sha) throw new Error("Current-SHA gate ALLOW is required before merge");
  const remote = verifyPullRequest(task, repo);
  if (remote.head_sha !== task.git.head_sha) throw new Error(`PR head changed after gate: ${remote.head_sha} != ${task.git.head_sha}`);
  if (remote.base_branch !== task.git.base_branch || remote.is_cross_repository) throw new Error("PR base or repository does not match the task contract");
  verifyGateStatus(task, repo, repository);
  run("gh", ["pr", "checks", String(task.git.pr_number), "--required"], repo);
  run("gh", ["pr", "merge", String(task.git.pr_number), "--squash", "--delete-branch", "--match-head-commit", task.git.head_sha], repo);
  const data = JSON.parse(run("gh", ["pr", "view", String(task.git.pr_number), "--json", "state,mergedAt,mergeCommit"], repo));
  if (data.state !== "MERGED" || !data.mergeCommit || !data.mergeCommit.oid) throw new Error("GitHub did not confirm the merge");
  task.git.merge_sha = data.mergeCommit.oid;
  return task.git.merge_sha;
}

module.exports = { run, assertClean, prepareWorktree, taskRepository, cleanupWorktree, captureHead, publishPullRequest, submitReview, verifyPullRequest, publishGateStatus, verifyGateStatus, verifyPostMergeChecks, mergePullRequest };
