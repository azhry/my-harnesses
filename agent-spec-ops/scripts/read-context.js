#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { loadJson, readNdjson, readCsv } = require("./lib/memory-store");
const { safeLinearMetadata } = require("./lib/policy");
const { loadSecretEnv } = require("./lib/env-loader");

const file = process.argv[2];

let roleName = "";
const roleIndex = process.argv.indexOf("--role");
if (roleIndex > -1 && roleIndex + 1 < process.argv.length) {
  roleName = process.argv[roleIndex + 1];
}
const fullInstructions = process.argv.includes("--full-instructions");

if (!file) {
  console.error("Usage: node scripts/read-context.js path/to/workflow-state.json [--role <ROLE>]");
  process.exit(1);
}

const statePath = path.resolve(file);
loadSecretEnv(statePath);
if (!fs.existsSync(statePath)) {
  console.error(`State file not found: ${statePath}`);
  process.exit(1);
}

const state = loadJson(statePath);
if (!state || !state.delivery) {
  console.error("Invalid workflow-state.json");
  process.exit(1);
}

const runDir = path.dirname(statePath);
const deliveryId = state.delivery.id || "unknown";
const title = state.delivery.title || "";
const currentState = state.current_state || "unknown";
const updatedAt = state.delivery.updated_at || "";

const HARNESS_ROOT = path.resolve(__dirname, "..");

const separator = "=".repeat(60);
const subSep = "-".repeat(40);

console.log(`\n${separator}`);
console.log(`  CONTEXT RECOVERY — ${deliveryId}`);
console.log(`  ${title}`);
console.log(`${separator}\n`);

console.log(`Current State:  ${currentState}`);
console.log(`Last Updated:   ${updatedAt}`);

if (state.gates && state.gates.final_review) {
  const fr = state.gates.final_review;
  console.log(`Final Review:   ${fr.status}${fr.approver ? ` by ${fr.approver}` : ""}`);
}

const humanInstructions = state.human_instructions && state.human_instructions.final_review;
if (humanInstructions && humanInstructions.status === "sent") {
  console.log(`Review Sent:    yes (${humanInstructions.questions ? humanInstructions.questions.length : 0} questions)`);
}

console.log(`\n${subSep}`);
console.log("  TOOL READINESS & TOKENS");
console.log(`${subSep}`);

const tr = state.tool_readiness || {};
console.log(`  Status:     ${tr.status || "not_started"}`);
const tracker = (tr.choices && tr.choices.product_tracker) || "";
const codeHost = (tr.choices && tr.choices.code_host) || "";
console.log(`  Tracker:    ${tracker || "none"}`);
console.log(`  Code Host:  ${codeHost || "none"}`);

if (Array.isArray(tr.capabilities)) {
  for (const cap of tr.capabilities) {
    const icon = cap.status === "available" ? "✓" : cap.status === "missing" ? "✗" : "?";
    const provider = cap.provider || "unknown";
    console.log(`  ${icon} ${cap.name}: ${provider} (${cap.status})`);
  }
}

const tokens = state.memory && state.memory.token_totals;
if (tokens) {
  console.log(`  Tokens:     ${(tokens.total_tokens || 0).toLocaleString()} total, $${(tokens.total_cost_usd || 0).toFixed(4)} USD`);
} else {
  console.log(`  Tokens:     none recorded`);
}

console.log(`\n${subSep}`);
console.log("  PROJECT / TEAM CONTEXT");
console.log(`${subSep}`);

console.log(`  Delivery ID:   ${deliveryId}`);
console.log(`  Title:         ${title}`);

const taskProvider = state.memory && state.memory.local_task_provider;
if (taskProvider) {
  console.log(`  Task Provider: ${taskProvider.mode || "local"}${taskProvider.external_provider ? ` (${taskProvider.external_provider})` : ""}`);
  console.log(`  Sync Status:   ${taskProvider.sync_status || "local_only"}`);
  if (taskProvider.last_synced_at) {
    console.log(`  Last Synced:   ${taskProvider.last_synced_at}`);
  }
}

