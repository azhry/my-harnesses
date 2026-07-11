# DevCircuit progress

## Current verified state

- Standalone harness scaffold: complete
- Sealed workflow state: passing
- Exact Linear status lifecycle: passing
- Linear project/spec/task adapter: contract-tested
- GitHub feature branch/PR/check/merge lifecycle: implemented; requires live sandbox certification
- Independent role separation: passing
- Review failure/rework loop: passing
- Evidence-bound merge gate: passing
- Durable supervisor heartbeat/audit: passing
- Cryptographically pinned sandbox readiness and negative fake-runner checks: passing
- Concurrent delivery worktree isolation: passing
- Runtime-neutral Claude Code/OpenCode/Kilo adapter protocol: documented; live adapters require certification
- Automated deterministic suite: 27 passing tests

## Remaining deployment work

- Run live Linear and GitHub sandbox certification with real credentials.
- Configure production GitHub ruleset and trusted App status source.
- Provide environment-specific agent adapter executables.
- Complete the 100-happy-path/50-rejection/chaos certification thresholds before autonomous merge.
