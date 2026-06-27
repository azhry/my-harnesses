"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const DEFAULT_SECRET_FILES = [
  path.join(root, ".agent-spec-ops.secrets.env"),
  path.join(root, ".env.agent-spec-ops")
];

let loaded = false;
let loadedFiles = [];

function loadSecretEnv() {
  if (loaded) {
    return loadedFiles;
  }
  loaded = true;

  const candidates = [
    process.env.AGENT_SPEC_OPS_SECRETS_FILE || "",
    ...DEFAULT_SECRET_FILES
  ].filter(Boolean);

  for (const file of candidates) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) {
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
  }

  return loadedFiles;
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

module.exports = { loadSecretEnv };
