# Task 1 Report: Durable agent domain model

## Status

**DONE**

## Implementation summary

### `server/package.json`

Added scripts:

- `"test": "tsx --test src/**/*.test.ts"`
- `"typecheck": "tsc --noEmit"`

### `server/src/store.ts`

- Exported agent domain types: `AgentModel`, `AgentTurnStatus`, `AgentPlan`, `AgentThread`, `AgentTurn`.
- Extended `GenerationKind` with `"agent"`.
- Added optional `agentThreadId` and `agentTurnId` on `Generation`.
- Extended `Db` with `agentThreads` and `agentTurns`.
- `emptyDb()` initializes both arrays to `[]`.
- `readDb()` tolerates legacy `db.json` files missing `agentThreads` / `agentTurns` (defaults to `[]`).
- `publicGeneration()` forwards optional `agentThreadId` / `agentTurnId` when present.

### `server/src/agent-prompts.ts` (new)

- `mergeReferenceIds(pinnedIds, selectedIds, validIds)` — pinned order first, then valid selections, deduplicated, invalid IDs dropped.
- `buildExecutionPrompt(plan, references, hasCurrentImage)` — image ordering block, then approved prompt (`expandedPrompt`), scene, and bullet list of preserve constraints.

### `client/src/api.ts`

- Added `"agent"` to `ViewId` and `GenerationKind`.
- Mirrored public agent types (`AgentModel`, `AgentTurnStatus`, `AgentPlan`, `AgentThread`, `AgentTurn`).
- Added optional `agentThreadId` / `agentTurnId` on client `Generation`.

## Tests

### File: `server/src/agent-prompts.test.ts`

Covers:

1. Exact `mergeReferenceIds` behavior from the plan.
2. Regex match for canvas + Mina reference ordering when `hasCurrentImage === true`.
3. Presence of expanded prompt, scene, and preserve items in execution prompt.

### TDD red → green

**Red (before `agent-prompts.ts` existed):**

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '...\server\src\agent-prompts.js' imported from ...\agent-prompts.test.ts
✖ tests 1, pass 0, fail 1
npm error command failed ... tsx --test src/**/*.test.ts
```

**Green (after implementation):**

```
▶ mergeReferenceIds
  ✔ preserves pinned order, appends valid selections, deduplicates
✔ mergeReferenceIds
▶ buildExecutionPrompt
  ✔ labels canvas and character references when editing
  ✔ includes approved prompt, scene, and preservation constraints
✔ buildExecutionPrompt
ℹ tests 3
ℹ suites 2
ℹ pass 3
ℹ fail 0
ℹ duration_ms 361.6903
```

### Verification commands (exact outputs)

**`npm test -w server`** — exit code `0` (output above).

**`npx tsc --noEmit -p server/tsconfig.json`** — exit code `0`, no diagnostics.

**`npx tsc --noEmit -p client/tsconfig.json`** — exit code `0`, no diagnostics.

## Files changed

| File | Action |
|------|--------|
| `server/package.json` | Modified |
| `server/src/store.ts` | Modified |
| `server/src/agent-prompts.ts` | Created |
| `server/src/agent-prompts.test.ts` | Created |
| `client/src/api.ts` | Modified |

## Self-review

- **Pinned IDs and `validIds`:** `mergeReferenceIds` only keeps pinned IDs that appear in `validIds`. Task 2 text says unknown agent selections are removed while pinned IDs remain; if a pinned character is deleted from the catalog, this helper will drop that pin. A follow-up task may need to always retain pins regardless of `validIds`.
- **Gallery UI not updated:** `client/src/views/Gallery.tsx` `label()` still returns `"Turnaround"` for any kind other than `text` / `edit`, so future `agent` generations would show the wrong label until a later task adds an Agent filter and label. Out of scope for Task 1; typecheck still passes.
- **Navigation:** `ViewId` includes `"agent"` but `App.tsx` nav is unchanged (expected; Agent view is a later task).
- **`publicGeneration`:** Uses conditional spread for optional agent fields rather than always emitting `undefined`; keeps JSON payloads unchanged for existing generations.

## Concerns

- None blocking Task 1 acceptance criteria.
- Minor follow-up: Gallery filter/label for `"agent"` kind when agent generations are written (Task 3+).

## Sample `buildExecutionPrompt` excerpt (for manual inspection)

With the test plan and Mina reference + current canvas, output begins:

```
Image ordering:
Image 1 is the current canvas
Image 2 is the character reference for "Mina"

Approved prompt:
Place Mina on a rooftop at golden hour.
...
```

This satisfies the required regex:

`/Image 1 is the current canvas[\s\S]*Image 2 is the character reference for "Mina"/`

---

## Review fix (invalid pinned IDs)

**Ruling:** Keep current `mergeReferenceIds` behavior — `validIds` filters both pinned and selected IDs; valid pins keep their relative order; stale pins (e.g. after catalog deletion) are dropped.

**Change:** Added test `removes invalid pinned IDs and preserves valid pinned order` in `server/src/agent-prompts.test.ts`:

```ts
mergeReferenceIds(["alpha", "stale-pin", "beta"], ["gamma"], new Set(["alpha", "beta", "gamma"]))
// => ["alpha", "beta", "gamma"]
```

**Command:** `npm test -w server`

**Output:**

```
▶ mergeReferenceIds
  ✔ preserves pinned order, appends valid selections, deduplicates
  ✔ removes invalid pinned IDs and preserves valid pinned order
✔ mergeReferenceIds
▶ buildExecutionPrompt
  ✔ labels canvas and character references when editing
  ✔ includes approved prompt, scene, and preservation constraints
✔ buildExecutionPrompt
ℹ tests 4
ℹ suites 2
ℹ pass 4
ℹ fail 0
ℹ duration_ms 242.92
```

**Exit code:** 0
