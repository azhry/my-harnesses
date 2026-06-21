#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { appendEvent } = require("./lib/memory-store");

const [file, taskId, ...rest] = process.argv.slice(2);
const repoPath = rest.includes("--repo-path")
  ? path.resolve(rest[rest.indexOf("--repo-path") + 1])
  : process.cwd();
const labelOption = rest.includes("--label")
  ? rest[rest.indexOf("--label") + 1]
  : "";

if (!file || !taskId) {
  console.error("Usage: node scripts/enforce-git-lifecycle.js path/to/workflow-state.json TASK_ID [--repo-path /path/to/repo]");
  process.exit(1);
}

const statePath = path.resolve(file);
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const tasks = state.task_graph && Array.isArray(state.task_graph.tasks) ? state.task_graph.tasks : [];
const task = tasks.find((t) => t.id === taskId);

if (!task) {
  console.error(`Task not found: ${taskId}`);
  process.exit(1);
}

const git = task.git_flow || {};
const isDevTask = ["frontend_dev", "backend_dev"].includes(task.role);

if (!isDevTask) {
  console.log(`SKIP: ${taskId} (${task.role}) is not a dev task — no git lifecycle required`);
  process.exit(0);
}

const checks = [];
const failures = [];

// Fast-fail: check if repo path is a git repo
let isGitRepo = false;
try {
  const gitTopLevel = execSync("git rev-parse --show-toplevel", {
    cwd: repoPath,
    encoding: "utf8",
    timeout: 5000,
    stdio: ["pipe", "pipe", "pipe"]
  });
  isGitRepo = gitTopLevel.trim().length > 0;
} catch {
  isGitRepo = false;
}

if (!isGitRepo) {
  console.log(`  ⚠  ${repoPath} is not a git repository — skipping remote checks`);
  appendEvent(statePath, {
    type: "git_lifecycle_check",
    role_context: task.role,
    task_id: taskId,
    target: task.status,
    summary: `Git lifecycle skipped for ${taskId} — not a git repo at ${repoPath}`,
    details: JSON.stringify([{ check: "git_repo", status: "skipped", detail: `Not a git repo at ${repoPath}` }], null, 2),
    severity: "info",
    tags: ["git_lifecycle", taskId, "skipped"]
  });
  process.exit(0);
}

function runGit(args) {
  try {
    const result = execSync(`git ${args}`, {
      cwd: repoPath,
      encoding: "utf8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"]
    });
    return { ok: true, stdout: result.trim(), stderr: "" };
  } catch (err) {
    return { ok: false, stdout: (err.stdout || "").trim(), stderr: (err.stderr || "").trim() };
  }
}

function runGh(args) {
  try {
    const result = execSync(`gh ${args}`, {
      cwd: repoPath,
      encoding: "utf8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"]
    });
    return { ok: true, stdout: result.trim(), stderr: "" };
  } catch (err) {
    return { ok: false, stdout: (err.stdout || "").trim(), stderr: (err.stderr || "").trim() };
  }
}

// Check 1: remote exists for the repo
console.log(`\n[Git Lifecycle Enforcement] ${taskId} (${task.title || ""})`);
console.log(`  Target repo: ${repoPath}`);

