#!/usr/bin/env node
"use strict";

const { enforcePolicy } = require("./lib/policy");

const [stateFile, phase = "manual"] = process.argv.slice(2);

if (!stateFile) {
  console.error("Usage: node scripts/enforce-policy.js runs/<DELIVERY_ID>/workflow-state.json [phase]");
  process.exit(1);
}

try {
  enforcePolicy(stateFile, { phase });
  console.log(`OK: policy passed for ${stateFile}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
