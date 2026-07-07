#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { appendEvent } = require("./lib/memory-store");
const { getLinearConfig } = require("./lib/linear-config");
const { enforcePolicy, safeLinearMetadata } = require("./lib/policy");
const { loadSecretEnv } = require("./lib/env-loader");
const { loadWorkflowState, writeWorkflowState } = require("./lib/state-store");

const args = parseArgs(process.argv.slice(2));

if (!args.stateFile) {
  console.error([
    "Usage: node scripts/sync-linear-task.js runs/<DELIVERY_ID>/workflow-state.json [options]",
    "",
    "Options:",
    "  --task TASK_ID    Sync a specific task (omit to sync all tasks)",
    "  --dry-run         Show what would be synced without making changes",
    "  --create          Create missing Linear issues (default: update only)",
    "  --audit           Read-only audit of workflow task status vs Linear"
  ].join("\n"));
  process.exit(1);
}

const GRAPHQL_URL = "https://api.linear.app/graphql";

const statePath = path.resolve(args.stateFile);
loadSecretEnv(statePath);
let state;
try {
  state = loadWorkflowState(statePath);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
try {
  enforcePolicy(statePath, { phase: "linear_task_sync" });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const linearCfg = getLinearConfig(statePath);
const LINEAR_API_KEY = linearCfg.api_key;
const LINEAR_TEAM_ID = linearCfg.team_id;
const LINEAR_PROJECT_ID = linearCfg.project_id;
const deliveryId = state.delivery && state.delivery.id ? state.delivery.id : path.basename(path.dirname(statePath));
const tasks = state.task_graph && Array.isArray(state.task_graph.tasks) ? state.task_graph.tasks : [];
const targetTasks = args.taskId ? tasks.filter((t) => t.id === args.taskId) : tasks;

const allHaveIds = targetTasks.length > 0 && targetTasks.every((t) => t.linear_id);
const anyHaveIds = targetTasks.some((t) => t.linear_id);

if (!LINEAR_API_KEY) {
  if (args.audit) {
    console.error("LINEAR_API_KEY not set - cannot audit Linear status");
    process.exit(1);
  }
  if (allHaveIds) {
    console.log(`All ${targetTasks.length} task(s) already have Linear IDs — no sync needed`);
    process.exit(0);
  }
  console.log("LINEAR_API_KEY not set — Linear sync skipped");
  if (anyHaveIds) {
    console.log("Note: some tasks already have Linear IDs linked in state");
  }
  process.exit(0);
}

if (!targetTasks.length) {
  console.log(`No tasks to sync`);
  process.exit(0);
}

if (args.audit) {
  auditLinear().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
} else {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

let synced = 0;
let errors = 0;
let stateIdCache = null;

async function main() {
let teamIdToUse = LINEAR_TEAM_ID;
if (!teamIdToUse && targetTasks.some((t) => t.linear_id)) {
  const firstId = targetTasks.find((t) => t.linear_id).linear_id;
  try {
    const res = await graphql({ query: `query { issue(id: "${firstId}") { team { id } } }` });
    if (res.data && res.data.issue && res.data.issue.team) {
      teamIdToUse = res.data.issue.team.id;
    }
  } catch (e) {
    console.warn(`Failed to resolve team ID from issue ${firstId}: ${e.message}`);
  }
}

if (teamIdToUse) {
  stateIdCache = await resolveWorkflowStates(teamIdToUse);
}

const PREFIX_PATTERNS = [
  /^(?:RUN\s+)?CODE\s*:\s*/i,
  /^TASK\s*:\s*/i,
  /^FEATURE\s*:\s*/i,
  /^STORY\s*:\s*/i,
  /^IMPLEMENT\s*:\s*/i,
  /^FIX\s*:\s*/i,
  /^BUG\s*:\s*/i,
  /^CHORE\s*:\s*/i,
  /^REFACTOR\s*:\s*/i,
  /^DOCS?\s*:\s*/i,
  /^TEST\s*:\s*/i,
  /^UI\s*:\s*/i,
  /^UX\s*:\s*/i
];

function stripTitlePrefix(title) {
  let cleaned = title;
  for (const pattern of PREFIX_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }
  return cleaned.trim();
}

for (const task of targetTasks) {
  const linearId = task.linear_id || "";
  const title = `${task.id}: ${stripTitlePrefix(task.title || task.id)}`;
  const description = [
    `**Delivery:** ${deliveryId}`,
    `**Task:** ${task.id}`,
    `**Role:** ${task.role}`,
    `**Status:** ${task.status}`,
    ``,
    `**Description:** ${task.description || "—"}`,
    ``,
    `### Definition of Done`,
    ...(Array.isArray(task.definition_of_done) && task.definition_of_done.length ? task.definition_of_done.map((d) => `- ${d}`) : ["- Not defined"]),
    ``,
    `### Acceptance Criteria / Verification`,
    ...(Array.isArray(task.verification) && task.verification.length ? task.verification.map((v) => `- ${v}`) : ["- Not defined"]),
    ``,
    `### Expected MR Description`,
    task.expected_mr_description || "Use templates/pull-request-template.md with this task's scope, tests, MR comment, checks, and merge evidence.",
    ``,
    `### Expected Changes`,
    ...(Array.isArray(task.expected_changes) && task.expected_changes.length ? task.expected_changes.map((c) => `- \`${c}\``) : ["- Not specified"]),
    ``,
    `### Scope`,
    ...(task.scope ? [
      `- Paths: ${Array.isArray(task.scope.allowed_paths) && task.scope.allowed_paths.length ? task.scope.allowed_paths.join(", ") : "not restricted"}`,
      `- Repos: ${Array.isArray(task.scope.allowed_repos) && task.scope.allowed_repos.length ? task.scope.allowed_repos.join(", ") : "not restricted"}`,
      `- Services: ${Array.isArray(task.scope.allowed_services) && task.scope.allowed_services.length ? task.scope.allowed_services.join(", ") : "not restricted"}`
    ] : ["- Not defined"]),
    ``,
    `### Dependencies`,
    ...(Array.isArray(task.depends_on) && task.depends_on.length ? task.depends_on.map((d) => `- ${d}`) : ["- None"]),
  ].join("\n");

  if (linearId) {
    // Update existing Linear issue
    const targetStatus = linearStatusFor(task.status);
    const stateId = stateIdCache ? stateIdCache[targetStatus] : "";
    const stateInput = stateId ? `, stateId: "${stateId}"` : "";
    const mutation = {
      query: `mutation { issueUpdate(id: "${linearId}", input: { title: ${JSON.stringify(title)}, description: ${JSON.stringify(description)}${stateInput} }) { success } }`
    };
    if (args.dryRun) {
      console.log(`[DRY RUN] Would update Linear issue ${linearId}: ${task.id} -> ${task.status} (${targetStatus})`);
      synced++;
      continue;
    }
    if (!stateIdCache) {
      console.warn(`Warning: LINEAR_TEAM_ID not provided and could not be resolved. Task ${task.id} status will NOT be updated to ${targetStatus}.`);
    } else if (!stateId) {
      console.warn(`Warning: Could not find a matching Linear state for ${targetStatus}. Task ${task.id} status will NOT be updated.`);
    }
    try {
      const result = await graphql(mutation);
      if (result.errors) {
        console.error(`Linear API error for ${task.id}: ${result.errors[0].message}`);
        errors++;
      } else {
        console.log(`Updated Linear issue ${linearId} for ${task.id} -> ${task.status}${stateId ? ` [state: ${targetStatus}]` : " [STATUS NOT UPDATED]"}`);
        synced++;
      }
    } catch (err) {
      console.error(`Failed to update Linear issue for ${task.id}: ${err.message}`);
      errors++;
    }
  } else if (args.create) {
    if (!LINEAR_TEAM_ID) {
      console.error(`Cannot create Linear issue for ${task.id}: LINEAR_TEAM_ID is not set. Set env var LINEAR_TEAM_ID to the target team ID.`);
      errors++;
      continue;
    }
    if (!LINEAR_PROJECT_ID) {
      console.warn(`Creating Linear issue for ${task.id} without project — set LINEAR_PROJECT_ID to assign to a specific project.`);
    }
    // Create new Linear issue
    const projectInput = LINEAR_PROJECT_ID ? `, projectId: "${LINEAR_PROJECT_ID}"` : "";
    const initialStatus = linearStatusFor(task.status);
    const createStateId = stateIdCache ? stateIdCache[initialStatus] : "";
    const stateInput = createStateId ? `, stateId: "${createStateId}"` : "";
    const mutation = {
      query: `mutation { issueCreate(input: { teamId: "${LINEAR_TEAM_ID}", title: ${JSON.stringify(title)}, description: ${JSON.stringify(description)}${projectInput}${stateInput} }) { success issue { id } } }`
    };
    if (args.dryRun) {
      console.log(`[DRY RUN] Would create Linear issue for ${task.id}`);
      synced++;
      continue;
    }
    try {
      const result = await graphql(mutation);
      if (result.errors) {
        console.error(`Linear API error creating issue for ${task.id}: ${result.errors[0].message}`);
        errors++;
      } else {
        const newId = result.data && result.data.issueCreate && result.data.issueCreate.issue ? result.data.issueCreate.issue.id : "";
        if (newId) {
          task.linear_id = newId;
          state.delivery.updated_at = new Date().toISOString();
          writeWorkflowState(statePath, state, { writer: "sync-linear-task.js" });
          console.log(`Created Linear issue ${newId} for ${task.id}`);
          synced++;
        }
      }
    } catch (err) {
      console.error(`Failed to create Linear issue for ${task.id}: ${err.message}`);
      errors++;
    }
  } else {
    console.log(`SKIP ${task.id}: no linear_id and --create not set`);
  }
}

  if (synced > 0 && errors === 0 && !args.dryRun) {
    state.linear_config = {
      ...safeLinearMetadata(),
      team_id: LINEAR_TEAM_ID || (state.linear_config && state.linear_config.team_id) || "",
      project_id: LINEAR_PROJECT_ID || (state.linear_config && state.linear_config.project_id) || "",
      last_verified_at: new Date().toISOString()
    };
    state.memory = state.memory || {};
    state.memory.local_task_provider = {
      ...(state.memory.local_task_provider || {}),
      enabled: false,
      mode: "external",
      reason: "Linear is required by harness policy and is the task system of record.",
      external_provider: "linear",
      sync_status: "synced",
      last_synced_at: new Date().toISOString(),
      path: state.memory.local_tasks_path || "tasks.json"
    };
    state.delivery.updated_at = new Date().toISOString();
    writeWorkflowState(statePath, state, { writer: "sync-linear-task.js" });
  }

  appendEvent(statePath, {
    type: "linear_sync",
    role_context: "orchestrator",
    task_id: args.taskId || "",
    target: "linear_tasks",
    summary: `Synced ${synced} tasks to Linear${errors ? ` (${errors} errors)` : ""}`,
    details: args.dryRun ? "DRY RUN — no changes made" : `${synced} updated, ${errors} failed`,
    severity: errors ? "warning" : "info",
    tags: ["linear", "sync", deliveryId]
  });

  console.log(`\nDone: ${synced} synced, ${errors} errors`);
  if (errors > 0) {
    process.exit(1);
  }
}

async function auditLinear() {
  const rows = [];
  const counts = {
    ok: 0,
    nonTerminal: 0,
    mismatch: 0,
    missingLinearId: 0,
    notFound: 0,
    errors: 0
  };

  for (const task of targetTasks) {
    const expected = linearStatusFor(task.status);
    const terminal = ["verified", "waived", "not_applicable"].includes(task.status || "");
    const row = {
      task,
      expected,
      issue: null,
      actual: "",
      problem: ""
    };

    if (!terminal) counts.nonTerminal++;

    if (!task.linear_id) {
      row.problem = "NO_LINEAR_ID";
      counts.missingLinearId++;
      rows.push(row);
      continue;
    }

    try {
      row.issue = await fetchIssue(task.linear_id);
    } catch (error) {
      row.problem = `ERROR: ${formatError(error)}`;
      counts.errors++;
      rows.push(row);
      continue;
    }

    if (!row.issue) {
      row.problem = "NOT_FOUND";
      counts.notFound++;
      rows.push(row);
      continue;
    }

    row.actual = linearStatusFromIssue(row.issue);
    if (row.actual !== expected) {
      row.problem = `MISMATCH expected ${expected}, got ${row.actual}`;
      counts.mismatch++;
      rows.push(row);
      continue;
    }

    counts.ok++;
    if (!terminal) rows.push(row);
  }

  console.log(`LINEAR AUDIT ${deliveryId}${args.taskId ? ` ${args.taskId}` : ""}`);
  console.log(`Tasks checked: ${targetTasks.length}`);

  if (rows.length) {
    console.log("");
    console.log("Tasks needing attention:");
    for (const row of rows) {
      console.log(formatAuditRow(row));
    }
  } else {
    console.log("");
    console.log("No non-terminal tasks or Linear mismatches found.");
  }

  console.log("");
  console.log([
    `Summary: ok=${counts.ok}`,
    `non_terminal=${counts.nonTerminal}`,
    `mismatch=${counts.mismatch}`,
    `not_found=${counts.notFound}`,
    `missing_linear_id=${counts.missingLinearId}`,
    `errors=${counts.errors}`
  ].join(" "));

  if (counts.mismatch || counts.notFound || counts.missingLinearId || counts.errors) {
    process.exit(1);
  }
}

async function fetchIssue(issueId) {
  const result = await graphql({
    query: "query($id: String!) { issue(id: $id) { id identifier title state { name type } project { id name } } }",
    variables: { id: issueId }
  });
  if (result.errors) {
    const message = result.errors.map((error) => error.message).join("; ");
    if (/not found/i.test(message)) return null;
    throw new Error(message);
  }
  return result.data && result.data.issue ? result.data.issue : null;
}

function formatAuditRow(row) {
  const task = row.task;
  const issue = row.issue;
  const linear = issue
    ? `${issue.identifier} ${issue.state && issue.state.name ? issue.state.name : "unknown"} (${issue.state && issue.state.type ? issue.state.type : "unknown"})`
    : task.linear_id || "NO_LINEAR_ID";
  const problem = row.problem ? ` :: ${row.problem}` : "";
  return `- ${task.id} ${task.status} -> expected ${row.expected}; Linear ${linear}${problem} :: ${task.title || ""}`;
}

function formatError(error) {
  const parts = [];
  if (error && error.message) parts.push(error.message);
  if (error && error.code) parts.push(error.code);
  if (error && Array.isArray(error.errors)) {
    for (const inner of error.errors) {
      const innerParts = [inner && inner.code, inner && inner.address, inner && inner.port].filter(Boolean);
      if (innerParts.length) parts.push(innerParts.join(" "));
    }
  }
  if (parts.length) return parts.join("; ");
  return error && error.name ? error.name : "unknown error";
}

function linearStatusFor(taskStatus) {
  const statusMap = {
    planned: "backlog",
    active: "inProgress",
    implemented: "inProgress",
    testing: "inReview",
    verified: "done",
    failed: "canceled",
    blocked: "blocked",
    waived: "done",
    not_applicable: "done"
  };
  return statusMap[taskStatus] || "backlog";
}

function linearStatusFromIssue(issue) {
  const state = issue && issue.state ? issue.state : {};
  const name = String(state.name || "").toLowerCase();
  const type = String(state.type || "").toLowerCase();
  if (name === "blocked") return "blocked";
  if (type === "completed") return "done";
  if (type === "started") return "inProgress";
  if (type === "review") return "inReview";
  if (type === "backlog" || type === "unstarted") return "backlog";
  if (type === "canceled") return "canceled";
  return type || name || "unknown";
}

async function resolveWorkflowStates(teamId) {
  const query = {
    query: `query { team(id: "${teamId}") { states { nodes { id name type } } } }`
  };
  try {
    const result = await graphql(query);
    const nodes = result.data && result.data.team && result.data.team.states && result.data.team.states.nodes;
    if (!Array.isArray(nodes)) return null;
    const map = {};
    for (const state of nodes) {
      const type = (state.type || "").toLowerCase();
      const name = (state.name || "").toLowerCase();
      if (type === "backlog") map.backlog = state.id;
      if (type === "unstarted") map.unstarted = state.id;
      if (type === "started") map.started = state.id;
      if (type === "review") map.review = state.id;
      if (type === "completed") map.completed = state.id;
      if (type === "canceled") map.canceled = state.id;
      if (name === "blocked") map.blocked = state.id;
    }
    return {
      backlog: map.backlog || map.unstarted || "",
      inProgress: map.started || map.backlog || "",
      inReview: map.review || map.started || "",
      done: map.completed || "",
      canceled: map.canceled || "",
      blocked: map.blocked || map.backlog || ""
    };
  } catch {
    return null;
  }
}

function graphql(body) {
  const url = new URL(GRAPHQL_URL);
  const options = {
    hostname: url.hostname,
    path: url.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `${LINEAR_API_KEY}`
    }
  };
  return new Promise((resolve, reject) => {
    const http = url.protocol === "https:" ? require("https") : require("http");
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}. Response: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function parseArgs(rawArgs) {
  const parsed = { stateFile: "", taskId: "", dryRun: false, create: false, audit: false };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--") && !parsed.stateFile) {
      parsed.stateFile = arg;
      continue;
    }
    switch (arg) {
      case "--task": parsed.taskId = rawArgs[++index]; break;
      case "--dry-run": parsed.dryRun = true; break;
      case "--create": parsed.create = true; break;
      case "--audit": parsed.audit = true; break;
    }
  }
  return parsed;
}
