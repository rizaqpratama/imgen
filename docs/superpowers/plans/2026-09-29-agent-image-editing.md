# Agent Image Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable GPT-6 Luna/Sol image-editing threads with agent-selected catalog references, reviewable plans, auto-generation, and turn-by-turn Responses API image edits.

**Architecture:** The server runs a two-stage workflow: GPT-6 produces a validated JSON plan from thread and catalog metadata, then GPT-6 invokes the hosted `image_generation` tool with the approved prompt and selected local images. Threads, plans, OpenAI response IDs, and gallery links are persisted in `data/db.json`; a new React Agent workspace renders and controls this lifecycle.

**Tech Stack:** React 19, Vite, TypeScript, Express 5, OpenAI Node SDK, Node test runner through `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-29-agent-image-editing-design.md`

## Global Constraints

- Supported agent models are exactly `gpt-6-luna` and `gpt-6-sol`; Luna is the default.
- The OpenAI key remains server-side in `data/db.json`.
- Pinned references are always included; only selected reference image bytes are sent to OpenAI.
- The existing Generate, Turnaround, Catalog, Gallery, and Key workflows remain functional.
- Deleting an agent thread does not delete its gallery images.
- The project is not currently a Git repository, so commit steps are skipped unless Git is initialized externally.

---

### Task 1: Durable agent domain model

**Files:**
- Modify: `server/src/store.ts`
- Modify: `client/src/api.ts`
- Modify: `server/package.json`
- Create: `server/src/agent-prompts.ts`
- Create: `server/src/agent-prompts.test.ts`

**Interfaces:**
- Produces: `AgentModel`, `AgentPlan`, `AgentThread`, and `AgentTurn` on the server and matching public client types.
- Produces: `mergeReferenceIds(pinnedIds, selectedIds, validIds)` and `buildExecutionPrompt(plan, references, hasCurrentImage)`.

- [ ] **Step 1: Add a server test command**

Set the server scripts to:

```json
{
  "test": "tsx --test src/**/*.test.ts",
  "typecheck": "tsc --noEmit"
}
```

- [ ] **Step 2: Write failing prompt tests**

Cover these exact behaviors:

```ts
assert.deepEqual(
  mergeReferenceIds(["pinned"], ["agent", "pinned", "missing"], new Set(["pinned", "agent"])),
  ["pinned", "agent"],
);
assert.match(
  buildExecutionPrompt(plan, [{ id: "mina", name: "Mina" }], true),
  /Image 1 is the current canvas[\s\S]*Image 2 is the character reference for "Mina"/,
);
```

- [ ] **Step 3: Run tests and verify failure**

Run: `npm test -w server`

Expected: failure because `agent-prompts.ts` does not exist.

- [ ] **Step 4: Extend persistence types**

Add:

```ts
export type AgentModel = "gpt-6-luna" | "gpt-6-sol";
export type AgentTurnStatus = "planning" | "awaiting_approval" | "generating" | "completed" | "failed";
export type AgentPlan = {
  summary: string;
  expandedPrompt: string;
  scene: string;
  preserve: string[];
  referenceIds: string[];
};
export type AgentThread = {
  id: string;
  title: string;
  model: AgentModel;
  autoGenerate: boolean;
  quality: string;
  size: string;
  pinnedReferenceIds: string[];
  latestResponseId: string | null;
  createdAt: string;
  updatedAt: string;
};
export type AgentTurn = {
  id: string;
  threadId: string;
  instruction: string;
  status: AgentTurnStatus;
  plan: AgentPlan | null;
  approvedPrompt: string | null;
  referenceIds: string[];
  responseId: string | null;
  imageCallId: string | null;
  generationId: string | null;
  revisedPrompt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};
```

Add `agentThreads` and `agentTurns` to `Db`, default them to empty arrays, and tolerate old database files without these properties. Add `"agent"` to `GenerationKind` and optional `agentThreadId`/`agentTurnId` fields to `Generation`.

- [ ] **Step 5: Implement prompt helpers**

`mergeReferenceIds` preserves pinned order, appends valid agent selections, removes duplicates, and rejects no input. `buildExecutionPrompt` states image ordering before the approved prompt and includes the plan's scene and preservation constraints.

- [ ] **Step 6: Add matching client types**

