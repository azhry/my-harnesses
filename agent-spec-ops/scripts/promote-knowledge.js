#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  appendEvent,
  ensureGlobalMemory,
  ensureRunMemory,
  listJsonFiles,
  loadJson,
  nowIso,
  root,
  writeJson
} = require("./lib/memory-store");

const [stateFile, cardRef, ...rest] = process.argv.slice(2);
const status = readOption(rest, "--status") || "active";

if (!stateFile || !cardRef) {
  console.error("Usage: node scripts/promote-knowledge.js runs/<DELIVERY_ID>/workflow-state.json CARD_ID_OR_PATH [--status active|promoted]");
  process.exit(1);
}

if (!["active", "promoted"].includes(status)) {
  console.error("--status must be active or promoted");
  process.exit(1);
}

const { runDir } = ensureRunMemory(stateFile);
ensureGlobalMemory();

const sourceFile = findCard(runDir, cardRef);
if (!sourceFile) {
  console.error(`Could not find knowledge card: ${cardRef}`);
  process.exit(1);
}

const card = loadJson(sourceFile);
const at = nowIso();
card.status = status;
card.updated_at = at;
card.promoted_at = card.promoted_at || at;

const targetDir = path.join(root, "knowledge", "cards", card.kind);
const targetFile = path.join(targetDir, `${card.id}.json`);
writeJson(targetFile, card);

appendEvent(stateFile, {
  type: "knowledge_promoted",
  role_context: "orchestrator",
  summary: `Knowledge promoted: ${card.id}`,
  details: card.statement,
  tags: card.applies_to && card.applies_to.tags ? card.applies_to.tags : [],
  evidence: [path.relative(root, targetFile)]
});

console.log(`Promoted ${card.id} to ${status}`);
console.log(`Wrote ${path.relative(root, targetFile)}`);

function findCard(runDir, ref) {
  const direct = path.resolve(ref);
  if (fs.existsSync(direct)) {
    return direct;
  }
  const relative = path.resolve(runDir, ref);
  if (fs.existsSync(relative)) {
    return relative;
  }
  return listJsonFiles(path.join(runDir, "knowledge"))
    .find((file) => {
      const card = loadJson(file);
      return card && card.id === ref;
    });
}

function readOption(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? "" : args[index + 1] || "";
}
