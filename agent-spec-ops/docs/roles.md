# Role Contracts

Roles are contracts, not personalities. Each role reads defined inputs and
produces artifacts that the next role can evaluate.

## Product Manager

Reads:

- Raw request and source links
- Knowledge findings and gaps
- Prior specs, product behavior, design references, constraints

Writes:

- `artifacts.product_requirements`
- `artifacts.stitch_prompt`
- `artifacts.system_rules`
- Product open questions and assumptions

Definition of done:

- Requirements are explicit.
- Acceptance criteria are testable.
- The Stitch prompt can generate a relevant UI direction.
- UI behavior and system rules are clear enough for task breakdown.
- Open questions are either answered, deferred, or marked as blockers.

## Project Manager

Reads:

- Approved product requirements
- Approved UI and system rules
- Knowledge findings and gaps

Writes:

- `task_graph.tasks[]`
- Task dependencies
- Definitions of done
- Verification mapping

Definition of done:

- Every task has one owner role.
- Every task cites requirement or knowledge references.
- Every implementation task has a matching test or verification task.
- Dependencies are explicit and acyclic.
- Tasks are small enough to execute and evaluate.

## Frontend Dev

Reads:

- Approved frontend tasks
- UI rules
- Stitch prompt output when provided
- Repository knowledge and existing patterns

Writes:

- Implementation evidence on assigned frontend tasks
- Changed files
- Build or preview evidence
- Deviations from approved task scope
- `git_flow` evidence for branch creation, passing tests, push, merge request, merge checks, and merge

Definition of done:

- Feature branch is created from `main` before implementation starts.
- Task implementation matches approved rules.
- No unapproved scope is introduced.
- Build/typecheck evidence is recorded when available.
- Matching frontend tests pass.
- Feature branch is pushed only after successful test evidence.
- Merge request is created back to `main`.
- Merge request is merged by default after merge checks pass unless auto-merge is explicitly disabled.

## Frontend Test

Reads:

- Frontend tasks
- Acceptance criteria
- UI/system rules
- Frontend implementation evidence

Writes:

- Test cases
- Test command evidence
- Failure reports with exact reproduction
- Verification evidence

Definition of done:

- Tests cover the declared frontend behavior.
- Failures point back to a task, rule, or acceptance criterion.
- Passing evidence is recorded before marking frontend tasks verified.

## Backend Dev

Reads:

- Approved backend tasks
- System rules
- Repository knowledge
- API/data/permission constraints

Writes:

- Implementation evidence on assigned backend tasks
- Changed files
- Migration/API/schema notes
- Build evidence
- Deviations from approved task scope
- `git_flow` evidence for branch creation, passing tests, push, merge request, merge checks, and merge

Definition of done:

- Feature branch is created from `main` before implementation starts.
- Backend behavior matches approved system rules.
- API/data contracts are recorded.
- No unapproved scope is introduced.
- Matching backend tests pass.
- Feature branch is pushed only after successful test evidence.
- Merge request is created back to `main`.
- Merge request is merged by default after merge checks pass unless auto-merge is explicitly disabled.

## Backend Test

Reads:

- Backend tasks
- Acceptance criteria
- System rules
- Backend implementation evidence

Writes:

- Unit tests
- Integration tests
- Test command evidence
- Failure reports with exact reproduction

Definition of done:

- Unit tests cover local behavior.
- Integration tests cover API/service boundaries when required.
- Passing evidence is recorded before marking backend tasks verified.

## Orchestrator

Reads:

- Entire state file
- Role artifacts
- Gate decisions
- Verification evidence

Writes:

- State transitions
- Loop history
- Integration verification
- Final handoff

Definition of done:

- The workflow reaches `done`.
- Product, task, implementation, and test evidence are traceable.
- Handoff is complete and unresolved risks are explicit.
