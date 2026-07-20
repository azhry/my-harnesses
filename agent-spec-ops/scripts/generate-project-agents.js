#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { appendEvent, readNdjson, loadKnowledgeCards } = require("./lib/memory-store");
const { loadWorkflowState } = require("./lib/state-store");

const args = parseArgs(process.argv.slice(2));

if (!args.stateFile || !args.projectRepo) {
  console.error([
    "Usage: node scripts/generate-project-agents.js runs/<DELIVERY_ID>/workflow-state.json --project-repo PATH [options]",
    "",
    "Options:",
    "  --project-repo PATH   Absolute or harness-relative path to the project repo",
    "  --role ROLE           Default role to show in recovery commands (default: orchestrator)",
    "  --force               Replace existing managed block"
  ].join("\n"));
  process.exit(1);
}

const harnessRoot = path.resolve(__dirname, "..");
const statePath = path.resolve(args.stateFile);
let state;
try {
  state = loadWorkflowState(statePath);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const runDir = path.dirname(statePath);
const projectRepo = path.resolve(harnessRoot, args.projectRepo);
const agentsPath = path.join(projectRepo, "AGENTS.md");
const deliveryId = state.delivery && state.delivery.id ? state.delivery.id : path.basename(runDir);
const title = state.delivery && state.delivery.title ? state.delivery.title : deliveryId;
const role = args.role || "orchestrator";
const tasks = state.task_graph && Array.isArray(state.task_graph.tasks) ? state.task_graph.tasks : [];
const designAssets = state.artifacts && state.artifacts.design_assets ? state.artifacts.design_assets : {};
const harnessRel = slash(path.relative(projectRepo, harnessRoot) || ".");
const stateRelFromHarness = slash(path.relative(harnessRoot, statePath));
const runRelFromHarness = slash(path.relative(harnessRoot, runDir));
const designAssetsRel = designAssets.path || `runs/${deliveryId}/design-assets/`;
const designAssetsFromProject = slash(path.relative(projectRepo, path.resolve(harnessRoot, designAssetsRel)));
const existing = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, "utf8") : "";
const managed = buildManagedBlock(!existing.trim());
const next = mergeManagedBlock(existing, managed);

fs.mkdirSync(projectRepo, { recursive: true });
fs.writeFileSync(agentsPath, next);
console.log(`Generated project AGENTS.md: ${agentsPath}`);

const openCodeFiles = writeOpenCodeAdapterFiles();
for (const file of openCodeFiles) {
  console.log(`Generated OpenCode adapter: ${file}`);
}

appendEvent(statePath, {
  type: "artifact_generated",
  actor: "agent",
  role_context: "orchestrator",
  target: slash(path.relative(harnessRoot, agentsPath)),
  summary: `Generated project AGENTS.md for ${deliveryId}`,
  details: `Updated managed agent-spec-ops context block and OpenCode adapters in ${projectRepo}`,
  severity: "info",
  tags: ["artifact", "project-agents", deliveryId],
  evidence: [
    slash(path.relative(harnessRoot, agentsPath)),
    ...openCodeFiles.map((file) => slash(path.relative(harnessRoot, file)))
  ]
});

