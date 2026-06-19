"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const MARKER_PATH = path.join(root, ".session.json");
const MAX_AGE_MS = 5 * 60 * 1000;

function readSessionMarker() {
  if (!fs.existsSync(MARKER_PATH)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(MARKER_PATH, "utf8"));
  } catch {
    return null;
  }
}

function requireContext(label) {
  if (process.env.SKIP_CONTEXT_CHECK) {
    return { delivery_id: "", state: "", started_at: "" };
  }
  const marker = readSessionMarker();
  if (!marker) {
    console.error(`⚠  Context not loaded. Run this first:`);
    console.error(`   node scripts/read-context.js runs/<DELIVERY_ID>/workflow-state.json`);
    console.error(`   Then retry: ${label}`);
    process.exit(1);
  }
  const age = Date.now() - new Date(marker.started_at).getTime();
  if (age > MAX_AGE_MS) {
    console.error(`⚠  Context is stale (${Math.round(age / 1000 / 60)}m old). Refresh:`);
    console.error(`   node scripts/read-context.js runs/${marker.delivery_id}/workflow-state.json`);
    console.error(`   Then retry: ${label}`);
    process.exit(1);
  }
  return marker;
}

function checkContext(label) {
  if (process.env.SKIP_CONTEXT_CHECK) {
    return { delivery_id: "", state: "", started_at: "" };
  }
  const marker = readSessionMarker();
  if (!marker) {
    console.error(`⚠  Context not loaded. Run this first:`);
    console.error(`   node scripts/read-context.js runs/<DELIVERY_ID>/workflow-state.json`);
    console.error(`   Then retry: ${label}`);
    process.exit(1);
  }
  const age = Date.now() - new Date(marker.started_at).getTime();
  if (age > MAX_AGE_MS) {
    console.error(`⚠  Context is stale (${Math.round(age / 1000 / 60)}m old). Refresh:`);
    console.error(`   node scripts/read-context.js runs/${marker.delivery_id}/workflow-state.json`);
    console.error(`   Then retry: ${label}`);
    process.exit(1);
  }
  return marker;
}

module.exports = { checkContext, readSessionMarker, MARKER_PATH, MAX_AGE_MS };
