"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");

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

const KNOWLEDGE_STATUSES = ["observed", "candidate", "promoted", "active", "deprecated"];

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function ensureFile(file, contents = "") {
  ensureDir(path.dirname(file));
  if (!fs.existsSync(file)) fs.writeFileSync(file, contents);
}

function loadJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
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

function readNdjson(file) {
  if (!fs.existsSync(file)) return [];
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

function compactTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "item";
}

function makeId(prefix, seed = "") {
  return `${prefix}-${compactTimestamp()}-${slug(seed).slice(0, 32)}`;
}

function defaultMemory() {
  return {
    status: "not_started",
    events_path: "events.ndjson",
    knowledge_dirs: ["knowledge/candidates", "knowledge/promoted"],
    local_task_provider: {
      enabled: false,
      mode: "external",
      reason: "Linear is the required task store.",
      external_provider: "linear",
      sync_status: "blocked",
      last_synced_at: "",
      path: ""
    },
    last_event_id: "",
    event_count: 0,
    last_knowledge_query_at: "",
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
    }
  };
}

function ensureGlobalMemory() {
  for (const kind of KNOWLEDGE_KINDS) {
    ensureDir(path.join(root, "knowledge", "cards", kind));
  }
}

function ensureRunMemory(statePath, state) {
  const resolved = path.resolve(statePath);
  const runDir = path.dirname(resolved);
  const workingState = state || loadState(resolved);
  const memory = mergeMemory(workingState.memory);

  ensureFile(path.join(runDir, memory.events_path), "");
  ensureDir(path.join(runDir, "decisions"));
  ensureDir(path.join(runDir, "changes"));
  ensureDir(path.join(runDir, "disapprovals"));
  for (const directory of memory.knowledge_dirs) ensureDir(path.join(runDir, directory));

  const events = readNdjson(path.join(runDir, memory.events_path));
  memory.event_count = events.length;
  memory.last_event_id = events.length ? events[events.length - 1].id || "" : memory.last_event_id;
  workingState.memory = memory;
  return { state: workingState, memory, runDir };
}

function deliveryIdFromState(state) {
  return state && state.delivery && state.delivery.id ? state.delivery.id : "";
}

function appendEvent(statePath, partialEvent) {
  const resolved = path.resolve(statePath);
  const { state, memory, runDir } = ensureRunMemory(resolved);
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
  state.log.push({ at, state: state.current_state, note: `Memory event recorded: ${event.type} ${event.id}` });
  writeState(resolved, state);
  return { event, state, runDir };
}

function writeEventMarkdown(runDir, event) {
  const directoryByType = {
    human_disapproval: "disapprovals",
    change_request: "changes",
    decision: "decisions"
  };
  const directory = directoryByType[event.type];
  if (!directory) return "";
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
  return ["promoted", "active"].includes(status) ? "promoted" : "candidates";
}

function createKnowledgeCard(options) {
  const at = options.created_at || nowIso();
  const kind = options.kind || "process_rule";
  const status = options.status || "candidate";
  return {
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

function listJsonFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return listJsonFiles(full);
    return entry.isFile() && entry.name.endsWith(".json") ? [full] : [];
  });
}

function loadKnowledgeCards(runDir) {
  const files = [
    ...listJsonFiles(path.join(root, "knowledge", "cards")),
    ...(runDir ? listJsonFiles(path.join(runDir, "knowledge")) : [])
  ];
  return files
    .map((file) => ({ file, card: loadJson(file) }))
    .filter((entry) => entry.card && entry.card.id);
}

module.exports = {
  root,
  KNOWLEDGE_KINDS,
  KNOWLEDGE_STATUSES,
  appendEvent,
  appendNdjson,
  compactTimestamp,
  createKnowledgeCard,
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
  readNdjson,
  slug,
  writeEventMarkdown,
  writeJson,
  writeKnowledgeCard,
  writeState
};
