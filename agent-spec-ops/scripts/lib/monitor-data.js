"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const runsDir = path.join(root, "runs");

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return {
      error: error.message,
      file
    };
  }
}

function readText(file) {
  if (!fs.existsSync(file)) {
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

function readNdjson(file) {
  return readText(file)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return {
          id: "",
          type: "parse_error",
          summary: error.message,
          created_at: ""
        };
      }
    });
}

function parseCsv(text) {
  const rows = [];
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (!lines.length) {
    return rows;
  }
  const headers = parseCsvLine(lines[0]);
  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line);
    rows.push(Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
  }
  return rows;
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
  return parseCsv(readText(file));
}

function runIds() {
  if (!fs.existsSync(runsDir)) {
    return [];
  }
  return fs.readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(runsDir, name, "workflow-state.json")))
    .sort((left, right) => left.localeCompare(right));
}

function loadRun(id) {
  const runDir = path.join(runsDir, id);
  const statePath = path.join(runDir, "workflow-state.json");
  const state = readJson(statePath, {});
  const tasks = readJson(path.join(runDir, "tasks.json"), { tasks: [] });
  const events = readNdjson(path.join(runDir, "events.ndjson"));
  const evals = readCsv(path.join(runDir, "evals.csv"));
  const remarks = readCsv(path.join(runDir, "remarks.csv"));
  const tokenUsage = readCsv(path.join(runDir, "token-usage.csv"));
  return buildRunView(id, state, tasks, events, evals, remarks, tokenUsage);
}

function loadAllRuns() {
  return runIds().map(loadRun).sort((left, right) => {
    const leftDate = Date.parse(left.updated_at || left.created_at || "") || 0;
    const rightDate = Date.parse(right.updated_at || right.created_at || "") || 0;
    return rightDate - leftDate || left.id.localeCompare(right.id);
  });
}

function buildRunView(id, state, localTasks, events, evals, remarks, tokenUsage) {
  const graphTasks = state.task_graph && Array.isArray(state.task_graph.tasks)
    ? state.task_graph.tasks
    : [];
  const localTaskList = localTasks && Array.isArray(localTasks.tasks)
    ? localTasks.tasks
    : [];
  const tasks = mergeTasks(graphTasks, localTaskList);
  const gates = state.gates || {};
  const loops = state.loops || {};
  const contracts = state.contracts && Array.isArray(state.contracts.interfaces)
    ? state.contracts.interfaces
    : [];
  const integration = state.integration || {};
  const dispatch = state.agent_dispatch || {};

  return {
    id,
    title: state.delivery && state.delivery.title ? state.delivery.title : "",
    current_state: state.current_state || "unknown",
    created_at: state.delivery && state.delivery.created_at ? state.delivery.created_at : "",
    updated_at: state.delivery && state.delivery.updated_at ? state.delivery.updated_at : "",
    requested_by: state.delivery && state.delivery.requested_by ? state.delivery.requested_by : "",
    request_summary: state.delivery && state.delivery.request_summary ? state.delivery.request_summary : "",
    state_error: state.error || "",
    artifacts: (state.artifacts || {}),
    tool_readiness: summarizeReadiness(state.tool_readiness),
    roles: state.roles || {},
    gates: summarizeGates(gates),
    loops: summarizeLoops(loops),
    tasks: summarizeTasks(tasks, tokenUsage),
    task_provider: state.memory && state.memory.local_task_provider ? state.memory.local_task_provider : {},
    contracts: summarizeContracts(contracts),
    integration: summarizeIntegration(integration),
    dispatch: summarizeDispatch(dispatch),
    memory: summarizeMemory(state.memory || {}, events, evals, remarks, tokenUsage),
    token_usage: summarizeTokenUsage(tokenUsage),
    human_instructions: state.human_instructions || {},
    test_results: summarizeTestResults(tasks),
    recent_events: events.slice(-20).reverse(),
    recent_evals: evals.slice(-20).reverse(),
    recent_remarks: remarks.slice(-20).reverse(),
    recent_token_usage: tokenUsage.slice(-20).reverse(),
    log: Array.isArray(state.log) ? state.log.slice(-20).reverse() : []
  };
}

