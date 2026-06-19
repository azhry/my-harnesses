#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const [file, targetPath, role] = process.argv.slice(2);

if (!file || !targetPath) {
  console.error("Usage: node scripts/check-write-scope.js path/to/workflow-state.json TARGET_PATH [ROLE]");
  console.error("");
  console.error("Checks if TARGET_PATH is within the allowed write scope for the given ROLE.");
  console.error("Exits 0 if allowed, 1 if denied.");
  console.error("");
  console.error("If ROLE is omitted, checks against all roles' scopes.");
  process.exit(1);
}

const statePath = path.resolve(file);
if (!fs.existsSync(statePath)) {
  console.error(`State file not found: ${statePath}`);
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const harnessRoot = path.resolve(__dirname, "..");
const resolvedTarget = path.resolve(targetPath);

const deliveryId = state.delivery && state.delivery.id ? state.delivery.id : "";
const runDir = deliveryId ? path.join(harnessRoot, "runs", deliveryId) : "";

const HARNESS_PROTECTED_DIRS = [
  { dir: path.join(harnessRoot, "scripts"), label: "scripts/", allowed_roles: ["orchestrator"] },
  { dir: path.join(harnessRoot, "tests"), label: "tests/", allowed_roles: ["orchestrator"] },
  { dir: path.join(harnessRoot, "ui"), label: "ui/", allowed_roles: ["orchestrator"] },
  { dir: path.join(harnessRoot, "docs"), label: "docs/", allowed_roles: ["orchestrator"] },
  { dir: path.join(harnessRoot, "templates"), label: "templates/", allowed_roles: ["orchestrator"] },
  { dir: path.join(harnessRoot, "schemas"), label: "schemas/", allowed_roles: ["orchestrator"] }
];

const HARNESS_PROTECTED_FILES = [
  { file: path.join(harnessRoot, "AGENTS.md"), label: "AGENTS.md", allowed_roles: ["orchestrator"] },
  { file: path.join(harnessRoot, "CLAUDE.md"), label: "CLAUDE.md", allowed_roles: ["orchestrator"] },
  { file: path.join(harnessRoot, "package.json"), label: "package.json", allowed_roles: ["orchestrator"] },
  { file: path.join(harnessRoot, "harness.yaml"), label: "harness.yaml", allowed_roles: ["orchestrator"] },
  { file: path.join(harnessRoot, "notes.txt"), label: "notes.txt", allowed_roles: ["orchestrator"] },
  { file: path.join(harnessRoot, ".gitignore"), label: ".gitignore", allowed_roles: ["orchestrator", "product_manager", "project_manager", "frontend_dev", "frontend_test", "backend_dev", "backend_test"] }
];

const ALLOWED_WRITE_DIRS = {
  product_manager: [],
  project_manager: [],
  frontend_dev: [],
  frontend_test: [],
  backend_dev: [],
  backend_test: [],
  orchestrator: []
};

for (const entry of HARNESS_PROTECTED_DIRS) {
  for (const r of entry.allowed_roles) {
    ALLOWED_WRITE_DIRS[r].push(entry.dir);
  }
}

function isWithin(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

function pathEquals(a, b) {
  return path.resolve(a) === path.resolve(b);
}

const errors = [];

const workspaceRoot = path.resolve(harnessRoot, "..");

if (runDir && isWithin(runDir, resolvedTarget)) {
  console.log(`OK: ${targetPath} is within run directory (runs/${deliveryId}/)`);
  process.exit(0);
}

const checkRole = role || "orchestrator";

for (const entry of HARNESS_PROTECTED_FILES) {
  if (pathEquals(entry.file, resolvedTarget)) {
    if (entry.allowed_roles.includes(checkRole)) {
      console.log(`OK: ${entry.label} is in allowed scope for role ${checkRole}`);
      process.exit(0);
    }
    errors.push(`Cannot write to ${entry.label}. Only ${entry.allowed_roles.join(", ")} may modify harness configuration.`);
  }
}

for (const entry of HARNESS_PROTECTED_DIRS) {
  if (isWithin(entry.dir, resolvedTarget)) {
    const relPath = path.relative(harnessRoot, resolvedTarget);
    if (entry.allowed_roles.includes(checkRole)) {
      console.log(`OK: ${relPath} is in allowed scope for role ${checkRole}`);
      process.exit(0);
    }
    errors.push(`Cannot write to ${entry.label} as role ${checkRole}. Role ${entry.allowed_roles.join(" or ")} required. Agent output must go inside runs/${deliveryId || "<DELIVERY_ID>"}/.`);
  }
}

if (!runDir) {
  errors.push(`No delivery ID found. Cannot determine write scope.`);
}

if (errors.length) {
  for (const err of errors) {
    console.error(`DENIED: ${err}`);
  }
  process.exit(1);
}

const taskScopes = [];
const tasks = (state.task_graph && state.task_graph.tasks) || [];
for (const t of tasks) {
  if (t.scope && Array.isArray(t.scope.allowed_paths)) {
    for (const allowedPath of t.scope.allowed_paths) {
      const resolvedAllowed = path.resolve(workspaceRoot, allowedPath);
      if (isWithin(resolvedAllowed, resolvedTarget)) {
        taskScopes.push(t.id);
      }
    }
  }
}

if (taskScopes.length) {
  console.log(`OK: ${targetPath} is within scope of task(s): ${taskScopes.join(", ")}`);
  process.exit(0);
}

console.error(`DENIED: ${targetPath} is not within any approved write scope for role ${checkRole || "unknown"}.`);
console.error(`  Your CWD appears to be: ${process.cwd()}`);
console.error(`  Resolved target: ${resolvedTarget}`);
console.error(`  Workspace root: ${workspaceRoot}`);
console.error(`  Agent output must go inside runs/${deliveryId || "<DELIVERY_ID>"}/ or the project repo (e.g. ${path.join(workspaceRoot, "<repo>")}/).`);
process.exit(1);
