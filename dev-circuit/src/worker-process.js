"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { workerEnv } = require("./security");

function spawnWorker(executable, args, { cwd = process.cwd(), timeout = 120000 } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "devcircuit-worker-home-"));
  const env = workerEnv();
  env.HOME = home;
  const runner = process.env.DEVCIRCUIT_SANDBOX_RUNNER;
  if (!runner && process.env.DEVCIRCUIT_TEST_ALLOW_UNSANDBOXED !== "1") throw new Error("DEVCIRCUIT_SANDBOX_RUNNER is required for planner, agent, and repository commands");
  const command = runner || executable;
  const commandArgs = runner ? ["--cwd", path.resolve(cwd), "--home", home, "--", path.resolve(executable), ...args] : args;
  return spawnSync(command, commandArgs, { cwd, encoding: "utf8", timeout, env });
}

module.exports = { spawnWorker };
