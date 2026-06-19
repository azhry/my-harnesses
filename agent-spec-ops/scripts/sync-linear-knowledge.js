#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { appendEvent, loadKnowledgeCards } = require("./lib/memory-store");

const args = parseArgs(process.argv.slice(2));

if (!args.stateFile) {
  console.error([
    "Usage: node scripts/sync-linear-knowledge.js runs/<DELIVERY_ID>/workflow-state.json [options]",
    "",
    "Options:",
    "  --status STATUS    Sync only cards with this status (active, promoted, candidate)",
    "  --dry-run          Show what would be synced without making changes"
  ].join("\n"));
  process.exit(1);
}

const LINEAR_API_KEY = process.env.LINEAR_API_KEY || process.env.LINEAR_ACCESS_TOKEN || "";
const GRAPHQL_URL = "https://api.linear.app/graphql";

if (!LINEAR_API_KEY) {
  console.log("LINEAR_API_KEY not set — Linear sync skipped");
  process.exit(0);
}

const statePath = path.resolve(args.stateFile);
const runDir = path.dirname(statePath);
const deliveryId = path.basename(runDir);

// Load knowledge cards from both project-wide and run-specific directories
const cards = loadKnowledgeCards(runDir);
const allowedStatuses = args.status ? [args.status] : ["active", "promoted"];
const targetCards = cards.filter(({ card }) => allowedStatuses.includes(card.status) && card.status !== "deprecated");

if (!targetCards.length) {
  console.log("No knowledge cards to sync");
  process.exit(0);
}

let synced = 0;
let errors = 0;

// Find or create a Linear document for the delivery run
const docTitle = `Knowledge — ${deliveryId}`;
let docId = "";

// Try to find existing document
const searchQuery = {
  query: `{ documents(filter: { title: { eq: "${docTitle}" } }) { nodes { id } } }`
};

try {
  const searchResult = awaitQuery(searchQuery);
  if (searchResult.data && searchResult.data.documents && searchResult.data.documents.nodes && searchResult.data.documents.nodes.length) {
    docId = searchResult.data.documents.nodes[0].id;
  }
} catch {
  // Search failed, will try to create
}

const cardsMarkdown = targetCards.map(({ card }) => {
  return [
    `### ${card.statement}`,
    ``,
    `- **Kind:** ${card.kind}`,
    `- **Status:** ${card.status}`,
    `- **Confidence:** ${card.confidence}`,
    `- **Rationale:** ${card.rationale || "—"}`,
    ``,
    `**Applies to:**`,
    card.applies_to && card.applies_to.roles && card.applies_to.roles.length ? `- Roles: ${card.applies_to.roles.join(", ")}` : "",
    card.applies_to && card.applies_to.repos && card.applies_to.repos.length ? `- Repos: ${card.applies_to.repos.join(", ")}` : "",
    card.applies_to && card.applies_to.tasks && card.applies_to.tasks.length ? `- Tasks: ${card.applies_to.tasks.join(", ")}` : "",
    ``,
    card.evidence && card.evidence.length ? `**Evidence:**\n${card.evidence.map((e) => `- ${e}`).join("\n")}` : "",
    `---`,
    ``
  ].filter(Boolean).join("\n");
}).join("\n");

const fullContent = [
  `# ${docTitle}`,
  ``,
  `> Auto-synced from agent-spec-ops knowledge store.`,
  `> **Delivery:** ${deliveryId}`,
  `> **Cards:** ${targetCards.length}`,
  `> **Synced at:** ${new Date().toISOString()}`,
  ``,
  cardsMarkdown
].join("\n");

if (docId) {
  // Update existing document
  const mutation = {
    query: `mutation { documentUpdate(id: "${docId}", input: { title: ${JSON.stringify(docTitle)}, content: ${JSON.stringify(fullContent)} }) { success } }`
  };
  if (args.dryRun) {
    console.log(`[DRY RUN] Would update Linear document ${docId}: ${docTitle}`);
  } else {
    try {
      const result = awaitQuery(mutation);
      if (result.errors) {
        console.error(`Linear API error updating document: ${result.errors[0].message}`);
        errors++;
      } else {
        console.log(`Updated Linear document ${docId}: ${docTitle}`);
        synced++;
      }
    } catch (err) {
      console.error(`Failed to update Linear document: ${err.message}`);
      errors++;
    }
  }
} else {
  // Create new document
  const mutation = {
    query: `mutation { documentCreate(input: { title: ${JSON.stringify(docTitle)}, content: ${JSON.stringify(fullContent)} }) { success document { id } } }`
  };
  if (args.dryRun) {
    console.log(`[DRY RUN] Would create Linear document: ${docTitle}`);
  } else {
    try {
      const result = awaitQuery(mutation);
      if (result.errors) {
        console.error(`Linear API error creating document: ${result.errors[0].message}`);
        errors++;
      } else {
        docId = result.data && result.data.documentCreate && result.data.documentCreate.document ? result.data.documentCreate.document.id : "";
        console.log(`Created Linear document ${docId}: ${docTitle}`);
        synced++;
      }
    } catch (err) {
      console.error(`Failed to create Linear document: ${err.message}`);
      errors++;
    }
  }
}

appendEvent(statePath, {
  type: "linear_sync",
  role_context: "orchestrator",
  task_id: "",
  target: "linear_knowledge",
  summary: `Synced ${targetCards.length} knowledge cards to Linear${docId ? ` (doc: ${docId})` : ""}`,
  details: `${synced} documents synced, ${errors} errors`,
  severity: errors ? "warning" : "info",
  tags: ["linear", "knowledge", deliveryId]
});

console.log(`\nDone: ${synced} synced, ${errors} errors`);

function awaitQuery(body) {
  const url = new URL(GRAPHQL_URL);
  return new Promise((resolve, reject) => {
    const http = url.protocol === "https:" ? require("https") : require("http");
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LINEAR_API_KEY}`
      }
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}. Response: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function parseArgs(rawArgs) {
  const parsed = { stateFile: "", status: "", dryRun: false };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--") && !parsed.stateFile) {
      parsed.stateFile = arg;
      continue;
    }
    switch (arg) {
      case "--status": parsed.status = rawArgs[++index]; break;
      case "--dry-run": parsed.dryRun = true; break;
    }
  }
  return parsed;
}
