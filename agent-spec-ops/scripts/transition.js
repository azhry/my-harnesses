#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { states, transitions, canTransition } = require("./lib/state-machine");
const { appendEvent } = require("./lib/memory-store");
const { checkContext, updateSessionMarker } = require("./lib/context-check");
const { getLinearConfig } = require("./lib/linear-config");
const { enforcePolicy } = require("./lib/policy");
const { loadSecretEnv } = require("./lib/env-loader");

const [file, nextState, ...noteParts] = process.argv.slice(2);
const note = noteParts.join(" ").trim();

if (!file || !nextState) {
  console.error("Usage: node scripts/transition.js path/to/workflow-state.json NEXT_STATE [NOTE]");
  process.exit(1);
}

if (!states.includes(nextState)) {
  console.error(`Invalid next state: ${nextState}`);
  console.error(`Allowed states: ${states.join(", ")}`);
  process.exit(1);
}

const statePath = path.resolve(file);
loadSecretEnv(statePath);
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const currentState = state.current_state;

if (!canTransition(currentState, nextState)) {
  const allowed = transitions[currentState] || [];
  console.error(`Illegal transition: ${currentState} -> ${nextState}`);
  console.error(`Allowed from ${currentState}: ${allowed.join(", ") || "(none)"}`);
  process.exit(1);
}

checkContext("transition.js");

const taskList = state.task_graph && Array.isArray(state.task_graph.tasks)
  ? state.task_graph.tasks
  : [];

const LANE_ROLE_MAP = {
  frontend_dev: "frontend",
  frontend_test: "frontend",
  backend_dev: "backend",
  backend_test: "backend",
  orchestrator: "integration"
};

const errors = [];

if (nextState === "integration_verification") {
  const devTasks = taskList.filter((t) =>
    ["frontend_dev", "frontend_test", "backend_dev", "backend_test"].includes(t.role)
  );
  const unverified = devTasks.filter((t) =>
    !["verified", "not_applicable", "waived"].includes(t.status)
  );
  if (unverified.length > 0) {
    const ids = unverified.map((t) => `${t.id} (${t.status})`).join(", ");
    errors.push(`Cannot transition to integration_verification: unverified tasks: ${ids}`);
  }

  if (errors.length === 0) {
    const verifyScript = path.join(__dirname, "verify-integration.js");
    if (fs.existsSync(verifyScript) && !process.env.SKIP_INTEGRATION_VERIFY) {
      try {
        execSync(`node "${verifyScript}" "${statePath}"`, {
          cwd: path.resolve(__dirname, ".."), encoding: "utf8", stdio: "pipe", timeout: 180000
        });
      } catch (e) {
        const output = (e.stdout || e.stderr || e.message || "").trim();
        errors.push(`Integration verification failed:\n${output}`);
      }
    }
  }
}

if (nextState === "frontend_verified") {
  const feTasks = taskList.filter((t) =>
    ["frontend_dev", "frontend_test"].includes(t.role)
  );
  const unverified = feTasks.filter((t) =>
    !["verified", "not_applicable", "waived"].includes(t.status)
  );
  if (unverified.length > 0) {
    const ids = unverified.map((t) => `${t.id} (${t.status})`).join(", ");
    errors.push(`Cannot transition to frontend_verified: unverified frontend tasks: ${ids}`);
  }
}

if (nextState === "backend_verified") {
  const beTasks = taskList.filter((t) =>
    ["backend_dev", "backend_test"].includes(t.role)
  );
  const unverified = beTasks.filter((t) =>
    !["verified", "not_applicable", "waived"].includes(t.status)
  );
  if (unverified.length > 0) {
    const ids = unverified.map((t) => `${t.id} (${t.status})`).join(", ");
    errors.push(`Cannot transition to backend_verified: unverified backend tasks: ${ids}`);
  }
}

if (nextState === "frontend_dev" && currentState === "implementation_in_progress") {
  const activeFeTasks = taskList.filter((t) =>
    LANE_ROLE_MAP[t.role] === "frontend" && t.status === "active"
  );
  if (activeFeTasks.length > 0) {
    errors.push(`Frontend lane already has active tasks: ${activeFeTasks.map((t) => t.id).join(", ")}`);
  }
}

if (nextState === "backend_dev" && currentState === "implementation_in_progress") {
  const activeBeTasks = taskList.filter((t) =>
    LANE_ROLE_MAP[t.role] === "backend" && t.status === "active"
  );
  if (activeBeTasks.length > 0) {
    errors.push(`Backend lane already has active tasks: ${activeBeTasks.map((t) => t.id).join(", ")}`);
  }
}

