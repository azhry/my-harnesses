#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadWorkflowState } = require("./lib/state-store");

const args = parseArgs(process.argv.slice(2));

if (args.errors.length || !args.match) {
  console.error([
    "Usage: node scripts/audit-codex-sessions.js --match TEXT [--sessions-dir DIR] [--state runs/<ID>/workflow-state.json]",
    "",
    "Scans Codex JSONL session files for a project/run marker and reports harness-relevant anomalies.",
    "Use this for evaluate-and-fix reviews after a real delivery run."
  ].join("\n"));
  for (const error of args.errors) console.error(`- ${error}`);
  process.exit(1);
}

const sessionsDir = path.resolve(args.sessionsDir || path.join(process.env.HOME || "", ".codex", "sessions"));
const files = collectFiles(sessionsDir)
  .filter((file) => file.endsWith(".jsonl"))
  .filter((file) => fileContains(file, args.match));

const summaries = files.map(readSessionSummary).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
const findings = [];

for (const summary of summaries) {
  if (summary.isApprovalReview) {
    continue;
  }
  if (summary.stopSeen && summary.writeAfterStop) {
    findings.push({
      severity: "high",
      session: summary.sessionId,
      title: "Session wrote after receiving STOP/superseded instruction",
      evidence: summary.file
    });
  }
  if (summary.stopSeen && summary.writeBeforeStop) {
    findings.push({
      severity: "medium",
      session: summary.sessionId,
      title: "Session made file changes before a STOP/superseded instruction arrived",
      evidence: summary.file
    });
  }
  if (summary.branchProtectionMentions > 0) {
    findings.push({
      severity: "medium",
      session: summary.sessionId,
      title: "Branch protection or same-account review blocked submission",
      evidence: `${summary.branchProtectionMentions} mention(s)`
    });
  }
  if (summary.rawMergeMentions > 0) {
    findings.push({
      severity: "medium",
      session: summary.sessionId,
      title: "Raw PR merge path was discussed or attempted",
      evidence: `${summary.rawMergeMentions} mention(s)`
    });
  }
  if (summary.directProjectCompletionCalls > 0) {
    findings.push({
      severity: "high",
      session: summary.sessionId,
      title: "Session directly marked a Linear project Completed",
      evidence: `${summary.directProjectCompletionCalls} connector call(s); project completion requires explicit human completion approval and must not be inferred from task status`
    });
  }
  if (summary.completionClaimsBeforeUiDiscovery > 0) {
    findings.push({
      severity: "high",
      session: summary.sessionId,
      title: "Session claimed completion before satisfying UI/P0 discovery",
      evidence: `${summary.completionClaimsBeforeUiDiscovery} completion claim(s) before UI scan evidence`
    });
  }
}

const duplicateCompletes = duplicateTaskCompletes(args.stateFile);
for (const item of duplicateCompletes) {
  findings.push({
    severity: "medium",
    session: "workflow-state",
    title: `Task ${item.taskId} has duplicate completion events`,
    evidence: `${item.count} task_complete events`
  });
}

const missingLeaseSessions = args.stateFile ? leasesMissingSessions(args.stateFile, summaries) : [];
for (const lease of missingLeaseSessions) {
  findings.push({
    severity: "low",
    session: lease.agent_id,
    title: `Recorded ${lease.role} lease has no matching Codex session in scanned files`,
    evidence: lease.task_id
  });
}

console.log(`Codex session audit for "${args.match}"`);
console.log(`sessions_dir: ${sessionsDir}`);
console.log(`matched_sessions: ${summaries.length}`);
if (args.stateFile) console.log(`state: ${path.resolve(args.stateFile)}`);
console.log("");

for (const summary of summaries) {
  console.log([
    `- ${summary.sessionId || path.basename(summary.file)}`,
    summary.startedAt ? `started=${summary.startedAt}` : "",
    summary.cwd ? `cwd=${summary.cwd}` : "",
    summary.isApprovalReview ? "kind=approval-review" : "",
    summary.userTitle ? `title="${summary.userTitle}"` : "",
    `writes=${summary.writeEvents}`,
    summary.stopSeen ? "stop_seen=yes" : ""
  ].filter(Boolean).join(" "));
}

console.log("");
console.log("Findings");
if (!findings.length) {
  console.log("- none");
} else {
  for (const finding of findings) {
    console.log(`- [${finding.severity}] ${finding.title} (${finding.session}) ${finding.evidence}`);
  }
}

