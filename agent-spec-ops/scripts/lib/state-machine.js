"use strict";

const states = [
  "intake",
  "tool_readiness",
  "waiting_for_tool_readiness_review",
  "tool_readiness_revision",
  "knowledge_discovery",
  "product_requirements",
  "ui_design_prompt",
  "waiting_for_design_stitch",
  "design_assembly",
  "system_rules",
  "waiting_for_product_review",
  "product_revision",
  "product_approved",
  "task_breakdown",
  "waiting_for_delivery_plan_review",
  "task_revision",
  "delivery_plan_approved",
  "implementation_in_progress",
  "frontend_dev",
  "frontend_test",
  "frontend_verified",
  "backend_dev",
  "backend_test",
  "backend_verified",
  "integration_verification",
  "waiting_for_final_review",
  "done",
  "blocked"
];

const transitions = {
  intake: ["tool_readiness", "blocked"],
  tool_readiness: ["waiting_for_tool_readiness_review", "blocked"],
  waiting_for_tool_readiness_review: ["knowledge_discovery", "tool_readiness_revision", "blocked"],
  tool_readiness_revision: ["tool_readiness", "blocked"],
  knowledge_discovery: ["product_requirements", "blocked"],
  product_requirements: ["ui_design_prompt", "blocked"],
  ui_design_prompt: ["waiting_for_design_stitch", "blocked"],
  waiting_for_design_stitch: ["design_assembly", "blocked"],
  design_assembly: ["system_rules", "blocked"],
  system_rules: ["waiting_for_product_review", "blocked"],
  waiting_for_product_review: ["product_approved", "product_revision", "blocked"],
  product_revision: ["product_requirements", "blocked"],
  product_approved: ["task_breakdown", "blocked"],
  task_breakdown: ["waiting_for_delivery_plan_review", "blocked"],
  waiting_for_delivery_plan_review: ["delivery_plan_approved", "task_revision", "blocked"],
  task_revision: ["task_breakdown", "blocked"],
  delivery_plan_approved: ["implementation_in_progress", "blocked"],
  implementation_in_progress: ["frontend_dev", "backend_dev", "integration_verification", "blocked"],
  frontend_dev: ["frontend_test", "implementation_in_progress", "blocked"],
  frontend_test: ["frontend_dev", "frontend_verified", "blocked"],
  frontend_verified: ["implementation_in_progress", "integration_verification", "blocked"],
  backend_dev: ["backend_test", "implementation_in_progress", "blocked"],
  backend_test: ["backend_dev", "backend_verified", "blocked"],
  backend_verified: ["implementation_in_progress", "integration_verification", "blocked"],
  integration_verification: ["waiting_for_final_review", "implementation_in_progress", "blocked"],
  waiting_for_final_review: ["done", "implementation_in_progress", "blocked"],
  done: [],
  blocked: ["intake", "tool_readiness", "waiting_for_tool_readiness_review", "knowledge_discovery", "product_requirements", "task_breakdown", "implementation_in_progress"]
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
  "waived"
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
