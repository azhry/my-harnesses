#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  appendEvent,
  ensureRunMemory,
  queryKnowledge,
  writeState
} = require("./lib/memory-store");

const args = parseArgs(process.argv.slice(2));

if (!args.stateFile) {
  console.error("Usage: node scripts/query-knowledge.js runs/<DELIVERY_ID>/workflow-state.json [--role ROLE] [--task TASK_ID] [--tag TAG] [--component NAME] [--json]");
  process.exit(1);
}

const { state, runDir } = ensureRunMemory(args.stateFile);
const results = queryKnowledge(runDir, {
  roles: args.roles,
  tasks: args.tasks,
  tags: args.tags,
  components: args.components,
  repos: args.repos,
  services: args.services,
  statuses: args.statuses.length ? args.statuses : undefined
}, args.limit);

const at = new Date().toISOString();
state.memory.last_knowledge_query_at = at;
state.delivery.updated_at = at;
writeState(args.stateFile, state);

appendEvent(args.stateFile, {
  type: "knowledge_queried",
  role_context: args.roles.join(","),
  task_id: args.tasks.join(","),
  summary: `Knowledge query returned ${results.length} card(s)`,
  tags: args.tags,
  evidence: results.map((entry) => entry.card.id)
});

if (args.json) {
  console.log(JSON.stringify(results.map((entry) => entry.card), null, 2));
  process.exit(0);
}

console.log(`# Knowledge Packet`);
console.log("");
console.log(`Delivery: ${state.delivery.id || "(unset)"}`);
console.log(`Role filter: ${args.roles.join(", ") || "any"}`);
console.log(`Task filter: ${args.tasks.join(", ") || "any"}`);
console.log("");

if (!results.length) {
  console.log("No matching knowledge cards found.");
} else {
  console.log("## Reusable Knowledge");
  for (const { card, score, file } of results) {
    console.log("");
    console.log(`- ${card.id} (${card.kind}, ${card.status}, score ${score})`);
    console.log(`  ${card.statement}`);
    if (card.evidence && card.evidence.length) {
      console.log(`  Evidence: ${card.evidence.join("; ")}`);
    }
    console.log(`  Source: ${path.relative(runDir, file)}`);
  }
}

const recent = recentCsvSignals(runDir, state.memory);
if (recent.length) {
  console.log("");
  console.log("## Recent Eval And Remark Signals");
  for (const line of recent) {
    console.log(`- ${line}`);
  }
}

function recentCsvSignals(runDir, memory) {
  const files = [
    path.join(runDir, memory.evals_csv_path),
    path.join(runDir, memory.remarks_csv_path)
  ];
  return files.flatMap((file) => {
    if (!fs.existsSync(file)) {
      return [];
    }
    return fs.readFileSync(file, "utf8")
      .trim()
      .split(/\r?\n/)
      .slice(1)
      .slice(-3)
      .filter(Boolean);
  });
}

function parseArgs(rawArgs) {
  const parsed = {
    stateFile: "",
    roles: [],
    tasks: [],
    tags: [],
    components: [],
    repos: [],
    services: [],
    statuses: [],
    limit: 10,
    json: false
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (!arg.startsWith("--") && !parsed.stateFile) {
      parsed.stateFile = arg;
      continue;
    }
    const value = rawArgs[index + 1] || "";
    switch (arg) {
      case "--role":
        parsed.roles.push(...splitList(value));
        index += 1;
        break;
      case "--task":
        parsed.tasks.push(...splitList(value));
        index += 1;
        break;
      case "--tag":
        parsed.tags.push(...splitList(value));
        index += 1;
        break;
      case "--component":
        parsed.components.push(...splitList(value));
        index += 1;
        break;
      case "--repo":
        parsed.repos.push(...splitList(value));
        index += 1;
        break;
      case "--service":
        parsed.services.push(...splitList(value));
        index += 1;
        break;
      case "--status":
        parsed.statuses.push(...splitList(value));
        index += 1;
        break;
      case "--limit":
        parsed.limit = Number(value) || parsed.limit;
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
