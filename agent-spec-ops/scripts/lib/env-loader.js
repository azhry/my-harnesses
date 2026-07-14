"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const DEFAULT_SECRET_FILES = [
  path.join(root, ".agent-spec-ops.secrets.env"),
  path.join(root, ".env.agent-spec-ops")
];

const SECRET_FILE_HEADER = [
  "# Agent Spec Ops run secrets.",
  "# This file is intentionally untracked. Do not copy values into workflow-state.json, logs, or docs."
].join("\n");

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

function readEnvFile(file) {
  const values = {};
  if (!file || !fs.existsSync(file)) {
    return values;
  }
  const contents = fs.readFileSync(file, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    values[match[1]] = unquote(match[2].trim());
  }
  return values;
}

function writeRunSecretEnv(stateFile, updates, options = {}) {
  const file = path.resolve(options.file || runSecretFile(stateFile));
  if (!file) {
    throw new Error("Cannot resolve run secret file");
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current = readEnvFile(file);
  for (const [key, value] of Object.entries(updates || {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid environment variable name: ${key}`);
    }
    if (value === undefined || value === null || String(value) === "") {
      continue;
    }
    current[key] = String(value);
  }
  const lines = [SECRET_FILE_HEADER, ""];
  for (const key of Object.keys(current).sort()) {
    lines.push(`${key}=${quoteEnvValue(current[key])}`);
  }
  fs.writeFileSync(file, `${lines.join("\n")}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Best-effort permissions on platforms that support chmod.
  }
  loadedFileSet.delete(file);
  loadSecretEnv(stateFile);
  return file;
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

function quoteEnvValue(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(text)) {
    return text;
  }
  return JSON.stringify(text);
}

module.exports = { loadSecretEnv, readEnvFile, runSecretFile, writeRunSecretEnv };