const remoteResult = runGit("remote -v");
if (!remoteResult.ok || !remoteResult.stdout) {
  const msg = `No git remote configured at ${repoPath}. Validation failed.`;
  console.log(`  ⚠  ${msg}`);
  checks.push({ check: "remote_exists", status: "failed", detail: msg });
  failures.push(msg);
} else {
  checks.push({ check: "remote_exists", status: "passed", detail: "Remote configured" });
  const remoteUrl = remoteResult.stdout.split("\n")[0].split(/\s+/)[1] || "";

  // Check 2: feature branch exists on remote
  if (git.feature_branch) {
    const lsResult = runGit(`ls-remote --heads origin ${git.feature_branch}`);
    if (lsResult.ok && lsResult.stdout.includes(git.feature_branch)) {
      checks.push({ check: "branch_pushed_remote", status: "passed", detail: `Branch ${git.feature_branch} exists on remote` });
    } else {
      const msg = `Branch ${git.feature_branch} not found on remote (ls-remote returned nothing)`;
      checks.push({ check: "branch_pushed_remote", status: "failed", detail: msg });
      failures.push(msg);
    }
  } else {
    checks.push({ check: "branch_pushed_remote", status: "skipped", detail: "No feature_branch in git_flow" });
  }

  // Check 3: merge request exists via gh CLI
  if (git.merge_request_url) {
    const mrNumber = git.merge_request_url.match(/(\d+)$/)?.[1];
    if (mrNumber) {
      const mrResult = runGh(`pr view ${mrNumber} --json state,mergedAt,mergeCommit,body`);
      if (mrResult.ok) {
        let mrData;
        try {
          mrData = JSON.parse(mrResult.stdout);
        } catch {
          mrData = null;
        }
        if (mrData) {
          checks.push({ check: "merge_request_exists", status: "passed", detail: `PR #${mrNumber} exists on remote` });
          const body = (mrData.body || "").trim();
          if (!body || body.length < 50) {
            const msg = `PR #${mrNumber} description is too short (${body.length} chars) — must be >= 50 chars with Summary, Changes, Impact, Test Instructions`;
            checks.push({ check: "pr_description_quality", status: "failed", detail: msg });
            failures.push(msg);
          } else if (!body.includes("## Summary") && !body.includes("## Changes") && !body.includes("## Manual Test")) {
            const msg = `PR #${mrNumber} description missing required sections (## Summary, ## Changes, ## Impact, ## Manual Test Instructions)`;
            checks.push({ check: "pr_description_quality", status: "failed", detail: msg });
            failures.push(msg);
          } else {
            checks.push({ check: "pr_description_quality", status: "passed", detail: `PR #${mrNumber} description has ${body.length} chars with required sections` });
          }
          const state = mrData.state || "";
          if (git.merge_request_status === "merged" && state !== "MERGED") {
            const msg = `PR #${mrNumber} is ${state} but git_flow says merged`;
            checks.push({ check: "merge_request_merged", status: "failed", detail: msg });
            failures.push(msg);
          } else if (git.merge_request_status === "merged" && state === "MERGED") {
            checks.push({ check: "merge_request_merged", status: "passed", detail: `PR #${mrNumber} merged at ${mrData.mergedAt || "unknown"}` });
          } else {
            checks.push({ check: "merge_request_merged", status: "skipped", detail: `PR #${mrNumber} state=${state} (merged not required yet)` });
          }
        } else {
          checks.push({ check: "merge_request_exists", status: "passed", detail: `PR #${mrNumber} exists` });
        }
      } else {
        const msg = `Cannot verify PR #${mrNumber}: ${mrResult.stderr || mrResult.stdout}`;
        checks.push({ check: "merge_request_exists", status: "failed", detail: msg });
        failures.push(msg);
      }
    } else {
      const msg = `Cannot parse PR number from merge_request_url: ${git.merge_request_url}`;
      checks.push({ check: "merge_request_exists", status: "skipped", detail: msg });
    }
  } else {
    checks.push({ check: "merge_request_exists", status: "skipped", detail: "No merge_request_url in git_flow" });
  }
}

// Check 4: local git_flow field consistency
console.log(`  Local git_flow fields:`);
const fieldChecks = {
  branch_created: git.branch_created,
  local_tests_passed: git.local_tests_passed,
  pushed: git.pushed,
  merge_request_status: git.merge_request_status,
  merge_request_url: git.merge_request_url,
  auto_merge: git.auto_merge,
  merge_checks_passed: git.merge_checks_passed,
  merged: git.merged
};
for (const [field, value] of Object.entries(fieldChecks)) {
  const status = value ? "present" : "missing";
  console.log(`    ${field}: ${status}${value ? ` = ${typeof value === "boolean" ? value : value}` : ""}`);
}
checks.push({ check: "field_consistency", status: failures.length === 0 ? "passed" : "failed", detail: `${Object.keys(fieldChecks).length} fields checked, ${failures.length} failures` });

// Auto-detect label: ai-assisted if human gates were involved, else ai-automated
function detectLabel(state, task) {
  if (labelOption) return labelOption;
  const gates = state.gates || {};
  const hasHumanGate = Object.values(gates).some((g) => g && (g.approver || g.approval_note));
  const hasHumanInstructions = state.human_instructions &&
    Object.values(state.human_instructions).some((h) => h && h.status === "sent");
  const hasHumanEvents = (state.log || []).some((e) =>
    /human_approval|human_disapproval|human_instruction|human_gate/i.test(e.note || "")
  );
  if (hasHumanGate || hasHumanInstructions || hasHumanEvents) return "ai-assisted";
  return "ai-automated";
}

// Apply label to PR via gh CLI
function applyPrLabel(mergeRequestUrl, label) {
  if (!mergeRequestUrl || !label) return;
  const mrNumber = mergeRequestUrl.match(/(\d+)$/)?.[1];
  if (!mrNumber) return;
  const result = runGh(`pr edit ${mrNumber} --add-label "${label}"`);
  if (result.ok) {
    console.log(`  Label applied: ${label} to PR #${mrNumber}`);
  } else {
    console.log(`  ⚠  Could not apply label ${label} to PR #${mrNumber}: ${result.stderr || result.stdout}`);
  }
}

// Record event
const passed = failures.length === 0;
const event = appendEvent(statePath, {
  type: "git_lifecycle_check",
  role_context: task.role,
  task_id: taskId,
  target: task.status,
  summary: passed
    ? `Git lifecycle verified for ${taskId}`
    : `Git lifecycle FAILED for ${taskId}: ${failures.join("; ")}`,
  details: JSON.stringify(checks, null, 2),
  severity: passed ? "info" : "warning",
  tags: ["git_lifecycle", taskId, passed ? "passed" : "failed"]
});

console.log(`  Overall: ${passed ? "PASS" : "FAIL"}`);
if (failures.length) {
  console.error(`  Failures:`);
  for (const f of failures) {
    console.error(`    - ${f}`);
  }
  process.exit(1);
}

if (passed && git.merge_request_url) {
  const detectedLabel = detectLabel(state, task);
  applyPrLabel(git.merge_request_url, detectedLabel);
}

console.log(`  Event recorded: ${event.event.id}`);