function summarizeReadiness(readiness = {}) {
  return {
    status: readiness.status || "unknown",
    checked_at: readiness.checked_at || "",
    product_tracker: readiness.choices && readiness.choices.product_tracker ? readiness.choices.product_tracker : "",
    code_host: readiness.choices && readiness.choices.code_host ? readiness.choices.code_host : "",
    capabilities: Array.isArray(readiness.capabilities) ? readiness.capabilities : [],
    frontend: readiness.frontend || {},
    backend: readiness.backend || {}
  };
}

function summarizeGates(gates) {
  const entries = Object.entries(gates).map(([name, gate]) => ({
    name,
    status: gate && gate.status ? gate.status : "unknown",
    approver: gate && gate.approver ? gate.approver : "",
    decided_at: gate && gate.decided_at ? gate.decided_at : "",
    approval_note: gate && gate.approval_note ? gate.approval_note : "",
    evidence_count: gate && Array.isArray(gate.evidence) ? gate.evidence.length : 0,
    evidence: gate && Array.isArray(gate.evidence) ? gate.evidence : []
  }));
  return {
    entries,
    waiting: entries.filter((gate) => ["ready", "waiting", "requested_changes"].includes(gate.status)).length,
    approved: entries.filter((gate) => gate.status === "approved").length,
    blocked: entries.filter((gate) => gate.status === "blocked").length
  };
}

function summarizeLoops(loops) {
  const entries = Object.entries(loops).map(([name, loop]) => ({
    name,
    status: loop && loop.status ? loop.status : "unknown",
    attempt: loop && Number.isInteger(loop.attempt) ? loop.attempt : 0,
    max_attempts: loop && Number.isInteger(loop.max_attempts) ? loop.max_attempts : 0,
    last_failure: loop && loop.last_failure ? loop.last_failure : "",
    history_count: loop && Array.isArray(loop.history) ? loop.history.length : 0
  }));
  return {
    entries,
    active: entries.filter((loop) => loop.status === "in_progress").length,
    failed: entries.filter((loop) => loop.status === "failed").length,
    blocked: entries.filter((loop) => loop.status === "blocked").length
  };
}

function summarizeTasks(tasks, tokenUsage) {
  const entries = tasks.map((task) => ({
    id: task.id || "",
    title: task.title || "",
    linear_id: task.linear_id || "",
    role: task.role || "",
    lane: task.lane || laneForRole(task.role || ""),
    status: task.status || "unknown",
    description: task.description || "",
    depends_on: Array.isArray(task.depends_on) ? task.depends_on : [],
    knowledge_refs: Array.isArray(task.knowledge_refs) ? task.knowledge_refs : [],
    evidence_count: evidenceCount(task),
    evidence_items: collectEvidence(task),
    git: summarizeGit(task.git_flow || {}),
    token_usage: summarizeTokenUsage(tokenUsage.filter((row) => row.task_id === task.id))
  }));
  return {
    entries,
    total: entries.length,
    active: entries.filter((task) => task.status === "active").length,
    failed: entries.filter((task) => task.status === "failed").length,
    blocked: entries.filter((task) => task.status === "blocked").length,
    verified: entries.filter((task) => task.status === "verified").length,
    by_status: countBy(entries, "status"),
    by_role: countBy(entries, "role"),
    by_lane: countBy(entries, "lane")
  };
}

function mergeTasks(graphTasks, localTaskList) {
  const localById = {};
  for (const task of localTaskList) {
    localById[task.id] = task;
  }
  return graphTasks.map((gt) => {
    const local = localById[gt.id];
    return local ? { ...gt, ...local } : gt;
  });
}

function laneForRole(role) {
  if (role.startsWith("frontend")) return "frontend";
  if (role.startsWith("backend")) return "backend";
  if (role === "product_manager") return "product";
  if (role === "project_manager") return "planning";
  return "handoff";
}

function evidenceCount(task) {
  const implementation = task.implementation && Array.isArray(task.implementation.evidence)
    ? task.implementation.evidence.length
    : 0;
  const test = task.test && Array.isArray(task.test.evidence)
    ? task.test.evidence.length
    : 0;
  const direct = Array.isArray(task.evidence) ? task.evidence.length : 0;
  return implementation + test + direct;
}

function collectEvidence(task) {
  const items = [];
  if (task.implementation && Array.isArray(task.implementation.evidence)) {
    items.push(...task.implementation.evidence.map((e) => ({ type: "implementation", value: e })));
  }
  if (task.test && Array.isArray(task.test.evidence)) {
    items.push(...task.test.evidence.map((e) => ({ type: "test", value: e })));
  }
  if (Array.isArray(task.evidence)) {
    items.push(...task.evidence.map((e) => ({ type: "direct", value: e })));
  }
  return items;
}

