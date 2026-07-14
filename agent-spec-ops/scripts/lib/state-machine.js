"use strict";

const states = [
  "intake",
  "tool_readiness",
  "knowledge_discovery",
  "product_requirements",
  "product_review",
  "design_assembly",
  "system_rules",
  "system_rules_review",
  "task_breakdown",
  "implementation_in_progress",
  "implementation_review",
  "done",
  "blocked"
];

const transitions = {
  intake: ["tool_readiness", "blocked"],
  tool_readiness: ["knowledge_discovery", "blocked"],
  knowledge_discovery: ["product_requirements", "blocked"],
  product_requirements: ["product_review", "blocked"],
  product_review: ["design_assembly", "knowledge_discovery", "blocked"],
  design_assembly: ["system_rules", "blocked"],
  system_rules: ["system_rules_review", "blocked"],
  system_rules_review: ["task_breakdown", "design_assembly", "blocked"],
  task_breakdown: ["implementation_in_progress", "blocked"],
  implementation_in_progress: ["implementation_review", "task_breakdown", "blocked"],
  implementation_review: ["done", "implementation_in_progress", "task_breakdown", "blocked"],
  done: ["task_breakdown"],
  blocked: ["intake", "tool_readiness", "knowledge_discovery", "product_requirements", "task_breakdown", "implementation_in_progress"]
};

const roleNames = [
  "product_manager",
  "project_manager",
  "frontend_dev",
  "frontend_test",
  "backend_dev",
  "backend_test",
  "orchestrator"
];

const roleStatuses = [
  "not_started",
  "in_progress",
  "waiting_review",
  "approved",
  "needs_revision",
  "verified",
  "blocked",
  "complete"
];

const knowledgeBuckets = [
  "product_knowledge",
  "design_knowledge",
  "system_knowledge",
  "repository_knowledge",
  "verification_knowledge"
];

const taskStatuses = [
  "planned",
  "active",
  "implemented",
  "testing",
  "failed",
  "verified",
  "blocked",
  "waived",
  "not_applicable"
];

const gateStatuses = [
  "not_ready",
  "ready",
  "waiting",
  "approved",
  "requested_changes",
  "blocked"
];

const loopStatuses = [
  "not_started",
  "in_progress",
  "passed",
  "failed",
  "blocked",
  "waived",
  "completed"
];

function canTransition(from, to) {
  return Array.isArray(transitions[from]) && transitions[from].includes(to);
}

module.exports = {
  states,
  transitions,
  roleNames,
  roleStatuses,
  knowledgeBuckets,
  taskStatuses,
  gateStatuses,
  loopStatuses,
  canTransition
};
