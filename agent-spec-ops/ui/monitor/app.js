const store = {
  data: null,
  selectedRunId: "",
  filter: ""
};

const summaryGrid = document.querySelector("#summaryGrid");
const runList = document.querySelector("#runList");
const runDetail = document.querySelector("#runDetail");
const refreshButton = document.querySelector("#refreshButton");
const lastUpdated = document.querySelector("#lastUpdated");
const runFilter = document.querySelector("#runFilter");

const SECTION_HELP = {
  "Current State": "Use this to see the workflow checkpoint the harness is currently in. It helps decide whether the next action is planning, implementation, verification, or human review.",
  "Run Snapshot": "Use this for a compact read on tool readiness, tracker and code-host status, task storage mode, memory volume, token usage, and last update time.",
  "Human Gates": "Use this to see which approval gates are ready, approved, blocked, or waiting for changes before the harness can safely advance.",
  "Loop Pressure": "Use this to spot retry loops that are active or failing, including the attempt count and latest reason the loop did not pass.",
  "Task Lanes": "Use this as the execution board. It groups product, planning, frontend, backend, integration, and handoff tasks with evidence, branch, merge, and token signals.",
  "Role Board": "Use this to see what each harness role is doing now, which task it owns, and whether that role is complete, blocked, or waiting.",
  "Integration Checks": "Use this to inspect contract and scope verification before merge or final review. Failed checks usually route work back to dev or planning.",
  "Dispatch": "Use this to confirm whether the harness is allowed to auto-spawn agents, run frontend and backend in parallel, and maintain active leases.",
  "Token Cost": "Use this to track total token volume and cost for the selected run, split by input, output, cached input, and reasoning tokens.",
  "Memory Stream": "Use this as the run timeline. It records important events such as disapprovals, loop failures, tool readiness, spawns, and merge actions.",
  "Eval Ledger": "Use this to review scored checks from each loop so the harness can compare quality over time and decide what needs another pass.",
  "Token Ledger": "Use this to audit token and cost rows at run, task, eval, role, or tool scope. It is the raw trail behind the cost summary.",
  "Remarks": "Use this to capture human and agent observations: disapprovals, changes, risks, reusable patterns, and completed work."
};

