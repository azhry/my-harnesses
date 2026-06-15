#!/usr/bin/env bash
# Shared utilities for agent-kube-ops harness scripts.

detect_platform() {
  case "$OSTYPE" in
    linux-*)   PLATFORM=linux ;;
    darwin*)   PLATFORM=macos ;;
    msys*|cygwin*) PLATFORM=windows ;;
    *)         PLATFORM=unknown ;;
  esac
  echo "Platform: $PLATFORM | Shell: $(basename "${SHELL:-unknown}")"
}

INFRA_FILE="$ROOT_DIR/docs/infrastructure.md"
DEPLOY_STATE_FILE="$ROOT_DIR/state/current-deployment.json"

check_tool() {
  local name="$1"
  local version_cmd="$2"
  if command -v "$name" &> /dev/null; then
    echo "  $name: found ($(eval "$version_cmd" 2>&1 | head -1))"
  else
    echo "  $name: NOT FOUND"
    FAILED=$((FAILED + 1))
  fi
}

read_infra() {
  local key="$1"
  grep "^$key:" "$INFRA_FILE" 2>/dev/null | sed "s/^$key:[[:space:]]*//" || echo ""
}

read_deployment_state() {
  local key="$1"
  jq -r ".$key // empty" "$DEPLOY_STATE_FILE" 2>/dev/null || echo ""
}

update_deployment_state() {
  local key="$1"
  local value="$2"
  if [ -f "$DEPLOY_STATE_FILE" ]; then
    local tmp
    tmp=$(mktemp)
    jq --arg k "$key" --arg v "$value" '.[$k] = $v' "$DEPLOY_STATE_FILE" > "$tmp" && mv "$tmp" "$DEPLOY_STATE_FILE"
  fi
}
