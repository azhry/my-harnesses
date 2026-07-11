#!/usr/bin/env node
"use strict";

const { execute } = require("../src/cli");

execute(process.argv.slice(2)).then((result) => {
  if (result && result.output) console.log(result.output);
}).catch((error) => {
  console.error(`DevCircuit failed: ${error.message}`);
  process.exitCode = 1;
});
