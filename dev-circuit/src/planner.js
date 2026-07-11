"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnWorker } = require("./worker-process");

function analyzeRequest({ requestFile, adapter, outputDirectory }) {
  if (!adapter) throw new Error("A planner adapter executable is required");
  const request = fs.readFileSync(path.resolve(requestFile), "utf8");
  if (!request.trim()) throw new Error("Request is empty");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const inputPath = path.join(outputDirectory, "planner-input.json");
  fs.writeFileSync(inputPath, `${JSON.stringify({
    protocol: "devcircuit-planner-v1",
    request,
    required_output: {
      specification: "complete Markdown specification",
      tasks: [{ id: "stable id", title: "one mergeable outcome", description: "behavior", scope: [], exclusions: [], acceptance_criteria: [], verification_commands: [], manual_test_steps: [], dependencies: [] }]
    },
    rules: [
      "Cover every requirement with at least one acceptance criterion and task.",
      "Every task must be independently mergeable and verifiable.",
      "Do not invent resolved product decisions when ambiguity is material.",
      "Return JSON only through the output file path printed on the final stdout line."
    ]
  }, null, 2)}\n`, { mode: 0o600 });
  const result = spawnWorker(path.resolve(adapter), [inputPath], { timeout: 120000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Planner adapter failed: ${result.stderr || result.stdout}`);
  const resultPath = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!resultPath || !fs.existsSync(resultPath)) throw new Error("Planner adapter must print an existing result JSON path");
  const plan = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  if (!plan.specification || !Array.isArray(plan.tasks) || !plan.tasks.length) throw new Error("Planner output requires specification and non-empty tasks");
  const criteria = plan.tasks.flatMap((task) => task.acceptance_criteria || []);
  for (const task of plan.tasks) {
    if (!task.id || !task.title || !task.description) throw new Error("Every planned task needs id, title, and description");
    if (!Array.isArray(task.verification_commands) || !task.verification_commands.length) throw new Error(`${task.id} requires verification_commands`);
  }
  if (!criteria.length) throw new Error("Planner output has no acceptance criteria");
  const specificationPath = path.join(outputDirectory, "specification.md");
  const tasksPath = path.join(outputDirectory, "tasks.json");
  fs.writeFileSync(specificationPath, plan.specification);
  fs.writeFileSync(tasksPath, `${JSON.stringify(plan.tasks, null, 2)}\n`);
  return { specificationPath, tasksPath, plannerInputPath: inputPath, plannerResultPath: resultPath };
}

module.exports = { analyzeRequest };
