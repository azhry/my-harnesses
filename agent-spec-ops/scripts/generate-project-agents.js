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

appendEvent(statePath, {
  type: "artifact_generated",
  actor: "agent",
  role_context: "orchestrator",
  target: slash(path.relative(harnessRoot, agentsPath)),
  summary: `Generated project AGENTS.md for ${deliveryId}`,
  details: `Updated managed agent-spec-ops context block in ${agentsPath}`,
  severity: "info",
  tags: ["artifact", "project-agents", deliveryId],
  evidence: [slash(path.relative(harnessRoot, agentsPath))]
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
  lines.push("```");
  lines.push("");
  lines.push("If a transition script reports stale context, rerun the two commands above.");
  lines.push("");
  lines.push("### Non-Negotiable Workflow");
  lines.push("");
  lines.push("- Do not keep task, gate, credential, or design knowledge only in chat.");
  lines.push("- Do not edit `workflow-state.json` directly.");
  lines.push("- Use `record-event.js --set` for state field updates.");
  lines.push("- Use `transition.js` for top-level state transitions.");
  lines.push("- Use `transition-task.js` for task status transitions.");
  lines.push("- Use Linear as the task system of record when `LINEAR_API_KEY` is configured.");
  lines.push("- Before delivery-plan review, every task must have a Linear issue ID.");
  lines.push("- Do not create local `task-breakdown.md` when Linear is available.");
  lines.push("");
  lines.push("### Linear Task Creation");
  lines.push("");
  lines.push("Create or update `task_graph.tasks[]` in state, then sync to Linear:");
  lines.push("");
  lines.push("```bash");
  lines.push(`cd ${harnessRel}`);
  lines.push(`node scripts/sync-linear-task.js ${stateRelFromHarness} --create`);
  lines.push(`node scripts/validate-state.js ${stateRelFromHarness}`);
  lines.push("```");
  lines.push("");
  lines.push("If task graph state is missing, stop and create it through the harness state");
  lines.push("mutation path before attempting Linear sync.");
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
    lines.push(`- Query knowledge from the harness: \`cd ${harnessRel} && node scripts/query-knowledge.js ${stateRelFromHarness}\``);
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