function buildManagedBlock(includeTitle) {
  const lines = [];
  if (includeTitle) {
    lines.push("# Agent Instructions");
    lines.push("");
  }
  lines.push("<!-- agent-spec-ops:managed:start -->");
  lines.push("## Agent Spec Ops Context");
  lines.push("");
  lines.push("This project is managed by the `agent-spec-ops` harness. Treat this");
  lines.push("managed block as the compact recovery packet for new sessions, role");
  lines.push("handoffs, and context compaction.");
  lines.push("");
  lines.push("### Current Delivery");
  lines.push("");
  lines.push(`- Delivery: ${deliveryId}`);
  lines.push(`- Title: ${title}`);
  lines.push(`- State: ${state.current_state || "unknown"}`);
  lines.push(`- Last updated: ${(state.delivery && state.delivery.updated_at) || "unknown"}`);
  lines.push(`- Harness path from this repo: \`${harnessRel}\``);
  lines.push(`- Workflow state: \`${harnessRel}/${stateRelFromHarness}\``);
  lines.push(`- Run directory: \`${harnessRel}/${runRelFromHarness}/\``);
  lines.push("");
  lines.push("### Required Session Start");
  lines.push("");
  lines.push("Run this before acting, after compaction, after interruption, and after any");
  lines.push("state change made outside the current shell:");
  lines.push("");
  lines.push("```bash");
  lines.push(`cd ${harnessRel}`);
  lines.push(`node scripts/read-context.js ${stateRelFromHarness} --role ${role}`);
  lines.push(`node scripts/read-instructions.js ${stateRelFromHarness} --role ${role}`);
  lines.push(`node scripts/validate-state.js ${stateRelFromHarness}`);
  lines.push("```");
  lines.push("");
  lines.push("If a transition script reports stale context, rerun the two commands above.");
  lines.push("");
  lines.push("### Non-Negotiable Workflow");
  lines.push("");
  lines.push("- Evaluation is not passive: if the user asks to evaluate, inspect, review, or diagnose a run/session, also apply safe harness/project instruction fixes for confirmed root causes before reporting.");
  lines.push("- Stop at evaluation only when the user explicitly says `evaluate only` or the fix needs approval or unclear product-scope changes.");
  lines.push("- A default/freeform OpenCode `build` or `general` session is not the harness orchestrator.");
  lines.push("- If this prompt was not launched through `/agent-spec-spawn` or `@agent-spec-orchestrator`, stop and ask the user to restart through the harness command/agent before planning, spawning, editing, submitting, or merging.");
  lines.push("- Do not treat a user prompt as direct coding work while this run is active.");
  lines.push("- If the user requests rework, stop implementation and route back to `task_breakdown`.");
  lines.push("- Do not keep task, gate, credential, or design knowledge only in chat.");
  lines.push("- Do not edit `workflow-state.json` directly.");
  lines.push("- For task breakdown, write `runs/<DELIVERY_ID>/task-breakdown.json` and run `record-task-breakdown.js`; do not create temporary scripts or mutate `task_graph.tasks` directly.");
  lines.push("- If context recovery or validation reports a state integrity error, stop; do not continue from untrusted state.");
  lines.push("- Do not use generic state-field mutation for status, task, gate, or lease updates.");
  lines.push("- Do not run long-lived dev servers or full E2E suites from a default build/general session or orchestrator role.");
  lines.push("- Test agents must use bounded, task-scoped commands. On timeout, hang, or first failing run, record failed evidence and return to dev instead of rerunning the full suite or patching implementation.");
  lines.push("- Local browser E2E must be visible/headed by default so the human can watch. Use headless only in CI, when the user explicitly asks, or for a final artifact-only check; if visible mode is unavailable, stop and report it.");
  lines.push("- Use `record-event.js` only for evidence, decisions, blockers, and corrections.");
  lines.push("- Use `transition.js` for top-level state transitions.");
  lines.push("- Use `transition-task.js` for task status transitions.");
  lines.push("- Use Linear as the task system of record when `LINEAR_API_KEY` is configured.");
  lines.push("- For Linear status disputes, session evaluation, or backlog/in-progress/done checks, run `sync-linear-task.js --audit`; do not hand-roll Linear GraphQL filters in chat.");
  lines.push("- Before implementation, every task must have a Linear issue ID.");
  lines.push("- `implemented` requires scoped changed files and implementation evidence.");
  lines.push("- Dev tasks require test evidence, pushed branch, MR URL, passed MR status comment, passed MR check evidence, and merged MR evidence before `verified`.");
  lines.push("- Do not run raw `gh pr merge`; use `submit-task.js` so MR checks are inspected before merge.");
  lines.push("- `record-test-results.js` records tests and MR status comments only; dev-task MR check/merge evidence must come from `submit-task.js`.");
  lines.push("- After test failure, return to dev. After three dev/test loops, stop and ask the user to intervene.");
  lines.push("- Orchestrator may not edit project files or run dev/test directly during implementation.");
  lines.push("- Task transitions require a matching recorded exact-agent lease from `record-agent-spawn.js --agent <AGENT_NAME>`.");
  lines.push("- Test results require `testing` status and a matching test-agent lease.");
  lines.push("- `submit-task.js` refuses unrelated dirty files instead of staging the whole worktree.");
  lines.push("- `seal-state.js` is trusted manual repair only and must not be used as normal recovery.");
  lines.push("- Do not create a recurring spawn watcher unless a human explicitly asks for unattended background orchestration.");
  lines.push("");
  lines.push("### Agent Dispatch");
  lines.push("");
  lines.push("When `agent_dispatch.spawn_requests[]` contains planned requests:");
  lines.push("");
  lines.push("- Use the available multi-agent spawn tool with the exact request prompt and exact `.opencode/agents/agent-spec-*` agent named by the spawn request.");
  lines.push("- Record the real returned/visible runtime id with `record-agent-spawn.js ... --agent <AGENT_NAME>`.");
  lines.push("- Never invent, synthesize, or reuse subagent/session ids for leases.");
  lines.push("");
  lines.push("Useful commands:");
  lines.push("");
  lines.push("```bash");
  lines.push(`cd ${harnessRel}`);
  lines.push(`node scripts/read-context.js ${stateRelFromHarness} --role orchestrator`);
  lines.push(`node scripts/plan-agent-dispatch.js ${stateRelFromHarness} --enable-auto`);
  lines.push(`node scripts/record-agent-spawn.js ${stateRelFromHarness} <SPAWN_ID> <REAL_OPENCODE_SESSION_ID> --agent <AGENT_NAME>`);
  lines.push("```");
  lines.push("");
  lines.push("### Linear Task Creation");
  lines.push("");
  lines.push("Create task breakdown entries through the harness flow, then sync to Linear:");
  lines.push("");
  lines.push("```bash");
  lines.push(`cd ${harnessRel}`);
  lines.push(`node scripts/record-task-breakdown.js ${stateRelFromHarness} --file ${runRelFromHarness}/task-breakdown.json --dependencies-checked`);
  lines.push(`node scripts/sync-linear-task.js ${stateRelFromHarness} --create`);
  lines.push(`node scripts/sync-linear-task.js ${stateRelFromHarness} --audit`);
  lines.push(`node scripts/validate-state.js ${stateRelFromHarness}`);
  lines.push("```");
  lines.push("");
  lines.push("If task graph state is missing, stop and return to `task_breakdown` before attempting Linear sync.");
  lines.push("");
  lines.push("### Design Assets");
  lines.push("");
  if (designAssets.status || designAssets.path) {
    lines.push(`- Status: ${designAssets.status || "unknown"}`);
    lines.push(`- Harness path: \`${designAssetsRel}\``);
    lines.push(`- Path from this repo: \`${designAssetsFromProject || "."}\``);
    if (designAssets.url) lines.push(`- Source URL: ${designAssets.url}`);
    if (Array.isArray(designAssets.evidence) && designAssets.evidence.length) {
      lines.push(`- Evidence: ${designAssets.evidence.slice(-5).join("; ")}`);
    }
  } else {
    lines.push(`- Expected folder: \`${harnessRel}/runs/${deliveryId}/design-assets/\``);
    lines.push("- If designs are needed, run the official harness Stitch fetcher.");
  }
  lines.push("");
  lines.push("### Approved Write Scope");
  lines.push("");
  const scopeRows = taskScopeRows(tasks);
  if (scopeRows.length) {
    lines.push("| Task | Role | Status | Allowed repos | Allowed paths |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const row of scopeRows) lines.push(row);
  } else {
    lines.push("- No task scopes are recorded yet. Run context recovery and wait for planning.");
  }
  lines.push("");
  lines.push("Before writing project files, verify scope:");
  lines.push("");
  lines.push("```bash");
  lines.push(`cd ${harnessRel}`);
  lines.push(`node scripts/check-write-scope.js ${stateRelFromHarness} <TARGET_PATH> ${role}`);
  lines.push("```");
  lines.push("");
  lines.push("Tests must be recorded by the matching test role after the task enters `testing`.");
  lines.push("Do not add `--merged`, `--merge-commit`, or `--merge-check-evidence` here for dev tasks:");
  lines.push("");
  lines.push("```bash");
  lines.push(`cd ${harnessRel}`);
  lines.push(`node scripts/record-test-results.js ${stateRelFromHarness} --task <TASK_ID> --status passed --role <TEST_ROLE> --command "<COMMAND>" --output "..." --mr-comment-url "<URL>" --mr-comment-evidence "posted passed status"`);
  lines.push(`node scripts/submit-task.js ${stateRelFromHarness} <TASK_ID> --commit-msg "feat: <TASK_ID>: summary" --test-command "<OPTIONAL_RECHECK_COMMAND>"`);
  lines.push("```");
  lines.push("");
  lines.push("### Current Tasks");
  lines.push("");
  if (tasks.length) {
    lines.push("| ID | Role | Status | Linear | Title |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const task of tasks) {
      lines.push(`| ${task.id || ""} | ${task.role || task.lane || ""} | ${task.status || ""} | ${task.linear_id || ""} | ${escapeTable(task.title || "")} |`);
    }
  } else {
    lines.push("- No tasks are recorded yet.");
  }
  lines.push("");
  lines.push("### Durable Knowledge");
  lines.push("");
  const knowledge = recentKnowledge();
  if (knowledge.length) {
    for (const item of knowledge) lines.push(`- ${item}`);
  } else {
    lines.push("- No promoted knowledge cards are recorded yet.");
  }
  lines.push("");
  lines.push("Record durable project learning with:");
  lines.push("");
  lines.push("```bash");
  lines.push(`cd ${harnessRel}`);
  lines.push(`node scripts/record-knowledge.js ${stateRelFromHarness} --kind process_rule --status candidate --statement "..." --rationale "..."`);
  lines.push("```");
  lines.push("");
  lines.push("### Keep This File Fresh");
  lines.push("");
  lines.push("After planning changes, task sync, design fetches, major implementation work,");
  lines.push("or final review updates, regenerate this managed block:");
  lines.push("");
  lines.push("```bash");
  lines.push(`cd ${harnessRel}`);
  lines.push(`node scripts/generate-project-agents.js ${stateRelFromHarness} --project-repo ${slash(path.relative(harnessRoot, projectRepo) || ".")} --role ${role}`);
  lines.push("```");
  lines.push("");
  lines.push(`Generated by agent-spec-ops at ${new Date().toISOString()}.`);
  lines.push("<!-- agent-spec-ops:managed:end -->");
  lines.push("");
  return lines.join("\n");
}

function mergeManagedBlock(existing, managed) {
  const start = "<!-- agent-spec-ops:managed:start -->";
  const end = "<!-- agent-spec-ops:managed:end -->";
  if (!existing.trim()) return managed;
  const startIndex = existing.indexOf(start);
  const endIndex = existing.indexOf(end);
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    const before = existing.slice(0, startIndex).replace(/\s+$/, "");
    const after = existing.slice(endIndex + end.length).replace(/^\s+/, "");
    const managedBody = managed.slice(managed.indexOf(start));
    return [before, managedBody, after].filter(Boolean).join("\n\n").replace(/\n{3,}/g, "\n\n") + "\n";
  }
  return `${existing.replace(/\s+$/, "")}\n\n${managed}\n`;
}

