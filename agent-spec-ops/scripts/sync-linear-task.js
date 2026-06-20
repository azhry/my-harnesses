#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { appendEvent } = require("./lib/memory-store");
const { getLinearConfig } = require("./lib/linear-config");

const args = parseArgs(process.argv.slice(2));

if (!args.stateFile) {
  console.error([
    "Usage: node scripts/sync-linear-task.js runs/<DELIVERY_ID>/workflow-state.json [options]",
    "",
    "Options:",
    "  --task TASK_ID    Sync a specific task (omit to sync all tasks)",
    "  --dry-run         Show what would be synced without making changes",
    "  --create          Create missing Linear issues (default: update only)"
  ].join("\n"));
  process.exit(1);
}

const GRAPHQL_URL = "https://api.linear.app/graphql";

const statePath = path.resolve(args.stateFile);
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const linearCfg = getLinearConfig(state);
const LINEAR_API_KEY = linearCfg.api_key;
const LINEAR_TEAM_ID = linearCfg.team_id;
const LINEAR_PROJECT_ID = linearCfg.project_id;
const deliveryId = state.delivery && state.delivery.id ? state.delivery.id : path.basename(path.dirname(statePath));
const tasks = state.task_graph && Array.isArray(state.task_graph.tasks) ? state.task_graph.tasks : [];
const targetTasks = args.taskId ? tasks.filter((t) => t.id === args.taskId) : tasks;

const allHaveIds = targetTasks.length > 0 && targetTasks.every((t) => t.linear_id);
const anyHaveIds = targetTasks.some((t) => t.linear_id);

if (!LINEAR_API_KEY) {
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

let synced = 0;
let errors = 0;
let stateIdCache = null;

(async () => {
if (LINEAR_TEAM_ID) {
  stateIdCache = await resolveWorkflowStates(LINEAR_TEAM_ID);
}
for (const task of targetTasks) {
  const linearId = task.linear_id || "";
  const title = `[${deliveryId}] ${task.title || task.id}`;
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
    try {
      const result = await graphql(mutation);
      if (result.errors) {
        console.error(`Linear API error for ${task.id}: ${result.errors[0].message}`);
        errors++;
      } else {
        console.log(`Updated Linear issue ${linearId} for ${task.id} -> ${task.status}${stateId ? ` [state: ${targetStatus}]` : ""}`);
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
          fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
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
})();

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
  const parsed = { stateFile: "", taskId: "", dryRun: false, create: false };
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
    }
  }
  return parsed;
}
