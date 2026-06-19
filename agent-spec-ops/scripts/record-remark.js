#!/usr/bin/env node
"use strict";

const {
  appendEvent,
  appendRemarkRows
} = require("./lib/memory-store");

const args = parseArgs(process.argv.slice(2));

if (!args.stateFile || !args.summary) {
  console.error([
    "Usage: node scripts/record-remark.js runs/<DELIVERY_ID>/workflow-state.json --summary TEXT [options]",
    "",
    "Options:",
    "  --role ROLE",
    "  --task TASK_ID",
    "  --source human|agent|test|tool",
    "  --kind disapproval|change|pattern|work_done|risk|note",
    "  --severity info|warning|error",
    "  --details TEXT",
    "  --tag TAG       repeatable or comma-separated",
    "  --evidence REF repeatable"
  ].join("\n"));
  process.exit(1);
}

const row = appendRemarkRows(args.stateFile, {
  role: args.role,
  task_id: args.task,
  source: args.source,
  kind: args.kind,
  severity: args.severity,
  summary: args.summary,
  details: args.details,
  tags: args.tags,
  evidence: args.evidence
});

appendEvent(args.stateFile, {
  type: "remark_recorded",
  actor: args.source || "agent",
  role_context: args.role,
  task_id: args.task,
  summary: args.summary,
  details: args.details,
  severity: args.severity,
  tags: args.tags,
  evidence: args.evidence
});

console.log(`Recorded remark row: ${row.summary}`);

function parseArgs(rawArgs) {
  const parsed = {
    stateFile: "",
    role: "",
    task: "",
    source: "agent",
    kind: "note",
    severity: "info",
    summary: "",
    details: "",
    tags: [],
    evidence: []
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--") && !parsed.stateFile) {
      parsed.stateFile = arg;
      continue;
    }
    const value = rawArgs[index + 1] || "";
    switch (arg) {
      case "--role":
        parsed.role = value;
        index += 1;
        break;
      case "--task":
        parsed.task = value;
        index += 1;
        break;
      case "--source":
        parsed.source = value;
        index += 1;
        break;
      case "--kind":
        parsed.kind = value;
        index += 1;
        break;
      case "--severity":
        parsed.severity = value;
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
      case "--tag":
        parsed.tags.push(...splitList(value));
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
