#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const {
  ensureRunMemory,
  loadJson,
  writeJson
} = require("./lib/memory-store");

const args = parseArgs(process.argv.slice(2));

if (!args.stateFile) {
  console.error([
    "Usage: node scripts/fetch-stitch-designs.js runs/<DELIVERY_ID>/workflow-state.json [options]",
    "",
    "Required (one of):",
    "  --url <stitch_url>            Full URL to Stitch project or JSON-RPC endpoint",
    "  --project-id <id>             Stitch project ID (uses default Stitch URL)",
    "",
    "Auth:",
    "  --api-key <key>               Google Stitch API key",
    "  (or set GOOGLE_STITCH_API_KEY env var)",
    "",
    "JSON-RPC options (Stitch uses JSON-RPC, not REST):",
    "  --method <name>               JSON-RPC method name (default: getScreens)",
    "  --params <json>               JSON-RPC params as JSON string (default: {})",
    "  --list-methods                Try common method names and report which work",
    "",
    "REST fallback:",
    "  --rest                        Use GET request instead of JSON-RPC POST",
    "",
    "Screen overrides:",
    "  --screen-names <a,b,c>        Comma-separated screen names",
    "  --list-screens                Only list available screens, do not save",
    "",
    "Examples:",
    "  GOOGLE_STITCH_API_KEY=xxx node scripts/fetch-stitch-designs.js runs/NLA-001/workflow-state.json --project-id abc123",
    "  node scripts/fetch-stitch-designs.js runs/NLA-001/workflow-state.json --url https://stitch.google.com/api --api-key xxx --method exportScreens --params '{\"projectId\":\"abc123\"}'",
    "  node scripts/fetch-stitch-designs.js runs/NLA-001/workflow-state.json --url https://stitch.google.com/s/abc --rest"
  ].join("\n"));
  process.exit(1);
}

function parseArgs(rawArgs) {
  const parsed = {
    stateFile: "",
    url: "",
    projectId: "",
    apiKey: "",
    method: "getScreens",
    params: "{}",
    rest: false,
    listMethods: false,
    screenNames: [],
    listScreens: false
  };

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === "--url") parsed.url = rawArgs[++i] || "";
    else if (arg === "--project-id") parsed.projectId = rawArgs[++i] || "";
    else if (arg === "--api-key") parsed.apiKey = rawArgs[++i] || "";
    else if (arg === "--method") parsed.method = rawArgs[++i] || "";
    else if (arg === "--params") parsed.params = rawArgs[++i] || "{}";
    else if (arg === "--rest") parsed.rest = true;
    else if (arg === "--list-methods") parsed.listMethods = true;
    else if (arg === "--screen-names") parsed.screenNames = (rawArgs[++i] || "").split(",").map(s => s.trim()).filter(Boolean);
    else if (arg === "--list-screens") parsed.listScreens = true;
    else if (!arg.startsWith("--") && !parsed.stateFile) parsed.stateFile = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  parsed.apiKey = parsed.apiKey || process.env.GOOGLE_STITCH_API_KEY || "";
  return parsed;
}

function httpRequest(url, method, body, apiKey, contentType) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const mod = urlObj.protocol === "https:" ? https : http;
    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        "User-Agent": "agent-spec-ops/fetch-stitch-designs"
      },
      timeout: 30000
    };
    if (contentType) opts.headers["Content-Type"] = contentType;
    if (apiKey) {
      opts.headers["Authorization"] = `Bearer ${apiKey}`;
      opts.headers["X-API-Key"] = apiKey;
    }
    if (body) opts.headers["Content-Length"] = Buffer.byteLength(body);
    const req = mod.request(opts, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        contentType: (res.headers["content-type"] || "").toLowerCase(),
        data
      }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
    if (body) req.write(body);
    req.end();
  });
}

function parseStitchProjectUrl(url) {
  const patterns = [
    /stitch\.google\.com\/(?:projects?|s|view|export)\/([a-zA-Z0-9_-]+)/i,
    /stitch\.googleapis\.com\/(?:v\d\/)?projects\/([a-zA-Z0-9_-]+)/i
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  const idMatch = url.match(/([a-zA-Z0-9_-]{8,})/);
  return idMatch ? idMatch[1] : "";
}

function isJsonRpcResponse(data) {
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === "object" && parsed.jsonrpc === "2.0";
  } catch {
    return false;
  }
}

function hasJsonRpcError(data) {
  if (!isJsonRpcResponse(data)) return null;
  const parsed = JSON.parse(data);
  if (parsed.error) {
    return {
      code: parsed.error.code,
      message: parsed.error.message,
      data: parsed.error.data
    };
  }
  return null;
}

function determineUrl(projectId, givenUrl) {
  if (givenUrl && !givenUrl.includes("stitch.google.com")) {
    return `https://stitch.google.com/api/jsonrpc`;
  }
  if (givenUrl) return givenUrl;
  return `https://stitch.google.com/api/jsonrpc`;
}

