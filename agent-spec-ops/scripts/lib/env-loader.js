"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const DEFAULT_SECRET_FILES = [
  path.join(root, ".agent-spec-ops.secrets.env"),
  path.join(root, ".env.agent-spec-ops")
];

let loadedFiles = [];
const loadedFileSet = new Set();

function loadSecretEnv(stateFile) {
  const candidates = [
    process.env.AGENT_SPEC_OPS_SECRETS_FILE || "",
    runSecretFile(stateFile),
    ...DEFAULT_SECRET_FILES
  ].filter(Boolean);

  for (const file of candidates) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved) || loadedFileSet.has(resolved)) {
      continue;
    }
    const contents = fs.readFileSync(resolved, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) {
        continue;
      }
      const key = match[1];
      const value = unquote(match[2].trim());
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
    loadedFiles.push(resolved);
    loadedFileSet.add(resolved);
  }

  return loadedFiles;
}

function runSecretFile(stateFile) {
  if (!stateFile) {
    return "";
  }
  const resolved = path.resolve(stateFile);
  const basename = path.basename(resolved);
  const runDir = basename === "workflow-state.json" ? path.dirname(resolved) : resolved;
  return path.join(runDir, ".agent-spec-ops.secrets.env");
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

module.exports = { loadSecretEnv, runSecretFile };
