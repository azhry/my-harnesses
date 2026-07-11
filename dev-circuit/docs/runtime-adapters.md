# Runtime adapters: Claude Code, OpenCode, and Kilo Code

## Support level

DevCircuit's controller is runtime-neutral. It supports Claude Code, OpenCode, and Kilo Code **through a trusted adapter** implementing both contracts below. The repository currently provides the protocol and setup guidance, not pre-authenticated production wrappers; authentication/session-output details vary by runtime version and organization policy and must be certified locally.

## Planner adapter contract

Input: one argument, the absolute planner-context JSON path.
Output: final stdout line is an absolute JSON result path containing:

```json
{
  "specification": "# Complete Markdown specification",
  "tasks": [
    {
      "id": "APP-001",
      "title": "One mergeable outcome",
      "description": "Behavior",
      "scope": [],
      "exclusions": [],
      "acceptance_criteria": [],
      "verification_commands": [],
      "manual_test_steps": [],
      "dependencies": []
    }
  ]
}
```

## Worker adapter contract

Input: one argument, the absolute task-context JSON path. The context includes the worktree, role, contract, prior reviews, and a scoped submission capability.
Output: final stdout line is a runtime-derived lease:

```json
{"agent_id":"real-session-id","principal":"runtime-account-or-agent-principal","workspace_id":"isolated-worktree-id"}
```

The adapter must not invent identities, reuse a session/workspace for another role, expose controller credentials, or bypass the submission inbox.

## Claude Code

Claude Code provides non-interactive print mode with JSON output, bounded turns, tool allow/deny lists, and session resume. A wrapper can invoke `claude -p --output-format json --max-turns <N>` inside the assigned worktree, parse the returned session ID, and limit tools for reviewer/gatekeeper roles. See Anthropic's [Claude Code CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage).

Recommended mapping:

- Planner: read-only plus output-artifact permission.
- Implementer: read/edit/bash only inside the assigned worktree.
- Reviewer: read/bash; no edit permission.
- Gatekeeper: read-only access to the bounded context/evidence.
- Merger: no model-driven shell; controller performs the actual merge.

Do not use `--dangerously-skip-permissions` as a substitute for the DevCircuit sandbox.

## OpenCode

OpenCode supports non-interactive `opencode run`, project-defined primary/subagents, explicit permissions, MCP configuration, and an attachable server. Its CLI documents `opencode agent create`, `opencode mcp`, and `opencode run`; background subagents are an experimental option. See the official [OpenCode CLI documentation](https://dev.opencode.ai/docs/cli/).

Create separate project agents for implementer and reviewer. Deny edit permission for reviewers and configure the adapter to return the real OpenCode session/agent principal and assigned worktree identity.

## Kilo Code

Kilo CLI 1.0+ supports `kilo run`, autonomous `--auto` execution, custom agents/modes, permissions, sessions, and MCP. Install with `npm install -g @kilocode/cli`, verify with `kilo --version`, and authenticate interactively with `/connect`. See [Kilo CLI](https://kilo.ai/docs/code-with-ai/platforms/cli), [custom modes](https://kilo.ai/docs/customize/custom-modes), and [MCP configuration](https://kilo.ai/docs/automate/mcp/using-in-kilo-code).

Use a custom read-only reviewer agent and a worktree-scoped implementer agent. Autonomous mode still honors Kilo permission rules; denied operations remain denied. The adapter must return a real Kilo session identity rather than a generated label.

## Certification checklist for any adapter

- [ ] Runs only through `DEVCIRCUIT_SANDBOX_RUNNER`.
- [ ] Receives no controller, Linear, GitHub, SSH, cloud, or package-registry credentials unless explicitly task-scoped.
- [ ] Returns real session principal and worktree identity.
- [ ] Implements capability submissions without reading workflow state.
- [ ] Reviewer cannot edit or push.
- [ ] Gatekeeper cannot implement, review, or merge.
- [ ] A new role/attempt gets a new session and workspace identity.
- [ ] Crash, timeout, malformed output, and expired capability fail closed.
- [ ] Planner output passes task/acceptance/verification coverage validation.
- [ ] The adapter passes a sandbox end-to-end rejection/rework/merge run before production use.
