## Linear Bidirectional Sync (Phase 5)

When Linear is configured (via `LINEAR_API_KEY` env var), sync tasks, knowledge,
and delivery status to Linear.

Required environment variables:
- `LINEAR_API_KEY` — Linear API key (or `LINEAR_ACCESS_TOKEN`)
- `LINEAR_TEAM_ID` — Team ID for new issues

Optional environment variables:
- `LINEAR_PROJECT_ID` — Project ID for new issues (if unset, issues are created
  in the team's default project)

### Sync task status to Linear

```bash
# Sync all tasks
node scripts/sync-linear-task.js runs/<DELIVERY_ID>/workflow-state.json

# Sync a single task (must already have linear_id)
node scripts/sync-linear-task.js runs/<DELIVERY_ID>/workflow-state.json --task <TASK_ID>

# Create Linear issues for tasks that don't have one yet
node scripts/sync-linear-task.js runs/<DELIVERY_ID>/workflow-state.json --create

# Preview without making changes
node scripts/sync-linear-task.js runs/<DELIVERY_ID>/workflow-state.json --dry-run
```

Maps task status to Linear workflow states:
- `planned` → backlog, `active`/`implemented` → inProgress
- `testing` → inReview, `verified`/`waived`/`not_applicable` → done
- `failed` → canceled, `blocked` → blocked

### Sync knowledge cards to Linear documents

```bash
node scripts/sync-linear-knowledge.js runs/<DELIVERY_ID>/workflow-state.json
node scripts/sync-linear-knowledge.js runs/<DELIVERY_ID>/workflow-state.json --status active
node scripts/sync-linear-knowledge.js runs/<DELIVERY_ID>/workflow-state.json --dry-run
```

Creates or updates a Linear document called "Knowledge — <DELIVERY_ID>" with all
active/promoted knowledge cards as markdown sections.

### Sync delivery status to Linear projects

```bash
node scripts/sync-linear-status.js runs/<DELIVERY_ID>/workflow-state.json
node scripts/sync-linear-status.js runs/<DELIVERY_ID>/workflow-state.json --dry-run
```

Creates or updates a Linear project called "Delivery — <DELIVERY_ID>" with task
summary table, progress metrics, and status.

When `LINEAR_API_KEY` is not set, all Linear scripts exit silently with no
changes.