function summarizeGit(git) {
  return {
    branch: git.feature_branch || "",
    branch_created: Boolean(git.branch_created),
    tests_passed: Boolean(git.local_tests_passed),
    pushed: Boolean(git.pushed),
    merge_request_status: git.merge_request_status || "",
    merge_request_url: git.merge_request_url || "",
    auto_merge: Boolean(git.auto_merge),
    merge_checks_passed: Boolean(git.merge_checks_passed),
    merged: Boolean(git.merged)
  };
}

function summarizeContracts(contracts) {
  return {
    total: contracts.length,
    failed: contracts.filter((contract) => contract.status === "failed").length,
    blocked: contracts.filter((contract) => contract.status === "blocked").length,
    passed: contracts.filter((contract) => contract.status === "passed").length,
    entries: contracts.map((contract) => ({
      id: contract.id || "",
      kind: contract.kind || "",
      status: contract.status || "unknown",
      producer_task_id: contract.producer_task_id || "",
      consumer_task_id: contract.consumer_task_id || "",
      evidence_count: Array.isArray(contract.evidence) ? contract.evidence.length : 0
    }))
  };
}

function summarizeIntegration(integration) {
  const contractChecks = Array.isArray(integration.contract_checks) ? integration.contract_checks : [];
  const scopeChecks = Array.isArray(integration.scope_checks) ? integration.scope_checks : [];
  return {
    status: integration.status || "not_started",
    contract_checks: summarizeChecks(contractChecks),
    scope_checks: summarizeChecks(scopeChecks),
    evidence_count: Array.isArray(integration.evidence) ? integration.evidence.length : 0,
    blockers: Array.isArray(integration.blockers) ? integration.blockers : []
  };
}

function summarizeChecks(checks) {
  return {
    total: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    failed: checks.filter((check) => check.status === "failed").length,
    blocked: checks.filter((check) => check.status === "blocked").length,
    entries: checks
  };
}

function summarizeDispatch(dispatch) {
  const requests = Array.isArray(dispatch.spawn_requests) ? dispatch.spawn_requests : [];
  const leases = Array.isArray(dispatch.leases) ? dispatch.leases : [];
  return {
    mode: dispatch.mode || "single_agent",
    auto_spawn: Boolean(dispatch.auto_spawn),
    parallel_allowed: Boolean(dispatch.parallel_allowed),
    max_parallel_agents: dispatch.max_parallel_agents || 1,
    status: dispatch.status || "not_started",
    planned_at: dispatch.planned_at || "",
    planned_requests: requests.filter((request) => request.status === "planned").length,
    active_leases: leases.filter((lease) => ["requested", "leased"].includes(lease.status)).length,
    requests,
    leases
  };
}

function summarizeMemory(memory, events, evals, remarks, tokenUsage) {
  return {
    status: memory.status || "not_started",
    event_count: events.length,
    eval_count: evals.length,
    remark_count: remarks.length,
    token_usage_count: tokenUsage.length,
    last_event_id: memory.last_event_id || (events.length ? events[events.length - 1].id : ""),
    last_eval_at: memory.last_eval_at || "",
    last_remark_at: memory.last_remark_at || "",
    last_knowledge_query_at: memory.last_knowledge_query_at || ""
  };
}

function summarizeTestResults(tasks) {
  const entries = tasks.filter((t) => t.test && (t.test.status || t.test.evidence || t.test.cases)).map((task) => {
    const test = task.test || {};
    return {
      task_id: task.id,
      title: task.title || "",
      role: task.role,
      status: test.status || "unknown",
      cases: Array.isArray(test.cases) ? test.cases : [],
      commands: Array.isArray(test.commands) ? test.commands : [],
      evidence: Array.isArray(test.evidence) ? test.evidence : [],
      failures: Array.isArray(test.failures) ? test.failures : [],
      output_file: test.output_file || "",
      last_run_at: test.last_run_at || ""
    };
  });
  return {
    entries,
    total: entries.length,
    passed: entries.filter((e) => e.status === "passed").length,
    failed: entries.filter((e) => e.status === "failed").length
  };
}

