## Git Lifecycle Enforcement

Before marking a dev task `verified`, run the git lifecycle enforcement script to
verify that git claims (branch pushed, PR created, merge completed) match real
remote state:

```bash
node scripts/enforce-git-lifecycle.js runs/<DELIVERY_ID>/workflow-state.json <TASK_ID> --repo-path /path/to/target/repo
```

If `repo_path` is set in `implementation.git_policy`, `transition-task.js` will
attempt this automatically. The script checks:
- Remote is configured
- Feature branch exists on remote via `git ls-remote`
- PR/MR exists via `gh pr view` (if gh CLI is available)
- Merge state matches what `git_flow` claims

Failures block the `verified` transition. Run `scripts/enforce-git-lifecycle.js`
standalone to see detailed per-check output.

## Dev Git Lifecycle

For every `frontend_dev` and `backend_dev` task — **you MUST use the automated submit-task script.**

> [!CAUTION]
> **STRICT COMPLIANCE REQUIRED**
> You are strictly forbidden from running manual `git` commands or using the `gh` CLI directly to bypass the script. If `submit-task.js` throws a `FATAL` error, you must read the error output and fix the underlying issue. Bypassing the script is considered CHEATING and will result in run termination.

The harness requires strict state updates which are handled automatically by `scripts/submit-task.js`.

### Step-by-step (run this single command):

```bash
node scripts/submit-task.js runs/<DELIVERY_ID>/workflow-state.json <TASK_ID> \
  --commit-msg "feat: <TASK_ID>: your message here" \
  --test-command "npm test"
```

This script will automatically:
1. Create your feature branch (`delivery/<DELIVERY_ID>/<TASK_ID>`)
2. Stage and commit your code
3. Run the tests and explicitly record the output
4. Push the branch to the remote
5. Create a Pull/Merge Request
6. Update all required fields in `workflow-state.json` (`git_flow`, `test.status`, etc.)

If you are only editing non-code files or doing setup where tests don't apply, you can omit the test command or use a dummy command like `echo "no tests needed"`.
## Pull/Merge Request Description

Every PR/MR must have a substantive description. The description is the
primary communication artifact for human reviewers — it explains what
changed, why, and how to verify it.

### Required PR/MR description format

```markdown
## Summary

<1-3 sentences describing what this PR does at a high level.>

## Task

- **Delivery:** <DELIVERY_ID>
- **Task:** <TASK_ID>
- **Description:** <task.description from workflow-state>

## Changes

- <file path>: <what changed and why>
- <file path>: <what changed and why>

## Impact

- **Frontend/Backend:** <which system(s) are affected>
- **Breaking:** Yes/No
- **Dependencies:** <new or changed dependencies>
- **Configuration:** <new env vars, config changes>

## Manual Test Instructions

1. <step-by-step instructions to verify the change>
2. <include specific commands, URLs, payloads>

## Related

- Closes <TASK_ID>
- Related MRs/Issues: <links>
```

### How to use this template with submit-task.js

1. Create a markdown file in your run directory (e.g. `runs/<DELIVERY_ID>/pr-<TASK_ID>.md`)
2. Write your meaningful PR description using the template format above.
3. Pass the file to `submit-task.js` using the `--pr-body-file` flag:

```bash
node scripts/submit-task.js runs/<DELIVERY_ID>/workflow-state.json <TASK_ID> \
  --commit-msg "feat: <TASK_ID>: your message here" \
  --test-command "npm test" \
  --pr-body-file runs/<DELIVERY_ID>/pr-<TASK_ID>.md
```

Do NOT use `gh pr create` manually. The automated script is strictly required.
