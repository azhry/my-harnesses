"use strict";

const fs = require("fs");
const path = require("path");
const { stateIntegrityErrors } = require("./state-store");

const root = path.resolve(__dirname, "../..");
const runsDir = path.join(root, "runs");

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { error: error.message };
  }
}

function readNdjson(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return { type: "parse_error", summary: error.message, created_at: "" };
      }
    });
}

function runIds() {
  if (!fs.existsSync(runsDir)) return [];
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
  const events = readNdjson(path.join(runDir, "events.ndjson"));
  return buildRunView(id, state, events, statePath);
}

function loadDashboardData() {
  const runs = runIds().map(loadRun).sort((left, right) => {
    const leftDate = Date.parse(left.updated_at || left.created_at || "") || 0;
    const rightDate = Date.parse(right.updated_at || right.created_at || "") || 0;
    return rightDate - leftDate || left.id.localeCompare(right.id);
  });
  return {
    generated_at: new Date().toISOString(),
    runs,
    summary: summarizeAllRuns(runs)
  };
}

function buildRunView(id, state, events, statePath) {
  const tasks = state.task_graph && Array.isArray(state.task_graph.tasks) ? state.task_graph.tasks : [];
  const dispatch = state.agent_dispatch || {};
  const integration = state.integration || {};
  return {
    id,
    title: state.delivery && state.delivery.title ? state.delivery.title : "",
    current_state: state.current_state || "unknown",
    created_at: state.delivery && state.delivery.created_at ? state.delivery.created_at : "",
    updated_at: state.delivery && state.delivery.updated_at ? state.delivery.updated_at : "",
    requested_by: state.delivery && state.delivery.requested_by ? state.delivery.requested_by : "",
    request_summary: state.delivery && state.delivery.request_summary ? state.delivery.request_summary : "",
    artifacts: state.artifacts || {},
    tool_readiness: summarizeReadiness(state.tool_readiness || {}),
    roles: state.roles || {},
    gates: summarizeGates(state.gates || {}),
    loops: summarizeLoops(state.loops || {}),
    tasks: summarizeTasks(tasks),
    task_provider: state.memory && state.memory.local_task_provider ? state.memory.local_task_provider : {},
    contracts: { total: 0, passed: 0, failed: 0, blocked: 0, entries: [] },
    integration: summarizeIntegration(integration),
    dispatch: summarizeDispatch(dispatch),
    memory: { event_count: events.length },
    integrity: summarizeIntegritySeal(statePath, state),
    human_instructions: state.human_instructions || {},
    test_results: summarizeTestResults(tasks),
    recent_events: events.slice(-20).reverse(),
    log: Array.isArray(state.log) ? state.log.slice(-20).reverse() : []
  };
}

function summarizeIntegritySeal(statePath, state) {
  const errors = stateIntegrityErrors(statePath, state || {});
  const seal = state && state.harness && state.harness.state_integrity;
  return {
    status: errors.length ? "failed" : seal ? "sealed" : "unsealed",
    sealed_at: seal && seal.sealed_at ? seal.sealed_at : "",
    sealed_by: seal && seal.sealed_by ? seal.sealed_by : "",
    errors
  };
}

function summarizeReadiness(readiness) {
  return {
    status: readiness.status || "unknown",
    checked_at: readiness.checked_at || "",
    product_tracker: readiness.choices && readiness.choices.product_tracker ? readiness.choices.product_tracker : "",
    code_host: readiness.choices && readiness.choices.code_host ? readiness.choices.code_host : "",
    capabilities: Array.isArray(readiness.capabilities) ? readiness.capabilities : []
  };
}

