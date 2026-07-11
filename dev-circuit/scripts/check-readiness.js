#!/usr/bin/env node
"use strict";

const { parseArgs } = require("../src/args");
const { readiness } = require("../src/readiness");

const args = parseArgs(process.argv.slice(2));
readiness({ repo: args.repo, githubRepository: args.githubRepository, baseBranch: args.baseBranch, linearTeamId: args.linearTeamId, remote: !args.localOnly }).then((report) => {
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`DevCircuit readiness: ${report.ready ? "READY" : "BLOCKED"}`);
    for (const check of report.checks) console.log(`${check.status === "ready" ? "[ok]" : check.required ? "[BLOCK]" : "[optional]"} ${check.id}: ${check.detail}\n  owner=${check.installation_owner}; ${check.fix}`);
  }
  if (!report.ready) process.exitCode = 1;
}).catch((error) => {
  console.error(`Readiness failed: ${error.message}`);
  process.exitCode = 1;
});
