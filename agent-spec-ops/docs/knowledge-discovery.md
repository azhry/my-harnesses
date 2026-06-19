# Knowledge Discovery

The harness uses layered discovery: fast candidate search first, authoritative
source verification second.

Run tool readiness before source-dependent discovery:

```bash
node scripts/check-tool-readiness.js runs/<DELIVERY_ID>/workflow-state.json
```

If tracker or code-host access is missing, discovery may still proceed from
local files or supplied documents, but the missing source must be recorded as a
knowledge gap or blocker.

## Discovery Layers

1. Fast indexes
   - Local knowledge graphs
   - Cached Confluence summaries
   - Service/API indexes
   - Repo search
   - Prior handoff reports

2. Source verification
   - Confluence pages
   - Linear/Jira tickets
   - Code files
   - API schemas
   - Tests
   - Runbooks

3. Evidence recording
   - Source kind
   - URL or file path
   - Page ID, ticket ID, commit, or line number
   - Query used
   - Confidence
   - Timestamp

## Knowledge Buckets

| Bucket | Use |
| --- | --- |
| `product_knowledge` | User problem, requirements, prior specs, acceptance criteria |
| `design_knowledge` | UI references, layout behavior, Stitch prompt inputs |
| `system_knowledge` | APIs, services, data models, permissions, business rules |
| `repository_knowledge` | Repos, files, existing implementation patterns, test references |
| `verification_knowledge` | Unit, integration, e2e, manual verification paths |

## Source Authority

Not every source has equal weight. Use this order when sources disagree:

1. Current ticket/spec explicit requirement
2. Current code and tests
3. Current API/schema contracts
4. Approved design/product documents
5. Runbooks and operational docs
6. Generated summaries and prior chat context

Generated summaries are useful for discovery, but they should not be final
authority for implementation-sensitive claims.

## Discovery Budgets

Discovery should be accurate without becoming endless. Default budgets:

| Budget | Default |
| --- | --- |
| Max queries per source | 8 |
| Max source documents inspected | 20 |
| Max repo files inspected per service | 30 |
| Max unresolved gaps before blocking | 5 |

When the budget is exhausted, record the gap instead of continuing silently.

## Finding Structure

Each finding should be small, sourced, and reusable:

```json
{
  "id": "finding-api-create-booking",
  "bucket": "system_knowledge",
  "type": "api_flow",
  "claim": "Booking creation uses the createBooking endpoint.",
  "confidence": "medium",
  "sources": [
    {
      "kind": "code",
      "path": "services/booking/create_booking.go",
      "line": 42,
      "commit": "abc123"
    }
  ],
  "used_by": ["backend-task-001", "integration-test-001"]
}
```

## Task Traceability

Tasks should cite the knowledge that justified them. A task without source links
is allowed only when it is explicitly exploratory or manually approved.

The intended trace is:

```text
requirement -> knowledge finding -> system/UI rule -> task -> implementation -> test -> evidence
```

## Persistent Learning

When discovery reveals a reusable rule, pattern, risk, or decision, store it in
the local memory system after recording the source event:

```bash
node scripts/record-event.js runs/<DELIVERY_ID>/workflow-state.json \
  --type pattern_observed \
  --summary "Checkout requirements need measurable latency targets"

node scripts/record-knowledge.js runs/<DELIVERY_ID>/workflow-state.json \
  --kind product_rule \
  --status candidate \
  --statement "Checkout requirements should include measurable latency targets." \
  --tag checkout
```

Only `active` or `promoted` knowledge should guide future unrelated deliveries.
Candidate cards can guide the current run when cited, but should not become a
global rule without human approval, repeated evidence, or a post-run eval.

See [local-memory.md](local-memory.md).
