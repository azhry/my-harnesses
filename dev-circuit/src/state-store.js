"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function stateKey() {
  const key = process.env.DEVCIRCUIT_STATE_KEY;
  if (!key || key.length < 32) throw new Error("DEVCIRCUIT_STATE_KEY must be set to at least 32 characters");
  return key;
}

function hashState(state) {
  const copy = structuredClone(state);
  delete copy.integrity;
  return crypto.createHmac("sha256", stateKey()).update(JSON.stringify(canonical(copy))).digest("hex");
}

function seal(state, writer) {
  state.integrity = {
    algorithm: "hmac-sha256",
    writer,
    sealed_at: new Date().toISOString(),
    hash: hashState(state)
  };
  return state;
}

function validateSeal(state) {
  if (!state.integrity || !state.integrity.hash) throw new Error("Workflow state is unsealed");
  const expected = hashState(state);
  if (expected !== state.integrity.hash) throw new Error(`Workflow integrity mismatch: expected ${expected}, got ${state.integrity.hash}`);
}

function readState(statePath) {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  validateSeal(state);
  return state;
}

function acquireLock(statePath) {
  const lockPath = `${statePath}.lock`;
  try {
    const descriptor = fs.openSync(lockPath, "wx", 0o600);
    fs.writeFileSync(descriptor, `${process.pid}\n`);
    return { descriptor, lockPath };
  } catch (error) {
    if (error.code === "EEXIST") {
      const pid = Number(fs.readFileSync(lockPath, "utf8").trim());
      let alive = Number.isInteger(pid) && pid > 0;
      if (alive) {
        try { process.kill(pid, 0); } catch { alive = false; }
      }
      if (!alive) {
        fs.unlinkSync(lockPath);
        return acquireLock(statePath);
      }
      throw new Error(`Workflow is locked by controller pid ${pid}: ${lockPath}`);
    }
    throw error;
  }
}

function releaseLock(lock) {
  if (!lock) return;
  try { fs.closeSync(lock.descriptor); } catch {}
  try { fs.unlinkSync(lock.lockPath); } catch {}
}

function writeState(statePath, state, writer) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  state.revision = Number(state.revision || 0) + 1;
  seal(state, writer);
  const temporary = `${statePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, statePath);
}

function mutateState(statePath, writer, mutate) {
  const lock = acquireLock(statePath);
  try {
    const state = readState(statePath);
    const result = mutate(state);
    state.run.updated_at = new Date().toISOString();
    writeState(statePath, state, writer);
    return result === undefined ? state : result;
  } finally {
    releaseLock(lock);
  }
}

module.exports = { stateKey, hashState, seal, validateSeal, acquireLock, releaseLock, readState, writeState, mutateState };
