# Git Lifecycle

Each implementation task uses:

```text
branch -> implement -> test -> push -> MR -> MR comment passed/failed -> merge
```

The MR description must follow `templates/pull-request-template.md`.

Required task evidence:

- feature branch
- test command and result
- push evidence
- MR URL
- MR comment URL/status from the test/review agent
- merged MR status, merge commit, and merge evidence

Do not push directly to `main` or `master`.
