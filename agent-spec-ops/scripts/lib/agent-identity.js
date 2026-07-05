"use strict";

const ROLE_AGENT_NAMES = {
  orchestrator: "agent-spec-orchestrator",
  frontend_dev: "agent-spec-frontend-dev",
  frontend_test: "agent-spec-frontend-test",
  backend_dev: "agent-spec-backend-dev",
  backend_test: "agent-spec-backend-test"
};

const GENERIC_AGENT_NAMES = new Set(["build", "general", "explore", "plan"]);

function expectedAgentName(role) {
  return ROLE_AGENT_NAMES[role] || "";
}

function validateSpawnIdentity(role, agentId, agentName) {
  const errors = [];
  const expected = expectedAgentName(role);
  const normalizedName = String(agentName || "").trim();
  const normalizedId = String(agentId || "").trim();

  if (!expected) return errors;

  if (!normalizedName) {
    errors.push(`${role}: exact OpenCode agent name is required. Use --agent ${expected}.`);
  } else if (GENERIC_AGENT_NAMES.has(normalizedName)) {
    errors.push(`${role}: generic OpenCode agent "${normalizedName}" is not allowed. Use ${expected}.`);
  } else if (normalizedName !== expected) {
    errors.push(`${role}: expected OpenCode agent ${expected}, got ${normalizedName}.`);
  }

  if (!/^ses_[A-Za-z0-9]+$/.test(normalizedId)) {
    errors.push(`${role}: agent id must be the real OpenCode child session id starting with "ses_". Got "${normalizedId || "(empty)"}".`);
  }

  return errors;
}

function leaseIdentityErrors(lease) {
  if (!lease) return ["missing lease"];
  return validateSpawnIdentity(lease.role, lease.agent_id, lease.agent_name);
}

function hasValidLease(state, taskId, role) {
  return validLease(state, taskId, role) !== null;
}

function validLease(state, taskId, role) {
  const leases = state.agent_dispatch && Array.isArray(state.agent_dispatch.leases)
    ? state.agent_dispatch.leases
    : [];
  return leases.find((lease) =>
    lease &&
    lease.task_id === taskId &&
    lease.role === role &&
    ["leased", "active"].includes(lease.status || "leased") &&
    leaseIdentityErrors(lease).length === 0
  ) || null;
}

module.exports = {
  expectedAgentName,
  validateSpawnIdentity,
  leaseIdentityErrors,
  hasValidLease,
  validLease
};
