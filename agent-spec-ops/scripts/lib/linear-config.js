"use strict";

const fs = require("fs");
const path = require("path");

function loadState(statePath) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(statePath), "utf8"));
  } catch {
    return null;
  }
}

function getLinearConfig(stateOrPath) {
  const state = typeof stateOrPath === "string" ? loadState(stateOrPath) : stateOrPath;

  const envKey = process.env.LINEAR_API_KEY || process.env.LINEAR_ACCESS_TOKEN || "";
  const savedKey = (state && state.linear_config && state.linear_config.api_key) || "";

  const apiKey = envKey || savedKey;
  const teamId = process.env.LINEAR_TEAM_ID || (state && state.linear_config && state.linear_config.team_id) || "";
  const projectId = process.env.LINEAR_PROJECT_ID || (state && state.linear_config && state.linear_config.project_id) || "";

  return { api_key: apiKey, team_id: teamId, project_id: projectId };
}

module.exports = { getLinearConfig };
