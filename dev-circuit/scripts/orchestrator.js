#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { parseArgs, required } = require("../src/args");
const { runOnce } = require("../src/orchestrator");
const { readiness } = require("../src/readiness");
const { readState } = require("../src/state-store");

const args = parseArgs(process.argv.slice(2));
const adapter = args.adapter || process.env.DEVCIRCUIT_AGENT_ADAPTER;
if (!adapter) throw new Error("--adapter or DEVCIRCUIT_AGENT_ADAPTER is required");
const options = {
  statePath: path.resolve(required(args, "state")),
  repo: path.resolve(required(args, "repo")),
  adapter: path.resolve(adapter)
};

let ready = false;
async function tick() {
  if (tick.inFlight) return;
  tick.inFlight = true;
  try {
    if (!ready) {
      const state = readState(options.statePath);
      const report = await readiness({ repo: options.repo, githubRepository: state.integrations.github.repository, baseBranch: state.integrations.github.base_branch, linearTeamId: state.integrations.linear.team_id });
      if (!report.ready) throw new Error(`Readiness blocked: ${report.checks.filter((item) => item.required && item.status !== "ready").map((item) => item.id).join(", ")}`);
      ready = true;
    }
    console.log(JSON.stringify(await runOnce(options)));
  }
  catch (error) { console.error(JSON.stringify({ action: "error", error: error.message })); }
  finally { tick.inFlight = false; }
}
tick.inFlight = false;

tick();
if (args.watch) setInterval(tick, Number(args.intervalMs || 5000));
