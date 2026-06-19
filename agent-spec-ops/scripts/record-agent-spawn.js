#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const [file, requestId, agentId] = process.argv.slice(2);

if (!file || !requestId || !agentId) {
  console.error("Usage: node scripts/record-agent-spawn.js runs/<DELIVERY_ID>/workflow-state.json SPAWN_REQUEST_ID AGENT_ID");
  process.exit(1);
}

const statePath = path.resolve(file);
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const request = (state.agent_dispatch.spawn_requests || []).find((item) => item.id === requestId);

if (!request) {
  console.error(`Spawn request not found: ${requestId}`);
  process.exit(1);
}

const now = new Date().toISOString();
const expires = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
request.status = "spawned";
request.agent_id = agentId;
request.updated_at = now;

state.agent_dispatch.leases = state.agent_dispatch.leases || [];
for (const taskId of request.task_ids) {
  state.agent_dispatch.leases.push({
    task_id: taskId,
    role: request.role,
    agent_id: agentId,
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

fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
console.log(`OK: recorded ${agentId} for ${requestId}`);
