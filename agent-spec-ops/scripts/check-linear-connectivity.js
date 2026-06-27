#!/usr/bin/env node
"use strict";

const https = require("https");
const { loadSecretEnv } = require("./lib/env-loader");

loadSecretEnv();

const LINEAR_API_KEY = process.env.LINEAR_API_KEY || process.env.LINEAR_ACCESS_TOKEN || "";

if (!LINEAR_API_KEY) {
  console.log("LINEAR_API_KEY not set.");
  console.log("Usage: export LINEAR_API_KEY=\"lin_api_...\" && node scripts/check-linear-connectivity.js");
  process.exit(1);
}

function graphql(query) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query });
    const req = https.request({
      hostname: "api.linear.app",
      path: "/graphql",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: LINEAR_API_KEY
      }
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => body += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`Parse error: ${e.message}. Body: ${body.slice(0, 200)}`)); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  console.log("Checking Linear API connectivity...\n");

  const viewerQuery = `query { viewer { id name } }`;
  const viewerResult = await graphql(viewerQuery);
  if (viewerResult.errors) {
    console.error(`API Error: ${viewerResult.errors[0].message}`);
    console.error("Check that your LINEAR_API_KEY is valid and not expired.");
    process.exit(1);
  }
  const viewer = viewerResult.data && viewerResult.data.viewer;
  if (viewer) {
    console.log(`Authenticated as: ${viewer.name} (${viewer.id})`);
  }

  const teamsQuery = `query { teams { nodes { id name key } } }`;
  const teamsResult = await graphql(teamsQuery);
  if (teamsResult.errors) {
    console.error(`API Error fetching teams: ${teamsResult.errors[0].message}`);
    process.exit(1);
  }
  const teams = teamsResult.data && teamsResult.data.teams && teamsResult.data.teams.nodes;
  if (teams && teams.length > 0) {
    console.log(`\nTeams (${teams.length}):`);
    for (const t of teams) {
      const isSet = process.env.LINEAR_TEAM_ID === t.id;
      console.log(`  ${isSet ? "✓" : " "} ${t.name} (${t.key}): ${t.id}${isSet ? " ← LINEAR_TEAM_ID" : ""}`);
    }
  } else {
    console.log("\nNo teams found. Check your API key permissions.");
  }

  const projQuery = `query { projects { nodes { id name } } }`;
  const projResult = await graphql(projQuery);
  const projects = projResult.data && projResult.data.projects && projResult.data.projects.nodes;
  if (projects && projects.length > 0) {
    console.log(`\nProjects (${projects.length}):`);
    for (const p of projects) {
      const isSet = process.env.LINEAR_PROJECT_ID === p.id;
      console.log(`  ${isSet ? "✓" : " "} ${p.name}: ${p.id}${isSet ? " ← LINEAR_PROJECT_ID" : ""}`);
    }
  } else {
    console.log("\nNo projects found.");
  }

  if (process.env.LINEAR_TEAM_ID) {
    const stateQuery = `query { team(id: "${process.env.LINEAR_TEAM_ID}") { states { nodes { id name type } } } }`;
    const stateResult = await graphql(stateQuery);
    const states = stateResult.data && stateResult.data.team && stateResult.data.team.states && stateResult.data.team.states.nodes;
    if (states && states.length > 0) {
      console.log(`\nWorkflow states for team:`);
      for (const s of states) {
        console.log(`  ${s.type.padEnd(12)} ${s.name.padEnd(20)} ${s.id}`);
      }
    }
  }

  console.log("\nDone. Set these env vars for the harness:");
  console.log(`  LINEAR_API_KEY    (set: ${!!LINEAR_API_KEY})`);
  console.log(`  LINEAR_TEAM_ID    (set: ${!!process.env.LINEAR_TEAM_ID})`);
  console.log(`  LINEAR_PROJECT_ID (set: ${!!process.env.LINEAR_PROJECT_ID})`);
})().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
