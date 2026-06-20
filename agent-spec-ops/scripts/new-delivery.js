#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  ensureGlobalMemory,
  ensureRunMemory,
  writeState
} = require("./lib/memory-store");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const workspaceIndex = args.indexOf("--workspace");
const workspacePath = workspaceIndex >= 0 ? path.resolve(args[workspaceIndex + 1]) : "";
const deliveryId = workspaceIndex >= 0 ? args[0] : args[0];
const titleParts = workspaceIndex >= 0 ? args.slice(1, workspaceIndex) : args.slice(1);
const title = titleParts.join(" ").trim();

if (!deliveryId) {
  console.error("Usage: node scripts/new-delivery.js DELIVERY_ID [TITLE] [--workspace /path/to/workspace]");
  process.exit(1);
}

const deliveryDir = path.join(root, "runs", deliveryId);
const stateFile = path.join(deliveryDir, "workflow-state.json");

if (fs.existsSync(stateFile)) {
  console.log(`State already exists: ${stateFile}`);
  process.exit(0);
}

fs.mkdirSync(deliveryDir, { recursive: true });
ensureGlobalMemory();

const templateFile = path.join(root, "templates", "workflow-state.json");
const state = JSON.parse(fs.readFileSync(templateFile, "utf8"));
const now = new Date().toISOString();

state.delivery.id = deliveryId;
state.delivery.title = title;
state.delivery.created_at = now;
state.delivery.updated_at = now;
if (workspacePath) state.workspace_root = workspacePath;
state.log.push({
  at: now,
  state: state.current_state,
  note: "Workflow state initialized from agent-spec-ops."
});

writeState(stateFile, state);
const prepared = ensureRunMemory(stateFile, state);
writeState(stateFile, prepared.state);

console.log(`Created ${stateFile}`);
console.log(`Prepared local memory and task store in ${deliveryDir}`);
