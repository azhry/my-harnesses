#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { readEnvFile, runSecretFile, writeRunSecretEnv } = require("./lib/env-loader");

const ALLOWED_KEYS = new Set([
  "LINEAR_API_KEY",
  "LINEAR_ACCESS_TOKEN",
  "LINEAR_TEAM_ID",
  "LINEAR_PROJECT_ID",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GITLAB_TOKEN",
  "GITLAB_PAT",
  "GRAB_GITLAB_ACCESS_TOKEN",
  "ATLASSIAN_API_TOKEN",
  "ATLASSIAN_EMAIL",
  "ATLASSIAN_BASE_URL",
  "ATLASSIAN_SITE_URL",
  "GOOGLE_STITCH_API_KEY"
]);

const args = parseArgs(process.argv.slice(2));

if (args.errors.length || !args.stateFile) {
  console.error([
    "Usage: node scripts/record-run-secrets.js runs/<DELIVERY_ID>/workflow-state.json [options]",
    "",
    "Options:",
    "  --set NAME=VALUE       Write one allowed env var to the run secret file",
    "  --from-env NAME        Copy one allowed env var from the current process env",
    "  --list                Show which allowed keys are present, without values",
    "",
    "Secrets are written to runs/<DELIVERY_ID>/.agent-spec-ops.secrets.env with mode 0600.",
    "Never put raw tokens in workflow-state.json, events.ndjson, logs, or docs."
  ].join("\n"));
  for (const error of args.errors) console.error(`- ${error}`);
  process.exit(1);
}

const statePath = path.resolve(args.stateFile);
if (!fs.existsSync(statePath)) {
  console.error(`State file not found: ${statePath}`);
  process.exit(1);
}

const file = runSecretFile(statePath);

if (args.list) {
  const values = readEnvFile(file);
  console.log(`Run secret file: ${file}`);
  for (const key of [...ALLOWED_KEYS].sort()) {
    console.log(`${key}: ${values[key] ? "present" : "missing"}`);
  }
  process.exit(0);
}

const updates = {};
for (const [key, value] of args.sets) {
  updates[key] = value;
}
for (const key of args.fromEnv) {
  const value = process.env[key] || "";
  if (!value) {
    console.error(`${key} is not set in the current environment`);
    process.exit(1);
  }
  updates[key] = value;
}

if (!Object.keys(updates).length) {
  console.error("No secrets provided. Use --set NAME=VALUE, --from-env NAME, or --list.");
  process.exit(1);
}

const written = writeRunSecretEnv(statePath, updates);
console.log(`Updated run secret file: ${written}`);
for (const key of Object.keys(updates).sort()) {
  console.log(`${key}: present`);
}

function parseArgs(raw) {
  const parsed = { stateFile: "", sets: [], fromEnv: [], list: false, errors: [] };
  for (let index = 0; index < raw.length; index += 1) {
    const arg = raw[index];
    if (!arg.startsWith("--") && !parsed.stateFile) {
      parsed.stateFile = arg;
      continue;
    }
    if (arg === "--set") {
      const pair = raw[++index] || "";
      const eq = pair.indexOf("=");
      if (eq <= 0) {
        parsed.errors.push("--set expects NAME=VALUE");
        continue;
      }
      const key = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      validateKey(key, parsed.errors);
      parsed.sets.push([key, value]);
      continue;
    }
    if (arg === "--from-env") {
      const key = raw[++index] || "";
      validateKey(key, parsed.errors);
      parsed.fromEnv.push(key);
      continue;
    }
    if (arg === "--list") {
      parsed.list = true;
      continue;
    }
    parsed.errors.push(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function validateKey(key, errors) {
  if (!ALLOWED_KEYS.has(key)) {
    errors.push(`Unsupported secret key: ${key}`);
  }
}