function summarizeTokenUsage(rows) {
  const totals = rows.reduce((accumulator, row) => {
    accumulator.input_tokens += numberValue(row.input_tokens);
    accumulator.output_tokens += numberValue(row.output_tokens);
    accumulator.cached_input_tokens += numberValue(row.cached_input_tokens);
    accumulator.reasoning_tokens += numberValue(row.reasoning_tokens);
    accumulator.total_tokens += numberValue(row.total_tokens);
    accumulator.total_cost_usd = roundCost(accumulator.total_cost_usd + numberValue(row.total_cost_usd));
    accumulator.currency = row.currency || accumulator.currency;
    accumulator.last_recorded_at = row.at || accumulator.last_recorded_at;
    return accumulator;
  }, {
    rows: rows.length,
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 0,
    total_cost_usd: 0,
    currency: "USD",
    last_recorded_at: ""
  });
  return {
    ...totals,
    by_scope: countBy(rows, "scope"),
    by_model: countBy(rows, "model"),
    by_cost_basis: countBy(rows, "cost_basis")
  };
}

function countBy(entries, key) {
  return entries.reduce((accumulator, entry) => {
    const value = entry[key] || "unknown";
    accumulator[value] = (accumulator[value] || 0) + 1;
    return accumulator;
  }, {});
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

function loadDashboardData() {
  const runs = loadAllRuns();
  const globalEvals = readCsv(path.join(root, "history", "evals.csv"));
  const globalRemarks = readCsv(path.join(root, "history", "remarks.csv"));
  const knowledgeCount = countKnowledgeCards(path.join(root, "knowledge", "cards"));
  return {
    generated_at: new Date().toISOString(),
    runs,
    summary: summarizeAllRuns(runs, globalEvals, globalRemarks, knowledgeCount)
  };
}

function summarizeAllRuns(runs, globalEvals, globalRemarks, knowledgeCount) {
  const taskTotals = runs.reduce((total, run) => total + run.tasks.total, 0);
  const tokenTotals = runs.reduce((total, run) => {
    const usage = run.token_usage || {};
    total.input_tokens += usage.input_tokens || 0;
    total.output_tokens += usage.output_tokens || 0;
    total.cached_input_tokens += usage.cached_input_tokens || 0;
    total.reasoning_tokens += usage.reasoning_tokens || 0;
    total.total_tokens += usage.total_tokens || 0;
    total.total_cost_usd = roundCost(total.total_cost_usd + (usage.total_cost_usd || 0));
    return total;
  }, { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, reasoning_tokens: 0, total_tokens: 0, total_cost_usd: 0 });
  return {
    total_runs: runs.length,
    active_runs: runs.filter((run) => !["done", "blocked"].includes(run.current_state)).length,
    done_runs: runs.filter((run) => run.current_state === "done").length,
    blocked_runs: runs.filter((run) => run.current_state === "blocked").length,
    failed_tasks: runs.reduce((total, run) => total + run.tasks.failed, 0),
    blocked_tasks: runs.reduce((total, run) => total + run.tasks.blocked, 0),
    verified_tasks: runs.reduce((total, run) => total + run.tasks.verified, 0),
    total_tasks: taskTotals,
    pending_gates: runs.reduce((total, run) => total + run.gates.waiting, 0),
    active_loops: runs.reduce((total, run) => total + run.loops.active, 0),
    failed_loops: runs.reduce((total, run) => total + run.loops.failed, 0),
    memory_events: runs.reduce((total, run) => total + run.memory.event_count, 0),
    eval_rows: globalEvals.length,
    remark_rows: globalRemarks.length,
    token_usage_rows: runs.reduce((total, run) => total + (run.token_usage && run.token_usage.rows ? run.token_usage.rows : 0), 0),
    total_tokens: tokenTotals.total_tokens,
    total_token_cost_usd: tokenTotals.total_cost_usd,
    knowledge_cards: knowledgeCount
  };
}

function countKnowledgeCards(directory) {
  if (!fs.existsSync(directory)) {
    return 0;
  }
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return total + countKnowledgeCards(full);
    }
    return total + (entry.isFile() && entry.name.endsWith(".json") ? 1 : 0);
  }, 0);
}

module.exports = {
  loadDashboardData,
  loadRun,
  parseCsv,
  readCsv,
  readNdjson,
  root,
  runIds
};
