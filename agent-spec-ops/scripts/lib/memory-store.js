"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");

const EVAL_HEADERS = [
  "at",
  "delivery_id",
  "loop",
  "role",
  "task_id",
  "artifact_id",
  "evaluator",
  "score",
  "max_score",
  "status",
  "metric",
  "finding",
  "recommendation",
  "evidence"
];

const REMARK_HEADERS = [
  "at",
  "delivery_id",
  "role",
  "task_id",
  "source",
  "kind",
  "severity",
  "summary",
  "details",
  "tags",
  "evidence"
];

const TOKEN_HEADERS = [
  "at",
  "delivery_id",
  "scope",
  "role",
  "task_id",
  "eval_id",
  "loop",
  "provider",
  "model",
  "input_tokens",
  "output_tokens",
  "cached_input_tokens",
  "reasoning_tokens",
  "total_tokens",
  "input_cost_usd",
  "output_cost_usd",
  "cached_input_cost_usd",
  "reasoning_cost_usd",
  "total_cost_usd",
  "currency",
  "cost_basis",
  "source",
  "evidence",
  "notes"
];

const TASK_STATUSES = [
  "planned",
  "active",
  "implemented",
  "testing",
  "failed",
  "verified",
  "blocked",
  "waived",
  "not_applicable"
];

const KNOWLEDGE_KINDS = [
  "product_rule",
  "design_rule",
  "system_rule",
  "repository_pattern",
  "verification_pattern",
  "process_rule",
  "decision",
  "risk",
  "anti_pattern"
];

const KNOWLEDGE_STATUSES = [
  "observed",
  "candidate",
  "promoted",
  "active",
  "deprecated"
];

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function ensureFile(file, contents = "") {
  ensureDir(path.dirname(file));
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, contents);
  }
}

