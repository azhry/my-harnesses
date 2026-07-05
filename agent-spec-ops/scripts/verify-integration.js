#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { loadWorkflowState } = require("./lib/state-store");

const file = process.argv[2];

if (!file) {
  console.error("Usage: node scripts/verify-integration.js path/to/workflow-state.json");
  console.error("Verifies that the project stack starts and responds correctly via docker compose.");
  process.exit(1);
}

const statePath = path.resolve(file);
let state;
try {
  state = loadWorkflowState(statePath);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const harnessRoot = path.resolve(__dirname, "..");

const tasks = state.task_graph && Array.isArray(state.task_graph.tasks) ? state.task_graph.tasks : [];

const uniqueRepos = new Set();
for (const t of tasks) {
  if (t.scope && Array.isArray(t.scope.allowed_repos)) {
    for (const repo of t.scope.allowed_repos) {
      uniqueRepos.add(repo);
    }
  }
}

const stateWorkspaceRoot = state.workspace_root || "";
const workspaceRoot = stateWorkspaceRoot
  ? path.resolve(harnessRoot, stateWorkspaceRoot)
  : path.resolve(harnessRoot, "..");

function findComposeFile(repoName) {
  const repoDir = path.join(workspaceRoot, repoName);
  for (const name of ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]) {
    const composePath = path.join(repoDir, name);
    if (fs.existsSync(composePath)) return composePath;
  }
  return null;
}

if (uniqueRepos.size === 0) {
  console.log("  No repos defined in task scopes — skipping integration verification");
  process.exit(0);
}

const repoName = [...uniqueRepos][0];
const composeFile = findComposeFile(repoName);

if (!composeFile) {
  console.log(`  No docker-compose file found in ${repoName}/ — skipping integration verification`);
  process.exit(0);
}

const composeDir = path.dirname(composeFile);
console.log(`  Found compose file: ${path.relative(workspaceRoot, composeFile)}`);

function runDocker(args) {
  try {
    const result = execSync(`docker ${args}`, {
      cwd: composeDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120000,
    });
    return { ok: true, stdout: result.trim(), stderr: "" };
  } catch (err) {
    return {
      ok: false,
      stdout: (err.stdout || "").trim(),
      stderr: (err.stderr || "").trim(),
    };
  }
}

function resolveServiceUrls() {
  const composeContent = fs.readFileSync(composeFile, "utf8");
  const urls = [];

  const portPattern = /ports:\s*-\s*"?(\d+):(\d+)"?/g;
  let match;
  while ((match = portPattern.exec(composeContent)) !== null) {
    urls.push(`http://localhost:${match[1]}`);
  }

  return urls;
}

console.log("  Starting services...");
const upResult = runDocker(`compose up -d --wait-timeout 60`);

if (!upResult.ok) {
  const errMsg = upResult.stderr && !upResult.stderr.includes("progress") ? upResult.stderr : upResult.stdout || "unknown error";
  console.error(`  FAILED to start services: ${errMsg.slice(0, 300)}`);
  runDocker("compose down");
  process.exit(1);
}

console.log("  Services started successfully");

const serviceUrls = resolveServiceUrls();
const healthResults = [];

if (serviceUrls.length > 0) {
  console.log(`  Checking ${serviceUrls.length} service endpoint(s)...`);

  for (const url of serviceUrls) {
    try {
      const result = execSync(`curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${url}"`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 15000,
      });
      const httpCode = result.trim();
      const healthy = httpCode >= 200 && httpCode < 500;
      healthResults.push({ url, code: httpCode, healthy });
      console.log(`  ${healthy ? "✓" : "✗"} ${url} -> ${httpCode}`);
    } catch {
      healthResults.push({ url, code: "000", healthy: false });
      console.log(`  ✗ ${url} -> timeout/unreachable`);
    }
  }
}

const psResult = runDocker("compose ps --format json");
let running = 0;
let total = 0;
if (psResult.ok && psResult.stdout) {
  try {
    const lines = psResult.stdout.split("\n").filter(l => l.trim());
    for (const line of lines) {
      try {
        const svc = JSON.parse(line);
        total++;
        if (svc.State === "running") running++;
      } catch {}
    }
  } catch {}
  console.log(`  Services: ${running}/${total} running`);
}

const allHealthy = healthResults.length === 0 || healthResults.every(h => h.healthy);
const allRunning = total === 0 || running === total;

const passed = allHealthy && allRunning;

const { appendEvent } = require("./lib/memory-store");
appendEvent(statePath, {
  type: "requirement_verification",
  role_context: "orchestrator",
  task_id: "",
  target: state.current_state,
  summary: passed ? "Implementation verification passed" : "Implementation verification FAILED",
  details: JSON.stringify({
    compose_file: path.relative(workspaceRoot, composeFile),
    service_urls: serviceUrls,
    health_results: healthResults,
    services_running: `${running}/${total}`,
  }, null, 2),
  severity: passed ? "info" : "warning",
  tags: ["implementation_review", passed ? "passed" : "failed"],
});

runDocker("compose down");

if (!passed) {
  console.error("\n  Integration verification FAILED:");
  for (const h of healthResults) {
    if (!h.healthy) {
      console.error(`    ✗ ${h.url} returned HTTP ${h.code}`);
    }
  }
  if (total > 0 && running < total) {
    console.error(`    ✗ Only ${running}/${total} services are running`);
  }
  process.exit(1);
}

console.log("\n  Integration verification: PASSED");
process.exit(0);
