#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const crypto = require("crypto");

const file = process.argv[2];

if (!file) {
  console.error("Usage: node scripts/check-harness-integrity.js path/to/workflow-state.json");
  console.error("Checks that no protected harness files have been modified or added by agents.");
  process.exit(1);
}

const statePath = path.resolve(file);
const harnessRoot = path.resolve(__dirname, "..");

const PROTECTED_PATTERNS = [
  { dir: "scripts", label: "scripts/", mode: "strict" },
  { dir: "tests", label: "tests/", mode: "strict" },
  { dir: "ui", label: "ui/", mode: "strict" },
  { dir: "templates", label: "templates/", mode: "strict" },
  { dir: "schemas", label: "schemas/", mode: "strict" },
  { dir: "docs", label: "docs/", mode: "strict" },
];

const PROTECTED_FILES = [
  "AGENTS.md",
  "package.json",
  "harness.yaml",
  "README.md",
  ".gitignore",
];

const BASELINE_FILE = path.join(harnessRoot, ".harness-baseline.json");

function computeHash(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function walkDir(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function isGitRepo(dir) {
  try {
    execSync("git rev-parse --git-dir", { cwd: dir, encoding: "utf8", stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function getGitStatus(dir) {
  try {
    const output = execSync("git status --porcelain", {
      cwd: dir, encoding: "utf8", stdio: "pipe", timeout: 10000
    });
    return output.split(/\r?\n/).filter(l => l.trim());
  } catch {
    return [];
  }
}

const violations = [];

if (isGitRepo(harnessRoot)) {
  const statusLines = getGitStatus(harnessRoot);

  for (const line of statusLines) {
    const status = line.slice(0, 2).trim();
    const filePath = line.slice(3).trim();
    const absPath = path.resolve(harnessRoot, filePath);

    let isProtected = PROTECTED_FILES.includes(filePath);
    if (!isProtected) {
      for (const p of PROTECTED_PATTERNS) {
        const patternDir = path.join(harnessRoot, p.dir);
        if (absPath.startsWith(patternDir + path.sep) || absPath === patternDir) {
          isProtected = true;
          break;
        }
      }
    }

    if (isProtected) {
      const label = status === "??" ? "untracked" : "modified";
      violations.push(`${filePath} (${label})`);
    }
  }
} else {
  const baseline = {};
  if (fs.existsSync(BASELINE_FILE)) {
    try {
      Object.assign(baseline, JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8")));
    } catch {
      console.warn("  Corrupt .harness-baseline.json — regenerating");
    }
  }

  if (Object.keys(baseline).length === 0) {
    const allFiles = [];
    for (const p of PROTECTED_PATTERNS) {
      allFiles.push(...walkDir(path.join(harnessRoot, p.dir)));
    }
    for (const f of PROTECTED_FILES) {
      const fp = path.join(harnessRoot, f);
      if (fs.existsSync(fp)) allFiles.push(fp);
    }
    for (const fp of allFiles) {
      const relPath = path.relative(harnessRoot, fp);
      const hash = computeHash(fp);
      if (hash) baseline[relPath] = hash;
    }
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + "\n");
    console.log("  Harness baseline created at .harness-baseline.json");
  } else {
    for (const [relPath, expectedHash] of Object.entries(baseline)) {
      const absPath = path.join(harnessRoot, relPath);
      const currentHash = computeHash(absPath);
      if (currentHash && currentHash !== expectedHash) {
        violations.push(`${relPath} (hash mismatch)`);
      }
    }
    for (const p of PROTECTED_PATTERNS) {
      const dirFiles = walkDir(path.join(harnessRoot, p.dir));
      for (const fp of dirFiles) {
        const relPath = path.relative(harnessRoot, fp);
        if (!(relPath in baseline)) {
          violations.push(`${relPath} (untracked in protected dir)`);
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error("\n  Harness integrity violations detected:");
  for (const v of violations) {
    console.error(`    ✗ ${v}`);
  }
  console.error("\n  Protected harness files were modified outside of orchestrator scope.");
  console.error("  Only the orchestrator role may modify scripts/, tests/, ui/, templates/, etc.");
  console.error("  Reset changes or route through orchestrator to proceed.");
  process.exit(1);
} else {
  console.log("  Harness integrity: clean (no protected files modified)");
  process.exit(0);
}
