#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { expectedAgentName, validateSpawnIdentity } = require("./lib/agent-identity");
const { loadWorkflowState, writeWorkflowState } = require("./lib/state-store");

const ROLE_AGENT_MAP = {
  "frontend_test": "agent-spec-frontend-test",
  "backend_test": "agent-spec-backend-test",
  "frontend_dev": "agent-spec-frontend-dev",
  "backend_dev": "agent-spec-backend-dev",
  "orchestrator": "agent-spec-orchestrator"
};

function resolveAgentName(input) {
  if (!input) return "";
  if (ROLE_AGENT_MAP[input]) return ROLE_AGENT_MAP[input];
  return input;
}

function resolveRole(input) {
  if (!input) return "";
  const entry = Object.entries(ROLE_AGENT_MAP).find(([, v]) => v === input);
  return entry ? entry[0] : input;
}

const args = parseArgs(process.argv.slice(2));
const { file, requestId, agentId, agentName: rawAgentName, createRequest, taskId } = args;
const agentName = resolveAgentName(rawAgentName);
const resolvedRole = resolveRole(rawAgentName) || resolveRole(agentName);

if (!file || !requestId || !agentId) {
  console.error("Usage: node scripts/record-agent-spawn.js runs/<DELIVERY_ID>/workflow-state.json SPAWN_REQUEST_ID AGENT_ID --agent AGENT_NAME [--task TASK_ID] [--create-request]");
  process.exit(1);
}

const statePath = path.resolve(file);
let state;
try {
  state = loadWorkflowState(statePath);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const request = (state.agent_dispatch.spawn_requests || []).find((item) => item.id === requestId);

if (!request) {
  if (!createRequest || !taskId) {
    console.error(`Spawn request not found: ${requestId}. Use --create-request --task TASK_ID to create it.`);
    process.exit(1);
  }
  const task = (state.task_graph && state.task_graph.tasks || []).find((t) => t.id === taskId);
  const testRole = resolvedRole || task.role || "";
  const expected = expectedAgentName(testRole);
  const identityErrors = validateSpawnIdentity(testRole, agentId, agentName);
  if (identityErrors.length) {
    console.error("Agent spawn rejected:");
    for (const error of identityErrors) console.error(`- ${error}`);
    if (expected) console.error(`Expected command suffix: --agent ${expected}`);
    process.exit(1);
  }
  const now = new Date().toISOString();
  const newRequest = {
    id: requestId,
    role: testRole || agentName,
    lane: task && task.lane ? task.lane : "frontend",
    task_ids: [taskId],
    status: "spawned",
    agent_id: agentId,
    prompt: `Kilo/Agent Manager spawned ${agentName} for ${taskId}`,
    write_scope: [],
    created_at: now,
    updated_at: now,
    blockers: []
  };
  state.agent_dispatch.spawn_requests = state.agent_dispatch.spawn_requests || [];
  state.agent_dispatch.spawn_requests.push(newRequest);
  const expires = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  state.agent_dispatch.leases = state.agent_dispatch.leases || [];
  state.agent_dispatch.leases.push({
    task_id: taskId,
    role: testRole || agentName,
    agent_id: agentId,
    agent_name: agentName,
    status: "leased",
    started_at: now,
    expires_at: expires
  });
  state.agent_dispatch.status = "active";
  state.agent_dispatch.history.push({
    at: now,
    state: state.current_state,
    note: `Created spawn request ${requestId} and recorded agent ${agentId}.`
  });
  state.delivery.updated_at = now;
  state.log.push({
    at: now,
    state: state.current_state,
    note: `Agent ${agentId} leased task(s): ${taskId}`
  });
  writeWorkflowState(statePath, state, { writer: "record-agent-spawn.js" });
  console.log(`OK: created request ${requestId} and recorded ${agentName} ${agentId} for ${taskId}`);
  process.exit(0);
}

const expected = expectedAgentName(request.role);
const identityErrors = validateSpawnIdentity(request.role, agentId, agentName);
if (identityErrors.length) {
  console.error("Agent spawn rejected:");
  for (const error of identityErrors) console.error(`- ${error}`);
  if (expected) console.error(`Expected command suffix: --agent ${expected}`);
  process.exit(1);
}

const now = new Date().toISOString();
const expires = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
request.status = "spawned";
request.agent_id = agentId;
request.agent_name = agentName;
request.updated_at = now;

state.agent_dispatch.leases = state.agent_dispatch.leases || [];
for (const lease of state.agent_dispatch.leases) {
  if (!lease || !request.task_ids.includes(lease.task_id) || lease.role !== request.role) {
    continue;
  }
  if (["leased", "active", "requested"].includes(lease.status || "leased")) {
    lease.status = "superseded";
    lease.superseded_at = now;
    lease.superseded_by = agentId;
  }
}
for (const taskId of request.task_ids) {
  state.agent_dispatch.leases.push({
    task_id: taskId,
    role: request.role,
    agent_id: agentId,
    agent_name: agentName,
    status: "leased",
    started_at: now,
    expires_at: expires
  });
}
state.agent_dispatch.status = "active";
state.agent_dispatch.history.push({
  at: now,
  state: state.current_state,
  note: `Recorded agent ${agentId} for spawn request ${requestId}.`
});
state.delivery.updated_at = now;
state.log.push({
  at: now,
  state: state.current_state,
  note: `Agent ${agentId} leased task(s): ${request.task_ids.join(", ")}`
});

writeWorkflowState(statePath, state, { writer: "record-agent-spawn.js" });
console.log(`OK: recorded ${agentName} ${agentId} for ${requestId}`);

function parseArgs(raw) {
  const parsed = {
    file: raw[0] || "",
    requestId: raw[1] || "",
    agentId: raw[2] || "",
    agentName: "",
    createRequest: false,
    taskId: ""
  };
  for (let index = 3; index < raw.length; index += 1) {
    const arg = raw[index];
    if (arg === "--agent" || arg === "--agent-name") {
      parsed.agentName = raw[++index] || "";
    } else if (arg === "--create-request") {
      parsed.createRequest = true;
    } else if (arg === "--task") {
      parsed.taskId = raw[++index] || "";
    }
  }
  return parsed;
}
