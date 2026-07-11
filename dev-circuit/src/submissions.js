"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ALLOWED_TYPES = {
  implementer: new Set(["implementation"]),
  reviewer: new Set(["manual_test", "acceptance", "review"]),
  gatekeeper: new Set(),
  merger: new Set()
};

function pending(statePath, state) {
  const inbox = path.join(path.dirname(statePath), "inbox");
  if (!fs.existsSync(inbox)) return [];
  const result = [];
  for (const name of fs.readdirSync(inbox).filter((item) => item.endsWith(".json")).sort()) {
    const file = path.join(inbox, name);
    try {
      const envelope = JSON.parse(fs.readFileSync(file, "utf8"));
      const task = state.tasks.find((item) => item.id === envelope.task_id);
      if (!task) throw new Error(`unknown task ${envelope.task_id}`);
      const lease = task.agent_leases[envelope.role];
      const tokenHash = crypto.createHash("sha256").update(String(envelope.capability_token || "")).digest("hex");
      if (!lease || lease.capability_hash !== tokenHash || lease.attempt !== envelope.attempt || task.attempt !== envelope.attempt) throw new Error("invalid or stale capability");
      if (!ALLOWED_TYPES[envelope.role] || !ALLOWED_TYPES[envelope.role].has(envelope.type)) throw new Error(`role ${envelope.role} cannot submit ${envelope.type}`);
      result.push({ file, envelope, task, agentId: lease.agent_id });
    } catch (error) {
      const rejected = path.join(inbox, "rejected");
      fs.mkdirSync(rejected, { recursive: true });
      fs.renameSync(file, path.join(rejected, `${name}.rejected`));
      fs.writeFileSync(path.join(rejected, `${name}.reason.txt`), `${error.message}\n`, { mode: 0o600 });
    }
  }
  return result;
}

function begin(state, envelope, owner = `pid:${process.pid}`, leaseMs = 300000) {
  state.submission_journal ||= {};
  const existing = state.submission_journal[envelope.id];
  if (existing && existing.status === "processed") return "processed";
  const claimAge = existing && existing.processing_at ? Date.now() - Date.parse(existing.processing_at) : Infinity;
  if (existing && existing.status === "processing" && existing.owner !== owner && claimAge < leaseMs) return "claimed";
  state.submission_journal[envelope.id] = {
    ...(existing || {}),
    status: "processing",
    task_id: envelope.task_id,
    role: envelope.role,
    type: envelope.type,
    attempt: envelope.attempt,
    received_at: existing && existing.received_at || new Date().toISOString(),
    processing_at: new Date().toISOString(),
    owner
  };
  return existing ? "resuming" : "processing";
}

function complete(state, envelope) {
  state.submission_journal ||= {};
  state.submission_journal[envelope.id] = { ...(state.submission_journal[envelope.id] || {}), status: "processed", processed_at: new Date().toISOString() };
}

function archive(file, outcome = "processed") {
  const directory = path.join(path.dirname(file), outcome);
  fs.mkdirSync(directory, { recursive: true });
  fs.renameSync(file, path.join(directory, path.basename(file)));
}

module.exports = { pending, begin, complete, archive };
