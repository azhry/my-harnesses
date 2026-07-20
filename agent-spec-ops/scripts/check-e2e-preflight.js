#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");
const { loadWorkflowState } = require("./lib/state-store");

const args = process.argv.slice(2);
const stateFile = args.find((a) => !a.startsWith("--"));
const portArg = args.indexOf("--frontend-port");
const backendPortArg = args.indexOf("--backend-port");
const frontendPort = portArg >= 0 ? Number(args[portArg + 1]) : 3000;
const backendPort = backendPortArg >= 0 ? Number(args[backendPortArg + 1]) : 8080;
const skipBackend = args.includes("--skip-backend");

if (!stateFile) {
  console.error("Usage: node scripts/check-e2e-preflight.js <workflow-state.json> [--frontend-port 3000] [--backend-port 8080] [--skip-backend]");
  process.exit(1);
}

const statePath = path.resolve(stateFile);
let state;
try {
  state = loadWorkflowState(statePath);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const runDir = path.dirname(statePath);
const policy = (state.implementation && state.implementation.git_policy) || {};
const repoPath = path.resolve(policy.repo_path || state.workspace_root || process.cwd());

const checks = [];
let failed = false;

function checkPort(port, label) {
  const result = spawnSync("curl", [
    "-s", "-o", "/dev/null", "-w", "%{http_code}",
    "--connect-timeout", "3",
    `http://localhost:${port}/`
  ], { cwd: repoPath, encoding: "utf8", timeout: 10000, windowsHide: true });

  const httpCode = (result.stdout || "").trim();
  const reachable = httpCode && httpCode !== "000" && httpCode !== "";

  if (reachable) {
    checks.push(`  [PASS] ${label} (localhost:${port}) — HTTP ${httpCode}`);
  } else {
    checks.push(`  [FAIL] ${label} (localhost:${port}) — not reachable`);
    failed = true;
  }
}

function checkGitClean() {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd: repoPath, encoding: "utf8", timeout: 5000, windowsHide: true
  });
  const dirty = (result.stdout || "").trim();
  if (dirty) {
    const files = dirty.split(/\r?\n/).filter(Boolean);
    checks.push(`  [WARN] Working tree has ${files.length} dirty file(s):`);
    for (const f of files.slice(0, 10)) {
      checks.push(`         ${f}`);
    }
    if (files.length > 10) {
      checks.push(`         ... and ${files.length - 10} more`);
    }
  } else {
    checks.push("  [PASS] Working tree is clean");
  }
}

function checkCurrentBranch() {
  const result = spawnSync("git", ["branch", "--show-current"], {
    cwd: repoPath, encoding: "utf8", timeout: 5000, windowsHide: true
  });
  const branch = (result.stdout || "").trim();
  checks.push(`  [INFO] Current branch: ${branch || "(detached)"}`);
  return branch;
}

console.log("E2E Preflight Checks");
console.log("=====================\n");

console.log("1. Git status:");
checkCurrentBranch();
checkGitClean();

console.log("\n2. Frontend server:");
checkPort(frontendPort, "Frontend dev server");

if (!skipBackend) {
  console.log("\n3. Backend server:");
  checkPort(backendPort, "Backend API server");
}

console.log("");

if (failed) {
  console.error("PREFLIGHT FAILED: One or more required services are not reachable.");
  console.error("Start the required servers before running E2E tests.");
  console.error("");
  console.error("Expected:");
  console.error(`  Frontend: http://localhost:${frontendPort}/`);
  if (!skipBackend) {
    console.error(`  Backend:  http://localhost:${backendPort}/`);
  }
  process.exit(1);
} else {
  console.log("PREFLIGHT PASSED: All required services are reachable.");
}
