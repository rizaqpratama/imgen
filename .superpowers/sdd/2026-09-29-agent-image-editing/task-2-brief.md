# Task 2: GPT-6 planning and image-tool execution

Work in `c:\Users\Rizaq\works\ai\img_gen`.

## Files

- Create `server/src/agent.ts`
- Create `server/src/agent.test.ts`
- Modify `server/src/openai.ts` only if sharing a client/data-URL helper improves clarity

## Existing interfaces

Import `AgentModel`, `AgentPlan`, `AgentThread`, `Character`, `Generation`, and `ImageExt` from `store.ts`; import prompt helpers from `agent-prompts.ts`.

Export:

```ts
planAgentTurn(input: PlanAgentTurnInput): Promise<AgentPlan>
executeAgentPlan(input: ExecuteAgentPlanInput): Promise<{
  bytes: Buffer;
  responseId: string;
  imageCallId: string;
  revisedPrompt: string | null;
}>
```

Both functions must support dependency injection of a fake Responses client for tests; production creates the official OpenAI client from the supplied API key.

## Planner

The planner receives API key, model, user instruction, compact catalog entries (`id`, `name`, `notes`), pinned IDs, current scene summary, latest image metadata, and optionally an injected client.

Its developer instruction includes this exact text:

```text
You are an image-editing director. Turn the user's short request into production-ready image instructions. Select character references only from the supplied catalog IDs. Preserve identity and requested unchanged details. Do not claim to have seen catalog images; selection is based on their names and notes.
```

Call the Responses API with strict structured output for:

```ts
{
  summary: string;
  expandedPrompt: string;
  scene: string;
  preserve: string[];
  referenceIds: string[];
}
```

Use `reasoning.effort = "low"` for `gpt-6-luna` and `"medium"` for `gpt-6-sol`. Validate runtime output. Throw `AgentPlanError` for absent/malformed content. Filter references via `mergeReferenceIds(pinned, returned, validCatalogIds)`.

## Execution

The executor receives API key, thread, approved plan, ordered selected catalog records with image file paths and extensions, optional current gallery image, and optional injected client.

Build a Responses request:

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

Content order is `input_text`, current image as a base64 data URL if present, then catalog images in the same order as the prompt labels. Use `detail: "high"` for image inputs.

Parse the first response output with `type === "image_generation_call"` and a string `result`; decode it. Return response ID, call ID, and `revised_prompt` when string. If no image exists, throw a readable `AgentImageError` containing `response.output_text` when available.

If a request with `previous_response_id` fails, retry once with the same full explicit input and no previous-response field. Do not retry a fresh request.

## Tests

Use injected fake clients. Cover:

1. structured plan parses and pinned IDs merge with known selected IDs;
2. malformed structured output throws `AgentPlanError`;
3. Luna/Sol reasoning effort values;
4. image execution extracts/decode result and preserves response/call/revised prompt;
5. no image throws a readable error;
6. continuation failure retries exactly once without `previous_response_id`;
7. input image and prompt ordering.

Run `npm test -w server` and `npx tsc --noEmit -p server/tsconfig.json`.

Do not dispatch subagents. Do not initialize Git or commit. Preserve the existing direct Sunburst Images API.
