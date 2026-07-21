#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadWorkflowState } = require("./lib/state-store");

const STALE_THRESHOLDS = {
  active: 2 * 60 * 60 * 1000,
  implemented: 30 * 60 * 1000,
  testing: 2 * 60 * 60 * 1000,
  failed: 24 * 60 * 60 * 1000
};

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/detect-stale-tasks.js runs/<DELIVERY_ID>/workflow-state.json");
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

const now = Date.now();
const tasks = state.task_graph && Array.isArray(state.task_graph.tasks) ? state.task_graph.tasks : [];
const leases = state.agent_dispatch && Array.isArray(state.agent_dispatch.leases) ? state.agent_dispatch.leases : [];
const taskById = new Map(tasks.map((t) => [t.id, t]));
const stale = [];

for (const task of tasks) {
  if (!["active", "implemented", "testing", "failed"].includes(task.status)) continue;
  const threshold = STALE_THRESHOLDS[task.status];
  if (!threshold) continue;

  const lastUpdate = task.loop && task.loop.history && task.loop.history.length
    ? new Date(task.loop.history[task.loop.history.length - 1].split(":")[0]).getTime()
    : task.updated_at ? new Date(task.updated_at).getTime() : 0;
  const ageMs = lastUpdate ? now - lastUpdate : Infinity;

  if (ageMs <= threshold) continue;

  const hasCurrentLease = leases.some((l) =>
    l && l.task_id === task.id &&
    ["leased", "active"].includes(l.status) &&
    l.expires_at && Date.parse(l.expires_at) > now
  );

  const reason = task.status === "active" && !hasCurrentLease
    ? "active with no current lease (agent likely dead)"
    : task.status === "implemented" && !hasCurrentLease
    ? "implemented but no test agent lease created"
    : task.status === "active"
    ? `active for ${Math.round(ageMs / 60000)}m (threshold: ${Math.round(threshold / 60000)}m)`
    : task.status === "testing"
    ? `testing for ${Math.round(ageMs / 60000)}m`
    : `${task.status} for ${Math.round(ageMs / 60000)}m`;

  stale.push({
    id: task.id,
    status: task.status,
    role: task.role,
    title: task.title,
    age_minutes: Math.round(ageMs / 60000),
    threshold_minutes: Math.round(threshold / 60000),
    reason,
    loop_attempt: (task.loop && task.loop.attempt) || 0,
    max_attempts: (task.loop && task.loop.max_attempts) || 3,
    has_current_lease: hasCurrentLease
  });
}

if (stale.length === 0) {
  console.log("No stale tasks detected.");
} else {
  console.log(`Stale tasks: ${stale.length}`);
  for (const s of stale) {
    console.log(`\n  ${s.id} [${s.role}] ${s.status} — ${s.title || ""}`);
    console.log(`    Reason: ${s.reason}`);
    console.log(`    Age: ${s.age_minutes}m (threshold: ${s.threshold_minutes}m)`);
    console.log(`    Loop: attempt ${s.loop_attempt}/${s.max_attempts}`);
    console.log(`    Current lease: ${s.has_current_lease ? "yes" : "NO"}`);
  }
  console.log("\nRecommended actions:");
  for (const s of stale) {
    if (s.status === "active" && !s.has_current_lease) {
      console.log(`  ${s.id}: Agent dead. Transition to failed, then re-dispatch.`);
    } else if (s.status === "implemented" && !s.has_current_lease) {
      console.log(`  ${s.id}: No test agent. Run plan-agent-dispatch.js to create one.`);
    } else if (s.status === "testing" && s.age_minutes > 120) {
      console.log(`  ${s.id}: Test agent stuck. Check session, re-run or hand back to dev.`);
    } else if (s.status === "failed" && s.loop_attempt >= s.max_attempts) {
      console.log(`  ${s.id}: Loop exhausted (${s.loop_attempt}/${s.max_attempts}). User intervention needed.`);
    }
  }
}

if (stale.length > 0) process.exit(1);
