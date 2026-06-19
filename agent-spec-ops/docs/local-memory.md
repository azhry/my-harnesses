# Local Memory Store

The harness stores reusable knowledge locally so future agents can improve
without depending on chat history, Jira, Linear, Confluence, or a specific code
host.

## Storage Layout

Each run gets operational memory:

```text
runs/<DELIVERY_ID>/
  workflow-state.json
  tasks.json
  events.ndjson
  evals.csv
  remarks.csv
  token-usage.csv
  decisions/
  changes/
  disapprovals/
  knowledge/
    candidates/
    promoted/
```

The harness also keeps reusable cross-run memory:

```text
knowledge/
  cards/
    product_rule/
    design_rule/
    system_rule/
    repository_pattern/
    verification_pattern/
    process_rule/
    decision/
    risk/
    anti_pattern/
history/
  evals.csv
  remarks.csv
  token-usage.csv
```

`workflow-state.json` remains the current control state. The memory files are
the durable learning layer.

## Event First

Every disapproval, change request, decision, pattern, task update, completed
work item, eval, or remark should be recorded as an event before it becomes a
reusable rule.

```bash
node scripts/record-event.js runs/<DELIVERY_ID>/workflow-state.json \
  --type human_disapproval \
  --role product_manager \
  --target artifacts.product_requirements \
  --summary "Success metric is unclear" \
  --details "Add conversion and latency targets before approval." \
  --tag requirements \
  --evidence "human review comment"
```

Events are appended to `events.ndjson`. Human disapprovals, change requests, and
decisions also get readable markdown files under `disapprovals/`, `changes/`,
or `decisions/`.

## Knowledge Cards

Reusable knowledge is stored as small cards. A card must have a statement,
scope, confidence, status, and evidence.

```bash
node scripts/record-knowledge.js runs/<DELIVERY_ID>/workflow-state.json \
  --kind product_rule \
  --status candidate \
  --statement "Checkout requirements must include measurable conversion and latency targets." \
  --role product_manager \
  --component checkout \
  --tag requirements \
  --evidence evt-20260619100000-human-disapproval
```

Use these statuses:

| Status | Meaning |
| --- | --- |
| `observed` | Raw observation, not reusable yet |
| `candidate` | Possible reusable knowledge, not automatically applied |
| `promoted` | Accepted as reusable guidance |
| `active` | Automatically included in future knowledge packets |
| `deprecated` | Superseded or no longer safe to use |

Promote a candidate only after human approval, repeated evidence, or a clear
post-run evaluation:

```bash
node scripts/promote-knowledge.js runs/<DELIVERY_ID>/workflow-state.json <CARD_ID> --status active
```

## Query Packets

Before a role starts, query a small packet instead of loading all memory:

```bash
node scripts/query-knowledge.js runs/<DELIVERY_ID>/workflow-state.json \
  --role frontend_dev \
  --task FE-001 \
  --component checkout \
  --tag requirements
```

The query reads active/promoted global cards, run-local cards, and recent eval
or remark rows. Agents should cite card IDs in `knowledge_refs[]` when a task or
implementation depends on them.

## CSV History

CSV files are optimized for trend analysis and harness improvement.

Use evals for scored or status-based judgments:

```bash
node scripts/record-eval.js runs/<DELIVERY_ID>/workflow-state.json \
  --loop frontend_dev_test \
  --role frontend_test \
  --task FE-001 \
  --metric "test coverage" \
  --score 1 \
  --max-score 2 \
  --status warning \
  --finding "Happy path is covered but empty state is missing." \
  --recommendation "Add empty-state test before verification." \
  --evidence "npm test -- FE-001"
```

Use remarks for human comments, agent observations, patterns, changes, and
notable work:

```bash
node scripts/record-remark.js runs/<DELIVERY_ID>/workflow-state.json \
  --source human \
  --kind change \
  --role project_manager \
  --summary "Split backend task by API boundary" \
  --details "The first plan mixed persistence and response shaping." \
  --tag planning
```

Rows are written to both run-local CSV files and global `history/*.csv`.

## Token And Cost History

Token usage is tracked separately from evals and remarks so the harness can
compare delivery cost by run, task, role, eval, model, and loop.

Record actual usage when the runtime gives a usage summary:

```bash
node scripts/record-token-usage.js runs/<DELIVERY_ID>/workflow-state.json \
  --scope task \
  --task FE-001 \
  --role frontend_dev \
  --provider openai \
  --model gpt-5 \
  --input-tokens 12000 \
  --output-tokens 2800 \
  --cached-input-tokens 4000 \
  --reasoning-tokens 900 \
  --total-cost-usd 0.23 \
  --cost-basis actual \
  --source "runtime usage summary"
```

If exact cost is not reported, record token counts and either:

- Use `--cost-basis unknown` with no cost.
- Use `--cost-basis estimated` with explicit rate flags and evidence for the
  rate used.

```bash
node scripts/record-token-usage.js runs/<DELIVERY_ID>/workflow-state.json \
  --scope eval \
  --eval-id EVAL-001 \
  --input-tokens 3000 \
  --output-tokens 700 \
  --input-rate-per-1m 2.00 \
  --output-rate-per-1m 8.00 \
  --cost-basis estimated \
  --evidence "pricing snapshot 2026-06-19"
```

Rows are written to:

```text
runs/<DELIVERY_ID>/token-usage.csv
history/token-usage.csv
```

The current run totals are summarized in
`workflow-state.json` under `memory.token_totals`.

## Local Task Fallback

If Linear or Jira is unavailable, the harness keeps tasks in
`runs/<DELIVERY_ID>/tasks.json`.

```bash
node scripts/update-local-task.js runs/<DELIVERY_ID>/workflow-state.json \
  --id FE-001 \
  --title "Implement checkout summary panel" \
  --role frontend_dev \
  --status planned \
  --acceptance "Shows item count, subtotal, tax, and total." \
  --evidence "Derived from approved task breakdown"
```

When product tracker readiness is missing or blocked,
`scripts/check-tool-readiness.js` marks `memory.local_task_provider` as local
and records the selected external provider for later sync.

## Accuracy Rules

- Store raw evidence before extracting reusable knowledge.
- Do not promote a one-off disapproval into an active rule without approval or
  repeated evidence.
- Never delete contradictory older cards; deprecate them and link the
  replacement.
- Keep cards small and scoped by role, component, service, repo, task, and tag.
- Record which card IDs were used by tasks so future evals can trace bad
  guidance back to its source.