function summarizeGates(gates) {
  const wanted = ["product_review", "system_rules_review", "implementation_review"];
  const entries = wanted.map((name) => {
    const gate = gates[name] || {};
    return {
      name,
      status: gate.status || "not_ready",
      approver: gate.approver || "",
      decided_at: gate.decided_at || "",
      approval_note: gate.approval_note || "",
      evidence_count: Array.isArray(gate.evidence) ? gate.evidence.length : 0,
      evidence: Array.isArray(gate.evidence) ? gate.evidence : []
    };
  });
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

function summarizeTasks(tasks) {
  const entries = tasks.map((task) => ({
    id: task.id || "",
    title: task.title || "",
    linear_id: task.linear_id || "",
    role: task.role || "",
    lane: task.lane || laneForRole(task.role || ""),
    status: task.status || "unknown",
    description: task.description || "",
    depends_on: Array.isArray(task.depends_on) ? task.depends_on : [],
    evidence_count: evidenceCount(task),
    evidence_items: collectEvidence(task),
    git: summarizeGit(task.git_flow || {})
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

function evidenceCount(task) {
  return [
    ...(task.implementation && Array.isArray(task.implementation.evidence) ? task.implementation.evidence : []),
    ...(task.test && Array.isArray(task.test.evidence) ? task.test.evidence : []),
    ...(Array.isArray(task.evidence) ? task.evidence : [])
  ].length;
}

function collectEvidence(task) {
  const items = [];
  if (task.implementation && Array.isArray(task.implementation.evidence)) {
    items.push(...task.implementation.evidence.map((value) => ({ type: "implementation", value })));
  }
  if (task.test && Array.isArray(task.test.evidence)) {
    items.push(...task.test.evidence.map((value) => ({ type: "test", value })));
  }
  if (Array.isArray(task.evidence)) {
    items.push(...task.evidence.map((value) => ({ type: "direct", value })));
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
    merge_request_comment_status: git.merge_request_comment_status || "",
    merge_request_comment_url: git.merge_request_comment_url || "",
    merge_checks_passed: Boolean(git.merge_checks_passed),
    merged: Boolean(git.merged)
  };
}

function summarizeIntegration(integration) {
  return {
    status: integration.status || "not_started",
    contract_checks: summarizeChecks(integration.contract_checks || []),
    scope_checks: summarizeChecks(integration.scope_checks || []),
    acceptance_mapping: summarizeChecks(integration.acceptance_mapping || []),
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
    planned_requests: requests.filter((request) => request.status === "planned").length,
    active_leases: leases.filter((lease) => ["requested", "leased"].includes(lease.status)).length,
    requests,
    leases
  };
}

function summarizeTestResults(tasks) {
  const entries = tasks.filter((task) => task.test).map((task) => {
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
    passed: entries.filter((entry) => entry.status === "passed").length,
    failed: entries.filter((entry) => entry.status === "failed").length
  };
}

function summarizeAllRuns(runs) {
  return {
    total_runs: runs.length,
    active_runs: runs.filter((run) => !["done", "blocked"].includes(run.current_state)).length,
    done_runs: runs.filter((run) => run.current_state === "done").length,
    blocked_runs: runs.filter((run) => run.current_state === "blocked").length,
    failed_tasks: runs.reduce((total, run) => total + run.tasks.failed, 0),
    blocked_tasks: runs.reduce((total, run) => total + run.tasks.blocked, 0),
    verified_tasks: runs.reduce((total, run) => total + run.tasks.verified, 0),
    total_tasks: runs.reduce((total, run) => total + run.tasks.total, 0),
    pending_gates: runs.reduce((total, run) => total + run.gates.waiting, 0),
    unsafe_runs: runs.filter((run) => run.integrity && run.integrity.status === "failed").length,
    active_loops: runs.reduce((total, run) => total + run.loops.active, 0),
    failed_loops: runs.reduce((total, run) => total + run.loops.failed, 0),
    memory_events: runs.reduce((total, run) => total + run.memory.event_count, 0),
    knowledge_cards: countKnowledgeCards(path.join(root, "knowledge", "cards"))
  };
}

function countKnowledgeCards(directory) {
  if (!fs.existsSync(directory)) return 0;
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return total + countKnowledgeCards(full);
    return total + (entry.isFile() && entry.name.endsWith(".json") ? 1 : 0);
  }, 0);
}

function countBy(entries, key) {
  return entries.reduce((accumulator, entry) => {
    const value = entry[key] || "unknown";
    accumulator[value] = (accumulator[value] || 0) + 1;
    return accumulator;
  }, {});
}

function laneForRole(role) {
  if (role.startsWith("frontend")) return "frontend";
  if (role.startsWith("backend")) return "backend";
  if (role === "product_manager") return "product";
  if (role === "project_manager") return "planning";
  return "handoff";
}

module.exports = {
  loadDashboardData,
  loadRun,
  readNdjson,
  root,
  runIds
};