const GATES_WITH_INSTRUCTIONS = {
  waiting_for_tool_readiness_review: "tool_readiness_review",
  waiting_for_design_stitch: "design_stitch",
  waiting_for_product_review: "product_review",
  waiting_for_delivery_plan_review: "delivery_plan_review",
  waiting_for_final_review: "final_review"
};

const gateKey = GATES_WITH_INSTRUCTIONS[nextState];
if (gateKey) {
  const instructions = state.human_instructions && state.human_instructions[gateKey];
  if (!instructions || !instructions.instructions || !instructions.instructions.trim()) {
    errors.push(`Cannot transition to ${nextState}: human_instructions.${gateKey}.instructions is empty. Generate review instructions first using scripts/record-event.js with type=human_instruction.`);
  }
  if (!instructions || instructions.status !== "sent") {
    errors.push(`Cannot transition to ${nextState}: human_instructions.${gateKey}.status must be 'sent'. Use scripts/record-event.js to record that instructions were sent to the reviewer.`);
  }
}

// === HUMAN GATE APPROVAL ENFORCEMENT: prevent agent from self-approving ===
const GATE_APPROVAL_MAP = {
  waiting_for_tool_readiness_review: "tool_readiness_review",
  waiting_for_design_stitch: "design_stitch",
  waiting_for_product_review: "product_review",
  waiting_for_delivery_plan_review: "delivery_plan_review",
  waiting_for_final_review: "final_review"
};
const APPROVED_NEXT = {
  waiting_for_tool_readiness_review: "knowledge_discovery",
  tool_readiness_revision: "tool_readiness",
  waiting_for_design_stitch: "design_assembly",
  waiting_for_product_review: "product_approved",
  product_revision: "product_requirements",
  waiting_for_delivery_plan_review: "delivery_plan_approved",
  task_revision: "task_breakdown",
  waiting_for_final_review: "done"
};

// If transitioning FROM a human gate state TO its approved next state,
// require the gate to actually be approved by a human
if (GATE_APPROVAL_MAP[currentState] && APPROVED_NEXT[currentState] === nextState) {
  const gateName = GATE_APPROVAL_MAP[currentState];
  const gate = state.gates && state.gates[gateName];
  if (!gate || gate.status !== "approved") {
    errors.push(`Cannot transition from ${currentState} to ${nextState}: gate "${gateName}" is not approved. Status: ${gate ? gate.status : "not_found"}. You forgot to get human approval. Present the review to the human, wait for their approval, and update the state.`);
  }
  if (!gate || !gate.approver || gate.approver === "") {
    errors.push(`Cannot transition from ${currentState} to ${nextState}: gate "${gateName}" has no approver. You must explicitly set an approver when recording human approval.`);
  }
  if (!gate || !gate.decided_at) {
    errors.push(`Cannot transition from ${currentState} to ${nextState}: gate "${gateName}" has no decided_at timestamp. The human decision must be recorded with a timestamp.`);
  }
}

if (nextState === "waiting_for_final_review") {
  const integrityScript = path.join(__dirname, "check-harness-integrity.js");
  if (fs.existsSync(integrityScript) && !process.env.SKIP_INTEGRITY_CHECK) {
    try {
      execSync(`node "${integrityScript}" "${statePath}"`, {
        cwd: path.resolve(__dirname, ".."), encoding: "utf8", stdio: "pipe", timeout: 15000
      });
    } catch (e) {
      const output = (e.stdout || e.stderr || e.message || "").trim();
      errors.push(`Harness integrity check failed:\n${output}`);
    }
  }

  if (errors.length === 0 && !process.env.SKIP_DOCKER_VERIFY) {
    const verifyScript = path.join(__dirname, "verify-integration.js");
    if (fs.existsSync(verifyScript)) {
      try {
        execSync(`node "${verifyScript}" "${statePath}"`, {
          cwd: path.resolve(__dirname, ".."), encoding: "utf8", stdio: "pipe", timeout: 120000
        });
        console.log(`  Integration verification (docker compose): passed`);
      } catch (e) {
        const output = (e.stdout || e.stderr || e.message || "").trim();
        if (output.includes("No docker-compose file found") || output.includes("No repos defined")) {
          console.log(`  Integration verification: skipped (no docker compose)`);
        } else {
          errors.push(`Integration (docker compose) verification failed at final review:\n${output}`);
        }
      }
    }
  }
}

