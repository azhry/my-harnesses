const GATE_NAMES = { 1: 'Tool Readiness', 2: 'Permissions', 3: 'Deploy App', 4: 'Healthcheck' };
let gatePassed = { 1: false, 2: false, 3: false, 4: false };

document.addEventListener('DOMContentLoaded', () => {
  loadState();
  loadInfra();
});

function getConfig() {
  return {
    namespace: document.getElementById('cfg-namespace').value || 'default',
    appName: document.getElementById('cfg-appName').value,
    gitRepo: document.getElementById('cfg-gitRepo').value,
    imageTag: document.getElementById('cfg-imageTag').value,
  };
}

function setGateStatus(gateId, status) {
  const card = document.querySelector(`.gate-card[data-gate="${gateId}"]`);
  const badge = card.querySelector('.gate-status');
  const btn = card.querySelector('.btn-run');
  const arrow = document.querySelectorAll('.gate-arrow')[gateId - 1];

  card.className = `gate-card ${status === 'passed' ? 'passed' : status === 'failed' ? 'failed' : status === 'running' ? 'running' : ''}`;
  badge.textContent = status;
  badge.className = `gate-status status-${status}`;

  if (status === 'passed') {
    btn.disabled = true;
    if (arrow) arrow.classList.add('passed');
    gatePassed[gateId] = true;
    unlockGate(gateId + 1);
  } else if (status === 'failed') {
    btn.disabled = false;
    if (arrow) arrow.classList.add('failed');
    gatePassed[gateId] = false;
  } else if (status === 'running') {
    btn.disabled = true;
    if (arrow) arrow.classList.add('active');
  } else {
    btn.disabled = gateId > 1 && !gatePassed[gateId - 1];
    gatePassed[gateId] = false;
  }
}

function unlockGate(gateId) {
  if (gateId > 4) return;
  const card = document.querySelector(`.gate-card[data-gate="${gateId}"]`);
  const btn = card.querySelector('.btn-run');
  card.classList.remove('locked');
  btn.disabled = false;
}

function appendLog(text, className) {
  const el = document.getElementById('log-output');
  const span = document.createElement('span');
  span.className = className || '';
  span.textContent = text;
  el.appendChild(span);
  el.scrollTop = el.scrollHeight;
}

function clearLog() {
  document.getElementById('log-output').innerHTML = '';
}

function setIndicator(text) {
  document.getElementById('gate-indicator').textContent = text;
}

function runGate(gateId) {
  const config = getConfig();
  if (gateId === 3 && !config.appName) {
    appendLog('FAIL: App Name is required before deploying.\n', 'log-fail');
    return;
  }

  clearLog();
  setIndicator(`Running Gate ${gateId}: ${GATE_NAMES[gateId]}...`);
  setGateStatus(gateId, 'running');

  const params = new URLSearchParams({
    namespace: config.namespace,
    appName: config.appName,
    gitRepo: config.gitRepo,
    imageTag: config.imageTag,
  });

  const evtSource = new EventSource(`/api/run-gate/${gateId}?${params}`);

  evtSource.addEventListener('output', (e) => {
    const data = JSON.parse(e.data);
    if (data.stream === 'stderr') {
      appendLog(data.text, 'log-stderr');
    } else {
      appendLog(data.text);
    }
  });

  evtSource.addEventListener('done', (e) => {
    const data = JSON.parse(e.data);
    evtSource.close();

    if (data.exitCode === 0) {
      setGateStatus(gateId, 'passed');
      setIndicator(`Gate ${gateId} passed`);
      appendLog(`\nPASS: Gate ${gateId} (${GATE_NAMES[gateId]}) completed successfully.\n`, 'log-pass');
      loadState();
    } else {
      setGateStatus(gateId, 'failed');
      setIndicator(`Gate ${gateId} failed`);
      appendLog(`\nFAIL: Gate ${gateId} (${GATE_NAMES[gateId]}) exited with code ${data.exitCode}.\n`, 'log-fail');
      if (data.error) appendLog(`Error: ${data.error}\n`, 'log-fail');
    }
  });

  evtSource.onerror = () => {
    evtSource.close();
    if (document.querySelector(`.gate-card[data-gate="${gateId}"] .status-running`)) {
      setGateStatus(gateId, 'pending');
      setIndicator('Connection lost');
    }
  };
}

function resetGates() {
  if (!confirm('Reset all gate statuses? This does not affect the cluster.')) return;
  gatePassed = { 1: false, 2: false, 3: false, 4: false };
  for (let i = 1; i <= 4; i++) {
    setGateStatus(i, 'pending');
  }
  document.querySelectorAll('.gate-arrow').forEach((a) => { a.className = 'gate-arrow'; });
  clearLog();
  setIndicator('Ready');
  appendLog('Gates reset.\n', 'log-info');
}

function rollback() {
  const config = getConfig();
  if (!config.appName) {
    appendLog('FAIL: App Name is required for rollback.\n', 'log-fail');
    return;
  }
  if (!confirm(`Rollback deployment "${config.appName}" in namespace "${config.namespace}"?`)) return;

  clearLog();
  setIndicator('Rolling back...');
  appendLog(`Rolling back ${config.appName} in ${config.namespace}...\n`, 'log-warn');

  fetch('/api/rollback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ namespace: config.namespace, appName: config.appName }),
  })
    .then((r) => r.json())
    .then((data) => {
      appendLog(data.output + '\n');
      if (data.exitCode === 0) {
        appendLog('Rollback completed.\n', 'log-pass');
        setIndicator('Rolled back');
      } else {
        appendLog(`Rollback failed (exit ${data.exitCode}).\n`, 'log-fail');
        setIndicator('Rollback failed');
      }
      loadState();
    });
}

function loadState() {
  fetch('/api/state')
    .then((r) => r.json())
    .then((data) => {
      document.getElementById('deployment-state').textContent = JSON.stringify(data, null, 2);
    });
}

function loadInfra() {
  fetch('/api/infra')
    .then((r) => r.json())
    .then((data) => {
      const el = document.getElementById('infra-display');
      el.textContent = JSON.stringify(data, null, 2);
    });
}
