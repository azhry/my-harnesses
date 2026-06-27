"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const MAX_AGE_MS = 5 * 60 * 1000;

function markerPathForState(stateFile) {
  const resolved = path.resolve(stateFile || "");
  const runDir = path.dirname(resolved);
  const parent = path.dirname(runDir);
  if (path.basename(parent) === "runs") {
    return path.join(runDir, ".session.json");
  }
  let deliveryId = "";
  try {
    if (fs.existsSync(resolved)) {
      const state = JSON.parse(fs.readFileSync(resolved, "utf8"));
      deliveryId = state.delivery && state.delivery.id ? state.delivery.id : "";
    }
  } catch {}
  if (deliveryId) {
    const runDirFromId = path.join(root, "runs", deliveryId);
    return path.join(runDirFromId, ".session.json");
  }
  return path.join(runDir, ".session.json");
}

function readSessionMarker(stateFile) {
  const mp = markerPathForState(stateFile);
  if (!fs.existsSync(mp)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(mp, "utf8"));
  } catch {
    return null;
  }
}

function updateSessionMarker(stateFile, updates) {
  const mp = markerPathForState(stateFile);
  const existing = readSessionMarker(stateFile) || {};
  fs.mkdirSync(path.dirname(mp), { recursive: true });
  fs.writeFileSync(mp, JSON.stringify({ ...existing, ...updates }, null, 2) + "\n");
}

function requireContext(label) {
  return checkContext(label);
}

function checkContext(label, stateFile) {
  if (process.env.SKIP_CONTEXT_CHECK) {
    return { delivery_id: "", state: "", started_at: "" };
  }
  if (!stateFile) {
    const args = process.argv.slice(2);
    stateFile = args[0] || "";
  }
  const marker = readSessionMarker(stateFile);
  if (!marker) {
    const runHint = stateFile ? path.dirname(path.resolve(stateFile)) : "runs/<DELIVERY_ID>/";
    console.error(`⚠  Context not loaded. Run this first:`);
    console.error(`   node scripts/read-context.js ${stateFile || "runs/<DELIVERY_ID>/workflow-state.json"}`);
    console.error(`   Then retry: ${label}`);
    process.exit(1);
  }
  const age = Date.now() - new Date(marker.started_at).getTime();
  if (age > MAX_AGE_MS) {
    console.error(`⚠  Context is stale (${Math.round(age / 1000 / 60)}m old). Refresh:`);
    console.error(`   node scripts/read-context.js ${stateFile || "runs/<DELIVERY_ID>/workflow-state.json"}`);
    console.error(`   Then retry: ${label}`);
    process.exit(1);
  }
  if (stateFile && fs.existsSync(path.resolve(stateFile))) {
    try {
      const state = JSON.parse(fs.readFileSync(path.resolve(stateFile), "utf8"));
      const stateUpdatedAt = state.delivery && state.delivery.updated_at ? state.delivery.updated_at : "";
      if (stateUpdatedAt && marker.state_updated_at && stateUpdatedAt !== marker.state_updated_at) {
        console.error(`⚠  State changed after context recovery. Refresh before mutating state:`);
        console.error(`   node scripts/read-context.js ${stateFile}`);
        console.error(`   Then retry: ${label}`);
        process.exit(1);
      }
    } catch {
      console.error(`⚠  Could not compare state freshness. Refresh context first:`);
      console.error(`   node scripts/read-context.js ${stateFile}`);
      console.error(`   Then retry: ${label}`);
      process.exit(1);
    }
  }
  return marker;
}

module.exports = { checkContext, readSessionMarker, updateSessionMarker, MAX_AGE_MS };
