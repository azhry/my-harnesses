const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3456;

const ROOT_DIR = path.resolve(__dirname, '..');
const STATE_FILE = path.join(ROOT_DIR, 'state', 'current-deployment.json');
const INFRA_FILE = path.join(ROOT_DIR, 'docs', 'infrastructure.md');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GATE_SCRIPTS = {
  1: '01-check-tools.sh',
  2: '02-verify-permissions.sh',
  3: '03-deploy-app.sh',
  4: '04-healthcheck.sh',
};

const GATE_NAMES = {
  1: 'Tool Readiness',
  2: 'Permissions',
  3: 'Deploy App',
  4: 'Healthcheck',
};

app.get('/api/state', (req, res) => {
  try {
    const data = fs.readFileSync(STATE_FILE, 'utf-8');
    res.json(JSON.parse(data));
  } catch {
    res.json({ status: 'none', image: '', namespace: '', app_name: '' });
  }
});

app.get('/api/infra', (req, res) => {
  const infra = {};
  try {
    const content = fs.readFileSync(INFRA_FILE, 'utf-8');
    for (const line of content.split('\n')) {
      const match = line.match(/^(\w+):\s*(.+)/);
      if (match) infra[match[1]] = match[2].trim();
    }
  } catch {}
  res.json(infra);
});

app.get('/api/run-gate/:id', (req, res) => {
  const gateId = req.params.id;
  const script = GATE_SCRIPTS[gateId];
  if (!script) {
    res.status(400).json({ error: `Unknown gate: ${gateId}` });
    return;
  }

  const scriptPath = path.join(ROOT_DIR, 'scripts', script);
  if (!fs.existsSync(scriptPath)) {
    res.status(400).json({ error: `Script not found: ${scriptPath}` });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const namespace = req.query.namespace || 'default';
  const appName = req.query.appName || '';
  const gitRepo = req.query.gitRepo || '';
  const imageTag = req.query.imageTag || '';

  const env = {
    ...process.env,
    NAMESPACE: namespace,
    APP_NAME: appName,
    GIT_REPO: gitRepo,
    IMAGE_TAG: imageTag,
    PATH: process.env.PATH,
  };

  const proc = spawn('bash', [scriptPath], { env, cwd: ROOT_DIR });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  proc.stdout.on('data', (data) => {
    send('output', { stream: 'stdout', text: data.toString() });
  });

  proc.stderr.on('data', (data) => {
    send('output', { stream: 'stderr', text: data.toString() });
  });

  proc.on('error', (err) => {
    send('done', { exitCode: -1, error: err.message });
    res.end();
  });

  proc.on('close', (code) => {
    send('done', { exitCode: code });
    res.end();
  });

  req.on('close', () => {
    proc.kill();
  });
});

app.post('/api/rollback', (req, res) => {
  const { namespace, appName } = req.body;
  if (!appName) {
    res.status(400).json({ error: 'appName is required' });
    return;
  }

  const ns = namespace || 'default';
  const cmd = `kubectl rollout undo deployment/${appName} -n ${ns}`;

  const proc = spawn('bash', ['-c', cmd], {
    env: { ...process.env, PATH: process.env.PATH },
    cwd: ROOT_DIR,
  });

  let output = '';
  proc.stdout.on('data', (d) => { output += d.toString(); });
  proc.stderr.on('data', (d) => { output += d.toString(); });

  proc.on('close', (code) => {
    res.json({ exitCode: code, output });
  });
});

app.listen(PORT, () => {
  console.log(`agent-kube-ops UI running at http://localhost:${PORT}`);
});
