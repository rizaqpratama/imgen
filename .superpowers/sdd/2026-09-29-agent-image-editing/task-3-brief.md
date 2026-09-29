# Task 3: Agent HTTP lifecycle

Work in `c:\Users\Rizaq\works\ai\img_gen`.

## Files

- Modify `server/src/index.ts`
- Create route tests in `server/src/agent-routes.test.ts` if practical without weakening existing server startup behavior

## Existing services

Use current exports from `server/src/agent.ts`:

```ts
planAgentTurn(input): Promise<AgentPlan>
executeAgentPlan(input): Promise<{
  bytes: Buffer;
  responseId: string;
  imageCallId: string;
  revisedPrompt: string | null;
}>
```

Use existing store helpers and agent domain types. Existing non-agent endpoints must remain compatible.

## Required API

- `GET /api/agent/threads` → `{ threads }`, newest updated first.
- `POST /api/agent/threads` → create with defaults: generated title `"New image thread"`, `gpt-6-luna`, review mode (`autoGenerate: false`), `quality: "high"`, `size: "1024x1024"`, no pins.
- `GET /api/agent/threads/:id/turns` → `{ turns }`, oldest first.
- `PATCH /api/agent/threads/:id` → accepts only supplied `title`, `model`, `autoGenerate`, `quality`, `size`, `pinnedReferenceIds`.
- `DELETE /api/agent/threads/:id` → removes thread and turns only; gallery records/files remain.
- `POST /api/agent/threads/:id/turns` body `{ instruction }` → plan and either await approval or auto-execute according to thread setting.
- `PATCH /api/agent/turns/:id/plan` body `{ expandedPrompt, referenceIds }` → update only an `awaiting_approval` turn. Preserve summary/scene/preserve. Merge thread pins, validate all selected catalog IDs, set `approvedPrompt`.
- `POST /api/agent/turns/:id/generate` → execute an awaiting plan.
- `POST /api/agent/turns/:id/retry` → if failed without a plan, repeat planning; with a plan, repeat generation.

## Validation and lifecycle

- Models are exactly `gpt-6-luna` and `gpt-6-sol`.
- Quality and size use existing `isQuality` and `isSize`.
- Validate title/instruction/prompt lengths using current server conventions.
- Every pinned/selected reference must exist at patch time. Deduplicate IDs.
- Use an in-memory per-thread lock; return 409 when another operation for the same thread is active. Always release in `finally`.
- Require the local API key before any OpenAI planning/generation call.
- Planner input includes catalog manifest (ID/name/notes), pins, latest completed turn's scene, and latest generation metadata.
- Persist statuses before network calls: `planning`, then `awaiting_approval` or `generating`, then `completed` or `failed`.
- On errors persist `failed` and readable `error`, then return an error response. Retry clears prior error.

## Generation persistence

On successful execution, in one `updateDb` mutation:

1. save bytes under a new gallery generation ID;
2. append a generation with `kind: "agent"`, approved prompt, thread quality/size, reference IDs, `agentThreadId`, and `agentTurnId`;
3. mark turn `completed`, set response/call/generation/revised-prompt fields;
4. set thread `latestResponseId` and `updatedAt`.

Current image for execution is the latest completed turn's generation file. Catalog references use the turn's approved reference order.

## Testability

Prefer exporting `createApp(deps?)` while starting the listener only when the file is executed as the entry module. Dependencies should allow fake planner/executor functions. If extracting all existing routes creates unreasonable risk, a smaller `registerAgentRoutes(app, deps)` module is acceptable, but existing runtime startup must continue with `npm run dev`.

Tests should cover:

- thread defaults and invalid model/reference rejection;
- manual planning to `awaiting_approval`;
- plan editing;
- auto mode completed gallery generation;
- retry semantics;
- deletion preserving gallery records.

Tests must use a temporary data/store boundary or dependency injection and must not modify the user's actual `data/db.json`.

Run `npm test -w server` and server typecheck. Do not dispatch subagents, initialize Git, or commit.