Add `"agent"` to `ViewId` and `GenerationKind`, then mirror all public thread, turn, and plan fields in `client/src/api.ts`.

- [ ] **Step 7: Run tests and typechecks**

Run:

```bash
npm test -w server
npx tsc --noEmit -p server/tsconfig.json
npx tsc --noEmit -p client/tsconfig.json
```

Expected: all pass.

### Task 2: GPT-6 planning and image-tool execution

**Files:**
- Create: `server/src/agent.ts`
- Create: `server/src/agent.test.ts`
- Modify: `server/src/openai.ts`

**Interfaces:**
- Consumes: domain types and prompt helpers from Task 1.
- Produces:

```ts
planAgentTurn(input: PlanAgentTurnInput): Promise<AgentPlan>
executeAgentPlan(input: ExecuteAgentPlanInput): Promise<{
  bytes: Buffer;
  responseId: string;
  imageCallId: string;
  revisedPrompt: string | null;
}>
```

- [ ] **Step 1: Write failing service tests with an injected fake client**

Test:

- structured plan JSON is parsed and validated;
- unknown reference IDs are removed while pinned IDs remain;
- malformed structured output throws `AgentPlanError`;
- execution extracts the first `image_generation_call`;
- execution throws a readable error when no image is returned;
- a failed continuation retries once without `previous_response_id`.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -w server`

Expected: failure because `agent.ts` does not exist.

- [ ] **Step 3: Implement planner instructions and JSON schema**

The planner system text must say:

```text
You are an image-editing director. Turn the user's short request into production-ready image instructions. Select character references only from the supplied catalog IDs. Preserve identity and requested unchanged details. Do not claim to have seen catalog images; selection is based on their names and notes.
```

Use Responses structured output with a strict object schema for `summary`, `expandedPrompt`, `scene`, `preserve`, and `referenceIds`. Set `reasoning.effort` to `low` for Luna and `medium` for Sol.

- [ ] **Step 4: Implement image execution**

Create a Responses request with:

```ts
{
  model: thread.model,
  input: [{ role: "user", content }],
  previous_response_id: thread.latestResponseId ?? undefined,
  tools: [{
    type: "image_generation",
    action: "auto",
    quality: thread.quality,
    size: thread.size,
  }],
  tool_choice: { type: "image_generation" },
}
```

`content` starts with `input_text`, followed by the current gallery image as a data URL when present, then selected catalog images in explicit prompt order. Parse `response.output` for `type === "image_generation_call"`, decode `result`, and retain `id` and `revised_prompt`.

- [ ] **Step 5: Preserve the existing Images API**

Leave `createImage`, `turnaroundPrompt`, and direct Sunburst routes unchanged. Share only the OpenAI client factory or base64/data-URL helpers where useful.

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
npm test -w server
npx tsc --noEmit -p server/tsconfig.json
```

Expected: all pass.

### Task 3: Agent HTTP lifecycle

**Files:**
- Modify: `server/src/index.ts`
- Create: `server/src/agent-routes.test.ts`

**Interfaces:**
- Consumes: `planAgentTurn`, `executeAgentPlan`, store types, and existing gallery persistence.
- Produces the REST API specified in the design.

- [ ] **Step 1: Write failing route tests**

Use an exported Express app with mocked agent functions. Cover:

- thread defaults to Luna and review mode;
- invalid models and references return 400;
- manual turn ends in `awaiting_approval`;
- auto turn proceeds to `completed`;
- plan patch changes prompt and references;
- generation creates an `agent` gallery record and updates `latestResponseId`;
- retry clears the old error and re-runs the appropriate stage;
- deletion keeps gallery records.

- [ ] **Step 2: Run route tests and verify failure**

Run: `npm test -w server`

Expected: failure because routes are absent.

- [ ] **Step 3: Extract `app` construction**

Export `createApp(deps?)` and start the listener only from the module entry path. Inject planner/executor functions in tests. Keep existing endpoints byte-for-byte compatible.

- [ ] **Step 4: Implement thread routes**

Implement list, create, patch, delete, and turn-list routes. Patch accepts only `title`, `model`, `autoGenerate`, `quality`, `size`, and `pinnedReferenceIds`.

- [ ] **Step 5: Implement turn planning**

