# Certification suite

Do not enable autonomous merge until the production-equivalent sandbox proves:

- 100 consecutive happy paths produce `Todo -> In Progress -> In Review -> Done`.
- 50 seeded review failures return to In Progress and never merge prematurely.
- 10,000 generated transition sequences contain no illegal transition.
- Crashes before and after every state write skip no gate and duplicate no merge.
- Duplicate/out-of-order Linear and GitHub events converge correctly.
- Every stale SHA, self-review, forged evidence, and unauthorized gate status is denied.
- Every transition can be reconstructed from the sealed event log and evidence.

Required scenarios include happy path, review rejection, retry exhaustion, stale approval, missing evidence, zero-test execution, self-review, duplicate intake, ambiguous project matching, lost API response, webhook replay, worker/reviewer crash, status drift, force push, CI weakening, merge conflict, merge replay, post-merge failure, mid-task change, secret exposure, and a hallucinated auditor decision.

The automated repository suite covers deterministic state, role, evidence, Linear projection, gate, and integrity invariants. Live connector and chaos certification requires sandbox Linear/GitHub credentials and production-equivalent branch rules.
