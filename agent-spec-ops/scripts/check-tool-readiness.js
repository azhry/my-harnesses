#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawnSync, execSync } = require("child_process");
const {
  ensureRunMemory,
  loadJson,
  writeJson
} = require("./lib/memory-store");

const args = parseArgs(process.argv.slice(2));
const stateFile = args.stateFile;
const nonInteractive = args.nonInteractive;
const verifyMode = args.verify;
const productTrackerArg = args.productTracker;
const codeHostArg = args.codeHost;

const PRODUCT_TRACKERS = ["linear", "atlassian"];
const CODE_HOSTS = ["github", "gitlab"];

const PRODUCT_TOKEN_ENVS = {
  linear: ["LINEAR_API_KEY", "LINEAR_ACCESS_TOKEN"],
  atlassian: ["ATLASSIAN_API_TOKEN"]
};

const PRODUCT_EXTRA_ENVS = {
  linear: [],
  atlassian: ["ATLASSIAN_EMAIL", "ATLASSIAN_BASE_URL", "ATLASSIAN_SITE_URL"]
};

const CODE_TOKEN_ENVS = {
  github: ["GITHUB_TOKEN", "GH_TOKEN"],
  gitlab: ["GITLAB_TOKEN", "GITLAB_PAT", "GRAB_GITLAB_ACCESS_TOKEN"]
};

