"use strict";

const fs = require("fs");
const path = require("path");
const { loadSecretEnv } = require("./env-loader");

function loadState(statePath) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(statePath), "utf8"));
  } catch {
    return null;
  }
}

function getLinearConfig(stateOrPath) {
  loadSecretEnv();
  const state = typeof stateOrPath === "string" ? loadState(stateOrPath) : stateOrPath;

  const envKey = process.env.LINEAR_API_KEY || process.env.LINEAR_ACCESS_TOKEN || "";

  const apiKey = envKey;
  const teamId = process.env.LINEAR_TEAM_ID || (state && state.linear_config && state.linear_config.team_id) || "";
  const projectId = process.env.LINEAR_PROJECT_ID || (state && state.linear_config && state.linear_config.project_id) || "";

  return { api_key: apiKey, team_id: teamId, project_id: projectId };
}

function fingerprintSecret(value) {
  if (!value) {
    return "";
  }
  if (value.length <= 12) {
    return "***";
  }
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function linearMetadataFromEnv() {
  loadSecretEnv();
  const apiKey = process.env.LINEAR_API_KEY || process.env.LINEAR_ACCESS_TOKEN || "";
  return {
    provider: "linear",
    api_key_present: Boolean(apiKey),
    api_key_fingerprint: fingerprintSecret(apiKey),
    team_id: process.env.LINEAR_TEAM_ID || "",
    project_id: process.env.LINEAR_PROJECT_ID || "",
    last_verified_at: ""
  };
}

module.exports = { fingerprintSecret, getLinearConfig, linearMetadataFromEnv };
