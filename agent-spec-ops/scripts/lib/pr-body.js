"use strict";

function buildPrBody(options) {
  const task = options.task || {};
  const changedFiles = task.implementation && Array.isArray(task.implementation.changed_files)
    ? task.implementation.changed_files
    : [];
  const expectedChanges = Array.isArray(task.expected_changes) ? task.expected_changes : [];
  const test = task.test || {};
  const commands = Array.isArray(test.commands) ? test.commands.filter(Boolean) : [];
  const verification = Array.isArray(task.verification) ? task.verification.filter(Boolean) : [];
  const sourceRequirements = Array.isArray(task.source_requirements) ? task.source_requirements.filter(Boolean) : [];
  const dependencies = task.dependencies || task.depends_on || [];
  const dependencyText = Array.isArray(dependencies) && dependencies.length ? dependencies.join(", ") : "None";
  const changedSummary = summarizeChangedFiles(changedFiles.length ? changedFiles : expectedChanges);
  const system = task.lane === "frontend" ? "Frontend" : task.lane === "backend" ? "Backend" : "Both";

  const body = [
    "## Summary",
    "",
    summaryFor(task),
    "",
    "## Task",
    "",
    `- **Delivery:** ${options.deliveryId}`,
    `- **Task:** ${options.taskId}`,
    `- **Title:** ${task.title || options.taskId}`,
    `- **Description:** ${task.description || "No task description recorded."}`,
    `- **Product requirement(s):** ${sourceRequirements.length ? sourceRequirements.join(", ") : "Not recorded"}`,
    `- **Dependencies:** ${dependencyText}`,
    "",
    "## Changes",
    "",
    ...changedSummary.map((item) => `- ${item}`),
    "",
    "## Impact",
    "",
    `- **System:** ${system}`,
    `- **Breaking:** ${breakingImpact(task)}`,
    `- **Dependencies:** ${dependencyImpact(task)}`,
    `- **Configuration:** ${configurationImpact(task)}`,
    "",
    "## Manual Test Instructions",
    "",
    ...manualTestInstructions(commands, verification),
    "",
    "## Test Agent Comment",
    "",
    "The harness posts a passed or failed MR status comment before verification.",
    "",
    "```text",
    `Status: ${test.status || "not_run"}`,
    `Task: ${options.taskId}`,
    `Evidence: ${test.output_file || "No test output file recorded yet"}`,
    "```",
    "",
    "## Related",
    "",
    relatedLine(task, options.taskId)
  ].join("\n");

  assertNoPrPlaceholders(body);
  return `${body}\n`;
}

function summaryFor(task) {
  const title = task.title || "Task implementation";
  const description = task.description || "";
  if (!description) return `${title}.`;
  const firstSentence = description.split(/(?<=[.!?])\s+/)[0].trim();
  return `${title}. ${firstSentence}`;
}

function summarizeChangedFiles(files) {
  if (!files.length) return ["No changed files were recorded in workflow state; inspect the task branch diff."];
  const limit = 12;
  const rows = files.slice(0, limit).map((file) => `${file}: updated for this task scope.`);
  if (files.length > limit) rows.push(`${files.length - limit} additional file(s): see the task branch diff.`);
  return rows;
}

function manualTestInstructions(commands, verification) {
  const rows = [];
  let index = 1;
  for (const command of commands) {
    rows.push(`${index}. Run \`${command}\`.`);
    index += 1;
  }
  for (const item of verification) {
    rows.push(`${index}. Verify ${item}.`);
    index += 1;
  }
  if (!rows.length) rows.push("1. Review the recorded test evidence in workflow state and rerun the task-specific checks.");
  return rows;
}

function breakingImpact(task) {
  const text = [
    task.description || "",
    ...(Array.isArray(task.definition_of_done) ? task.definition_of_done : [])
  ].join(" ");
  return /\bbreaking\b|\bremove\b|\bdrop\b|\bmigration\b/i.test(text) ? "Possible; review changed contracts and migrations." : "No known breaking change recorded.";
}

function dependencyImpact(task) {
  const evidence = [
    ...(Array.isArray(task.expected_changes) ? task.expected_changes : []),
    ...((task.implementation && Array.isArray(task.implementation.changed_files)) ? task.implementation.changed_files : [])
  ];
  return evidence.some((item) => /package\.json|go\.mod|requirements\.txt|pyproject\.toml|Gemfile/i.test(item))
    ? "Dependency manifest changed; review lockfile/module updates."
    : "No dependency change recorded.";
}

function configurationImpact(task) {
  const evidence = [
    task.description || "",
    ...(Array.isArray(task.expected_changes) ? task.expected_changes : []),
    ...((task.implementation && Array.isArray(task.implementation.changed_files)) ? task.implementation.changed_files : [])
  ].join(" ");
  return /\.env|config|secret|token|credential/i.test(evidence)
    ? "Configuration or environment behavior may be affected; review changed config paths."
    : "No configuration change recorded.";
}

function relatedLine(task, taskId) {
  if (task.linear_url) return `- Linear: ${task.linear_url}`;
  if (task.linear_id) return `- Linear issue: ${task.linear_id}`;
  return `- Task: ${taskId}`;
}

function assertNoPrPlaceholders(body) {
  const placeholder = String(body).match(/<[^>\n]+>/);
  if (placeholder) {
    throw new Error(`PR body still contains placeholder text: ${placeholder[0]}`);
  }
}

module.exports = {
  buildPrBody,
  assertNoPrPlaceholders
};