refreshButton.addEventListener("click", () => refresh());
runFilter.addEventListener("input", (event) => {
  store.filter = event.target.value.toLowerCase();
  render();
});
window.addEventListener("hashchange", () => {
  store.selectedRunId = decodeURIComponent(location.hash.replace(/^#/, ""));
  render();
});

refresh();
setInterval(refresh, 15000);

async function refresh() {
  refreshButton.disabled = true;
  try {
    const response = await fetch("/api/runs", { cache: "no-store" });
    store.data = await response.json();
    if (!store.selectedRunId) {
      store.selectedRunId = decodeURIComponent(location.hash.replace(/^#/, "")) || firstRunId();
    }
    render();
  } catch (error) {
    runDetail.innerHTML = `<div class="empty-state">Unable to load runs: ${escapeHtml(error.message)}</div>`;
  } finally {
    refreshButton.disabled = false;
  }
}

function firstRunId() {
  return store.data && store.data.runs && store.data.runs[0] ? store.data.runs[0].id : "";
}

function selectedRun() {
  if (!store.data || !store.data.runs.length) return null;
  return store.data.runs.find((run) => run.id === store.selectedRunId) || store.data.runs[0];
}

function render() {
  if (!store.data) return;
  renderSignals(store.data.summary);
  renderRunStack(store.data.runs);
  renderRunDetail(selectedRun());
  lastUpdated.textContent = `Updated ${formatDateTime(store.data.generated_at)}`;
}

function renderSignals(summary) {
  const metrics = [
    ["Runs", summary.total_runs],
    ["Active", summary.active_runs],
    ["Blocked", summary.blocked_runs],
    ["Tasks", summary.total_tasks],
    ["Tokens", compactNumber(summary.total_tokens)],
    ["Cost", money(summary.total_token_cost_usd)],
    ["Events", summary.memory_events],
    ["Knowledge", summary.knowledge_cards]
  ];
  summaryGrid.innerHTML = metrics.map(([label, value], index) => `
    <div class="signal">
      <span class="signal-index">${String(index + 1).padStart(2, "0")}</span>
      <strong class="signal-value">${escapeHtml(value)}</strong>
      <span class="signal-label">${escapeHtml(label)}</span>
    </div>
  `).join("");
}

function renderRunStack(runs) {
  const filtered = runs.filter((run) => {
    const haystack = `${run.id} ${run.title} ${run.current_state}`.toLowerCase();
    return haystack.includes(store.filter);
  });

  if (!filtered.length) {
    runList.innerHTML = `<div class="blank">No runs found</div>`;
    return;
  }

  runList.innerHTML = filtered.map((run) => `
    <button class="run-entry ${run.id === store.selectedRunId ? "active" : ""}" type="button" data-run-id="${escapeAttribute(run.id)}">
      <span class="state-marker ${statusClass(run.current_state)}"></span>
      <span class="run-entry-body">
        <span class="run-entry-top">
          <span class="run-title">${escapeHtml(run.title || run.id)}</span>
          ${tag(run.current_state)}
        </span>
        <span class="run-code">${escapeHtml(run.id)} / ${escapeHtml(formatDateTime(run.updated_at))}</span>
        <span class="run-entry-foot">
          ${microTag(`${run.tasks.total} tasks`)}
          ${microTag(`${run.memory.event_count} events`)}
          ${run.token_usage.total_tokens ? microTag(`${compactNumber(run.token_usage.total_tokens)} tokens`) : ""}
          ${run.gates.waiting ? microTag(`${run.gates.waiting} gates`) : ""}
        </span>
      </span>
    </button>
  `).join("");

  for (const button of runList.querySelectorAll("[data-run-id]")) {
    button.addEventListener("click", () => {
      store.selectedRunId = button.dataset.runId;
      location.hash = encodeURIComponent(store.selectedRunId);
      render();
    });
  }
}

function renderRunDetail(run) {
  if (!run) {
    runDetail.innerHTML = `<div class="empty-state">No runs yet. Create one with the harness and this observatory will populate automatically.</div>`;
    return;
  }

  runDetail.innerHTML = `
    <header class="run-hero">
      <div class="hero-main">
        <span class="run-code">${escapeHtml(run.id)} / ${escapeHtml(formatDateTime(run.updated_at))}</span>
        <h2>${escapeHtml(run.title || run.id)}</h2>
        <p class="hero-summary">${escapeHtml(run.request_summary || "No request summary recorded yet.")}</p>
      </div>
      <div class="hero-state">
        <div class="hero-state-label">
          <span>Current State</span>
          ${helpButton("Current State", "on-dark")}
        </div>
        <strong>${escapeHtml(labelize(run.current_state))}</strong>
      </div>
    </header>

    <div class="detail-matrix">
      ${module("Run Snapshot", snapshotHtml(run), "span-4")}
      ${module("Human Gates", gatesHtml(run.gates.entries), "span-4")}
      ${module("Loop Pressure", loopsHtml(run.loops.entries), "span-4")}
      ${module("Task Lanes", taskLanesHtml(run.tasks.entries), "span-12")}
      ${module("Role Board", rolesHtml(run.roles), "span-4")}
      ${module("Integration Checks", integrationHtml(run.integration, run.contracts), "span-4")}
      ${module("Dispatch", dispatchHtml(run.dispatch), "span-4")}
      ${module("Token Cost", tokenSummaryHtml(run.token_usage), "span-4")}
      ${module("Memory Stream", eventsHtml(run.recent_events), "span-6")}
      ${module("Eval Ledger", evalsHtml(run.recent_evals), "span-4")}
      ${module("Token Ledger", tokenLedgerHtml(run.recent_token_usage), "span-8")}
      ${module("Remarks", remarksHtml(run.recent_remarks), "span-12")}
    </div>
  `;
}

function module(title, body, span) {
  return `
    <section class="module ${span}">
      <div class="module-head">
        <h3>${escapeHtml(title)}</h3>
        ${helpButton(title)}
      </div>
      <div class="module-body">${body}</div>
    </section>
  `;
}

function helpButton(title, variant = "") {
  const helpText = SECTION_HELP[title] || "Use this section to inspect the selected run.";
  const classes = ["section-help", variant].filter(Boolean).join(" ");
  return `<button class="${classes}" type="button" aria-label="${escapeAttribute(title)} usage" data-tooltip="${escapeAttribute(helpText)}">?</button>`;
}

function snapshotHtml(run) {
  return `
    <div class="datum-grid">
      ${datum("Readiness", tag(run.tool_readiness.status))}
      ${datum("Tracker", `${escapeHtml(run.tool_readiness.product_tracker || "unset")} ${tag(capabilityStatus(run.tool_readiness.capabilities, "product_tracker"))}`)}
      ${datum("Code Host", `${escapeHtml(run.tool_readiness.code_host || "unset")} ${tag(capabilityStatus(run.tool_readiness.capabilities, "code_host"))}`)}
      ${datum("Task Source", `${escapeHtml(run.task_provider.mode || "unknown")} ${tag(run.task_provider.sync_status || "unknown")}`)}
      ${datum("Memory", `${escapeHtml(run.memory.event_count)} events / ${escapeHtml(run.memory.eval_count)} evals`)}
      ${datum("Tokens", `${compactNumber(run.token_usage.total_tokens)} / ${money(run.token_usage.total_cost_usd)}`)}
      ${datum("Updated", formatDateTime(run.updated_at))}
    </div>
  `;
}

function gatesHtml(gates) {
  return listRows(gates, (gate) => `
    <div class="rail-row">
      <div>
        <div class="row-title">${escapeHtml(labelize(gate.name))}</div>
        <div class="row-note">${escapeHtml(gate.approver || "No approver")} / ${escapeHtml(gate.evidence_count)} evidence</div>
      </div>
      ${tag(gate.status)}
    </div>
  `);
}

function loopsHtml(loops) {
  return listRows(loops, (loop) => `
    <div class="rail-row">
      <div>
        <div class="row-title">${escapeHtml(labelize(loop.name))}</div>
        <div class="row-note">Attempt ${escapeHtml(loop.attempt)} of ${escapeHtml(loop.max_attempts)}${loop.last_failure ? ` / ${escapeHtml(loop.last_failure)}` : ""}</div>
      </div>
      ${tag(loop.status)}
    </div>
  `);
}

function rolesHtml(roles) {
  return listRows(Object.entries(roles), ([name, role]) => `
    <div class="rail-row">
      <div>
        <div class="row-title">${escapeHtml(labelize(name))}</div>
        <div class="row-note">${escapeHtml(role.current_task_id || "No current task")} / ${escapeHtml((role.blockers || []).length)} blockers</div>
      </div>
      ${tag(role.status || "unknown")}
    </div>
  `);
}

function integrationHtml(integration, contracts) {
  return `
    <div class="datum-grid">
      ${datum("Status", tag(integration.status))}
      ${datum("Contracts", `${contracts.passed}/${contracts.total} passed`)}
      ${datum("Contract Checks", `${integration.contract_checks.passed}/${integration.contract_checks.total}`)}
      ${datum("Scope Checks", `${integration.scope_checks.passed}/${integration.scope_checks.total}`)}
      ${datum("Evidence", integration.evidence_count)}
      ${datum("Blockers", integration.blockers.length)}
    </div>
  `;
}

function dispatchHtml(dispatch) {
  return `
    <div class="datum-grid">
      ${datum("Mode", dispatch.mode)}
      ${datum("Status", tag(dispatch.status))}
      ${datum("Auto Spawn", dispatch.auto_spawn ? "enabled" : "disabled")}
      ${datum("Parallel", dispatch.parallel_allowed ? `max ${dispatch.max_parallel_agents}` : "disabled")}
      ${datum("Planned", dispatch.planned_requests)}
      ${datum("Leases", dispatch.active_leases)}
    </div>
  `;
}

function tokenSummaryHtml(tokenUsage) {
  return `
    <div class="datum-grid">
      ${datum("Total Tokens", compactNumber(tokenUsage.total_tokens))}
      ${datum("Total Cost", money(tokenUsage.total_cost_usd))}
      ${datum("Input", compactNumber(tokenUsage.input_tokens))}
      ${datum("Output", compactNumber(tokenUsage.output_tokens))}
      ${datum("Cached Input", compactNumber(tokenUsage.cached_input_tokens))}
      ${datum("Reasoning", compactNumber(tokenUsage.reasoning_tokens))}
      ${datum("Rows", tokenUsage.rows)}
      ${datum("Updated", formatDateTime(tokenUsage.last_recorded_at))}
    </div>
  `;
}

function taskLanesHtml(tasks) {
  if (!tasks.length) return `<div class="blank">No tasks recorded</div>`;
  const lanes = ["product", "planning", "frontend", "backend", "integration", "handoff"];
  const groups = lanes.map((lane) => [lane, tasks.filter((task) => (task.lane || laneForRole(task.role)) === lane)]);
  return `
    <div class="lane-board">
      ${groups.map(([lane, laneTasks]) => `
        <section class="lane">
          <div class="lane-head">
            <span class="lane-title">${escapeHtml(lane)}</span>
            ${microTag(laneTasks.length)}
          </div>
          ${laneTasks.length ? laneTasks.map(taskItemHtml).join("") : `<div class="blank">Empty</div>`}
        </section>
      `).join("")}
    </div>
  `;
}

function taskItemHtml(task) {
  return `
    <article class="task-item">
      <div class="task-title">${escapeHtml(task.id)} / ${escapeHtml(task.title || "Untitled")}</div>
      <div class="task-meta">
        ${tag(task.status)}
        ${microTag(task.role || "unassigned")}
        ${microTag(`${task.evidence_count} evidence`)}
        ${task.token_usage.total_tokens ? microTag(`${compactNumber(task.token_usage.total_tokens)} tok`) : ""}
        ${task.token_usage.total_cost_usd ? microTag(money(task.token_usage.total_cost_usd)) : ""}
      </div>
      <div class="fineprint">${gitBits(task.git).join(" / ") || "git not started"}</div>
    </article>
  `;
}

function eventsHtml(events) {
  return timeline(events, (event) => ({
    time: formatDateTime(event.created_at || event.at),
    title: event.type || "event",
    body: event.summary || event.note || "",
    status: event.severity || "note"
  }));
}

function evalsHtml(evals) {
  if (!evals.length) return `<div class="blank">No eval rows recorded</div>`;
  return table(["At", "Metric", "Status", "Finding"], evals.map((row) => [
    formatDateTime(row.at),
    row.metric,
    tag(row.status || "observed"),
    row.finding
  ]));
}

function remarksHtml(remarks) {
  if (!remarks.length) return `<div class="blank">No remarks recorded</div>`;
  return table(["At", "Kind", "Source", "Summary", "Tags"], remarks.map((row) => [
    formatDateTime(row.at),
    tag(row.kind || "note"),
    row.source,
    row.summary,
    row.tags
  ]));
}

function tokenLedgerHtml(rows) {
  if (!rows.length) return `<div class="blank">No token usage rows recorded</div>`;
  return table(["At", "Scope", "Target", "Model", "Tokens", "Cost", "Basis"], rows.map((row) => [
    formatDateTime(row.at),
    tag(row.scope || "run"),
    row.task_id || row.eval_id || row.role || row.loop || row.delivery_id,
    row.model || row.provider || "unknown",
    compactNumber(row.total_tokens),
    money(row.total_cost_usd),
    tag(row.cost_basis || "unknown")
  ]));
}

function timeline(items, toRow) {
  if (!items.length) return `<div class="blank">No entries recorded</div>`;
  return `<div class="timeline">${items.map((item) => {
    const row = toRow(item);
    return `
      <div class="timeline-row">
        <span class="timecode">${escapeHtml(row.time)}</span>
        <div>
          <div class="timeline-title">${escapeHtml(row.title)} ${tag(row.status)}</div>
          <div class="timeline-body">${escapeHtml(row.body)}</div>
        </div>
      </div>
    `;
  }).join("")}</div>`;
}

function table(headers, rows) {
  return `
    <div class="ledger">
      <table>
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows.map((row) => `<tr>${row.map((cell) => `<td>${String(cell).startsWith("<span") ? cell : escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function listRows(items, renderItem) {
  return items && items.length ? `<div class="rail">${items.map(renderItem).join("")}</div>` : `<div class="blank">No data recorded</div>`;
}

function datum(label, value) {
  const renderedValue = String(value).includes('class="tag ')
    ? value
    : escapeHtml(value);
  return `
    <div class="datum">
      <span class="datum-label">${escapeHtml(label)}</span>
      <span class="datum-value">${renderedValue}</span>
    </div>
  `;
}

function tag(status) {
  const value = String(status || "unknown");
  return `<span class="tag ${statusClass(value)}">${escapeHtml(labelize(value))}</span>`;
}

function microTag(value) {
  return `<span class="tag tag-muted">${escapeHtml(value)}</span>`;
}

function statusClass(value) {
  const status = String(value || "unknown");
  if (["done", "approved", "passed", "ready", "verified", "complete", "synced", "available"].includes(status)) return "tag-ok";
  if (["blocked", "failed", "error", "missing", "requested_changes"].includes(status)) return "tag-danger";
  if (["active", "in_progress", "testing", "planned", "open", "local_only", "partial"].includes(status)) return "tag-work";
  if (["waiting", "ready_for_review", "warning", "draft"].includes(status)) return "tag-warn";
  if (["candidate", "promoted", "note", "observed", "pattern"].includes(status)) return "tag-note";
  return "tag-muted";
}

function capabilityStatus(capabilities, name) {
  const capability = (capabilities || []).find((item) => item.name === name);
  return capability ? capability.status : "unknown";
}

function laneForRole(role) {
  if (role.startsWith("frontend")) return "frontend";
  if (role.startsWith("backend")) return "backend";
  if (role === "product_manager") return "product";
  if (role === "project_manager") return "planning";
  return "handoff";
}

function gitBits(git) {
  const bits = [];
  if (git.branch_created) bits.push("branch");
  if (git.tests_passed) bits.push("tests");
  if (git.pushed) bits.push("pushed");
  if (git.merge_request_status && git.merge_request_status !== "not_started") bits.push(git.merge_request_status);
  if (git.merge_checks_passed) bits.push("checks");
  if (git.merged) bits.push("merged");
  return bits;
}

function labelize(value) {
  return String(value || "unknown").replace(/_/g, " ");
}

function formatDateTime(value) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function compactNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return new Intl.NumberFormat(undefined, {
    notation: number >= 10000 ? "compact" : "standard",
    maximumFractionDigits: number >= 10000 ? 1 : 0
  }).format(number);
}

function money(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "$0";
  if (number === 0) return "$0";
  return `$${number.toFixed(number < 0.01 ? 6 : 4).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