const linearIds = [];
const tasks = (state.task_graph && state.task_graph.tasks) || [];
for (const t of tasks) {
  if (t.linear_id) linearIds.push(`${t.id} → ${t.linear_id}`);
}
if (linearIds.length) {
  console.log(`\n  Linear Issues:`);
  for (const line of linearIds) {
    console.log(`    ${line}`);
  }
} else {
  console.log(`\n  Linear Issues: none mapped`);
}

console.log(`\n${subSep}`);
console.log("  APPROVED REPOS");
console.log(`${subSep}`);

const uniqueRepos = new Set();
for (const t of tasks) {
  if (t.scope && Array.isArray(t.scope.allowed_repos)) {
    for (const repo of t.scope.allowed_repos) {
      uniqueRepos.add(repo);
    }
  }
}
if (uniqueRepos.size > 0) {
  for (const repo of [...uniqueRepos].sort()) {
    console.log(`  ${repo}`);
  }
  console.log(`\n  All task files go to ../${[...uniqueRepos][0]}/ not into harness dirs.`);
} else {
  console.log(`  (none defined in task scopes — check workspace root)`);
}

console.log(`\n${subSep}`);
console.log("  TASKS SUMMARY");
console.log(`${subSep}`);

const byStatus = {};
const byLane = {};
for (const t of tasks) {
  byStatus[t.status] = (byStatus[t.status] || 0) + 1;
  const lane = t.lane || t.role || "unknown";
  byLane[lane] = (byLane[lane] || 0) + 1;
}
console.log(`  Total: ${tasks.length} tasks`);
console.log(`  By Status:`);
for (const [status, count] of Object.entries(byStatus).sort()) {
  console.log(`    ${status}: ${count}`);
}
console.log(`  By Lane:`);
for (const [lane, count] of Object.entries(byLane).sort()) {
  console.log(`    ${lane}: ${count}`);
}

console.log(`\n  Task List:`);
for (const t of tasks) {
  const depMarker = (Array.isArray(t.depends_on) && t.depends_on.length) ? ` [depends: ${t.depends_on.join(", ")}]` : "";
  console.log(`    ${t.status.padEnd(14)} ${t.id.padEnd(10)} ${t.role.padEnd(18)} ${t.title}${depMarker}`);
}

console.log(`\n${subSep}`);
console.log("  GATES");
console.log(`${subSep}`);

const gateOrder = ["tool_readiness_review", "design_stitch", "product_review", "delivery_plan_review", "final_review"];
const gates = state.gates || {};
for (const name of gateOrder) {
  const g = gates[name];
  if (g) {
    const icon = g.status === "approved" ? "✓" : g.status === "waiting" ? "⏳" : g.status === "blocked" ? "✗" : "?";
    console.log(`  ${icon} ${name}: ${g.status}${g.approver ? ` by ${g.approver}` : ""}`);
  }
}

if (state.current_state === "waiting_for_final_review" && humanInstructions) {
  console.log(`\n${subSep}`);
  console.log("  REVIEW INSTRUCTIONS (sent)");
  console.log(`${subSep}`);
  console.log(`  Decision options: ${(humanInstructions.decision_options || []).join(", ")}`);
  if (humanInstructions.questions && humanInstructions.questions.length) {
    console.log(`  Questions:`);
    for (const q of humanInstructions.questions) {
      console.log(`    ? ${q}`);
    }
  }
  console.log(`\n  To approve:   node scripts/transition.js "${file}" done "Approved"`);
  console.log(`  To rework:    node scripts/reopen-delivery.js "${file}" "reason for rework"`);
}

console.log(`\n${subSep}`);
console.log("  RECENT LOG ENTRIES");
console.log(`${subSep}`);