function parseArgs(raw) {
  const parsed = { match: "", sessionsDir: "", stateFile: "", errors: [] };
  for (let index = 0; index < raw.length; index += 1) {
    const arg = raw[index];
    if (arg === "--match" || arg === "--project" || arg === "--contains") {
      parsed.match = raw[++index] || "";
    } else if (arg === "--sessions-dir") {
      parsed.sessionsDir = raw[++index] || "";
    } else if (arg === "--state") {
      parsed.stateFile = raw[++index] || "";
    } else {
      parsed.errors.push(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function collectFiles(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else out.push(full);
  }
  return out;
}

function fileContains(file, needle) {
  try {
    return fs.readFileSync(file, "utf8").toLowerCase().includes(String(needle).toLowerCase());
  } catch {
    return false;
  }
}

function readSessionSummary(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const summary = {
    file,
    sessionId: "",
    startedAt: "",
    cwd: "",
    userTitle: "",
    isApprovalReview: false,
    writeEvents: 0,
    stopSeen: false,
    writeBeforeStop: false,
    writeAfterStop: false,
    branchProtectionMentions: 0,
    rawMergeMentions: 0,
    directProjectCompletionCalls: 0,
    completionClaimsBeforeUiDiscovery: 0,
    uiDiscoverySeen: false
  };
  for (const line of lines) {
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    const text = textOf(item);
    summary.startedAt ||= item.timestamp || "";
    summary.sessionId ||= sessionIdOf(item, text);
    summary.cwd ||= cwdOf(item, text);
    if (/codex-auto-review|guardian subagent|Codex agent history whose request action/i.test(text)) {
      summary.isApprovalReview = true;
    }
    if (!summary.userTitle && /user_message|input_text/.test(text)) {
      const title = text.match(/(?:Task:|input_text|user_message)\s+([^<\n]{1,120})/i);
      if (title) summary.userTitle = title[1].trim();
    }
    const isWrite = isActualWriteEvent(item, text);
    if (isWrite) {
      summary.writeEvents += 1;
      if (summary.stopSeen) summary.writeAfterStop = true;
      else summary.writeBeforeStop = true;
    }
    if (isActualStopInstruction(item, text)) {
      summary.stopSeen = true;
    }
    if (/branch protection|approving review|self-approval|same GitHub account|REVIEW_REQUIRED/i.test(text)) {
      summary.branchProtectionMentions += 1;
    }
    if (/gh pr merge|--admin|admin merge/i.test(text)) {
      summary.rawMergeMentions += 1;
    }
    if (/"name"\s*:\s*"_save_project"|"state"\s*:\s*"Completed"|_save_project/i.test(text)) {
      summary.directProjectCompletionCalls += 1;
    }
    if (/frontend\/src|mockData|AuthContext|BookSession|AddStudent|DailyAgenda|UI scan|P0 feature/i.test(text)) {
      summary.uiDiscoverySeen = true;
    }
    if (!summary.uiDiscoverySeen && /\b(project|delivery|FlexQuota)\b.{0,120}\b(Completed|complete|done)\b/i.test(text)) {
      summary.completionClaimsBeforeUiDiscovery += 1;
    }
  }
  return summary;
}

function isActualWriteEvent(item, text) {
  if (item.type === "event_msg" && /patch_apply_end/i.test(text)) return true;
  if (item.type === "response_item" && /custom_tool_call/.test(text) && /apply_patch|exec_command/.test(text)) return true;
  if (item.type === "response_item" && /function_call/.test(text) && /\b(git add|git commit|git push)\b/.test(text)) return true;
  return false;
}

function isActualStopInstruction(item, text) {
  if (!/\bSTOP\b|superseded|do not make any further file changes|do not run commands/i.test(text)) {
    return false;
  }
  if (/TRANSCRIPT|transcript delta|Codex agent history whose request action/i.test(text)) {
    return false;
  }
  return item.type === "event_msg" && /user_message/.test(text) ||
    item.type === "response_item" && /message/.test(text) && /user|input_text/.test(text);
}

function textOf(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  if (typeof value === "object") return Object.values(value).map(textOf).join(" ");
  return String(value);
}

function sessionIdOf(item, text) {
  return item.session_id ||
    item.conversation_id ||
    firstMatch(text, /\b019[0-9a-f]{5}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i) ||
    "";
}

function cwdOf(item, text) {
  return item.cwd ||
    firstMatch(text, /<cwd>([^<]+)<\/cwd>/) ||
    firstMatch(text, /\b\/Users\/[^"\s]+\/Works\/[^"\s<]+/) ||
    "";
}

function firstMatch(text, pattern) {
  const match = String(text || "").match(pattern);
  return match ? match[1] || match[0] : "";
}

function duplicateTaskCompletes(stateFile) {
  if (!stateFile) return [];
  const eventFile = path.join(path.dirname(path.resolve(stateFile)), "events.ndjson");
  if (!fs.existsSync(eventFile)) return [];
  const counts = new Map();
  for (const line of fs.readFileSync(eventFile, "utf8").split(/\r?\n/).filter(Boolean)) {
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    if (item.type === "task_complete" && item.task_id) {
      counts.set(item.task_id, (counts.get(item.task_id) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([taskId, count]) => ({ taskId, count }));
}

function leasesMissingSessions(stateFile, sessionSummaries) {
  if (!stateFile) return [];
  let state;
  try {
    state = loadWorkflowState(path.resolve(stateFile));
  } catch {
    return [];
  }
  const seen = new Set(sessionSummaries.map((summary) => summary.sessionId).filter(Boolean));
  const leases = state.agent_dispatch && Array.isArray(state.agent_dispatch.leases)
    ? state.agent_dispatch.leases
    : [];
  return leases.filter((lease) => lease.agent_id && /^019/i.test(lease.agent_id) && !seen.has(lease.agent_id));
}