// === LINEAR ENFORCEMENT: tasks MUST have linear_ids before delivery plan review ===
if (currentState === "task_breakdown" && nextState === "waiting_for_delivery_plan_review") {
  const tasks = Array.isArray(state.task_graph && state.task_graph.tasks)
    ? state.task_graph.tasks : [];
  const tasksWithoutLinear = tasks.filter(t => !t.linear_id);
  if (tasksWithoutLinear.length > 0) {
    const ids = tasksWithoutLinear.map(t => t.id).join(", ");
    const linearCfg = getLinearConfig(state);
    if (linearCfg.api_key) {
      errors.push(`Tasks missing Linear IDs: ${ids}. Run "node scripts/sync-linear-task.js ${path.relative(process.cwd(), statePath).replace(/\\/g, "/")} --create" to create Linear issues, then retry.`);
    } else {
      errors.push(`Tasks missing Linear IDs: ${ids}. LINEAR_API_KEY is not configured. Either set the env var and run sync-linear-task.js --create, or set linear_id on each task manually before retrying.`);
    }
  }
}

try {
  enforcePolicy(statePath, { phase: "transition", nextState });
} catch (error) {
  errors.push(error.message);
}

if (errors.length) {
  console.error("Transition rejected:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

const now = new Date().toISOString();

if (currentState === "task_breakdown" && nextState === "waiting_for_delivery_plan_review") {
  if (Array.isArray(state.loops)) {
    const loopCount = state.loops.length;
    state.loops.push({
      name: `loop_${loopCount + 1}`,
      attempt: 1,
      max_attempts: state.agent_dispatch && state.agent_dispatch.max_attempts
        ? state.agent_dispatch.max_attempts : 3,
      last_failure: "",
      status: "planned"
    });
  }
}

if (nextState === "implementation_in_progress") {
  if (Array.isArray(state.loops)) {
    const activeLoop = state.loops.find((l) => l.status === "planned");
    if (activeLoop) {
      activeLoop.status = "active";
    } else {
      state.loops.push({
        name: `loop_${state.loops.length + 1}`,
        attempt: 1,
        max_attempts: state.agent_dispatch && state.agent_dispatch.max_attempts
          ? state.agent_dispatch.max_attempts : 3,
        last_failure: "",
        status: "active"
      });
    }
  }

  // Auto-create Linear issues for all planned tasks
  const linearCfg = getLinearConfig(state);
  if (linearCfg.api_key) {
    const syncScript = path.join(__dirname, "sync-linear-task.js");
    if (fs.existsSync(syncScript)) {
      try {
        execSync(`node "${syncScript}" "${statePath}" --create`, {
          cwd: path.resolve(__dirname, ".."), encoding: "utf8", stdio: "pipe", timeout: 60000
        });
        console.log(`  Auto-created Linear issues for planned tasks`);
      } catch (e) {
        const msg = (e.stdout || e.stderr || e.message || "").trim().slice(0, 200);
        console.warn(`  Linear issue creation had issues (non-blocking): ${msg}`);
      }
    }
  }
}

if (nextState === "done") {
  if (Array.isArray(state.loops)) {
    const activeLoop = state.loops.find((l) => l.status === "active");
    if (activeLoop) {
      activeLoop.status = "completed";
    }
  }
}

const runDir = path.dirname(statePath);
const tokenUsagePath = path.join(runDir, "token-usage.csv");
if (fs.existsSync(tokenUsagePath)) {
  const tokenLines = fs.readFileSync(tokenUsagePath, "utf8").split(/\r?\n/).filter((l) => l.trim());
  if (tokenLines.length <= 1) {
    console.warn("⚠  No token usage recorded yet. Run scripts/record-token-usage.js before this transition.");
  }
} else {
  console.warn("⚠  No token usage recorded yet. Run scripts/record-token-usage.js before this transition.");
}

if (nextState === "knowledge_improvement" || nextState === "waiting_for_final_review") {
  const linearCfg = getLinearConfig(state);
  const syncScript = path.join(__dirname, "sync-linear-knowledge.js");
  if (linearCfg.api_key && fs.existsSync(syncScript)) {
    try {
      execSync(`node "${syncScript}" "${statePath}"`, {
        cwd: path.resolve(__dirname, ".."),
        encoding: "utf8",
        stdio: "pipe",
        timeout: 20000
      });
    } catch (e) {
      console.warn(`  Knowledge sync to Linear had issues (non-blocking): ${(e.stderr || e.message || "").slice(0, 120)}`);
    }
  }
}

state.current_state = nextState;
state.delivery.updated_at = now;
state.log = state.log || [];
state.log.push({
  at: now,
  state: nextState,
  note: note || `Transitioned from ${currentState} to ${nextState}.`
});

fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
updateSessionMarker(statePath, {
  state: nextState,
  state_updated_at: state.delivery.updated_at
});
console.log(`OK: ${currentState} -> ${nextState}`);

appendEvent(statePath, {
  type: "state_transition",
  role_context: "orchestrator",
  task_id: "",
  target: nextState,
  summary: `State transition: ${currentState} -> ${nextState}`,
  details: note || "",
  severity: "info",
  tags: ["state_transition", currentState, nextState]
});
