#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const args = parseArgs(process.argv.slice(2));

if (!args.stateFile) {
  console.error("Usage: node scripts/read-instructions.js runs/<DELIVERY_ID>/workflow-state.json --role <ROLE> [--full]");
  process.exit(1);
}

const root = path.resolve(__dirname, "..");
const state = JSON.parse(fs.readFileSync(path.resolve(args.stateFile), "utf8"));
const role = args.role || inferRole(state);

console.log("\n============================================================");
console.log("  COMPACT INSTRUCTIONS");
console.log("============================================================\n");
console.log(fs.readFileSync(path.join(root, "docs", "agent-boot.md"), "utf8"));

console.log("\n------------------------------------------------------------");
console.log(`  CURRENT STATE: ${state.current_state}`);
console.log("------------------------------------------------------------");
console.log(stateAdvice(state.current_state));

if (role) {
  console.log("\n------------------------------------------------------------");
  console.log(`  ROLE: ${role}`);
  console.log("------------------------------------------------------------");
  const roleFile = path.join(root, "docs", `role-${role}.md`);
  if (fs.existsSync(roleFile)) {
    const content = fs.readFileSync(roleFile, "utf8");
    console.log(args.full ? content : compactMarkdown(content));
  } else {
    console.log(`No role file found: docs/role-${role}.md`);
  }
}

console.log("\n============================================================");
console.log("  Instruction packet complete. Load detailed docs only when needed.");
console.log("============================================================\n");

function stateAdvice(stateName) {
  const map = {
    intake: "Normalize delivery metadata, then transition to tool_readiness.",
    tool_readiness: "Run check-tool-readiness.js. Policy requires Linear for task and knowledge systems of record.",
    waiting_for_tool_readiness_review: "Stop for human approval. Do not proceed until the gate is approved.",
    knowledge_discovery: "Record sourced findings/gaps. Do not invent requirements.",
    product_requirements: "Create product requirements artifact under the run directory.",
    ui_design_prompt: "Create the Stitch prompt and prepare the design gate.",
    waiting_for_design_stitch: "Stop for human Stitch/design input.",
    design_assembly: "Fetch/save design assets; do not treat fetch errors as evidence.",
    system_rules: "Record UI/system behavior rules derived from approved product/design artifacts.",
    waiting_for_product_review: "Stop for human product review.",
    task_breakdown: "Create executable tasks with scope, DoD, expected changes, verification, dependencies, and Linear IDs.",
    waiting_for_delivery_plan_review: "Stop for human delivery-plan approval.",
    delivery_plan_approved: "Dispatch work. Use Linear as task system of record.",
    implementation_in_progress: "Activate one dependency-ready task per lane. WIP=1.",
    frontend_dev: "Implement only approved frontend task scope. Use submit-task.js when ready.",
    frontend_test: "Run/record tests. Return failed tasks to dev with evidence.",
    backend_dev: "Implement only approved backend task scope. Use submit-task.js when ready.",
    backend_test: "Run/record tests. Return failed tasks to dev with evidence.",
    integration_verification: "Run contract, scope, and integration checks. Then sync knowledge.",
    knowledge_improvement: "Promote reusable knowledge and sync it to Linear before final review.",
    waiting_for_final_review: "Stop for human final review.",
    done: "Delivery is closed. Keep state compact and handoff available.",
    blocked: "Do not proceed until blocker owner/action is clear."
  };
  return map[stateName] || "Read docs/state-transitions.md for this state.";
}

function compactMarkdown(content) {
  return content
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.startsWith("#") ||
        trimmed.startsWith("-") ||
        trimmed.startsWith("node ") ||
        trimmed.startsWith("```");
    })
    .slice(0, 80)
    .join("\n");
}

function inferRole(state) {
  const roleEntries = Object.entries(state.roles || {});
  const active = roleEntries.find(([, value]) => value && value.status === "in_progress");
  return active ? active[0] : "orchestrator";
}

function parseArgs(rawArgs) {
  const parsed = { stateFile: "", role: "", full: false };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--") && !parsed.stateFile) {
      parsed.stateFile = arg;
      continue;
    }
    switch (arg) {
      case "--role":
        parsed.role = rawArgs[++index] || "";
        break;
      case "--full":
        parsed.full = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}
