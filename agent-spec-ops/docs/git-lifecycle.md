# Git Lifecycle

Each implementation task uses:

```text
branch -> implement -> test -> push -> MR -> MR comment -> checks pass -> merge
```

The MR description must follow `templates/pull-request-template.md`.

Required task evidence:

- feature branch
- test command and result
- push evidence
- MR URL
- MR comment URL/status from the test/review agent
- passed MR check evidence
- merged MR status, merge commit, and merge evidence

Do not run raw `gh pr merge`. Use `submit-task.js`, which inspects code-host
checks and refuses to complete merge evidence until checks are passed.

Do not push directly to `main` or `master`.