function writeOpenCodeAdapterFiles() {
  const files = openCodeAdapterFiles();
  const written = [];
  for (const [relativeFile, content] of Object.entries(files)) {
    const target = path.join(projectRepo, relativeFile);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    written.push(target);
  }
  return written;
}

function openCodeAdapterFiles() {
  return {
    ".opencode/agents/agent-spec-orchestrator.md": openCodeAgent("orchestrator", {
      title: "Agent Spec Ops Orchestrator",
      description: `Route ${title} delivery work through the compact Agent Spec Ops harness without editing project files.`,
      permission: ["  edit: deny"],
      body: [
        "You are the harness orchestrator. Do not implement code directly.",
        "",
        requiredStart("orchestrator"),
        "",
        "Rules:",
        "",
        "- Do not edit project files.",
        "- Do not run frontend/backend dev or test work yourself.",
        "- Do not start dev servers, background daemons, Cypress, Playwright, or full test suites from the orchestrator.",
        "- If this is a default build/general session, stop and tell the user to invoke `/agent-spec-spawn` or `@agent-spec-orchestrator`.",
        "- For task breakdown, write the task JSON artifact and run `record-task-breakdown.js`; never create temporary state mutation scripts.",
        "- For Linear status disputes or session evaluation, run `sync-linear-task.js --audit` and report its issue-by-issue output.",
        "- Do not hand-roll Linear GraphQL filters in chat; they miss paginated issues, stale ids, project filters, and active tasks.",
        "- If the user requests rework, route back to `task_breakdown`; do not patch code first.",
        "- Use `plan-agent-dispatch.js --enable-auto` to create planned spawn requests.",
        "- Invoke only the exact `.opencode/agents/agent-spec-*` subagent named by each planned request.",
        "- After OpenCode creates a child session, record only the real visible child session id with `record-agent-spawn.js ... --agent <AGENT_NAME>`.",
        "- If OpenCode does not expose a real child session id, stop and report that the spawn cannot be safely leased.",
        "- Never invent synthetic ids or fake leases.",
        "- If a run state integrity check fails, stop and ask for repair instead of continuing.",
        "- Do not run `seal-state.js` as normal recovery.",
        "",
        "## Dispatch Validation",
        "",
        "Before dispatching a subagent, verify:",
        "",
        "1. The task's role matches the agent you are about to spawn. Do not dispatch `frontend_dev` for a task that needs `frontend_test`.",
        "2. The task status is eligible for dispatch (`planned`, `failed`, or `implemented` for test handoff).",
        "3. No other task is currently in-flight (WIP=1 enforcement).",
        "",
        "After a subagent returns \"completed\":",
        "",
        "1. Run `git diff --stat` to confirm files actually changed.",
        "2. If the subagent claimed tests pass, require the actual test command output before accepting.",
        "3. If no files changed and no evidence was recorded, treat as failed and re-dispatch.",
        "4. Never accept \"completed\" with empty output or no harness evidence.",
        "",
        "## E2E Awareness",
        "",
        "When dispatching E2E test tasks (Cypress/Playwright), ensure the subagent:",
        "",
        "1. Runs `check-e2e-preflight.js` before attempting E2E tests.",
        "2. Starts dev server and backend if needed (with health checks).",
        "3. Uses `run-task-command.js` with bounded timeout for test execution.",
        "4. Records actual command output, not claims.",
        "",
        "If a subagent reports E2E tests pass but no preflight or test output exists, treat it as failed."
      ]
    }),
    ".opencode/agents/agent-spec-frontend-dev.md": openCodeAgent("frontend_dev", {
      title: "Agent Spec Ops Frontend Dev",
      description: `Implement assigned ${title} frontend tasks through Agent Spec Ops with scoped file writes only.`,
      permission: ["  edit: allow", "  bash: allow"],
      body: [
        "You implement one assigned frontend task. Do not take unrelated work.",
        "",
        requiredStart("frontend_dev"),
        "",
        beforeWrite("frontend_dev"),
        "",
        "Rules:",
        "",
        "- Only edit paths allowed by the assigned frontend task scope.",
        "- Do not edit backend files.",
        "- Do not edit `workflow-state.json` directly.",
        "- Use `transition-task.js` for task status.",
        "- Do not record test results as frontend_dev; hand off to `agent-spec-frontend-test`.",
        "- If the task has no Linear id or no active frontend_dev lease, stop.",
        "- If a run state integrity check fails, stop and ask for repair instead of continuing.",
        "- Do not run `seal-state.js` as normal recovery.",
        "",
        "## Branch Awareness",
        "",
        "Before writing any files:",
        "",
        "1. Verify you are on the correct feature branch (not `main` or `master`).",
        "2. Check `git status --porcelain` for unrelated dirty files.",
        "3. If unrelated files are dirty, stop and report the conflict instead of proceeding with a contaminated working tree.",
        "",
        "## Test Handoff",
        "",
        "After completing implementation:",
        "",
        "1. Run `git diff --stat` to confirm your changes.",
        "2. Transition the task to `implemented` with `transition-task.js`.",
        "3. The separate `agent-spec-frontend-test` agent will handle testing.",
        "4. Do NOT write tests yourself unless the task definition explicitly includes unit test creation as part of implementation (not verification)."
      ]
    }),
    ".opencode/agents/agent-spec-frontend-test.md": openCodeAgent("frontend_test", {
      title: "Agent Spec Ops Frontend Test",
      description: `Verify assigned ${title} frontend tasks and record MR/test evidence through Agent Spec Ops.`,
      permission: ["  edit: deny"],
      body: [
        "You verify one assigned frontend task. Do not implement fixes.",
        "",
        requiredStart("frontend_test"),
        "",
        "Rules:",
        "",
        "- Run only relevant frontend tests and visual checks required by the task.",
        "- Use bounded, task-scoped commands. Prefer a single spec or explicit test target over a full suite when the task scope allows it.",
        "- For Cypress/Playwright browser E2E in local sessions, use visible/headed mode by default, such as `cypress open`, `cypress run --headed --browser chrome --spec <spec>`, or Playwright headed mode.",
        "- Do not silently switch browser E2E to headless. Headless is allowed only in CI, when the user explicitly asks, or for a final artifact-only check.",
        "- Do not pipe long test runs through `tail` or rerun full suites repeatedly; capture the first failure, screenshots/logs, and stop.",
        "- Record pass/fail evidence with `record-test-results.js --role frontend_test`.",
        "- Add the required passed/failed status comment to the MR when an MR exists.",
        "- Do not use manual merge/check flags with `record-test-results.js` for dev tasks.",
        "- A passed task is not verified until `submit-task.js` creates/comments/checks/merges the MR.",
        "- If tests fail, transition the task to `failed` and return it to frontend_dev.",
        "- If the dev/test loop reaches 3 attempts, stop and ask the user to intervene.",
        "- Do not edit project files except user-approved test artifact updates.",
        "- If a run state integrity check fails, stop and ask for repair instead of continuing.",
        "- Do not run `seal-state.js` as normal recovery.",
        "",
        "## Actually Run Tests",
        "",
        "**Never claim tests pass without running them.** Before recording results:",
        "",
        "1. Execute the actual test command (e.g., `npx jest --verbose`, `npx cypress run`).",
        "2. Capture the full output including pass/fail counts.",
        "3. Verify the output shows explicit results (e.g., \"X tests passed\", \"0 failing\").",
        "4. Pass the output to `record-test-results.js --output \"<actual output>\" --require-output`.",
        "5. If you cannot run the tests (missing server, timeout, etc.), record the blocker and transition to `failed`. Do not fabricate results.",
        "",
        "For E2E tests specifically:",
        "",
        "1. Run `node scripts/check-e2e-preflight.js <state-file>` first.",
        "2. If preflight fails, record the blocker and stop.",
        "3. Start required servers if not running, then run E2E tests.",
        "4. Never claim E2E tests pass without completing the full sequence."
      ]
    }),
    ".opencode/agents/agent-spec-backend-dev.md": openCodeAgent("backend_dev", {
      title: "Agent Spec Ops Backend Dev",
      description: `Implement assigned ${title} backend tasks through Agent Spec Ops with scoped file writes only.`,
      permission: ["  edit: allow", "  bash: allow"],
      body: [
        "You implement one assigned backend task. Do not take unrelated work.",
        "",
        requiredStart("backend_dev"),
        "",
        beforeWrite("backend_dev"),
        "",
        "Rules:",
        "",
        "- Only edit paths allowed by the assigned backend task scope.",
        "- Do not edit frontend files unless the task explicitly includes a contract update.",
        "- Do not edit `workflow-state.json` directly.",
        "- Use `transition-task.js` for task status.",
        "- Do not record test results as backend_dev; hand off to `agent-spec-backend-test`.",
        "- If the task has no Linear id or no active backend_dev lease, stop.",
        "- If a run state integrity check fails, stop and ask for repair instead of continuing.",
        "- Do not run `seal-state.js` as normal recovery.",
        "",
        "## Branch Awareness",
        "",
        "Before writing any files:",
        "",
        "1. Verify you are on the correct feature branch (not `main` or `master`).",
        "2. Check `git status --porcelain` for unrelated dirty files.",
        "3. If unrelated files are dirty, stop and report the conflict instead of proceeding with a contaminated working tree.",
        "",
        "## Test Handoff",
        "",
        "After completing implementation:",
        "",
        "1. Run `git diff --stat` to confirm your changes.",
        "2. Transition the task to `implemented` with `transition-task.js`.",
        "3. The separate `agent-spec-backend-test` agent will handle testing.",
        "4. Do NOT write tests yourself unless the task definition explicitly includes unit test creation as part of implementation (not verification)."
      ]
    }),
    ".opencode/agents/agent-spec-backend-test.md": openCodeAgent("backend_test", {
      title: "Agent Spec Ops Backend Test",
      description: `Verify assigned ${title} backend tasks and record MR/test evidence through Agent Spec Ops.`,
      permission: ["  edit: deny"],
      body: [
        "You verify one assigned backend task. Do not implement fixes.",
        "",
        requiredStart("backend_test"),
        "",
        "Rules:",
        "",
        "- Run only relevant backend tests required by the task.",
        "- Use bounded, task-scoped commands. Prefer a single package/test target over a full suite when the task scope allows it.",
        "- Do not pipe long test runs through `tail` or rerun full suites repeatedly; capture the first failure logs and stop.",
        "- Record pass/fail evidence with `record-test-results.js --role backend_test`.",
        "- Add the required passed/failed status comment to the MR when an MR exists.",
        "- Do not use manual merge/check flags with `record-test-results.js` for dev tasks.",
        "- A passed task is not verified until `submit-task.js` creates/comments/checks/merges the MR.",
        "- If tests fail, transition the task to `failed` and return it to backend_dev.",
        "- If the dev/test loop reaches 3 attempts, stop and ask the user to intervene.",
        "- Do not edit project files except user-approved test artifact updates.",
        "- If a run state integrity check fails, stop and ask for repair instead of continuing.",
        "- Do not run `seal-state.js` as normal recovery.",
        "",
        "## Actually Run Tests",
        "",
        "**Never claim tests pass without running them.** Before recording results:",
        "",
        "1. Execute the actual test command (e.g., `go test ./...`, `cargo test`).",
        "2. Capture the full output including pass/fail counts.",
        "3. Verify the output shows explicit results (e.g., \"PASS\", \"0 failures\").",
        "4. Pass the output to `record-test-results.js --output \"<actual output>\" --require-output`.",
        "5. If you cannot run the tests (missing dependencies, timeout, etc.), record the blocker and transition to `failed`. Do not fabricate results."
      ]
    }),
    ".opencode/agents/agent-spec-pr-reviewer.md": openCodeAgent("frontend_test", {
      title: "Agent Spec Ops MR Status Reviewer",
      description: `Review ${title} task evidence and MR status for the compact Agent Spec Ops harness.`,
      permission: ["  edit: deny"],
      body: [
        "You review a single task or merge request for harness evidence.",
        "",
        requiredStart("<TEST_ROLE>"),
        "",
        "Rules:",
        "",
        "- Do not edit project files as reviewer.",
        "- Do not merge the MR unless this reviewer was explicitly assigned merge ownership by the harness/user and MR checks are passed.",
        "- Do not edit `workflow-state.json` directly.",
        "- Prioritize correctness, regressions, missing tests, scope drift, and definition-of-done gaps.",
        "- Leave a clear MR comment with `passed` or `failed` status when review/test status is known.",
        "- Record evidence with `record-test-results.js --role <TEST_ROLE>`.",
        "- Never claim the task is complete unless the harness command succeeds.",
        "- If a run state integrity check fails, stop and ask for repair instead of continuing."
      ]
    }),
    ".opencode/commands/agent-spec-spawn.md": openCodeSpawnCommand()
  };
}

