# SDD ledger — plan: docs/superpowers/plans/2026-09-29-agent-image-editing.md

## Preflight

| Scope | Producer / consumer | Finding |
| --- | --- | --- |
| Task 1 | Domain types consumed by Tasks 2–4 | Consistent names and fields. |
| Task 1 / Task 2 | Prompt helpers consumed by execution service | Consistent image-order contract. |
| Task 2 / Task 3 | Planner and executor consumed by routes | Injection requirement is explicit. |
| Task 3 / Task 4 | REST lifecycle consumed by React workspace | Endpoint and status names agree. |
| Task 4 / Task 5 | UI consumed by browser verification | Required review and auto flows are covered. |
| Task 1 internal | Tests against helper implementation | Exact expectations are compatible. |
| Task 2 internal | Tests against service implementation | Fake-client injection is required but exact SDK typing may need a local adapter. |
| Task 3 internal | Route tests against current monolithic server | App extraction may be larger than needed; spec requires route validation, not a specific test harness. |
| Task 4 internal | Components against existing UI patterns | Component boundaries match the spec. |
| Task 5 internal | Verification against delivered app | Live success requires a real key, so mocked execution is authoritative for success paths. |

Ruling: The workspace has no Git repository, so worktrees, diff packages, commits, and commit-based review ranges are unavailable. Use report files plus direct file inspection for reviews. Cost if wrong: weaker change attribution, but no product behavior difference.

Task 1: Ruling: `validIds` applies to pinned and agent-selected IDs. The design requires reference IDs to exist, while catalog deletion can leave a stale pin; retaining it would make execution fail. Preserve the order of surviving pins, then append valid selections. Cost if wrong: a deleted pinned reference disappears silently instead of surfacing a validation error.

Task 1: fix round 1/5 (1 addressed, 0 open — added stale pinned-reference coverage; no commits because workspace has no Git).
Task 1: complete (review clean; 4/4 tests passing and both typechecks clean).
Task 2: complete (review clean; 12/12 tests passing and server typecheck clean).
Task 3: complete (routes plus gallery-seed thread; 20/20 server tests passing). Formal subagent review was skipped after the implementer aborted with the route files already written.
Task 4: complete (Agent workspace, gallery “Edit with agent”, responsive thread picker and reference tray).
Task 5: complete for missing-key and UI flows. Live image generation still needs a real OpenAI key. Browser check covered thread create/rename/delete, Luna/Sol, auto-generate, pinning, missing-key error, gallery seed, and the narrow layout. Test records were removed afterward.

