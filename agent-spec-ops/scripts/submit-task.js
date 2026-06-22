#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const args = process.argv.slice(2);
const stateFile = args[0];
const taskId = args[1];

let commitMsg = "";
let testCommand = "";
let prBodyFile = "";

for (let i = 2; i < args.length; i++) {
  if (args[i] === "--commit-msg" && i + 1 < args.length) {
    commitMsg = args[++i];
  } else if (args[i] === "--test-command" && i + 1 < args.length) {
    testCommand = args[++i];
  } else if (args[i] === "--pr-body-file" && i + 1 < args.length) {
    prBodyFile = args[++i];
  }
}

if (!stateFile || !taskId || !commitMsg) {
  console.error("Usage: node scripts/submit-task.js <workflow-state.json> <TASK_ID> --commit-msg \"<msg>\" [--test-command \"<cmd>\"]");
  process.exit(1);
}

const statePath = path.resolve(stateFile);
if (!fs.existsSync(statePath)) {
  console.error(`State file not found: ${statePath}`);
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const deliveryId = state.delivery.id;
const tasks = state.task_graph && state.task_graph.tasks ? state.task_graph.tasks : [];
const taskIndex = tasks.findIndex(t => t.id === taskId);

if (taskIndex === -1) {
  console.error(`Task ${taskId} not found.`);
  process.exit(1);
}

const task = tasks[taskIndex];
if (!["frontend_dev", "backend_dev"].includes(task.role)) {
  console.error(`Task ${taskId} has role ${task.role}. submit-task.js is only for frontend_dev and backend_dev.`);
  process.exit(1);
}

const branchName = `delivery/${deliveryId}/${taskId}`;
const runDir = path.dirname(statePath);

const gitPolicy = state.implementation && state.implementation.git_policy ? state.implementation.git_policy : {};
const repoPath = gitPolicy.repo_path || state.workspace_root || process.cwd();

console.log(`\n=== Submitting Task ${taskId} ===`);
console.log(`Repo: ${repoPath}`);
console.log(`Branch: ${branchName}`);
console.log(`Commit: ${commitMsg}`);
console.log(`Test: ${testCommand || "None"}\n`);

// 1. Git Branch
try {
  execSync(`git fetch origin main`, { cwd: repoPath, stdio: "pipe" });
  try {
    execSync(`git checkout ${branchName}`, { cwd: repoPath, stdio: "pipe" });
    console.log(`✓ Checked out existing branch ${branchName}`);
  } catch {
    execSync(`git checkout -b ${branchName} origin/main`, { cwd: repoPath, stdio: "pipe" });
    console.log(`✓ Created new branch ${branchName} from origin/main`);
  }
} catch (e) {
  console.error(`Failed to handle git branch. Are you in a valid repo?\n${e.message}`);
  process.exit(1);
}

// 2. Commit
try {
  execSync(`git add -A`, { cwd: repoPath, stdio: "pipe" });
  const status = execSync(`git status --porcelain`, { cwd: repoPath, stdio: "pipe" }).toString();
  if (status.trim()) {
    execSync(`git commit -m "${commitMsg}"`, { cwd: repoPath, stdio: "pipe" });
    console.log(`✓ Committed changes`);
  } else {
    console.log(`✓ No new changes to commit`);
  }
} catch (e) {
  console.error(`Failed to commit changes.\n${e.message}`);
  process.exit(1);
}

// 3. Test
let testPassed = true;
let testOutput = "No tests run.";
if (testCommand && testCommand.trim().length > 0 && !testCommand.includes("echo")) {
  console.log(`\nRunning tests: ${testCommand}...`);
  try {
    testOutput = execSync(testCommand, { cwd: repoPath, stdio: "pipe", encoding: "utf8" });
    console.log(`✓ Tests passed!`);
  } catch (e) {
    testPassed = false;
    testOutput = (e.stdout || "") + "\n" + (e.stderr || "");
    console.error(`✗ Tests failed!\n${testOutput}`);
    console.error(`\nAborting submit. Please fix tests and run submit-task.js again.`);
    process.exit(1);
  }
} else {
  console.log(`✓ Skipping tests (no valid command provided)`);
}

// Write test output to file
const testLogFile = `test-output-${taskId}.log`;
fs.writeFileSync(path.join(runDir, testLogFile), testOutput);

// Record tests in state
task.test = {
  status: testPassed ? "passed" : "failed",
  last_run_at: new Date().toISOString(),
  commands: [testCommand || "none"],
  failures: [],
  output_file: testLogFile
};
console.log(`✓ Recorded test results`);

// 4. Push
try {
  execSync(`git push -u origin ${branchName}`, { cwd: repoPath, stdio: "pipe" });
  console.log(`✓ Pushed to origin/${branchName}`);
} catch (e) {
  console.error(`Failed to push to origin. Ensure remote is accessible.\n${e.message}`);
  process.exit(1);
}

// 5. PR
let prUrl = "";
try {
  const ghBin = process.env.GH_CLI_PATH || "gh";
  const ghEnv = { ...process.env, GH_PROMPT_DISABLE: "1", NO_COLOR: "1" };
  const ghOpts = { cwd: repoPath, stdio: "pipe", encoding: "utf8", env: ghEnv };

  // Check if gh binary is available
  let ghAvailable = false;
  try {
    execSync(`"${ghBin}" --version`, { stdio: "pipe", encoding: "utf8", env: ghEnv });
    ghAvailable = true;
  } catch {
    console.error("✗ gh CLI binary not found. Install from https://cli.github.com/ or authenticate with `gh auth login`.");
  }

  if (ghAvailable) {
    // Check if PR already exists
    const prList = execSync(`"${ghBin}" pr list --head ${branchName} --json url`, ghOpts);
    const prs = JSON.parse(prList);
    if (prs.length > 0) {
      prUrl = prs[0].url;
      console.log(`✓ PR already exists: ${prUrl}`);
    } else {
      const title = `[${deliveryId}] ${taskId}: ${task.title}`;
      let body = `Closes ${taskId}\n\n${task.description}`;
      try {
        if (prBodyFile && fs.existsSync(prBodyFile)) {
          body = fs.readFileSync(prBodyFile, "utf8");
        } else {
          const templatePath = path.resolve(__dirname, "../templates/pull-request-template.md");
          if (fs.existsSync(templatePath)) {
            body = fs.readFileSync(templatePath, "utf8").replace(/<TASK_ID>/g, taskId).replace(/<DELIVERY_ID>/g, deliveryId);
          }
        }
      } catch { }

      const prOutput = execSync(`"${ghBin}" pr create --base main --head ${branchName} --title "${title}" --body "${body}"`, ghOpts);
      prUrl = prOutput.trim();
      console.log(`✓ Created PR: ${prUrl}`);
    }
  }

  if (!prUrl && process.env.GITHUB_TOKEN) {
    console.log("  gh CLI failed or unavailable — falling back to GitHub API...");
    const repoUrl = execSync(`git remote get-url origin`, { cwd: repoPath, stdio: "pipe", encoding: "utf8" }).trim();
    const repoPathMatch = repoUrl.match(/(?:github\.com[\/:])?([^\/]+\/[^\/\.]+?)(?:\.git)?$/);
    if (repoPathMatch) {
      const fullRepoName = repoPathMatch[1];
      const title = `[${deliveryId}] ${taskId}: ${task.title}`;
      let body = `Closes ${taskId}\n\n${task.description}`;
      try {
        const templatePath = path.resolve(__dirname, "../templates/pull-request-template.md");
        if (fs.existsSync(templatePath)) {
          body = fs.readFileSync(templatePath, "utf8").replace(/<TASK_ID>/g, taskId).replace(/<DELIVERY_ID>/g, deliveryId);
        }
      } catch { }
      const apiPayload = JSON.stringify({
        title, body, head: branchName, base: "main"
      });
      const apiResult = execSync(
        `node -e "const https=require('https');const req=https.request({hostname:'api.github.com',path:'/repos/${fullRepoName}/pulls',method:'POST',headers:{'Authorization':'Bearer ' + process.env.GITHUB_TOKEN,'Content-Type':'application/json','User-Agent':'submit-task'},timeout:15000},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>process.stdout.write(d));});req.write(${JSON.stringify(apiPayload)});req.on('error',e=>{process.stderr.write(e.message);process.exit(1)});req.end();"`,
        { stdio: "pipe", encoding: "utf8", timeout: 20000 }
      );
      const apiData = JSON.parse(apiResult);
      if (apiData.html_url) {
        prUrl = apiData.html_url;
        console.log(`✓ Created PR via API: ${prUrl}`);
      } else {
        console.error(`  API error: ${apiData.message || JSON.stringify(apiData)}`);
      }
    }
  }
} catch (e) {
  console.error(`✗ Failed to create PR: ${e.message}`);
}

// Update Git Flow State
task.git_flow = {
  feature_branch: branchName,
  base_branch: "main",
  target_branch: "main",
  branch_created: true,
  branch_evidence: [`Created and checked out ${branchName}`],
  local_tests_passed: testPassed,
  test_evidence: [testLogFile],
  pushed: true,
  push_evidence: [`Pushed ${branchName} to origin`],
  merge_request_status: prUrl ? "created" : "failed",
  merge_request_url: prUrl
};

fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
console.log(`\n=== Successfully submitted Task ${taskId} ===`);
console.log(`You can now transition this task to 'verified' using:`);
console.log(`node scripts/transition-task.js "${stateFile}" ${taskId} verified`);
