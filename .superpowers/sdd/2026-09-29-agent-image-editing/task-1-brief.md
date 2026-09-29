# Task 1: Durable agent domain model

Work in `c:\Users\Rizaq\works\ai\img_gen`.

## Files

- Modify `server/src/store.ts`
- Modify `client/src/api.ts`
- Modify `server/package.json`
- Create `server/src/agent-prompts.ts`
- Create `server/src/agent-prompts.test.ts`

## Requirements

1. Add server scripts `"test": "tsx --test src/**/*.test.ts"` and `"typecheck": "tsc --noEmit"`.
2. Add server types:

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

3. Add `agentThreads` and `agentTurns` to `Db`, default to empty arrays, and tolerate old database files.
4. Add `"agent"` to `GenerationKind` and optional `agentThreadId`/`agentTurnId` fields to `Generation` and `publicGeneration`.
5. Implement:

```ts
mergeReferenceIds(pinnedIds: string[], selectedIds: string[], validIds: Set<string>): string[]
buildExecutionPrompt(
  plan: AgentPlan,
  references: Array<{ id: string; name: string }>,
  hasCurrentImage: boolean,
): string
```

`mergeReferenceIds` preserves pinned order, appends valid selections, and deduplicates. `buildExecutionPrompt` states image ordering, approved prompt, scene, and preservation constraints. With a current image and Mina as one reference it must match `/Image 1 is the current canvas[\s\S]*Image 2 is the character reference for "Mina"/`.
6. Mirror public agent types in `client/src/api.ts`; add `"agent"` to `ViewId` and `GenerationKind`.
7. Write Node tests covering both helper behaviors.
8. Run `npm test -w server`, and both client and server typechecks.
9. Do not dispatch subagents. Do not initialize Git or commit; this workspace is intentionally not a repository.

