#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, required } = require("../src/args");

const args = parseArgs(process.argv.slice(2));
const inbox = path.resolve(required(args, "inbox"));
const payload = JSON.parse(fs.readFileSync(path.resolve(required(args, "payloadFile")), "utf8"));
fs.mkdirSync(inbox, { recursive: true });
const envelope = {
  id: crypto.randomUUID(),
  submitted_at: new Date().toISOString(),
  task_id: required(args, "task"),
  role: required(args, "role"),
  attempt: Number(required(args, "attempt")),
  capability_token: required(args, "token"),
  type: required(args, "type"),
  payload
};
const file = path.join(inbox, `${Date.now()}-${envelope.id}.json`);
const temporary = `${file}.${process.pid}.tmp`;
const descriptor = fs.openSync(temporary, "wx", 0o600);
fs.writeFileSync(descriptor, `${JSON.stringify(envelope, null, 2)}\n`);
fs.fsyncSync(descriptor);
fs.closeSync(descriptor);
fs.renameSync(temporary, file);
console.log(file);