function openCodeAgent(roleName, options) {
  const permissionLines = options.permission && options.permission.length
    ? ["permission:", ...options.permission]
    : [];
  return [
    "---",
    `description: ${options.description}`,
    "mode: subagent",
    "temperature: 0.1",
    ...permissionLines,
    "---",
    "",
    `# ${options.title}`,
    "",
    "<!-- agent-spec-ops:opencode-managed -->",
    "",
    ...options.body,
    ""
  ].join("\n");
}

function requiredStart(roleName) {
  return [
    "Required start:",
    "",
    "```bash",
    `cd ${harnessRel}`,
    `node scripts/read-context.js ${stateRelFromHarness} --role ${roleName}`,
    `node scripts/read-instructions.js ${stateRelFromHarness} --role ${roleName}`,
    `node scripts/validate-state.js ${stateRelFromHarness}`,
    "```"
  ].join("\n");
}

function beforeWrite(roleName) {
  return [
    "Before each project edit:",
    "",
    "```bash",
    `cd ${harnessRel}`,
    `node scripts/check-write-scope.js ${stateRelFromHarness} <TARGET_PATH> ${roleName}`,
    "```"
  ].join("\n");
}

function openCodeSpawnCommand() {
  return [
    "---",
    "description: Service compact Agent Spec Ops dispatch requests through the OpenCode harness orchestrator.",
    "agent: agent-spec-orchestrator",
    "---",
    "",
    "<!-- agent-spec-ops:opencode-managed -->",
    "",
    "# Agent Spec Ops Dispatch",
    "",
    "Use this command only for the compact harness. It must run through the `agent-spec-orchestrator` OpenCode agent.",
    "If you are in a default `build` or `general` session, stop and ask the user to invoke this command instead of continuing.",
    "",
    "Steps:",
    "",
    "1. Recover and validate context.",
    "2. Run dispatch planning if needed.",
    "3. Inspect `agent_dispatch.spawn_requests[]`.",
    "4. Invoke the matching OpenCode subagent from `.opencode/agents/` with the exact request prompt and exact `agent-spec-*` agent name.",
    "5. Record only the real OpenCode child session id with `record-agent-spawn.js ... --agent <AGENT_NAME>`.",
    "6. If no real child session id is visible, stop and ask the user to intervene.",
    "",
    "Never invent synthetic ids, fake leases, or manual workflow-state updates.",
    "",
    "Useful commands:",
    "",
    "```bash",
    `cd ${harnessRel}`,
    `node scripts/read-context.js ${stateRelFromHarness} --role orchestrator`,
    `node scripts/read-instructions.js ${stateRelFromHarness} --role orchestrator`,
    `node scripts/validate-state.js ${stateRelFromHarness}`,
    `node scripts/sync-linear-task.js ${stateRelFromHarness} --audit`,
    `node scripts/plan-agent-dispatch.js ${stateRelFromHarness} --enable-auto`,
    `node scripts/record-agent-spawn.js ${stateRelFromHarness} <SPAWN_REQUEST_ID> <REAL_OPENCODE_SESSION_ID> --agent <AGENT_NAME>`,
    "```",
    ""
  ].join("\n");
}

