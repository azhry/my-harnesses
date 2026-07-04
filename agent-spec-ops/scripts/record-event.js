#!/usr/bin/env node
"use strict";

const path = require("path");
const {
  appendEvent,
  createKnowledgeCard,
  writeEventMarkdown,
  writeKnowledgeCard,
  writeState
} = require("./lib/memory-store");
const { enforcePolicy } = require("./lib/policy");

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
    "  --service NAME    repeatable or comma-separated",
    "  --set PATH=VALUE  repeatable; metadata-only. Operational state must use dedicated harness scripts."
  ].join("\n"));
  process.exit(1);
}

try {
  enforcePolicy(args.stateFile, { phase: "event_record" });
  validateSetExpressions(args.sets);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const { event, state, runDir } = appendEvent(args.stateFile, {
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

if (args.sets.length) {
  for (const setExpression of args.sets) {
    applySet(state, setExpression);
  }
  state.delivery.updated_at = event.created_at;
  state.log = Array.isArray(state.log) ? state.log : [];
  state.log.push({
    at: event.created_at,
    state: state.current_state,
    note: `State fields updated by event ${event.id}: ${args.sets.map((item) => parseSet(item).path).join(", ")}`
  });
  writeState(args.stateFile, state);
}

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
if (args.sets.length) {
  console.log(`Applied ${args.sets.length} state update(s)`);
}

function applySet(state, expression) {
  const parsed = parseSet(expression);
  assertSetAllowed(parsed.path);
  const segments = parsed.path.split(".");
  if (!segments.length || segments.some((segment) => segment.trim() === "")) {
    throw new Error(`Invalid --set path: ${parsed.path}`);
  }

  let cursor = state;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const nextSegment = segments[index + 1];
    const key = keyForSegment(segment);
    if (cursor[key] == null) {
      cursor[key] = isArrayIndex(nextSegment) ? [] : {};
    }
    if (typeof cursor[key] !== "object") {
      throw new Error(`Cannot apply --set ${parsed.path}: ${segments.slice(0, index + 1).join(".")} is not an object`);
    }
    cursor = cursor[key];
  }

  cursor[keyForSegment(segments[segments.length - 1])] = parsed.value;
}

function validateSetExpressions(expressions) {
  for (const expression of expressions) {
    assertSetAllowed(parseSet(expression).path);
  }
}

function assertSetAllowed(pathExpression) {
  const path = String(pathExpression || "").trim();
  const allowedPrefixes = ["metadata.", "annotations.", "notes."];
  if (allowedPrefixes.some((prefix) => path.startsWith(prefix))) return;
  throw new Error([
    `Refusing --set ${path}: record-event.js may not mutate operational workflow state.`,
    "Use transition.js, transition-task.js, record-agent-spawn.js, record-test-results.js, sync-linear-task.js, or another dedicated harness script."
  ].join(" "));
}

function parseSet(expression) {
  const index = String(expression || "").indexOf("=");
  if (index <= 0) {
    throw new Error(`Invalid --set expression: ${expression}. Expected path.to.field=value`);
  }
  const pathExpression = expression.slice(0, index).trim();
  const rawValue = expression.slice(index + 1);
  if (!pathExpression) {
    throw new Error(`Invalid --set expression: ${expression}. Path is empty`);
  }
  return { path: pathExpression, value: parseSetValue(rawValue) };
}

function parseSetValue(value) {
  const text = String(value);
  const trimmed = text.trim();
  if (trimmed === "") return "";
  if (["true", "false", "null"].includes(trimmed)) return JSON.parse(trimmed);
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`Invalid JSON value for --set: ${error.message}`);
    }
  }
  return text;
}

function keyForSegment(segment) {
  return isArrayIndex(segment) ? Number(segment) : segment;
}

function isArrayIndex(segment) {
  return /^(0|[1-9]\d*)$/.test(segment);
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
