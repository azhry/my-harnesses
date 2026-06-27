#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { loadSecretEnv } = require("./lib/env-loader");

const args = parseArgs(process.argv.slice(2));

if (!args.stateFile) {
  console.error([
    "Usage: node scripts/fetch-stitch-designs.js runs/<DELIVERY_ID>/workflow-state.json [options]",
    "",
    "Options:",
    "  --url URL             Stitch JSON-RPC/REST endpoint or project URL",
    "  --project-id ID       Stitch project ID",
    "  --method NAME         JSON-RPC method name",
    "  --params JSON         JSON-RPC params object",
    "  --list-methods        Probe common JSON-RPC method names",
    "  --list-screens        Print detected screen names without saving",
    "  --rest                Treat endpoint as REST JSON/HTML instead of JSON-RPC"
  ].join("\n"));
  process.exit(1);
}

const statePath = path.resolve(args.stateFile);
loadSecretEnv(statePath);

const apiKey = process.env.GOOGLE_STITCH_API_KEY || "";
if (!apiKey) {
  console.error("GOOGLE_STITCH_API_KEY is not set. Put it in the run or harness .agent-spec-ops.secrets.env file.");
  process.exit(1);
}

if (!args.url) {
  console.error("A Stitch URL/endpoint is required. Provide --url from the human gate approval note.");
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const runDir = path.dirname(statePath);
const outputDir = path.join(runDir, "design-assets");
fs.mkdirSync(outputDir, { recursive: true });

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  if (args.listMethods) {
    await listMethods();
    return;
  }

  const payload = args.rest
    ? await restRequest(args.url)
    : await jsonRpcRequest(args.url, args.method || "exportScreens", params());

  const screens = extractScreens(payload);
  if (args.listScreens) {
    if (!screens.length) {
      console.log("No screens detected.");
      process.exit(1);
    }
    screens.forEach((screen, index) => console.log(`${index + 1}. ${screen.name}`));
    return;
  }

  if (!screens.length) {
    markDesignAssets("blocked", [], "No screens detected in Stitch response");
    console.error("No screens detected in Stitch response. Do not claim designs were fetched.");
    process.exit(1);
  }

  const saved = [];
  screens.forEach((screen, index) => {
    const file = `${String(index).padStart(2, "0")}-${slug(screen.name || `screen-${index + 1}`)}.html`;
    const full = path.join(outputDir, file);
    fs.writeFileSync(full, asHtml(screen), "utf8");
    saved.push(file);
  });

  markDesignAssets("ready_for_review", saved, `Fetched ${saved.length} Stitch design asset(s)`);
  console.log(`Saved ${saved.length} design asset(s) to ${path.relative(process.cwd(), outputDir)}`);
  saved.forEach((file) => console.log(`- ${file}`));
}

async function listMethods() {
  const methods = [
    "exportScreens",
    "listScreens",
    "getScreens",
    "screens.list",
    "projects.exportScreens",
    "projects.getScreens"
  ];
  let success = false;
  for (const method of methods) {
    try {
      const result = await jsonRpcRequest(args.url, method, params());
      const screens = extractScreens(result);
      console.log(`${method}: OK (${screens.length} screen(s) detected)`);
      success = true;
    } catch (error) {
      console.log(`${method}: ${error.message.slice(0, 160)}`);
    }
  }
  if (!success) {
    process.exit(1);
  }
}

function params() {
  if (args.params) {
    return JSON.parse(args.params);
  }
  return args.projectId ? { projectId: args.projectId } : {};
}

async function jsonRpcRequest(url, method, requestParams) {
  const body = {
    jsonrpc: "2.0",
    id: Date.now(),
    method,
    params: requestParams
  };
  const result = await request(url, "POST", body);
  if (result && result.error) {
    const code = result.error.code || "unknown";
    const message = result.error.message || JSON.stringify(result.error);
    throw new Error(`JSON-RPC error ${code}: ${message}`);
  }
  return result && Object.prototype.hasOwnProperty.call(result, "result") ? result.result : result;
}

