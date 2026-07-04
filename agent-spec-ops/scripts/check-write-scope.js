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
  console.error("ROLE is required for project writes. Harness run artifacts are always allowed.");
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

const tasks = (state.task_graph && state.task_graph.tasks) || [];
const allAllowedRepos = new Set();
for (const t of tasks) {
  if (t.scope && Array.isArray(t.scope.allowed_repos)) {
    for (const repo of t.scope.allowed_repos) {
      allAllowedRepos.add(repo);
    }
  }
}

// Determine workspace root:
// 1. Use state.workspace_root if set
// 2. Auto-detect by checking which ancestor of harness contains the allowed repos
// 3. Fall back to parent of harness root
let workspaceRoot;
if (state.workspace_root) {
  workspaceRoot = path.resolve(harnessRoot, state.workspace_root);
} else if (allAllowedRepos.size > 0) {
  const ancestors = path.resolve(harnessRoot).split(path.sep);
  let found = false;
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const candidate = ancestors.slice(0, i + 1).join(path.sep);
    const allFound = [...allAllowedRepos].every((repo) => {
      const repoDir = path.join(candidate, repo);
      return fs.existsSync(repoDir) && fs.statSync(repoDir).isDirectory();
    });
    if (allFound) {
      workspaceRoot = candidate;
      found = true;
      break;
    }
  }
  if (!found) {
    workspaceRoot = path.resolve(harnessRoot, "..");
    console.warn(`  Could not auto-detect workspace root for repos: ${[...allAllowedRepos].join(", ")}`);
    console.warn(`  Target project may be in wrong location. Set workspace_root in state file.`);
  }
} else {
  workspaceRoot = path.resolve(harnessRoot, "..");
}

if (runDir && isWithin(runDir, resolvedTarget)) {
  console.log(`OK: ${targetPath} is within run directory (runs/${deliveryId}/)`);
  process.exit(0);
}

const checkRole = role || "";

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
const blockedTaskScopes = [];

for (const t of tasks) {
  if (t.scope && Array.isArray(t.scope.allowed_paths)) {
    for (const allowedPath of t.scope.allowed_paths) {
      const allowedRoots = resolveAllowedRoots(workspaceRoot, t, allowedPath);
      if (allowedRoots.some((allowedRoot) => isWithin(allowedRoot, resolvedTarget))) {
        if (canUseTaskScope(t, checkRole)) {
          taskScopes.push(t.id);
        } else {
          blockedTaskScopes.push(`${t.id}(${t.role || "no-role"}, ${t.status || "no-status"})`);
        }
      }
    }
  }
  if (t.scope && Array.isArray(t.scope.allowed_repos)) {
    for (const repo of t.scope.allowed_repos) {
      allAllowedRepos.add(repo);
    }
  }
}

function resolveAllowedRoots(root, task, allowedPath) {
  const staticPath = staticAllowedPath(allowedPath);
  if (path.isAbsolute(staticPath)) return [path.resolve(staticPath)];
  const roots = [path.resolve(root, staticPath)];
  const repos = task.scope && Array.isArray(task.scope.allowed_repos)
    ? task.scope.allowed_repos
    : [];
  for (const repo of repos) {
    roots.push(path.resolve(root, repo, staticPath));
  }
  return [...new Set(roots)];
}

function staticAllowedPath(allowedPath) {
  const normalized = String(allowedPath || "").replace(/\\/g, "/");
  const wildcard = normalized.search(/[*?]/);
  if (wildcard === -1) return normalized || ".";
  const prefix = normalized.slice(0, wildcard);
  const slash = prefix.lastIndexOf("/");
  if (slash === -1) return prefix || ".";
  return prefix.slice(0, slash + 1) || ".";
}

function canUseTaskScope(task, currentRole) {
  if (!currentRole) return false;
  if (task.role !== currentRole) return false;
  return task.status === "active";
}

if (taskScopes.length) {
  console.log(`OK: ${targetPath} is within active scope of task(s): ${taskScopes.join(", ")} for role ${checkRole}`);
  process.exit(0);
}

if (blockedTaskScopes.length) {
  if (!checkRole) {
    console.error(`DENIED: ROLE is required for project writes. Matching task scopes: ${blockedTaskScopes.join(", ")}`);
  } else {
    console.error(`DENIED: ${targetPath} matches task scope, but not an active task for role ${checkRole}.`);
    console.error(`  Matching task scopes: ${blockedTaskScopes.join(", ")}`);
    console.error("  Start the assigned task with transition-task.js and use the matching dev/test role before editing.");
  }
  process.exit(1);
}

if (allAllowedRepos.size > 0 && isWithin(workspaceRoot, resolvedTarget)) {
  const relPath = path.relative(workspaceRoot, resolvedTarget);
  const targetRepo = relPath.split(path.sep)[0];
  if (!allAllowedRepos.has(targetRepo)) {
    console.error(`DENIED: ${targetPath} references repo "${targetRepo}" which is not in the approved repos for this delivery.`);
    console.error(`  Approved repos: ${[...allAllowedRepos].join(", ")}`);
    console.error(`  Use one of these repos instead. Check read-context.js output for approved repos.`);
    process.exit(1);
  }
}

console.error(`DENIED: ${targetPath} is not within any active approved write scope for role ${checkRole || "unknown"}.`);
console.error(`  Your CWD appears to be: ${process.cwd()}`);
console.error(`  Resolved target: ${resolvedTarget}`);
console.error(`  Workspace root: ${workspaceRoot}`);
console.error(`  Agent output must go inside runs/${deliveryId || "<DELIVERY_ID>"}/ or an active task scope.`);
process.exit(1);