function loadJson(file, fallback = null) {
  if (!fs.existsSync(file)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function loadState(statePath) {
  return loadJson(path.resolve(statePath));
}

function writeState(statePath, state) {
  writeJson(path.resolve(statePath), state);
}

function runDirFromStatePath(statePath) {
  return path.dirname(path.resolve(statePath));
}

function deliveryIdFromState(state) {
  return state && state.delivery && state.delivery.id ? state.delivery.id : "";
}

function defaultMemory() {
  return {
    status: "not_started",
    events_path: "events.ndjson",
    local_tasks_path: "tasks.json",
    evals_csv_path: "evals.csv",
    remarks_csv_path: "remarks.csv",
    token_usage_csv_path: "token-usage.csv",
    knowledge_dirs: [
      "knowledge/candidates",
      "knowledge/promoted"
    ],
    local_task_provider: {
      enabled: true,
      mode: "local",
      reason: "Local task storage is always available and used when Linear/Jira is unavailable.",
      external_provider: "",
      sync_status: "local_only",
      last_synced_at: "",
      path: "tasks.json"
    },
    last_event_id: "",
    event_count: 0,
    last_eval_at: "",
    last_remark_at: "",
    last_knowledge_query_at: "",
    token_totals: {
      input_tokens: 0,
      output_tokens: 0,
      cached_input_tokens: 0,
      reasoning_tokens: 0,
      total_tokens: 0,
      total_cost_usd: 0,
      currency: "USD",
      last_recorded_at: ""
    },
    evidence: []
  };
}

function mergeMemory(existing) {
  return {
    ...defaultMemory(),
    ...(existing || {}),
    local_task_provider: {
      ...defaultMemory().local_task_provider,
      ...((existing && existing.local_task_provider) || {})
    },
    token_totals: {
      ...defaultMemory().token_totals,
      ...((existing && existing.token_totals) || {})
    }
  };
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join("|") : value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function appendCsv(file, headers, row) {
  ensureDir(path.dirname(file));
  const needsHeader = !fs.existsSync(file) || fs.readFileSync(file, "utf8").trim() === "";
  const values = headers.map((header) => csvEscape(row[header]));
  if (needsHeader) {
    fs.writeFileSync(file, `${headers.join(",")}\n`);
  }
  fs.appendFileSync(file, `${values.join(",")}\n`);
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function readCsv(file) {
  if (!fs.existsSync(file)) {
    return [];
  }
  const lines = fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  if (!lines.length) {
    return [];
  }
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  });
}

function readNdjson(file) {
  if (!fs.existsSync(file)) {
    return [];
  }
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function appendNdjson(file, record) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "item";
}

function compactTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function makeId(prefix, seed = "") {
  return `${prefix}-${compactTimestamp()}-${slug(seed).slice(0, 32)}`;
}

function defaultLocalTasks(deliveryId = "") {
  return {
    provider: {
      mode: "local",
      external_provider: "",
      sync_status: "local_only",
      last_synced_at: "",
      evidence: []
    },
    delivery_id: deliveryId,
    updated_at: "",
    tasks: []
  };
}

function ensureGlobalMemory() {
  ensureDir(path.join(root, "history"));
  for (const kind of KNOWLEDGE_KINDS) {
    ensureDir(path.join(root, "knowledge", "cards", kind));
  }
  ensureFile(path.join(root, "history", "evals.csv"), `${EVAL_HEADERS.join(",")}\n`);
  ensureFile(path.join(root, "history", "remarks.csv"), `${REMARK_HEADERS.join(",")}\n`);
  ensureFile(path.join(root, "history", "token-usage.csv"), `${TOKEN_HEADERS.join(",")}\n`);
}

function ensureRunMemory(statePath, state) {
  const resolvedStatePath = path.resolve(statePath);
  const runDir = runDirFromStatePath(resolvedStatePath);
  const workingState = state || loadState(resolvedStatePath);
  const deliveryId = deliveryIdFromState(workingState);
  const memory = mergeMemory(workingState.memory);

  ensureFile(path.join(runDir, memory.events_path), "");
  ensureFile(path.join(runDir, memory.evals_csv_path), `${EVAL_HEADERS.join(",")}\n`);
  ensureFile(path.join(runDir, memory.remarks_csv_path), `${REMARK_HEADERS.join(",")}\n`);
  ensureFile(path.join(runDir, memory.token_usage_csv_path), `${TOKEN_HEADERS.join(",")}\n`);
  ensureDir(path.join(runDir, "decisions"));
  ensureDir(path.join(runDir, "changes"));
  ensureDir(path.join(runDir, "disapprovals"));
  for (const directory of memory.knowledge_dirs) {
    ensureDir(path.join(runDir, directory));
  }

  const localTasksPath = path.join(runDir, memory.local_tasks_path);
  if (!fs.existsSync(localTasksPath)) {
    writeJson(localTasksPath, defaultLocalTasks(deliveryId));
  }

  const events = readNdjson(path.join(runDir, memory.events_path));
  memory.event_count = events.length;
  memory.last_event_id = events.length ? events[events.length - 1].id || "" : memory.last_event_id;
  memory.token_totals = sumTokenRows(readCsv(path.join(runDir, memory.token_usage_csv_path)));

  workingState.memory = memory;
  return { state: workingState, memory, runDir };
}

function appendEvent(statePath, partialEvent) {
  const resolvedStatePath = path.resolve(statePath);
  const { state, memory, runDir } = ensureRunMemory(resolvedStatePath);
  const at = partialEvent.created_at || partialEvent.at || nowIso();
  const event = {
    id: partialEvent.id || makeId("evt", partialEvent.type || partialEvent.summary || "event"),
    type: partialEvent.type || "generic",
    delivery_id: partialEvent.delivery_id || deliveryIdFromState(state),
    actor: partialEvent.actor || "agent",
    role_context: partialEvent.role_context || "",
    task_id: partialEvent.task_id || "",
    target: partialEvent.target || "",
    summary: partialEvent.summary || "",
    details: partialEvent.details || "",
    severity: partialEvent.severity || "info",
    tags: partialEvent.tags || [],
    evidence: partialEvent.evidence || [],
    created_at: at
  };

  appendNdjson(path.join(runDir, memory.events_path), event);
  memory.last_event_id = event.id;
  memory.event_count += 1;
  state.memory = memory;
  state.delivery.updated_at = at;
  state.log = Array.isArray(state.log) ? state.log : [];
  state.log.push({
    at,
    state: state.current_state,
    note: `Memory event recorded: ${event.type} ${event.id}`
  });
  writeState(resolvedStatePath, state);
  return { event, state, runDir };
}

function writeEventMarkdown(runDir, event) {
  const directoryByType = {
    human_disapproval: "disapprovals",
    change_request: "changes",
    decision: "decisions"
  };
  const directory = directoryByType[event.type];
  if (!directory) {
    return "";
  }
  const file = path.join(runDir, directory, `${event.id}.md`);
  const body = [
    `# ${event.summary || event.type}`,
    "",
    `- Event: ${event.id}`,
    `- Type: ${event.type}`,
    `- Role: ${event.role_context || "n/a"}`,
    `- Task: ${event.task_id || "n/a"}`,
    `- Target: ${event.target || "n/a"}`,
    `- Severity: ${event.severity}`,
    `- Created: ${event.created_at}`,
    "",
    "## Details",
    "",
    event.details || event.summary || "",
    "",
    "## Evidence",
    "",
    ...(event.evidence && event.evidence.length ? event.evidence.map((item) => `- ${item}`) : ["- n/a"]),
    ""
  ].join("\n");
  fs.writeFileSync(file, body);
  return path.relative(runDir, file);
}

function knowledgeDirectoryForStatus(status) {
  if (["promoted", "active"].includes(status)) {
    return "promoted";
  }
  return "candidates";
}

function writeKnowledgeCard(baseDir, card) {
  const statusDirectory = baseDir.endsWith(path.join("knowledge", "cards", card.kind))
    ? ""
    : knowledgeDirectoryForStatus(card.status);
  const directory = statusDirectory ? path.join(baseDir, "knowledge", statusDirectory) : baseDir;
  ensureDir(directory);
  const file = path.join(directory, `${card.id}.json`);
  writeJson(file, card);
  return file;
}

function createKnowledgeCard(options) {
  const at = options.created_at || nowIso();
  const kind = options.kind || "process_rule";
  const status = options.status || "candidate";
  const card = {
    id: options.id || makeId(`k-${slug(kind)}`, options.statement || kind),
    kind,
    status,
    statement: options.statement || "",
    rationale: options.rationale || "",
    applies_to: {
      roles: options.roles || [],
      components: options.components || [],
      repos: options.repos || [],
      services: options.services || [],
      tasks: options.tasks || [],
      tags: options.tags || []
    },
    confidence: options.confidence || "medium",
    source_event_ids: options.source_event_ids || [],
    evidence: options.evidence || [],
    usage_count: 0,
    created_at: at,
    updated_at: at,
    promoted_at: ["promoted", "active"].includes(status) ? at : "",
    deprecated_at: "",
    supersedes: options.supersedes || [],
    superseded_by: ""
  };
  return card;
}

function listJsonFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listJsonFiles(full);
    }
    return entry.isFile() && entry.name.endsWith(".json") ? [full] : [];
  });
}

