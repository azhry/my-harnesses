#!/usr/bin/env node
"use strict";

const {
  appendEvent,
  appendTokenUsageRow,
  roundCost
} = require("./lib/memory-store");

const args = parseArgs(process.argv.slice(2));

if (!args.stateFile) {
  console.error([
    "Usage: node scripts/record-token-usage.js runs/<DELIVERY_ID>/workflow-state.json [options]",
    "",
    "Scope options:",
    "  --scope run|task|eval|role|tool",
    "  --role ROLE",
    "  --task TASK_ID",
    "  --eval-id EVAL_ID",
    "  --loop LOOP_NAME",
    "",
    "Usage options:",
    "  --provider PROVIDER",
    "  --model MODEL",
    "  --input-tokens N",
    "  --output-tokens N",
    "  --cached-input-tokens N",
    "  --reasoning-tokens N",
    "  --total-tokens N",
    "",
    "Cost options:",
    "  --input-cost-usd N",
    "  --output-cost-usd N",
    "  --cached-input-cost-usd N",
    "  --reasoning-cost-usd N",
    "  --total-cost-usd N",
    "  --input-rate-per-1m N",
    "  --output-rate-per-1m N",
    "  --cached-input-rate-per-1m N",
    "  --reasoning-rate-per-1m N",
    "  --cost-basis actual|estimated|unknown",
    "",
    "Other:",
    "  --source TEXT",
    "  --notes TEXT",
    "  --evidence REF    repeatable"
  ].join("\n"));
  process.exit(1);
}

if (!["run", "task", "eval", "role", "tool"].includes(args.scope)) {
  console.error("--scope must be one of: run, task, eval, role, tool");
  process.exit(1);
}

if (args.scope === "task" && !args.taskId) {
  console.error("--scope task requires --task TASK_ID");
  process.exit(1);
}

if (args.scope === "eval" && !args.evalId && !args.taskId) {
  console.error("--scope eval requires --eval-id or --task TASK_ID");
  process.exit(1);
}

const inputTokens = numberValue(args.inputTokens);
const outputTokens = numberValue(args.outputTokens);
const cachedInputTokens = numberValue(args.cachedInputTokens);
const reasoningTokens = numberValue(args.reasoningTokens);
const totalTokens = args.totalTokens === ""
  ? inputTokens + outputTokens + reasoningTokens
  : numberValue(args.totalTokens);

const inputCost = costOrRate(args.inputCostUsd, inputTokens, args.inputRatePer1m);
const outputCost = costOrRate(args.outputCostUsd, outputTokens, args.outputRatePer1m);
const cachedInputCost = costOrRate(args.cachedInputCostUsd, cachedInputTokens, args.cachedInputRatePer1m);
const reasoningCost = costOrRate(args.reasoningCostUsd, reasoningTokens, args.reasoningRatePer1m);
const totalCost = args.totalCostUsd === ""
  ? roundCost(inputCost + outputCost + cachedInputCost + reasoningCost)
  : roundCost(args.totalCostUsd);
const costBasis = args.costBasis || inferCostBasis(args);
if (!["actual", "estimated", "unknown"].includes(costBasis)) {
  console.error("--cost-basis must be one of: actual, estimated, unknown");
  process.exit(1);
}

const row = appendTokenUsageRow(args.stateFile, {
  scope: args.scope,
  role: args.role,
  task_id: args.taskId,
  eval_id: args.evalId,
  loop: args.loop,
  provider: args.provider,
  model: args.model,
  input_tokens: inputTokens,
  output_tokens: outputTokens,
  cached_input_tokens: cachedInputTokens,
  reasoning_tokens: reasoningTokens,
  total_tokens: totalTokens,
  input_cost_usd: roundCost(inputCost),
  output_cost_usd: roundCost(outputCost),
  cached_input_cost_usd: roundCost(cachedInputCost),
  reasoning_cost_usd: roundCost(reasoningCost),
  total_cost_usd: totalCost,
  currency: args.currency,
  cost_basis: costBasis,
  source: args.source,
  evidence: args.evidence,
  notes: args.notes
});

appendEvent(args.stateFile, {
  type: "token_usage_recorded",
  actor: "agent",
  role_context: args.role,
  task_id: args.taskId,
  target: args.evalId || args.scope,
  summary: `Token usage recorded for ${args.scope}: ${totalTokens} tokens, ${args.currency} ${totalCost}`,
  details: args.notes,
  severity: "info",
  tags: ["token_usage", args.scope, args.model].filter(Boolean),
  evidence: args.evidence
});