const log = Array.isArray(state.log) ? state.log : [];
const recentLog = log.slice(-8).reverse();
for (const entry of recentLog) {
  console.log(`  ${(entry.at || "").slice(11, 19)} [${entry.state}] ${entry.note}`);
}

const eventsPath = path.join(runDir, "events.ndjson");
if (fs.existsSync(eventsPath)) {
  const events = readNdjson(eventsPath);
  const recentEvents = events.slice(-5).reverse();
  console.log(`\n${subSep}`);
  console.log("  RECENT EVENTS");
  console.log(`${subSep}`);
  for (const evt of recentEvents) {
    console.log(`  ${(evt.created_at || "").slice(11, 19)} ${evt.type.padEnd(25)} ${evt.summary || ""}`);
  }
}

const markerDir = path.basename(path.dirname(runDir)) === "runs"
  ? runDir
  : path.join(HARNESS_ROOT, "runs", deliveryId);
const roleInstructionFiles = roleName
  ? ["AGENTS.md", "docs/state-transitions.md", `docs/role-${roleName}.md`]
  : ["AGENTS.md", "docs/state-transitions.md"];
fs.mkdirSync(markerDir, { recursive: true });
fs.writeFileSync(path.join(markerDir, ".session.json"), JSON.stringify({
  delivery_id: deliveryId,
  started_at: new Date().toISOString(),
  state_updated_at: updatedAt,
  state: currentState,
  role: roleName,
  instruction_files: roleInstructionFiles,
  tasks_total: tasks.length,
  tasks_verified: tasks.filter((t) => t.status === "verified").length,
  tokens: tokens ? tokens.total_tokens : 0,
  cost: tokens ? tokens.total_cost_usd : 0
}, null, 2) + "\n");

console.log(`\n${separator}`);
console.log(`  LINEAR STATUS`);
console.log(`${separator}\n`);

const LINEAR_API_KEY_ENV = process.env.LINEAR_API_KEY || process.env.LINEAR_ACCESS_TOKEN || "";
const LINEAR_TEAM_ID_ENV = process.env.LINEAR_TEAM_ID || "";
const LINEAR_PROJECT_ID_ENV = process.env.LINEAR_PROJECT_ID || "";

// Restore only safe Linear metadata from state. Raw keys must stay in env.
const savedConfig = state.linear_config || {};
const effectiveApiKey = LINEAR_API_KEY_ENV || "";
const effectiveTeamId = LINEAR_TEAM_ID_ENV || savedConfig.team_id || "";
const effectiveProjectId = LINEAR_PROJECT_ID_ENV || savedConfig.project_id || "";

console.log(`  API Key:    ${effectiveApiKey ? `✓ ${effectiveApiKey.slice(0, 12)}... (${LINEAR_API_KEY_ENV ? "env" : "saved in state"})` : "✗ NOT SET"}`);
console.log(`  Team ID:    ${effectiveTeamId ? `${effectiveTeamId} (${LINEAR_TEAM_ID_ENV ? "env" : "saved in state"})` : "✗ NOT SET"}`);
console.log(`  Project ID: ${effectiveProjectId ? `${effectiveProjectId} (${LINEAR_PROJECT_ID_ENV ? "env" : "saved in state"})` : "not set (optional)"}`);

// Persist safe Linear metadata to state so the agent remembers configuration
// shape across sessions without storing raw secrets.
if (effectiveApiKey || effectiveTeamId || effectiveProjectId || savedConfig.api_key) {
  const metadata = safeLinearMetadata();
  state.linear_config = {
    ...metadata,
    api_key_present: Boolean(effectiveApiKey),
    api_key_fingerprint: metadata.api_key_fingerprint || savedConfig.api_key_fingerprint || "",
    team_id: effectiveTeamId,
    project_id: effectiveProjectId,
    last_verified_at: savedConfig.last_verified_at || ""
  };
  state.delivery.updated_at = new Date().toISOString();
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
  console.log(`  Safe Linear metadata saved to state — raw API key was not stored.`);
}

