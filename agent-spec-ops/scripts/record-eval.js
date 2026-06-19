#!/usr/bin/env node
"use strict";

const {
  appendEvalRows,
  appendEvent
} = require("./lib/memory-store");

const args = parseArgs(process.argv.slice(2));

if (!args.stateFile || !args.metric || !args.finding) {
  console.error([
    "Usage: node scripts/record-eval.js runs/<DELIVERY_ID>/workflow-state.json --metric TEXT --finding TEXT [options]",
    "",
    "Options:",
    "  --loop LOOP_NAME",
    "  --role ROLE",
    "  --task TASK_ID",
    "  --artifact ARTIFACT_ID",
    "  --evaluator NAME",
    "  --score NUMBER",
    "  --max-score NUMBER",
    "  --status passed|warning|failed|blocked|observed",
    "  --recommendation TEXT",
    "  --evidence REF    repeatable"
  ].join("\n"));
  process.exit(1);
}

const row = appendEvalRows(args.stateFile, {
  loop: args.loop,
  role: args.role,
  task_id: args.task,
  artifact_id: args.artifact,
  evaluator: args.evaluator,
  score: args.score,
  max_score: args.maxScore,
  status: args.status,
  metric: args.metric,
  finding: args.finding,
  recommendation: args.recommendation,
  evidence: args.evidence
});

appendEvent(args.stateFile, {
  type: "eval_recorded",
  actor: args.evaluator || "agent",
  role_context: args.role,
  task_id: args.task,
  target: args.artifact,
  summary: `${args.metric}: ${args.status}`,
  details: `${args.finding}${args.recommendation ? ` Recommendation: ${args.recommendation}` : ""}`,
  severity: args.status === "failed" || args.status === "blocked" ? "warning" : "info",
  tags: [args.metric].filter(Boolean),
  evidence: args.evidence
});

console.log(`Recorded eval row for ${row.metric}`);

function parseArgs(rawArgs) {
  const parsed = {
    stateFile: "",
    loop: "",
    role: "",
    task: "",
    artifact: "",
    evaluator: "agent",
    score: "",
    maxScore: "2",
    status: "observed",
    metric: "",
    finding: "",
    recommendation: "",
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
      case "--loop":
        parsed.loop = value;
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
      case "--artifact":
        parsed.artifact = value;
        index += 1;
        break;
      case "--evaluator":
        parsed.evaluator = value;
        index += 1;
        break;
      case "--score":
        parsed.score = value;
        index += 1;
        break;
      case "--max-score":
        parsed.maxScore = value;
        index += 1;
        break;
      case "--status":
        parsed.status = value;
        index += 1;
        break;
      case "--metric":
        parsed.metric = value;
        index += 1;
        break;
      case "--finding":
        parsed.finding = value;
        index += 1;
        break;
      case "--recommendation":
        parsed.recommendation = value;
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
