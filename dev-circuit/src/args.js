"use strict";

function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith("--")) {
      result._.push(value);
      continue;
    }
    const key = value.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) result[key] = true;
    else {
      result[key] = next;
      i += 1;
    }
  }
  return result;
}

function required(args, name) {
  if (args[name] === undefined || args[name] === "") throw new Error(`Missing --${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
  return args[name];
}

module.exports = { parseArgs, required };
