# my-harnesses

Collection of AI agent harnesses. Each harness is a self-contained directory
that follows the five-subsystem model: instructions, tools, environment, state,
and feedback.

## Harnesses

| Harness | Purpose |
|---------|---------|
| agent-kube-ops | Deploy apps from a remote git repo to EKS — 4-gate pipeline: tools → permissions → deploy → healthcheck |
| agent-spec-ops | Spec-to-delivery lifecycle with 7 roles, 24 states, 3 human gates, and knowledge memory |
| dev-circuit | End-to-end request-to-delivery harness with Linear planning, isolated task branches, independent review, evidence gates, and a durable supervisor |

## Usage

Each harness directory contains its own `README.md` with setup and usage
instructions. In general:

1. Open your AI coding agent (Claude Code, Codex, etc.) in the harness directory
2. The agent reads `AGENTS.md` (or `CLAUDE.md`) and follows the defined workflow
3. Each harness ships with scripts for gate-based verification and a Web UI for manual operation

## Structure

Each harness follows a consistent layout:

```
harness-name/
├── AGENTS.md              # Root instruction for AI agents
├── CLAUDE.md              # Claude Code-specific instructions
├── init.sh                # Startup / readiness check
├── PROGRESS.md            # Session state tracking
├── feature_list.json      # Feature / task tracking
├── scripts/               # Gate-based verification scripts
├── docs/                  # Domain reference (infrastructure, workflows)
├── templates/             # K8s manifests, Dockerfiles, etc.
├── state/                 # Persistent runtime state
└── ui/                    # Optional Web UI for manual operation
```

## Reference

- [OpenAI: Harness engineering](https://openai.com/index/harness-engineering/)
- [Anthropic: Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
