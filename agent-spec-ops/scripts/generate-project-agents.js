#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { appendEvent, readNdjson, loadKnowledgeCards } = require("./lib/memory-store");

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
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
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
  lines.push("- Do not treat a user prompt as direct coding work while this run is active.");
  lines.push("- If the user requests rework, stop implementation and route back to `task_breakdown`.");
  lines.push("- Do not keep task, gate, credential, or design knowledge only in chat.");
  lines.push("- Do not edit `workflow-state.json` directly.");
  lines.push("- Do not use generic state-field mutation for status, task, gate, or lease updates.");
  lines.push("- Use `record-event.js` only for evidence, decisions, blockers, and corrections.");
  lines.push("- Use `transition.js` for top-level state transitions.");
  lines.push("- Use `transition-task.js` for task status transitions.");
  lines.push("- Use Linear as the task system of record when `LINEAR_API_KEY` is configured.");
  lines.push("- Before implementation, every task must have a Linear issue ID.");
  lines.push("- Dev tasks require test evidence, pushed branch, MR URL, passed MR status comment, and merged MR evidence before `verified`.");
  lines.push("- After test failure, return to dev. After three dev/test loops, stop and ask the user to intervene.");
  lines.push("- Orchestrator may not edit project files or run dev/test directly during implementation.");
  lines.push("- Task transitions require a matching recorded subagent lease from `record-agent-spawn.js`.");
  lines.push("- Test results require `testing` status and a matching test-agent lease.");
  lines.push("- `submit-task.js` refuses unrelated dirty files instead of staging the whole worktree.");
  lines.push("- Do not create a recurring spawn watcher unless a human explicitly asks for unattended background orchestration.");
  lines.push("");
  lines.push("### Agent Dispatch");
  lines.push("");
  lines.push("When `agent_dispatch.spawn_requests[]` contains planned requests:");
  lines.push("");
  lines.push("- Use the available multi-agent spawn tool with the exact request prompt, then record the real returned/visible runtime id with `record-agent-spawn.js`.");
  lines.push("- Never invent, synthesize, or reuse subagent/session ids for leases.");
  lines.push("");
  lines.push("Useful commands:");
  lines.push("");
  lines.push("```bash");
  lines.push(`cd ${harnessRel}`);
  lines.push(`node scripts/read-context.js ${stateRelFromHarness} --role orchestrator`);
  lines.push(`node scripts/plan-agent-dispatch.js ${stateRelFromHarness} --enable-auto`);
  lines.push(`node scripts/record-agent-spawn.js ${stateRelFromHarness} <SPAWN_ID> <AGENT_ID>`);
  lines.push("```");
  lines.push("");
  lines.push("### Linear Task Creation");
  lines.push("");
  lines.push("Create task breakdown entries through the harness flow, then sync to Linear:");
  lines.push("");
  lines.push("```bash");
  lines.push(`cd ${harnessRel}`);
  lines.push(`node scripts/sync-linear-task.js ${stateRelFromHarness} --create`);
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
  lines.push("Tests must be recorded by the matching test role after the task enters `testing`:");
  lines.push("");
  lines.push("```bash");
  lines.push(`cd ${harnessRel}`);
  lines.push(`node scripts/record-test-results.js ${stateRelFromHarness} --task <TASK_ID> --status passed --role <TEST_ROLE> --command "<COMMAND>" --output "..." --mr-comment-url "<URL>" --mr-comment-evidence "posted passed status" --merged --merge-commit "<SHA>" --merge-evidence "MR merged"`);
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
        "- If the user requests rework, route back to `task_breakdown`; do not patch code first.",
        "- Use `plan-agent-dispatch.js --enable-auto` to create planned spawn requests.",
        "- Invoke only the matching OpenCode subagent for each planned request.",
        "- After OpenCode creates a child session, record only the real visible child session id with `record-agent-spawn.js`.",
        "- If OpenCode does not expose a real child session id, stop and report that the spawn cannot be safely leased.",
        "- Never invent synthetic ids or fake leases."
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
        "- If the task has no Linear id or no active frontend_dev lease, stop."
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
        "- Record pass/fail evidence with `record-test-results.js --role frontend_test`.",
        "- Add the required passed/failed status comment to the MR when an MR exists.",
        "- A passed task is not verified until the task MR is merged and merge evidence is recorded.",
        "- If tests fail, transition the task to `failed` and return it to frontend_dev.",
        "- If the dev/test loop reaches 3 attempts, stop and ask the user to intervene.",
        "- Do not edit project files except user-approved test artifact updates."
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
        "- If the task has no Linear id or no active backend_dev lease, stop."
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
        "- Record pass/fail evidence with `record-test-results.js --role backend_test`.",
        "- Add the required passed/failed status comment to the MR when an MR exists.",
        "- A passed task is not verified until the task MR is merged and merge evidence is recorded.",
        "- If tests fail, transition the task to `failed` and return it to backend_dev.",
        "- If the dev/test loop reaches 3 attempts, stop and ask the user to intervene.",
        "- Do not edit project files except user-approved test artifact updates."
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
        "- Do not merge the MR unless this reviewer was explicitly assigned merge ownership by the harness/user.",
        "- Do not edit `workflow-state.json` directly.",
        "- Prioritize correctness, regressions, missing tests, scope drift, and definition-of-done gaps.",
        "- Leave a clear MR comment with `passed` or `failed` status when review/test status is known.",
        "- Record evidence with `record-test-results.js --role <TEST_ROLE>`.",
        "- Never claim the task is complete unless the harness command succeeds."
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
    "",
    "Steps:",
    "",
    "1. Recover and validate context.",
    "2. Run dispatch planning if needed.",
    "3. Inspect `agent_dispatch.spawn_requests[]`.",
    "4. Invoke the matching OpenCode subagent from `.opencode/agents/` with the exact request prompt.",
    "5. Record only the real OpenCode child session id with `record-agent-spawn.js`.",
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
    `node scripts/plan-agent-dispatch.js ${stateRelFromHarness} --enable-auto`,
    `node scripts/record-agent-spawn.js ${stateRelFromHarness} <SPAWN_REQUEST_ID> <REAL_OPENCODE_SESSION_ID>`,
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
    const events = readNdjson(path.join(runDir, "events.ndjson"));
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
