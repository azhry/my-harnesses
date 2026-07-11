"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnWorker } = require("./worker-process");

function contextFor(state, task, role, submission) {
  return {
    protocol: "devcircuit-agent-dispatch-v1",
    run: { id: state.run.id, title: state.run.title, project_key: state.run.project_key },
    specification: state.specification,
    task: {
      id: task.id,
      title: task.title,
      status: task.status,
      attempt: task.attempt,
      contract: task.contract,
      contract_hash: task.contract_hash,
      linear: task.linear,
      git: task.git,
      prior_reviews: task.reviews
    },
    role,
    submission,
    rules: [
      "Use only this role's permissions.",
      "Do not claim evidence you did not produce.",
      "Do not change workflow-state.json directly.",
      "Review and gate decisions must target the exact current HEAD SHA."
    ]
  };
}

function dispatch({ statePath, state, task, role, adapter }) {
  if (!adapter) throw new Error("An agent adapter executable is required");
  const directory = path.join(path.dirname(statePath), "dispatch");
  fs.mkdirSync(directory, { recursive: true });
  const inbox = path.join(path.dirname(statePath), "inbox");
  fs.mkdirSync(inbox, { recursive: true });
  const capabilityToken = crypto.randomBytes(32).toString("hex");
  const submission = { inbox, capability_token: capabilityToken, task_id: task.id, role, attempt: task.attempt };
  const contextPath = path.join(directory, `${task.id}-${role}-${Date.now()}.json`);
  fs.writeFileSync(contextPath, `${JSON.stringify(contextFor(state, task, role, submission), null, 2)}\n`, { mode: 0o600 });
  const result = spawnWorker(path.resolve(adapter), [contextPath], { timeout: 30000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Agent adapter failed: ${result.stderr || result.stdout}`);
  const finalLine = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  let lease;
  try { lease = JSON.parse(finalLine); } catch { throw new Error("Agent adapter final line must be JSON"); }
  if (!lease.agent_id || !lease.principal || !lease.workspace_id) throw new Error("Agent adapter lease requires agent_id, principal, and workspace_id");
  lease.adapter_sha256 = crypto.createHash("sha256").update(fs.readFileSync(path.resolve(adapter))).digest("hex");
  lease.capability_hash = crypto.createHash("sha256").update(capabilityToken).digest("hex");
  lease.inbox = inbox;
  lease.attempt = task.attempt;
  return { lease, contextPath };
}

module.exports = { contextFor, dispatch };
