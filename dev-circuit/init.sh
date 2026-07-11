#!/bin/sh
set -eu

command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js is required" >&2; exit 1; }
major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$major" -ge 20 ] || { echo "ERROR: Node.js 20+ is required" >&2; exit 1; }

node scripts/check-readiness.js --local-only
npm run validate

echo "DevCircuit is ready. Start the supervisor with: npm run monitor"