if (!effectiveApiKey) {
  console.log(`\n  To set up Linear, run this in your terminal:`);
  console.log(`    export LINEAR_API_KEY="lin_api_..."`);
  console.log(`    export LINEAR_TEAM_ID="${effectiveTeamId || "<your-team-id>"}"`);
  if (effectiveProjectId) {
    console.log(`    export LINEAR_PROJECT_ID="${effectiveProjectId}"`);
  }
  console.log(`  Or use the connectivity test to find your IDs:`);
  console.log(`    export LINEAR_API_KEY="lin_api_..." && node scripts/check-linear-connectivity.js`);
  console.log(`\n  Linear sync skipped.\n`);
} else {
  // Set env vars for child processes so they use the restored config
  if (!LINEAR_API_KEY_ENV && effectiveApiKey) process.env.LINEAR_API_KEY = effectiveApiKey;
  if (!LINEAR_TEAM_ID_ENV) process.env.LINEAR_TEAM_ID = effectiveTeamId;
  if (!LINEAR_PROJECT_ID_ENV) process.env.LINEAR_PROJECT_ID = effectiveProjectId;

  const syncScripts = [];

  const tasksWithoutLinear = tasks.filter((t) => !t.linear_id);
  if (tasksWithoutLinear.length > 0) {
    syncScripts.push({
      script: "sync-linear-task.js",
      args: [statePath, "--create"],
      label: `Create Linear issues for ${tasksWithoutLinear.length} task(s) without IDs`
    });
  }

  syncScripts.push({
    script: "sync-linear-task.js",
    args: [statePath],
    label: `Sync ${tasks.length} task(s) status to Linear`
  });

  syncScripts.push({
    script: "sync-linear-knowledge.js",
    args: [statePath],
    label: "Sync knowledge cards to Linear documents"
  });

  if (currentState === "waiting_for_final_review" || currentState === "done") {
    syncScripts.push({
      script: "sync-linear-status.js",
      args: [statePath],
      label: "Sync delivery status to Linear project"
    });
  }

  console.log(`\n${separator}`);
  console.log(`  AUTO-SYNCING LINEAR...`);
  console.log(`${separator}\n`);

  for (const { script, args, label } of syncScripts) {
    const scriptPath = path.resolve(__dirname, script);
    if (fs.existsSync(scriptPath)) {
      try {
        console.log(`  → ${label}...`);
        execSync(`node "${scriptPath}" ${args.map(a => `"${a}"`).join(" ")}`, {
          cwd: HARNESS_ROOT,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 30000
        });
        console.log(`  ✓ ${label}`);
      } catch (e) {
        const msg = (e.stdout || e.stderr || e.message || "").trim().slice(0, 200);
        console.log(`  ⚠ ${label} had issues: ${msg}`);
      }
    }
  }
}

if (roleName) {
  const roleFile = path.join(HARNESS_ROOT, "docs", `role-${roleName}.md`);
  if (fs.existsSync(roleFile)) {
    console.log(`\n${separator}`);
    console.log(`  ROLE INSTRUCTIONS: ${roleName.toUpperCase()}`);
    console.log(`${separator}\n`);
    if (fullInstructions) {
      console.log(fs.readFileSync(roleFile, "utf8"));
    } else {
      console.log(`Compact mode enabled. Run this for the just-in-time packet:`);
      console.log(`  node scripts/read-instructions.js ${file} --role ${roleName}`);
      console.log(`Use --full-instructions on read-context.js only when you truly need the full role document.`);
    }
  } else {
    console.log(`\n  ⚠ No specific role instructions found for "${roleName}" at ${roleFile}`);
  }
}

console.log(`\n${separator}`);
console.log(`  Context recovery complete. Read the output above before acting.`);
console.log(`${separator}\n`);
