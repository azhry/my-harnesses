#!/usr/bin/env node
"use strict";

const path = require("path");
const {
  appendEvent,
  createKnowledgeCard,
  writeEventMarkdown,
  writeKnowledgeCard
} = require("./lib/memory-store");

const args = parseArgs(process.argv.slice(2));

if (!args.stateFile || !args.summary) {
  console.error([
    "Usage: node scripts/record-event.js runs/<DELIVERY_ID>/workflow-state.json --type TYPE --summary TEXT [options]",
    "",
    "Options:",
    "  --actor NAME",
    "  --role ROLE",
    "  --task TASK_ID",
    "  --target ARTIFACT_OR_FILE",
    "  --details TEXT",
    "  --severity info|warning|error",
    "  --tag TAG          repeatable or comma-separated",
    "  --evidence REF    repeatable",
    "  --knowledge-statement TEXT",
    "  --knowledge-kind KIND",
    "  --knowledge-status observed|candidate|promoted|active",
    "  --component NAME  repeatable or comma-separated",
    "  --repo NAME       repeatable or comma-separated",
    "  --service NAME    repeatable or comma-separated"
  ].join("\n"));
  process.exit(1);
}

const { event, runDir } = appendEvent(args.stateFile, {
  type: args.type,
  actor: args.actor,
  role_context: args.role,
  task_id: args.task,
  target: args.target,
  summary: args.summary,
  details: args.details,
  severity: args.severity,
  tags: args.tags,
  evidence: args.evidence
});

const markdownPath = writeEventMarkdown(runDir, event);
let cardPath = "";

if (args.knowledgeStatement) {
  const card = createKnowledgeCard({
    kind: args.knowledgeKind,
    status: args.knowledgeStatus,
    statement: args.knowledgeStatement,
    rationale: `Derived from event ${event.id}: ${event.summary}`,
    roles: args.role ? [args.role] : [],
    components: args.components,
    repos: args.repos,
    services: args.services,
    tasks: args.task ? [args.task] : [],
    tags: args.tags,
    source_event_ids: [event.id],
    evidence: [event.id, ...args.evidence]
  });
  cardPath = path.relative(runDir, writeKnowledgeCard(runDir, card));
}

console.log(`Recorded event ${event.id}`);
if (markdownPath) {
  console.log(`Wrote ${markdownPath}`);
}
if (cardPath) {
  console.log(`Created knowledge card ${cardPath}`);
}

function parseArgs(rawArgs) {
  const parsed = {
    stateFile: "",
    type: "generic",
    actor: "agent",
    role: "",
    task: "",
    target: "",
    summary: "",
    details: "",
    severity: "info",
    tags: [],
    evidence: [],
    knowledgeStatement: "",
    knowledgeKind: "process_rule",
    knowledgeStatus: "candidate",
    components: [],
    repos: [],
    services: [],
    sets: []
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--") && !parsed.stateFile) {
      parsed.stateFile = arg;
      continue;
    }
    const value = rawArgs[index + 1] || "";
    switch (arg) {
      case "--type":
        parsed.type = value;
        index += 1;
        break;
      case "--actor":
        parsed.actor = value;
        index += 1;
        break;
      case "--role":
        parsed.role = value;
        index += 1;
        break;
      case "--task":
        parsed.task = value;
        index += 1;
        break;
      case "--target":
        parsed.target = value;
        index += 1;
        break;
      case "--summary":
        parsed.summary = value;
        index += 1;
        break;
      case "--details":
        parsed.details = value;
        index += 1;
        break;
      case "--severity":
        parsed.severity = value;
        index += 1;
        break;
      case "--tag":
        parsed.tags.push(...splitList(value));
        index += 1;
        break;
      case "--evidence":
        parsed.evidence.push(value);
        index += 1;
        break;
      case "--knowledge-statement":
        parsed.knowledgeStatement = value;
        index += 1;
        break;
      case "--knowledge-kind":
        parsed.knowledgeKind = value;
        index += 1;
        break;
      case "--knowledge-status":
        parsed.knowledgeStatus = value;
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
      case "--set":
        parsed.sets.push(value);
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