function loadKnowledgeCards(runDir) {
  const files = [
    ...listJsonFiles(path.join(root, "knowledge", "cards")),
    ...(runDir ? listJsonFiles(path.join(runDir, "knowledge")) : [])
  ];
  return files.map((file) => ({
    file,
    card: loadJson(file)
  })).filter((entry) => entry.card && entry.card.id);
}

function toArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function scoreKnowledgeCard(card, filters) {
  let score = 0;
  const appliesTo = card.applies_to || {};
  const buckets = [
    ["roles", filters.roles],
    ["components", filters.components],
    ["repos", filters.repos],
    ["services", filters.services],
    ["tasks", filters.tasks],
    ["tags", filters.tags]
  ];

  for (const [key, requested] of buckets) {
    const values = toArray(appliesTo[key]);
    const wanted = toArray(requested);
    if (!wanted.length) {
      continue;
    }
    if (values.some((value) => wanted.includes(value))) {
      score += key === "tasks" ? 5 : 2;
    } else if (values.length) {
      score -= 1;
    }
  }

  if (["active", "promoted"].includes(card.status)) {
    score += 2;
  }
  if (card.confidence === "high") {
    score += 1;
  }
  return score;
}

function queryKnowledge(runDir, filters, limit = 10) {
  const allowedStatuses = new Set(filters.statuses || ["active", "promoted", "candidate"]);
  return loadKnowledgeCards(runDir)
    .filter(({ card }) => allowedStatuses.has(card.status) && card.status !== "deprecated")
    .map((entry) => ({
      ...entry,
      score: scoreKnowledgeCard(entry.card, filters)
    }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score || left.card.id.localeCompare(right.card.id))
    .slice(0, limit);
}

function appendEvalRows(statePath, row) {
  const resolvedStatePath = path.resolve(statePath);
  const { state, memory, runDir } = ensureRunMemory(resolvedStatePath);
  const normalized = {
    ...Object.fromEntries(EVAL_HEADERS.map((header) => [header, ""])),
    ...row,
    at: row.at || nowIso(),
    delivery_id: row.delivery_id || deliveryIdFromState(state)
  };
  appendCsv(path.join(runDir, memory.evals_csv_path), EVAL_HEADERS, normalized);
  appendCsv(path.join(root, "history", "evals.csv"), EVAL_HEADERS, normalized);
  state.memory.last_eval_at = normalized.at;
  state.delivery.updated_at = normalized.at;
  state.evaluation = state.evaluation || {};
  state.evaluation.improvement_actions = Array.isArray(state.evaluation.improvement_actions)
    ? state.evaluation.improvement_actions
    : [];
  state.evaluation.improvement_actions.push({
    at: normalized.at,
    state: state.current_state,
    note: `Eval recorded for ${normalized.role || "unknown role"} ${normalized.metric || ""}`.trim()
  });
  writeState(resolvedStatePath, state);
  return normalized;
}

function appendRemarkRows(statePath, row) {
  const resolvedStatePath = path.resolve(statePath);
  const { state, memory, runDir } = ensureRunMemory(resolvedStatePath);
  const normalized = {
    ...Object.fromEntries(REMARK_HEADERS.map((header) => [header, ""])),
    ...row,
    at: row.at || nowIso(),
    delivery_id: row.delivery_id || deliveryIdFromState(state)
  };
  appendCsv(path.join(runDir, memory.remarks_csv_path), REMARK_HEADERS, normalized);
  appendCsv(path.join(root, "history", "remarks.csv"), REMARK_HEADERS, normalized);
  state.memory.last_remark_at = normalized.at;
  state.delivery.updated_at = normalized.at;
  state.log = Array.isArray(state.log) ? state.log : [];
  state.log.push({
    at: normalized.at,
    state: state.current_state,
    note: `Remark recorded: ${normalized.kind || "remark"}`
  });
  writeState(resolvedStatePath, state);
  return normalized;
}

function numberValue(value) {
  if (value === "" || value == null) {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundCost(value) {
  return Math.round(numberValue(value) * 1000000) / 1000000;
}

function sumTokenRows(rows) {
  const totals = {
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 0,
    total_cost_usd: 0,
    currency: "USD",
    last_recorded_at: ""
  };
  for (const row of rows) {
    totals.input_tokens += numberValue(row.input_tokens);
    totals.output_tokens += numberValue(row.output_tokens);
    totals.cached_input_tokens += numberValue(row.cached_input_tokens);
    totals.reasoning_tokens += numberValue(row.reasoning_tokens);
    totals.total_tokens += numberValue(row.total_tokens);
    totals.total_cost_usd = roundCost(totals.total_cost_usd + numberValue(row.total_cost_usd));
    totals.currency = row.currency || totals.currency;
    totals.last_recorded_at = row.at || totals.last_recorded_at;
  }
  return totals;
}

function appendTokenUsageRow(statePath, row) {
  const resolvedStatePath = path.resolve(statePath);
  const { state, memory, runDir } = ensureRunMemory(resolvedStatePath);
  const normalized = {
    ...Object.fromEntries(TOKEN_HEADERS.map((header) => [header, ""])),
    ...row,
    at: row.at || nowIso(),
    delivery_id: row.delivery_id || deliveryIdFromState(state),
    currency: row.currency || "USD",
    cost_basis: row.cost_basis || "actual"
  };

  appendCsv(path.join(runDir, memory.token_usage_csv_path), TOKEN_HEADERS, normalized);
  appendCsv(path.join(root, "history", "token-usage.csv"), TOKEN_HEADERS, normalized);

  state.memory.token_totals = sumTokenRows(readCsv(path.join(runDir, memory.token_usage_csv_path)));
  state.delivery.updated_at = normalized.at;
  state.log = Array.isArray(state.log) ? state.log : [];
  state.log.push({
    at: normalized.at,
    state: state.current_state,
    note: `Token usage recorded: ${normalized.scope || "run"} ${normalized.total_tokens || 0} tokens`
  });
  writeState(resolvedStatePath, state);
  return normalized;
}

module.exports = {
  root,
  EVAL_HEADERS,
  REMARK_HEADERS,
  TOKEN_HEADERS,
  TASK_STATUSES,
  KNOWLEDGE_KINDS,
  KNOWLEDGE_STATUSES,
  appendCsv,
  appendEvalRows,
  appendEvent,
  appendNdjson,
  appendRemarkRows,
  appendTokenUsageRow,
  compactTimestamp,
  createKnowledgeCard,
  defaultLocalTasks,
  defaultMemory,
  ensureDir,
  ensureFile,
  ensureGlobalMemory,
  ensureRunMemory,
  listJsonFiles,
  loadJson,
  loadKnowledgeCards,
  loadState,
  makeId,
  nowIso,
  queryKnowledge,
  readCsv,
  readNdjson,
  roundCost,
  slug,
  toArray,
  writeEventMarkdown,
  writeJson,
  writeKnowledgeCard,
  writeState
};
