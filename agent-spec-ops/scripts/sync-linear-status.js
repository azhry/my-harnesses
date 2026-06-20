#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { appendEvent } = require("./lib/memory-store");
const { getLinearConfig } = require("./lib/linear-config");

const args = parseArgs(process.argv.slice(2));

if (!args.stateFile) {
  console.error([
    "Usage: node scripts/sync-linear-status.js runs/<DELIVERY_ID>/workflow-state.json [options]",
    "",
    "Options:",
    "  --dry-run          Show what would be synced without making changes"
  ].join("\n"));
  process.exit(1);
}

const GRAPHQL_URL = "https://api.linear.app/graphql";

const statePath = path.resolve(args.stateFile);
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const linearCfg = getLinearConfig(state);
const LINEAR_API_KEY = linearCfg.api_key;
const LINEAR_TEAM_ID = linearCfg.team_id;

if (!LINEAR_API_KEY) {
  console.log("LINEAR_API_KEY not set — Linear sync skipped");
  process.exit(0);
}
const deliveryId = state.delivery && state.delivery.id ? state.delivery.id : path.basename(path.dirname(statePath));
const tasks = state.task_graph && Array.isArray(state.task_graph.tasks) ? state.task_graph.tasks : [];

const verifiedTasks = tasks.filter((t) => t.status === "verified").length;
const totalDevTasks = tasks.filter((t) => ["frontend_dev", "frontend_test", "backend_dev", "backend_test"].includes(t.role)).length;
const failedTasks = tasks.filter((t) => t.status === "failed").length;
const blockedTasks = tasks.filter((t) => t.status === "blocked").length;

const projectTitle = `Delivery — ${deliveryId}`;
const projectDescription = [
  `# ${state.delivery && state.delivery.title ? state.delivery.title : deliveryId}`,
  ``,
  `**State:** ${state.current_state}`,
  `**Tasks:** ${tasks.length} total, ${verifiedTasks}/${totalDevTasks} dev tasks verified`,
  `**Failed:** ${failedTasks}`,
  `**Blocked:** ${blockedTasks}`,
  `**Updated:** ${state.delivery && state.delivery.updated_at ? state.delivery.updated_at : "n/a"}`,
  `**Summary:** ${state.delivery && state.delivery.request_summary ? state.delivery.request_summary : "—"}`,
  ``,
  `### Task Summary`,
  ``,
  `| ID | Title | Role | Status |`,
  `| --- | --- | --- | --- |`,
  ...tasks.map((t) => `| ${t.id} | ${t.title || "Untitled"} | ${t.role} | ${t.status} |`),
  ``
].join("\n");

let synced = 0;
let errors = 0;

// Search for existing project by title
const searchQuery = {
  query: `{ projects(filter: { name: { eq: "${projectTitle}" } }) { nodes { id name } } }`
};

try {
  const searchResult = awaitQuery(searchQuery);
  const existing = searchResult.data && searchResult.data.projects && searchResult.data.projects.nodes ? searchResult.data.projects.nodes : [];

  if (existing.length) {
    // Update existing project
    const projectId = existing[0].id;
    const mutation = {
      query: `mutation { projectUpdate(id: "${projectId}", input: { name: ${JSON.stringify(projectTitle)}, description: ${JSON.stringify(projectDescription)} }) { success } }`
    };
    if (args.dryRun) {
      console.log(`[DRY RUN] Would update Linear project ${projectId}: ${projectTitle}`);
      synced++;
    } else {
      try {
        const result = awaitQuery(mutation);
        if (result.errors) {
          console.error(`Linear API error updating project: ${result.errors[0].message}`);
          errors++;
        } else {
          console.log(`Updated Linear project ${projectId}`);
          synced++;
        }
      } catch (err) {
        console.error(`Failed to update Linear project: ${err.message}`);
        errors++;
      }
    }
  } else if (LINEAR_TEAM_ID) {
    // Create new project
    const mutation = {
      query: `mutation { projectCreate(input: { teamIds: ["${LINEAR_TEAM_ID}"], name: ${JSON.stringify(projectTitle)}, description: ${JSON.stringify(projectDescription)} }) { success project { id } } }`
    };
    if (args.dryRun) {
      console.log(`[DRY RUN] Would create Linear project: ${projectTitle}`);
      synced++;
    } else {
      try {
        const result = awaitQuery(mutation);
        if (result.errors) {
          console.error(`Linear API error creating project: ${result.errors[0].message}`);
          errors++;
        } else {
          const projectId = result.data && result.data.projectCreate && result.data.projectCreate.project ? result.data.projectCreate.project.id : "";
          console.log(`Created Linear project ${projectId}: ${projectTitle}`);
          synced++;
        }
      } catch (err) {
        console.error(`Failed to create Linear project: ${err.message}`);
        errors++;
      }
    }
  } else {
    console.log("LINEAR_TEAM_ID not set — cannot create Linear project, skipping");
  }
} catch (err) {
  console.error(`Linear API error: ${err.message}`);
  errors++;
}

appendEvent(statePath, {
  type: "linear_sync",
  role_context: "orchestrator",
  task_id: "",
  target: "linear_status",
  summary: `Synced delivery status to Linear${errors ? ` (${errors} errors)` : ""}`,
  details: `${synced} project synced, ${errors} errors`,
  severity: errors ? "warning" : "info",
  tags: ["linear", "status", deliveryId]
});

console.log(`\nDone: ${synced} synced, ${errors} errors`);

function awaitQuery(body) {
  const url = new URL(GRAPHQL_URL);
  return new Promise((resolve, reject) => {
    const http = url.protocol === "https:" ? require("https") : require("http");
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LINEAR_API_KEY}`
      }
    };
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
  const parsed = { stateFile: "", dryRun: false };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--") && !parsed.stateFile) {
      parsed.stateFile = arg;
      continue;
    }
    switch (arg) {
      case "--dry-run": parsed.dryRun = true; break;
    }
  }
  return parsed;
}
