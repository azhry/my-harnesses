"use strict";

const API_URL = "https://api.linear.app/graphql";

class LinearClient {
  constructor({ apiKey = process.env.LINEAR_API_KEY || process.env.LINEAR_ACCESS_TOKEN, fetchImpl = globalThis.fetch } = {}) {
    if (!apiKey) throw new Error("LINEAR_API_KEY or LINEAR_ACCESS_TOKEN is required");
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }

  async query(query, variables = {}) {
    const response = await this.fetch(API_URL, {
      method: "POST",
      headers: { Authorization: this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables })
    });
    if (!response.ok) throw new Error(`Linear HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.errors && payload.errors.length) throw new Error(`Linear GraphQL: ${payload.errors.map((item) => item.message).join("; ")}`);
    return payload.data;
  }

  async workflowStates(teamId) {
    const data = await this.query(`query States($teamId: ID!) { workflowStates(filter: { team: { id: { eq: $teamId } } }) { nodes { id name } } }`, { teamId });
    return new Map(data.workflowStates.nodes.map((item) => [item.name.toLowerCase(), item]));
  }

  async findProject(teamId, key) {
    const data = await this.query(`query Projects($teamId: ID!) { projects(filter: { accessibleTeams: { id: { eq: $teamId } } }, first: 100) { nodes { id name description url } } }`, { teamId });
    const marker = `devcircuit:${key}`;
    return data.projects.nodes.find((item) => item.description && item.description.includes(marker)) || null;
  }

  async ensureProject({ teamId, key, name, description }) {
    const existing = await this.findProject(teamId, key);
    if (existing) return { project: existing, created: false };
    const marked = `${description}\n\n<!-- devcircuit:${key} -->`;
    const data = await this.query(`mutation CreateProject($input: ProjectCreateInput!) { projectCreate(input: $input) { success project { id name description url } } }`, { input: { name, description: marked, teamIds: [teamId] } });
    if (!data.projectCreate.success) throw new Error("Linear projectCreate returned success=false");
    return { project: data.projectCreate.project, created: true };
  }

  async findDocument(projectId, marker) {
    const data = await this.query(`query Documents($projectId: ID!) { documents(filter: { project: { id: { eq: $projectId } } }, first: 100) { nodes { id title content url } } }`, { projectId });
    return data.documents.nodes.find((item) => item.content && item.content.includes(marker)) || null;
  }

  async ensureDocument({ projectId, title, content, existingId, key }) {
    if (existingId) return { id: existingId, updated: false };
    const marker = `<!-- devcircuit-document:${key} -->`;
    const existing = await this.findDocument(projectId, marker);
    if (existing) return existing;
    const data = await this.query(`mutation CreateDocument($input: DocumentCreateInput!) { documentCreate(input: $input) { success document { id title url } } }`, { input: { projectId, title, content: `${content}\n\n${marker}` } });
    if (!data.documentCreate.success) throw new Error("Linear documentCreate returned success=false");
    return data.documentCreate.document;
  }

  async createIssue({ teamId, projectId, stateId, task }) {
    const description = renderIssue(task);
    const data = await this.query(`mutation CreateIssue($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url title } } }`, { input: { teamId, projectId, stateId, title: `${task.id}: ${task.title}`, description } });
    if (!data.issueCreate.success) throw new Error("Linear issueCreate returned success=false");
    return data.issueCreate.issue;
  }

  async findIssue(teamId, projectId, taskId) {
    const data = await this.query(`query Issues($teamId: ID!, $projectId: ID!) { issues(filter: { team: { id: { eq: $teamId } }, project: { id: { eq: $projectId } } }, first: 100) { nodes { id identifier url title description } } }`, { teamId, projectId });
    const marker = `<!-- devcircuit-task:${taskId} -->`;
    return data.issues.nodes.find((item) => item.description && item.description.includes(marker)) || null;
  }

  async ensureIssue({ teamId, projectId, stateId, task }) {
    return await this.findIssue(teamId, projectId, task.id) || await this.createIssue({ teamId, projectId, stateId, task });
  }

  async updateIssueStatus(issueId, stateId) {
    const data = await this.query(`mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id state { id name } } } }`, { id: issueId, input: { stateId } });
    if (!data.issueUpdate.success) throw new Error("Linear issueUpdate returned success=false");
    return data.issueUpdate.issue.state;
  }
}

function renderIssue(task) {
  const bullets = (values) => (values.length ? values.map((value) => `- ${value}`).join("\n") : "- None");
  return `## Description\n${task.contract.description}\n\n## Scope\n${bullets(task.contract.scope)}\n\n## Exclusions\n${bullets(task.contract.exclusions)}\n\n## Acceptance criteria\n${bullets(task.contract.acceptance_criteria)}\n\n## Verification commands\n${bullets(task.contract.verification_commands)}\n\n## Manual test steps\n${bullets(task.contract.manual_test_steps)}\n\n## Dependencies\n${bullets(task.contract.dependencies)}\n\nContract: \`${task.contract_hash}\`\n\n<!-- devcircuit-task:${task.id} -->`;
}

async function syncLinearState(state, client) {
  const config = state.integrations.linear;
  const states = await client.workflowStates(config.team_id);
  const required = ["todo", "in progress", "in review", "done"];
  for (const name of required) if (!states.has(name)) throw new Error(`Linear team is missing workflow status '${name}'`);
  const ensured = await client.ensureProject({ teamId: config.team_id, key: state.run.project_key, name: state.run.title, description: state.run.summary });
  config.project_id = ensured.project.id;
  config.project_url = ensured.project.url;
  const document = await client.ensureDocument({ projectId: config.project_id, title: `${state.run.title} — Specification`, content: state.specification.content, existingId: config.document_id, key: state.run.project_key });
  config.document_id = document.id;
  config.document_url = document.url || config.document_url;
  for (const task of state.tasks) {
    if (!task.linear.issue_id) {
      const issue = await client.ensureIssue({ teamId: config.team_id, projectId: config.project_id, stateId: states.get("todo").id, task });
      task.linear.issue_id = issue.id;
      task.linear.issue_url = issue.url;
      task.linear.actual_status = "Todo";
    }
    if (task.linear.sync_pending || task.linear.actual_status !== task.linear.desired_status) {
      const target = states.get(task.linear.desired_status.toLowerCase());
      const actual = await client.updateIssueStatus(task.linear.issue_id, target.id);
      if (actual.name !== task.linear.desired_status) throw new Error(`Linear read-after-write mismatch for ${task.id}: ${actual.name}`);
      task.linear.actual_status = actual.name;
      task.linear.sync_pending = false;
      task.linear.last_synced_at = new Date().toISOString();
    }
  }
  return state;
}

module.exports = { LinearClient, renderIssue, syncLinearState };