Create the turn with `planning`; call the planner; persist `awaiting_approval` or continue to execution when `autoGenerate` is true. Use a per-thread in-memory lock and return 409 for a concurrent operation.

- [ ] **Step 6: Implement approval, generation, and retry**

Before calling OpenAI set `generating`. On success, atomically save bytes, append the gallery generation, complete the turn, and update the thread response ID. On failure set `failed` with the readable error. Retry failed planning when no plan exists; otherwise retry execution.

- [ ] **Step 7: Run tests and typecheck**

Run:

```bash
npm test -w server
npx tsc --noEmit -p server/tsconfig.json
```

Expected: all pass.

### Task 4: React agent workspace

**Files:**
- Create: `client/src/views/Agent.tsx`
- Create: `client/src/components/ThreadList.tsx`
- Create: `client/src/components/AgentTimeline.tsx`
- Create: `client/src/components/AgentComposer.tsx`
- Create: `client/src/components/AgentPlanCard.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/styles.css`
- Modify: `client/src/views/Gallery.tsx`

**Interfaces:**
- Consumes: typed API records from Task 1 and REST endpoints from Task 3.
- Produces: complete Agent UI and Gallery Agent filter.

- [ ] **Step 1: Add Agent navigation and API helpers**

Place `{ id: "agent", index: "00", label: "Agent" }` before Generate. Add typed functions for listing, creating, patching, and deleting threads; listing turns; submitting, patching, approving, and retrying turns.

- [ ] **Step 2: Build the thread list**

Render new-thread, select, inline rename, and two-click delete controls. Persist model and Auto-generate changes through thread patching.

- [ ] **Step 3: Build the timeline**

Render user instruction, planning/generating status, failed state with Retry, plan summary, revised prompt, and linked gallery image. Keep pending plan cards visible after reload.

- [ ] **Step 4: Build the reviewable plan card**

Allow editing `expandedPrompt` and toggling catalog references. Save changes through `PATCH /api/agent/turns/:id/plan`; Generate calls the approval endpoint. Pinned references are displayed as locked selections.

- [ ] **Step 5: Build the composer and reference tray**

The composer includes instruction, quality, size, model, and Auto-generate controls. The reference tray renders catalog thumbnails and pins/unpins IDs on the active thread. Submission clears only the instruction.

- [ ] **Step 6: Compose the Agent workspace**

Load threads initially, create a default thread when none exists, poll the active thread while a turn is `planning` or `generating`, and refresh the timeline after mutations. Prevent duplicate submissions without blocking thread navigation.

- [ ] **Step 7: Add responsive styling**

Desktop: thread rail, timeline, reference tray. Under 980px: thread selector row, single-column timeline, collapsible reference tray. Reuse the existing cream/walnut/cadmium design language.

- [ ] **Step 8: Add Gallery Agent filter**

Add `{ id: "agent", label: "Agent" }` to the filter list and label helper.

- [ ] **Step 9: Typecheck and build**

Run:

```bash
npx tsc --noEmit -p client/tsconfig.json
npm run build -w client
```

Expected: both pass.

### Task 5: End-to-end verification

**Files:**
- Modify only files necessary to correct verification findings.

**Interfaces:**
- Consumes all prior tasks.
- Produces a verified local studio.

- [ ] **Step 1: Run the complete automated suite**

Run:

```bash
npm test -w server
npx tsc --noEmit -p server/tsconfig.json
npx tsc --noEmit -p client/tsconfig.json
npm run build -w client
```

Expected: all pass.

- [ ] **Step 2: Start the application**

Run: `npm run dev`

Expected: server on `127.0.0.1:3001` and client on `localhost:5173`.

- [ ] **Step 3: Browser-test without a real key**

Verify thread create/rename/delete, Luna/Sol selection, Auto-generate toggle, pinned references, responsive layout, and missing-key failure persistence.

- [ ] **Step 4: Exercise mocked successful flows**

With the server agent dependency mocked, verify review-plan editing and approval, auto-generation, retry, timeline reload, gallery Agent filter, and use of a generated image as the next turn's current canvas.

- [ ] **Step 5: Clean test data**

Return `data/db.json` to the user's real records. Remove only synthetic browser-test threads, turns, references, and gallery files.

- [ ] **Step 6: Final verification**

Re-run the complete automated suite and inspect server/client logs for uncaught errors.