function taskScopeRows(items) {
  return items
    .filter((task) => task.scope || task.allowed_repos || task.allowed_paths)
    .map((task) => {
      const scope = task.scope || {};
      const repos = arrayValue(scope.allowed_repos || task.allowed_repos || scope.repos);
      const paths = arrayValue(scope.allowed_paths || task.allowed_paths || scope.paths);
      return `| ${task.id || ""} | ${task.role || task.lane || ""} | ${task.status || ""} | ${repos.join(", ") || "not set"} | ${paths.join(", ") || "not set"} |`;
    });
}

function arrayValue(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function recentKnowledge() {
  const entries = [];
  try {
    for (const { card } of loadKnowledgeCards(runDir).slice(-5)) {
      if (card && card.statement) entries.push(`${card.kind || "knowledge"}: ${card.statement}`);
    }
  } catch {}
  try {
    const events = readNdjson(path.join(runDir, "events.ndjson"))
      .filter((event) => event.type !== "linear_audit");
    for (const event of events.slice(-5)) {
      if (event.summary) entries.push(`event ${event.type}: ${event.summary}`);
    }
  } catch {}
  return entries.slice(-8).map(escapeInline);
}

function escapeTable(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function escapeInline(value) {
  return String(value || "").replace(/\r?\n/g, " ");
}

function slash(value) {
  return String(value || "").replace(/\\/g, "/");
}

function parseArgs(rawArgs) {
  const parsed = {
    stateFile: "",
    projectRepo: "",
    role: "orchestrator",
    force: false
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--") && !parsed.stateFile) {
      parsed.stateFile = arg;
      continue;
    }
    const value = rawArgs[index + 1] || "";
    switch (arg) {
      case "--project-repo":
        parsed.projectRepo = value;
        index += 1;
        break;
      case "--role":
        parsed.role = value;
        index += 1;
        break;
      case "--force":
        parsed.force = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}
