#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { expectedAgentName, validateSpawnIdentity } = require("./lib/agent-identity");
const { loadWorkflowState, writeWorkflowState } = require("./lib/state-store");

const args = parseArgs(process.argv.slice(2));
const { file, requestId, agentId, agentName } = args;

if (!file || !requestId || !agentId) {
  console.error("Usage: node scripts/record-agent-spawn.js runs/<DELIVERY_ID>/workflow-state.json SPAWN_REQUEST_ID AGENT_ID --agent AGENT_NAME");
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
  console.error(`Spawn request not found: ${requestId}`);
  process.exit(1);
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
    agentName: ""
  };
  for (let index = 3; index < raw.length; index += 1) {
    const arg = raw[index];
    if (arg === "--agent" || arg === "--agent-name") {
      parsed.agentName = raw[++index] || "";
    }
  }
  return parsed;
}
