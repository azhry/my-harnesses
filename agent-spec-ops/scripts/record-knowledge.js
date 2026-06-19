#!/usr/bin/env node
"use strict";

const path = require("path");
const {
  KNOWLEDGE_KINDS,
  KNOWLEDGE_STATUSES,
  appendEvent,
  createKnowledgeCard,
  ensureGlobalMemory,
  ensureRunMemory,
  root,
  writeKnowledgeCard
} = require("./lib/memory-store");

const args = parseArgs(process.argv.slice(2));

if (!args.stateFile || !args.statement) {
  console.error([
    "Usage: node scripts/record-knowledge.js runs/<DELIVERY_ID>/workflow-state.json --kind KIND --statement TEXT [options]",
    "",
    "Options:",
    "  --status observed|candidate|promoted|active|deprecated",
    "  --global",
    "  --rationale TEXT",
    "  --confidence low|medium|high|unknown",
    "  --role ROLE        repeatable or comma-separated",
    "  --component NAME   repeatable or comma-separated",
    "  --repo NAME        repeatable or comma-separated",
    "  --service NAME     repeatable or comma-separated",
    "  --task TASK_ID     repeatable or comma-separated",
    "  --tag TAG          repeatable or comma-separated",
    "  --source-event ID  repeatable",
    "  --evidence REF     repeatable"
  ].join("\n"));
  process.exit(1);
}

if (!KNOWLEDGE_KINDS.includes(args.kind)) {
  console.error(`Unknown knowledge kind: ${args.kind}`);
  process.exit(1);
}

if (!KNOWLEDGE_STATUSES.includes(args.status)) {
  console.error(`Unknown knowledge status: ${args.status}`);
  process.exit(1);
}

const { event } = appendEvent(args.stateFile, {
  type: "knowledge_recorded",
  role_context: "orchestrator",
  summary: `Knowledge recorded: ${args.statement}`,
  details: args.rationale,
  tags: args.tags,
  evidence: args.evidence
});

const { runDir } = ensureRunMemory(args.stateFile);
ensureGlobalMemory();

const card = createKnowledgeCard({
  kind: args.kind,
  status: args.status,
  statement: args.statement,
  rationale: args.rationale,
  roles: args.roles,
  components: args.components,
  repos: args.repos,
  services: args.services,
  tasks: args.tasks,
  tags: args.tags,
  confidence: args.confidence,
  source_event_ids: [...args.sourceEvents, event.id],
  evidence: [...args.evidence, event.id]
});

const baseDir = args.global
  ? path.join(root, "knowledge", "cards", card.kind)
  : runDir;
const cardPath = writeKnowledgeCard(baseDir, card);

console.log(`Recorded knowledge card ${card.id}`);
console.log(`Wrote ${path.relative(args.global ? root : runDir, cardPath)}`);

function parseArgs(rawArgs) {
  const parsed = {
    stateFile: "",
    kind: "process_rule",
    statement: "",
    status: "candidate",
    global: false,
    rationale: "",
    confidence: "medium",
    roles: [],
    components: [],
    repos: [],
    services: [],
    tasks: [],
    tags: [],
    sourceEvents: [],
    evidence: []
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--global") {
      parsed.global = true;
      continue;
    }
    if (!arg.startsWith("--") && !parsed.stateFile) {
      parsed.stateFile = arg;
      continue;
    }
    const value = rawArgs[index + 1] || "";
    switch (arg) {
      case "--kind":
        parsed.kind = value;
        index += 1;
        break;
      case "--statement":
        parsed.statement = value;
        index += 1;
        break;
      case "--status":
        parsed.status = value;
        index += 1;
        break;
      case "--rationale":
        parsed.rationale = value;
        index += 1;
        break;
      case "--confidence":
        parsed.confidence = value;
        index += 1;
        break;
      case "--role":
        parsed.roles.push(...splitList(value));
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
      case "--task":
        parsed.tasks.push(...splitList(value));
        index += 1;
        break;
      case "--tag":
        parsed.tags.push(...splitList(value));
        index += 1;
        break;
      case "--source-event":
        parsed.sourceEvents.push(value);
        index += 1;
        break;
      case "--evidence":
        parsed.evidence.push(value);
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
