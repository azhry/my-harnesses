# Git Lifecycle

Each implementation task uses:

```text
branch -> implement -> test-agent signoff -> submit-task(push/PR/comment) -> test-agent PR review -> submit-task(checks/merge) -> verified/Linear sync
```

The MR description must follow `templates/pull-request-template.md`.

Required task evidence:

- feature branch
- test command and result
- push evidence
- MR URL
- MR comment URL/status from the test/review agent
- independent PR review verdict tied to the exact submitted HEAD
- passed MR check evidence
- merged MR status, merge commit, and merge evidence

Do not run raw `gh pr merge`. Use `submit-task.js`, which inspects code-host
checks and refuses to complete merge evidence until checks are passed.
Do not record dev-task MR check/merge evidence with `record-test-results.js`;
that script records tests and MR status comments only.
After the first `submit-task.js` pass creates the PR, the matching test agent
must inspect it and run `record-pr-review.js`. A failed verdict keeps the same
task open for fixes; a later task cannot start.

Do not push directly to `main` or `master`.