function extractScreensFromHtml(html) {
  const screens = [];
  const sections = html.split(/<section\b[^>]*>/gi);
  if (sections.length > 1) {
    for (let i = 1; i < sections.length; i++) {
      const section = sections[i];
      const idMatch = section.match(/id=["']([^"']+)["']/i);
      const name = idMatch ? idMatch[1] : `section-${String(i - 1).padStart(2, "0")}`;
      const content = section.split("</section>")[0];
      screens.push({ name, html: `<section>${content}</section>` });
    }
    return screens;
  }
  const screenWrappers = html.match(/<div[^>]*class=["'][^"']*screen[^"']*["'][^>]*>[\s\S]*?<\/div>/gi);
  if (screenWrappers) {
    screenWrappers.forEach((sw, i) => {
      const idMatch = sw.match(/id=["']([^"']+)["']/i);
      screens.push({ name: idMatch ? idMatch[1] : `screen-${String(i).padStart(2, "0")}`, html: sw });
    });
    return screens;
  }
  return [];
}

function extractScreensFromJson(data) {
  if (Array.isArray(data)) {
    return data.map((item, i) => ({
      name: item.name || item.title || item.id || `screen-${String(i).padStart(2, "0")}`,
      html: item.html || item.content || item.markup || JSON.stringify(item)
    }));
  }
  for (const key of ["screens", "pages", "exports", "results", "data"]) {
    const arr = data[key];
    if (Array.isArray(arr)) {
      return arr.map((item, i) => ({
        name: item.name || item.title || item.id || `${key}-${String(i).padStart(2, "0")}`,
        html: item.html || item.content || item.markup || JSON.stringify(item)
      }));
    }
  }
  if (data.html) return [{ name: "stitch-output", html: data.html }];
  if (data.markup) return [{ name: "stitch-output", html: data.markup }];
  return [];
}

function buildHtmlDocument(title, content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
</style>
</head>
<body>
${content}
</body>
</html>`;
}

function sanitizeFileName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").substring(0, 60) || "screen";
}

const COMMON_METHODS = [
  "getScreens", "listScreens", "exportScreens",
  "getProject", "getProjects", "listProjects",
  "renderScreens", "exportProject", "getExport",
  "getDesigns", "listDesigns", "fetchScreens",
  "generateScreens", "getGeneratedScreens",
  "stitch.getScreens", "stitch.listScreens",
  "screens.list", "project.export",
  "getPage", "getPages",
  "getUiScreens", "exportUiScreens"
];

async function tryMethods(url, apiKey, projectId) {
  console.log("Probing common JSON-RPC methods...\n");
  for (const method of COMMON_METHODS) {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      method,
      params: projectId ? { projectId } : {},
      id: 1
    });
    try {
      const res = await httpRequest(url, "POST", body, apiKey, "application/json");
      const err = hasJsonRpcError(res.data);
      if (err) {
        if (err.code === -32601) continue;
        console.log(`  ${method}: error [${err.code}] ${err.message}`);
      } else {
        console.log(`  ${method}: OK`);
        return method;
      }
    } catch (e) {
      console.log(`  ${method}: ${e.message}`);
    }
  }
  console.log("\nNo working method found. Try --method <name> to specify manually.");
  return "";
}

async function main() {
  const statePath = path.resolve(args.stateFile);
  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch (e) {
    console.error(`Cannot read state file: ${statePath}`);
    process.exit(1);
  }

  const deliveryId = state.delivery && state.delivery.id ? state.delivery.id : "UNKNOWN";
  const runDir = path.dirname(statePath);
  const projectId = args.projectId || (args.url ? parseStitchProjectUrl(args.url) : "");
  const effectiveUrl = determineUrl(projectId, args.url);
  const apiKey = args.apiKey;

  if (!apiKey) {
    console.error("No Google Stitch API key found. Set GOOGLE_STITCH_API_KEY env var or pass --api-key.");
    process.exit(1);
  }

  if (args.listMethods) {
    await tryMethods(effectiveUrl, apiKey, projectId);
    return;
  }

  const assetsDir = path.join(runDir, "design-assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  state.artifacts = state.artifacts || {};
  state.artifacts.design_assets = state.artifacts.design_assets || {
    status: "in_progress", path: "", url: "", content_hash: "", evidence: []
  };
  state.artifacts.design_assets.status = "in_progress";

  console.log(`Delivery: ${deliveryId}`);
  console.log(`Project ID: ${projectId || "(not provided)"}`);
  console.log(`Endpoint: ${effectiveUrl}`);
  console.log(`Output: ${assetsDir}\n`);

  let screens = [];
  let fetchErrors = [];
  let rawResponse = "";

  if (args.rest) {
    console.log(`Fetching (REST GET): ${effectiveUrl}`);
    try {
      const response = await httpRequest(effectiveUrl, "GET", null, apiKey, null);
      rawResponse = response.data;
      if (response.statusCode >= 400) {
        fetchErrors.push(`HTTP ${response.statusCode}: ${response.data.slice(0, 200)}`);
      } else if (response.contentType.includes("json")) {
        const jsonData = JSON.parse(response.data);
        screens = extractScreensFromJson(jsonData);
      } else if (response.contentType.includes("html")) {
        screens = extractScreensFromHtml(response.data);
        if (screens.length === 0) {
          screens.push({ name: "stitch-output", html: response.data });
        }
      } else {
        screens.push({ name: "stitch-output", html: `<pre>${response.data}</pre>` });
      }
    } catch (e) {
      fetchErrors.push(`REST fetch failed: ${e.message}`);
    }
  } else {
    const rpcParams = args.params ? JSON.parse(args.params) : {};
    if (projectId && !rpcParams.projectId) rpcParams.projectId = projectId;
    const rpcBody = JSON.stringify({
      jsonrpc: "2.0",
      method: args.method,
      params: rpcParams,
      id: 1
    });
    console.log(`Calling JSON-RPC: ${args.method}`);
    try {
      const response = await httpRequest(effectiveUrl, "POST", rpcBody, apiKey, "application/json");
      rawResponse = response.data;
      const rpcError = hasJsonRpcError(response.data);
      if (rpcError) {
        fetchErrors.push(`JSON-RPC error [${rpcError.code}]: ${rpcError.message}`);
      } else {
        const jsonData = JSON.parse(response.data);
        const result = jsonData.result;
        if (result) {
          screens = extractScreensFromJson(result);
        } else {
          fetchErrors.push("JSON-RPC response has no 'result' field");
        }
      }
    } catch (e) {
      fetchErrors.push(`JSON-RPC call failed: ${e.message}`);
    }
  }

  if (screens.length > 0 && args.screenNames.length > 0) {
    screens = screens.map((s, i) => ({
      ...s,
      name: args.screenNames[i] || s.name
    }));
  }

  if (args.listScreens) {
    console.log("\nAvailable screens:");
    screens.forEach((s, i) => console.log(`  ${String(i).padStart(2, "0")}: ${s.name}`));
    if (fetchErrors.length > 0) console.log("\nErrors:", fetchErrors.join("; "));
    return;
  }

  const evidence = [];
  if (screens.length > 0) {
    for (let i = 0; i < screens.length; i++) {
      const s = screens[i];
      const seq = String(i).padStart(2, "0");
      const safeName = sanitizeFileName(s.name);
      const fileName = `${seq}-${safeName}.html`;
      const filePath = path.join(assetsDir, fileName);
      const hasDocType = /<!DOCTYPE html/i.test(s.html) || (/<html/i.test(s.html) && /<head/i.test(s.html));
      const fullHtml = hasDocType ? s.html : buildHtmlDocument(s.name, s.html);
      fs.writeFileSync(filePath, fullHtml, "utf8");
      evidence.push(path.relative(path.resolve(__dirname, ".."), filePath).replace(/\\/g, "/"));
    }
    console.log(`\nSaved ${screens.length} design screen(s) to design-assets/`);
    evidence.forEach(e => console.log(`  ${e}`));
  }

  if (screens.length === 0 && fetchErrors.length === 0) {
    fetchErrors.push("No screens extracted from response");
  }

  const relativeAssetsDir = path.relative(path.resolve(__dirname, ".."), assetsDir).replace(/\\/g, "/");
  const now = new Date().toISOString();
  state.artifacts.design_assets = {
    status: screens.length > 0 ? "ready_for_review" : "failed",
    path: relativeAssetsDir,
    url: effectiveUrl,
    content_hash: "",
    screen_count: screens.length,
    evidence,
    fetch_errors: fetchErrors.length > 0 ? fetchErrors : undefined
  };

  state.delivery.updated_at = now;
  state.log = state.log || [];
  state.log.push({
    at: now,
    state: state.current_state,
    note: `Stitch designs: ${screens.length} screen(s) fetched, ${fetchErrors.length} error(s)`
  });

  writeJson(statePath, ensureRunMemory(statePath, state).state);
  console.log(`\nStatus: ${state.artifacts.design_assets.status}`);

  if (fetchErrors.length > 0) {
    console.error(`\nErrors (${fetchErrors.length}):`);
    fetchErrors.forEach(e => console.error(`  - ${e}`));
    if (!rawResponse.includes("jsonrpc")) {
      console.error(`\nRaw response (first 500 chars):\n${rawResponse.slice(0, 500)}`);
    }
  }

  if (screens.length === 0) {
    console.error("\nNo screens fetched. Suggestions:");
    console.error("  - Run with --list-methods to probe available JSON-RPC methods");
    console.error("  - Use --method <name> to specify the correct method");
    console.error("  - Use --params '{\"key\":\"value\"}' to pass required params");
    console.error("  - If the endpoint uses REST, add --rest");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
