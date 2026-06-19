#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawnSync } = require("child_process");
const {
  ensureRunMemory,
  loadJson,
  writeJson
} = require("./lib/memory-store");

const args = parseArgs(process.argv.slice(2));
const stateFile = args.stateFile;
const nonInteractive = args.nonInteractive;
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
    productTracker: "",
    codeHost: ""
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--non-interactive") {
      parsed.nonInteractive = true;
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
