#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { loadDashboardData, loadRun, root, runIds } = require("./lib/monitor-data");

const args = parseArgs(process.argv.slice(2));
const host = args.host || "127.0.0.1";
const port = Number(args.port || process.env.PORT || 8787);
const uiDir = path.join(root, "ui", "monitor");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

const server = http.createServer((request, response) => {
  try {
    route(request, response);
  } catch (error) {
    sendJson(response, 500, {
      error: error.message
    });
  }
});

server.listen(port, host, () => {
  console.log(`Run monitor listening on http://${host}:${port}`);
});

function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);

  if (url.pathname === "/" || url.pathname === "/index.html") {
    sendFile(response, path.join(uiDir, "index.html"));
    return;
  }

  if (url.pathname === "/api/summary" || url.pathname === "/api/runs") {
    sendJson(response, 200, loadDashboardData());
    return;
  }

  if (url.pathname.startsWith("/api/runs/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/runs/", ""));
    if (!runIds().includes(id)) {
      sendJson(response, 404, {
        error: `Run not found: ${id}`
      });
      return;
    }
    sendJson(response, 200, loadRun(id));
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    const assetName = url.pathname.replace("/assets/", "");
    const assetPath = path.resolve(uiDir, assetName);
    if (!assetPath.startsWith(uiDir) || !fs.existsSync(assetPath)) {
      sendJson(response, 404, {
        error: "Asset not found"
      });
      return;
    }
    sendFile(response, assetPath);
    return;
  }

  sendJson(response, 404, {
    error: "Not found"
  });
}

function sendFile(response, file) {
  const extension = path.extname(file);
  response.writeHead(200, {
    "content-type": contentTypes[extension] || "application/octet-stream",
    "cache-control": "no-store"
  });
  fs.createReadStream(file).pipe(response);
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(rawArgs) {
  const parsed = {
    host: "",
    port: ""
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    const value = rawArgs[index + 1] || "";
    if (arg === "--host") {
      parsed.host = value;
      index += 1;
      continue;
    }
    if (arg === "--port") {
      parsed.port = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}