async function restRequest(url) {
  return request(url, "GET");
}

function request(urlString, method, body) {
  const url = new URL(urlString);
  const client = url.protocol === "https:" ? https : http;
  const textBody = body ? JSON.stringify(body) : "";
  const headers = {
    "Accept": "application/json, text/html;q=0.9, text/plain;q=0.8",
    "Authorization": `Bearer ${apiKey}`,
    "X-Goog-Api-Key": apiKey
  };
  if (textBody) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(textBody);
  }

  return new Promise((resolve, reject) => {
    const req = client.request({
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method,
      headers,
      timeout: 30000
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 240)}`));
          return;
        }
        const contentType = res.headers["content-type"] || "";
        if (contentType.includes("json")) {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`Invalid JSON response: ${error.message}`));
          }
        } else {
          resolve(data);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    if (textBody) {
      req.write(textBody);
    }
    req.end();
  });
}

function extractScreens(payload) {
  if (!payload) {
    return [];
  }
  if (typeof payload === "string") {
    return payload.trim() ? [{ name: "stitch-export", html: payload }] : [];
  }
  if (Array.isArray(payload)) {
    return payload.flatMap(extractScreens);
  }
  const buckets = [
    payload.screens,
    payload.pages,
    payload.exports,
    payload.results,
    payload.data && payload.data.screens
  ].filter(Array.isArray);
  if (buckets.length) {
    return buckets.flatMap((items) => items.map(normalizeScreen).filter(Boolean));
  }
  const single = normalizeScreen(payload);
  return single ? [single] : [];
}

function normalizeScreen(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return { name: "screen", html: value };
  }
  const html = value.html || value.content || value.markup || value.document || "";
  const name = value.name || value.title || value.id || "screen";
  if (!html && !value.url) {
    return null;
  }
  return { name, html: html || `<a href="${escapeHtml(value.url)}">${escapeHtml(value.url)}</a>` };
}

function asHtml(screen) {
  const html = String(screen.html || "");
  if (/<html[\s>]/i.test(html)) {
    return html;
  }
  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    '  <meta charset="utf-8">',
    `  <title>${escapeHtml(screen.name)}</title>`,
    "</head>",
    "<body>",
    html,
    "</body>",
    "</html>"
  ].join("\n");
}

function markDesignAssets(status, files, note) {
  const now = new Date().toISOString();
  state.artifacts = state.artifacts || {};
  state.artifacts.design_assets = {
    ...(state.artifacts.design_assets || {}),
    status,
    path: path.relative(path.dirname(runDir), outputDir).replace(/\\/g, "/"),
    evidence: [
      ...(((state.artifacts.design_assets || {}).evidence) || []),
      note,
      ...files
    ]
  };
  state.delivery.updated_at = now;
  state.log = Array.isArray(state.log) ? state.log : [];
  state.log.push({
    at: now,
    state: state.current_state,
    note
  });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
}

function slug(value) {
  return String(value || "screen")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "screen";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseArgs(rawArgs) {
  const parsed = {
    stateFile: "",
    url: "",
    projectId: "",
    method: "",
    params: "",
    listMethods: false,
    listScreens: false,
    rest: false
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--") && !parsed.stateFile) {
      parsed.stateFile = arg;
      continue;
    }
    switch (arg) {
      case "--url":
        parsed.url = rawArgs[++index] || "";
        break;
      case "--project-id":
        parsed.projectId = rawArgs[++index] || "";
        break;
      case "--method":
        parsed.method = rawArgs[++index] || "";
        break;
      case "--params":
        parsed.params = rawArgs[++index] || "";
        break;
      case "--list-methods":
        parsed.listMethods = true;
        break;
      case "--list-screens":
        parsed.listScreens = true;
        break;
      case "--rest":
        parsed.rest = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}
