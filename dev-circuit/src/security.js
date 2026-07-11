"use strict";

function workerEnv(source = process.env) {
  const allowed = new Set(["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TMPDIR"]);
  for (const name of String(source.DEVCIRCUIT_WORKER_ENV_ALLOW || "").split(",").map((item) => item.trim()).filter(Boolean)) allowed.add(name);
  const result = Object.fromEntries([...allowed].filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
  result.DEVCIRCUIT_WORKER = "1";
  return result;
}

module.exports = { workerEnv };
