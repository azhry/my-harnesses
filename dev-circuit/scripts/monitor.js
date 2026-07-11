#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs } = require("../src/args");
const { mutateState } = require("../src/state-store");
const { auditState } = require("../src/gates");

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.runs || path.join(process.cwd(), "runs"));
const intervalMs = Number(args.intervalMs || 5000);

function stateFiles() {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => path.join(root, item.name, "workflow-state.json"))
    .filter((file) => fs.existsSync(file));
}

function auditAll() {
  const summary = [];
  for (const file of stateFiles()) {
    try {
      let audit;
      mutateState(file, "supervisor", (state) => {
        audit = auditState(state);
        state.supervisor.status = audit.ok ? "watching" : "denying";
        state.supervisor.heartbeat_at = new Date().toISOString();
        state.supervisor.findings = audit.findings;
        state.supervisor.audit_count += 1;
      });
      summary.push({ file, ok: audit.ok, findings: audit.findings.length });
    } catch (error) {
      summary.push({ file, ok: false, error: error.message });
    }
  }
  console.log(JSON.stringify({ at: new Date().toISOString(), runs: summary }, null, 2));
}

auditAll();
if (args.watch) setInterval(auditAll, intervalMs);