function parseArgs(rawArgs) {
  const parsed = {
    stateFile: "",
    nonInteractive: false,
    verify: false,
    productTracker: "",
    codeHost: ""
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--non-interactive") {
      parsed.nonInteractive = true;
      continue;
    }
    if (arg === "--verify") {
      parsed.verify = true;
      continue;
    }
    if (arg === "--product-tracker") {
      parsed.productTracker = rawArgs[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg === "--code-host") {
      parsed.codeHost = rawArgs[index + 1] || "";
      index += 1;
      continue;
    }
    if (!arg.startsWith("--") && !parsed.stateFile) {
      parsed.stateFile = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function envHasAny(names) {
  return names.some((name) => typeof process.env[name] === "string" && process.env[name].trim() !== "");
}

function envNamesPresent(names) {
  return names.filter((name) => typeof process.env[name] === "string" && process.env[name].trim() !== "");
}

function commandInfo(name) {
  const which = spawnSync("/bin/sh", ["-c", `command -v ${shellQuote(name)}`], {
    encoding: "utf8"
  });

  if (which.status !== 0) {
    return {
      name,
      status: "missing",
      path: "",
      version: ""
    };
  }

  const commandPath = (which.stdout || "").trim().split("\n")[0];
  const versionArgs = name === "java" ? ["-version"] : ["--version"];
  const version = spawnSync(name, versionArgs, {
    encoding: "utf8"
  });
  const versionText = `${version.stdout || ""}${version.stderr || ""}`
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) || "";

  return {
    name,
    status: version.status === 0 || versionText ? "available" : "error",
    path: commandPath,
    version: versionText
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function askSecret(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.resolve("");
  }

  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let answer = "";

    process.stdout.write(question);
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();

    function finish() {
      stdin.removeListener("data", onData);
      stdin.setRawMode(Boolean(wasRaw));
      process.stdout.write("\n");
      resolve(answer.trim());
    }

    function onData(char) {
      if (char === "\u0003") {
        process.stdout.write("\n");
        process.exit(130);
      }
      if (char === "\r" || char === "\n") {
        finish();
        return;
      }
      if (char === "\u007f") {
        answer = answer.slice(0, -1);
        return;
      }
      answer += char;
    }

    stdin.on("data", onData);
  });
}

async function chooseProvider(kind, options, argValue, envGuess) {
  if (argValue) {
    if (!options.includes(argValue)) {
      throw new Error(`Invalid ${kind}: ${argValue}. Use one of: ${options.join(", ")}`);
    }
    return argValue;
  }

  if (nonInteractive || !process.stdin.isTTY) {
    return envGuess || options[0];
  }

  const defaultChoice = envGuess || options[0];
  const labels = options.map((option, index) => {
    const recommended = option === defaultChoice ? " (default)" : "";
    return `${index + 1}. ${option}${recommended}`;
  });
  console.log(`Choose ${kind}:`);
  labels.forEach((label) => console.log(`  ${label}`));
  const answer = await ask(`Select 1-${options.length} [${options.indexOf(defaultChoice) + 1}]: `);
  if (!answer) {
    return defaultChoice;
  }
  const index = Number(answer) - 1;
  if (Number.isInteger(index) && options[index]) {
    return options[index];
  }
  if (options.includes(answer.toLowerCase())) {
    return answer.toLowerCase();
  }
  throw new Error(`Invalid ${kind} choice: ${answer}`);
}

async function capabilityFromProvider(name, provider, tokenEnvs, extraEnvs) {
  const presentTokenEnvs = envNamesPresent(tokenEnvs);
  const presentExtraEnvs = envNamesPresent(extraEnvs);
  let sessionTokenSupplied = false;

  if (presentTokenEnvs.length === 0 && !nonInteractive && process.stdin.isTTY) {
    const token = await askSecret(`No ${provider} token env found. Enter ${provider} access token/PAT for this session (blank to skip): `);
    sessionTokenSupplied = token.length > 0;
  }

  if (presentTokenEnvs.length > 0) {
    return {
      name,
      provider,
      required: true,
      status: "available",
      verification: `${presentTokenEnvs.join(", ")} present in environment`,
      evidence: [`${provider} token environment variable is present`],
      blocker: ""
    };
  }

  if (sessionTokenSupplied) {
    return {
      name,
      provider,
      required: true,
      status: "available_session",
      verification: "Token supplied interactively for this readiness check",
      evidence: [`${provider} token supplied interactively; raw value not stored`],
      blocker: ""
    };
  }

  const missing = tokenEnvs.join(" or ");
  const extraNote = presentExtraEnvs.length > 0
    ? ` Supporting env present: ${presentExtraEnvs.join(", ")}.`
    : "";

  return {
    name,
    provider,
    required: true,
    status: "missing",
    verification: "",
    evidence: extraNote ? [extraNote.trim()] : [],
    blocker: `Missing ${provider} token (${missing})`
  };
}

function frontendReadiness() {
  const commands = ["node", "npm", "yarn", "pnpm", "npx", "playwright"].map(commandInfo);
  const hasNode = commands.some((command) => command.name === "node" && command.status === "available");
  const hasPackageManager = commands.some((command) => ["npm", "yarn", "pnpm"].includes(command.name) && command.status === "available");
  const evidence = commands
    .filter((command) => command.status === "available")
    .map((command) => `${command.name}: ${command.version || command.path}`);
  const blockers = [];

  if (!hasNode) {
    blockers.push("Node.js command not found");
  }
  if (!hasPackageManager) {
    blockers.push("No frontend package manager found (npm, yarn, or pnpm)");
  }

  return {
    status: hasNode && hasPackageManager ? "ready" : evidence.length > 0 ? "partial" : "missing",
    commands,
    evidence,
    blockers
  };
}

function backendReadiness() {
  const commands = ["go", "python3", "java", "mvn", "gradle", "docker", "cargo"].map(commandInfo);
  const runtimeNames = ["go", "python3", "java", "cargo"];
  const hasRuntime = commands.some((command) => runtimeNames.includes(command.name) && command.status === "available");
  const evidence = commands
    .filter((command) => command.status === "available")
    .map((command) => `${command.name}: ${command.version || command.path}`);
  const blockers = hasRuntime ? [] : ["No backend runtime found (go, python3, java, or cargo)"];

  return {
    status: hasRuntime ? "ready" : evidence.length > 0 ? "partial" : "missing",
    commands,
    evidence,
    blockers
  };
}

function inferProductTracker() {
  if (envHasAny(PRODUCT_TOKEN_ENVS.linear)) {
    return "linear";
  }
  if (envHasAny(PRODUCT_TOKEN_ENVS.atlassian)) {
    return "atlassian";
  }
  return "";
}

function inferCodeHost() {
  if (envHasAny(CODE_TOKEN_ENVS.github)) {
    return "github";
  }
  if (envHasAny(CODE_TOKEN_ENVS.gitlab)) {
    return "gitlab";
  }
  return "";
}

function aggregateStatus(capabilities, frontend, backend) {
  const statuses = [
    ...capabilities.map((capability) => capability.status),
    frontend.status,
    backend.status
  ];

  if (statuses.some((status) => ["missing", "blocked"].includes(status))) {
    return statuses.some((status) => ["available", "available_session", "ready", "partial"].includes(status))
      ? "partial"
      : "blocked";
  }

  if (statuses.some((status) => status === "partial")) {
    return "partial";
  }

  return "ready";
}

function getTokenForProvider(tokenEnvs) {
  for (const name of tokenEnvs) {
    if (typeof process.env[name] === "string" && process.env[name].trim() !== "") {
      return { env: name, value: process.env[name].trim() };
    }
  }
  return null;
}

function verifyLinearConnectivity() {
  const tokenInfo = getTokenForProvider(["LINEAR_API_KEY", "LINEAR_ACCESS_TOKEN"]);
  if (!tokenInfo) {
    return { status: "missing", detail: "No Linear API key found in environment" };
  }
  try {
    const result = execSync(
      `node -e "const https=require('https');const opts={hostname:'api.linear.app',path:'/graphql',method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer ' + process.env.LINEAR_API_KEY || process.env.LINEAR_ACCESS_TOKEN || ''}};const req=https.request(opts,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{const j=JSON.parse(d);if(j.data&&j.data.viewer)process.exit(0);else process.exit(1)});});req.on('error',()=>process.exit(1));req.write(JSON.stringify({query:'{viewer{id name}}'}));req.end();"`,
      { encoding: "utf8", timeout: 10000, stdio: "pipe" }
    );
    return { status: "connected", detail: "Linear API responded successfully" };
  } catch (e) {
    const msg = (e.stdout || e.stderr || e.message || "").trim().slice(0, 200);
    return { status: "failed", detail: `Linear API connection failed: ${msg}` };
  }
}

function verifyGithubConnectivity() {
  const tokenInfo = getTokenForProvider(["GITHUB_TOKEN", "GH_TOKEN"]);
  if (!tokenInfo) {
    return { status: "missing", detail: "No GitHub token found in environment" };
  }
  const results = [];
  try {
    const ghResult = execSync("gh auth status", { encoding: "utf8", timeout: 10000, stdio: "pipe" });
    results.push({ method: "gh auth", status: "connected", detail: (ghResult || "").trim().slice(0, 200) });
  } catch (e) {
    results.push({ method: "gh auth", status: "failed", detail: "gh CLI not authenticated or not available" });
  }
  try {
    const apiResult = execSync(
      `node -e "const https=require('https');https.get('https://api.github.com/user',{headers:{'User-Agent':'readiness-check','Authorization':'Bearer ' + (process.env.GITHUB_TOKEN||process.env.GH_TOKEN||'')}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{const j=JSON.parse(d);if(j.login)process.exit(0);else process.exit(1);});});"`,
      { encoding: "utf8", timeout: 10000, stdio: "pipe" }
    );
    results.push({ method: "api.github.com/user", status: "connected", detail: "GitHub API authenticated" });
  } catch (e) {
    results.push({ method: "api.github.com/user", status: "failed", detail: "GitHub API call failed" });
  }
  return {
    status: results.some(r => r.status === "connected") ? "connected" : "failed",
    detail: results.map(r => `[${r.method}] ${r.status}: ${r.detail}`).join("; ")
  };
}

function verifyGitlabConnectivity() {
  const tokenInfo = getTokenForProvider(["GITLAB_TOKEN", "GITLAB_PAT", "GRAB_GITLAB_ACCESS_TOKEN"]);
  if (!tokenInfo) {
    return { status: "missing", detail: "No GitLab token found in environment" };
  }
  try {
    const result = execSync(
      `node -e "const https=require('https');https.get('https://gitlab.com/api/v4/user',{headers:{'Authorization':'Bearer ' + (process.env.GITLAB_TOKEN||process.env.GITLAB_PAT||process.env.GRAB_GITLAB_ACCESS_TOKEN||'')}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{const j=JSON.parse(d);if(j.id)process.exit(0);else process.exit(1);});});"`,
      { encoding: "utf8", timeout: 10000, stdio: "pipe" }
    );
    return { status: "connected", detail: "GitLab API authenticated" };
  } catch (e) {
    return { status: "failed", detail: "GitLab API call failed" };
  }
}

function verifyAtlassianConnectivity() {
  const tokenInfo = getTokenForProvider(["ATLASSIAN_API_TOKEN"]);
  const email = process.env.ATLASSIAN_EMAIL;
  const baseUrl = process.env.ATLASSIAN_BASE_URL || process.env.ATLASSIAN_SITE_URL;
  if (!tokenInfo || !email || !baseUrl) {
    return { status: "missing", detail: "Atlassian token, email, or base URL missing" };
  }
  try {
    const result = execSync(
      `node -e "const https=require('https');const auth=Buffer.from(encodeURIComponent(process.env.ATLASSIAN_EMAIL)+':'+(process.env.ATLASSIAN_API_TOKEN||'')).toString('base64');https.get(process.env.ATLASSIAN_BASE_URL+'/rest/api/3/myself',{headers:{'Authorization':'Basic '+auth}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{if(res.statusCode===200)process.exit(0);else process.exit(1);});});"`,
      { encoding: "utf8", timeout: 10000, stdio: "pipe" }
    );
    return { status: "connected", detail: "Atlassian API authenticated" };
  } catch (e) {
    return { status: "failed", detail: "Atlassian API call failed" };
  }
}

const VERIFIERS = {
  linear: verifyLinearConnectivity,
  atlassian: verifyAtlassianConnectivity,
  github: verifyGithubConnectivity,
  gitlab: verifyGitlabConnectivity
};

function printSummary(readiness) {
  console.log("\nTool readiness summary");
  console.log(`- Product tracker: ${readiness.choices.product_tracker}`);
  console.log(`- Code host: ${readiness.choices.code_host}`);
  readiness.capabilities.forEach((capability) => {
    console.log(`- ${capability.name}/${capability.provider}: ${capability.status}`);
    if (capability.blocker) {
      console.log(`  blocker: ${capability.blocker}`);
    }
  });
  console.log(`- Frontend tooling: ${readiness.frontend.status}`);
  readiness.frontend.blockers.forEach((blocker) => console.log(`  blocker: ${blocker}`));
  console.log(`- Backend tooling: ${readiness.backend.status}`);
  readiness.backend.blockers.forEach((blocker) => console.log(`  blocker: ${blocker}`));
  console.log(`- Overall: ${readiness.status}`);
}

function updateStateFile(file, readiness) {
  if (!file) {
    return;
  }
  const statePath = path.resolve(file);
  let state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const now = readiness.checked_at;
  state.tool_readiness = readiness;
  state.delivery.updated_at = now;
  state.log.push({
    at: now,
    state: state.current_state,
    note: `Tool readiness checked: ${readiness.status}`
  });
  const prepared = ensureRunMemory(statePath, state);
  state = prepared.state;
  const productTracker = readiness.capabilities.find((capability) => capability.name === "product_tracker");
  if (productTracker && ["missing", "blocked"].includes(productTracker.status)) {
    state.memory.local_task_provider = {
      ...state.memory.local_task_provider,
      enabled: true,
      mode: "local",
      reason: `${productTracker.provider} is unavailable: ${productTracker.blocker}`,
      external_provider: productTracker.provider,
      sync_status: "local_only",
      last_synced_at: "",
      path: state.memory.local_tasks_path
    };
    const taskFile = path.join(prepared.runDir, state.memory.local_tasks_path);
    const localTasks = loadJson(taskFile);
    if (localTasks) {
      localTasks.provider.external_provider = productTracker.provider;
      localTasks.provider.sync_status = "local_only";
      localTasks.provider.evidence = [
        `Using local task storage because ${productTracker.provider} is unavailable`
      ];
      localTasks.updated_at = now;
      writeJson(taskFile, localTasks);
    }
  }
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  console.log(`Updated ${statePath}`);
}

async function main() {
  // === VERIFY MODE: test connectivity for already-configured providers ===
  if (verifyMode) {
    const statePath = path.resolve(stateFile);
    let state = null;
    try {
      state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    } catch (e) {
      console.error(`Cannot read state file: ${statePath}`);
      process.exit(1);
    }
    const choices = state.tool_readiness && state.tool_readiness.choices;
    const productChoice = (productTrackerArg || (choices && choices.product_tracker) || inferProductTracker());
    const codeChoice = (codeHostArg || (choices && choices.code_host) || inferCodeHost());
    console.log(`Verifying connectivity for: product_tracker=${productChoice}, code_host=${codeChoice}\n`);

    const productVerifier = VERIFIERS[productChoice];
    const codeVerifier = VERIFIERS[codeChoice];
    const productResult = productVerifier ? productVerifier() : { status: "unknown", detail: `No verifier for ${productChoice}` };
    const codeResult = codeVerifier ? codeVerifier() : { status: "unknown", detail: `No verifier for ${codeChoice}` };
    const frontend = frontendReadiness();
    const backend = backendReadiness();

    console.log(`- ${productChoice}: ${productResult.status} — ${productResult.detail}`);
    console.log(`- ${codeChoice}: ${codeResult.status} — ${codeResult.detail}`);
    console.log(`- Frontend: ${frontend.status}`);
    console.log(`- Backend: ${backend.status}`);

    const allOk = productResult.status === "connected" && codeResult.status === "connected";
    const overallStatus = allOk ? "ready" :
      productResult.status === "connected" || codeResult.status === "connected" ? "partial" : "blocked";

    const readiness = {
      status: overallStatus,
      checked_at: new Date().toISOString(),
      choices: { product_tracker: productChoice, code_host: codeChoice },
      capabilities: [
        {
          name: "product_tracker",
          provider: productChoice,
          required: true,
          status: allOk ? "available" : productResult.status === "connected" ? "partial" : "missing",
          verification: productResult.detail,
          evidence: [productResult.detail],
          blocker: productResult.status === "connected" ? "" : `${productChoice} not reachable`
        },
        {
          name: "code_host",
          provider: codeChoice,
          required: true,
          status: allOk ? "available" : codeResult.status === "connected" ? "partial" : "missing",
          verification: codeResult.detail,
          evidence: [codeResult.detail],
          blocker: codeResult.status === "connected" ? "" : `${codeChoice} not reachable`
        }
      ],
      frontend,
      backend,
      verification: { product_connectivity: productResult, code_connectivity: codeResult }
    };

    console.log(`\nOverall: ${readiness.status}`);
    updateStateFile(stateFile, readiness);
    if (readiness.status === "blocked") process.exit(2);
    return;
  }

  const productTracker = await chooseProvider("product tracker", PRODUCT_TRACKERS, productTrackerArg, inferProductTracker());
  const codeHost = await chooseProvider("code host", CODE_HOSTS, codeHostArg, inferCodeHost());

  const productCapability = await capabilityFromProvider(
    "product_tracker",
    productTracker,
    PRODUCT_TOKEN_ENVS[productTracker],
    PRODUCT_EXTRA_ENVS[productTracker]
  );
  const codeCapability = await capabilityFromProvider(
    "code_host",
    codeHost,
    CODE_TOKEN_ENVS[codeHost],
    []
  );
  const frontend = frontendReadiness();
  const backend = backendReadiness();

  const readiness = {
    status: "checking",
    checked_at: new Date().toISOString(),
    choices: {
      product_tracker: productTracker,
      code_host: codeHost
    },
    capabilities: [productCapability, codeCapability],
    frontend,
    backend
  };

  readiness.status = aggregateStatus(readiness.capabilities, frontend, backend);
  printSummary(readiness);
  updateStateFile(stateFile, readiness);

  if (readiness.status === "blocked") {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