console.log(`Recorded token usage: ${row.scope} ${row.total_tokens} tokens ${row.currency} ${row.total_cost_usd}`);

function parseArgs(rawArgs) {
  const parsed = {
    stateFile: "",
    scope: "run",
    role: "",
    taskId: "",
    evalId: "",
    loop: "",
    provider: "",
    model: "",
    inputTokens: "",
    outputTokens: "",
    cachedInputTokens: "",
    reasoningTokens: "",
    totalTokens: "",
    inputCostUsd: "",
    outputCostUsd: "",
    cachedInputCostUsd: "",
    reasoningCostUsd: "",
    totalCostUsd: "",
    inputRatePer1m: "",
    outputRatePer1m: "",
    cachedInputRatePer1m: "",
    reasoningRatePer1m: "",
    currency: "USD",
    costBasis: "",
    source: "",
    notes: "",
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
      case "--scope":
        parsed.scope = value;
        index += 1;
        break;
      case "--role":
        parsed.role = value;
        index += 1;
        break;
      case "--task":
        parsed.taskId = value;
        index += 1;
        break;
      case "--eval-id":
        parsed.evalId = value;
        index += 1;
        break;
      case "--loop":
        parsed.loop = value;
        index += 1;
        break;
      case "--provider":
        parsed.provider = value;
        index += 1;
        break;
      case "--model":
        parsed.model = value;
        index += 1;
        break;
      case "--input-tokens":
        parsed.inputTokens = value;
        index += 1;
        break;
      case "--output-tokens":
        parsed.outputTokens = value;
        index += 1;
        break;
      case "--cached-input-tokens":
        parsed.cachedInputTokens = value;
        index += 1;
        break;
      case "--reasoning-tokens":
        parsed.reasoningTokens = value;
        index += 1;
        break;
      case "--total-tokens":
        parsed.totalTokens = value;
        index += 1;
        break;
      case "--input-cost-usd":
        parsed.inputCostUsd = value;
        index += 1;
        break;
      case "--output-cost-usd":
        parsed.outputCostUsd = value;
        index += 1;
        break;
      case "--cached-input-cost-usd":
        parsed.cachedInputCostUsd = value;
        index += 1;
        break;
      case "--reasoning-cost-usd":
        parsed.reasoningCostUsd = value;
        index += 1;
        break;
      case "--total-cost-usd":
        parsed.totalCostUsd = value;
        index += 1;
        break;
      case "--input-rate-per-1m":
        parsed.inputRatePer1m = value;
        index += 1;
        break;
      case "--output-rate-per-1m":
        parsed.outputRatePer1m = value;
        index += 1;
        break;
      case "--cached-input-rate-per-1m":
        parsed.cachedInputRatePer1m = value;
        index += 1;
        break;
      case "--reasoning-rate-per-1m":
        parsed.reasoningRatePer1m = value;
        index += 1;
        break;
      case "--currency":
        parsed.currency = value;
        index += 1;
        break;
      case "--cost-basis":
        parsed.costBasis = value;
        index += 1;
        break;
      case "--source":
        parsed.source = value;
        index += 1;
        break;
      case "--notes":
        parsed.notes = value;
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

function numberValue(value) {
  if (value === "" || value == null) {
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Expected non-negative number, got: ${value}`);
  }
  return parsed;
}

function costOrRate(explicitCost, tokens, ratePer1m) {
  if (explicitCost !== "") {
    return numberValue(explicitCost);
  }
  if (ratePer1m === "") {
    return 0;
  }
  return (tokens / 1000000) * numberValue(ratePer1m);
}

function inferCostBasis(parsed) {
  const explicitCosts = [
    parsed.inputCostUsd,
    parsed.outputCostUsd,
    parsed.cachedInputCostUsd,
    parsed.reasoningCostUsd,
    parsed.totalCostUsd
  ];
  if (explicitCosts.some((value) => value !== "")) {
    return "actual";
  }
  const rates = [
    parsed.inputRatePer1m,
    parsed.outputRatePer1m,
    parsed.cachedInputRatePer1m,
    parsed.reasoningRatePer1m
  ];
  if (rates.some((value) => value !== "")) {
    return "estimated";
  }
  return "unknown";
}
