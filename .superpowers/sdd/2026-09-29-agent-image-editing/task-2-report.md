# Task 2 Report: GPT-6 Planning and Responses Image Execution

## Status

Implemented and verified.

## Implementation

Created `server/src/agent.ts` with:

- `planAgentTurn(input)`:
  - accepts an injected Responses client or creates the official OpenAI client from the API key;
  - sends the required image-editing director instruction verbatim;
  - requests strict JSON Schema output for `summary`, `expandedPrompt`, `scene`, `preserve`, and `referenceIds`;
  - uses `reasoning.effort: "low"` for `gpt-6-luna` and `"medium"` for `gpt-6-sol`;
  - parses and validates structured output at runtime;
  - throws `AgentPlanError` for absent, malformed JSON, or invalid plan content;
  - filters and merges model-selected references through `mergeReferenceIds`, preserving valid pinned IDs first.
- `executeAgentPlan(input)`:
  - accepts an injected Responses client or creates the official OpenAI client from the API key;
  - constructs the required image-generation tool request;
  - orders content as prompt text, optional current image, then ordered catalog images;
  - reads image files into correctly typed base64 data URLs and sets `detail: "high"`;
  - extracts and decodes the first valid `image_generation_call`;
  - returns response ID, image call ID, bytes, and optional revised prompt;
  - throws `AgentImageError` with `output_text` when no generated image exists;
  - retries a failed continuation exactly once using the same explicit input without `previous_response_id`;
  - does not retry failed fresh requests.
- Runtime error classes `AgentPlanError` and `AgentImageError`.
- Public input and injectable client interfaces.
- A single compatibility cast in `createResponsesClient`, at the official SDK boundary. Request and response data remain runtime-validated.

Created `server/src/agent.test.ts` with injected fake clients covering all requested behaviors plus the fresh-request no-retry guard.

The existing direct Sunburst Images API implementation in `server/src/openai.ts` was not modified.

## TDD Evidence

### Red

Command:

```text
npx tsx --test src/agent.test.ts
```

Exact output:

```text
npm warn Unknown env config "devdir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
node:internal/modules/esm/resolve:275
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\Users\Rizaq\works\ai\img_gen\server\src\agent.js' imported from C:\Users\Rizaq\works\ai\img_gen\server\src\agent.test.ts
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    at moduleResolve (node:internal/modules/esm/resolve:865:10)
    at defaultResolve (node:internal/modules/esm/resolve:991:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:719:20)
    at #resolveAndMaybeBlockOnLoaderThread (node:internal/modules/esm/loader:736:38)
    at nextStep (node:internal/modules/customization_hooks:189:26)
    at resolveBaseSync (file:///C:/Users/Rizaq/works/ai/img_gen/node_modules/tsx/dist/register-nyXW-TH3.mjs:2:11092)
    at resolveDirectorySync (file:///C:/Users/Rizaq/works/ai/img_gen/node_modules/tsx/dist/register-nyXW-TH3.mjs:2:12398)
    at resolveTsPathsSync (file:///C:/Users/Rizaq/works/ai/img_gen/node_modules/tsx/dist/register-nyXW-TH3.mjs:2:13605)
    at resolve (file:///C:/Users/Rizaq/works/ai/img_gen/node_modules/tsx/dist/register-nyXW-TH3.mjs:2:16832) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///C:/Users/Rizaq/works/ai/img_gen/server/src/agent.js'
}

Node.js v24.14.1
✖ src\agent.test.ts (210.06ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 218.7047

✖ failing tests:

test at src\agent.test.ts:1:1
✖ src\agent.test.ts (210.06ms)
  'test failed'
```

The failure was expected: the new tests could not resolve the not-yet-created production module.

### Green

Command:

```text
npx tsx --test src/agent.test.ts
```

Exact output:

```text
npm warn Unknown env config "devdir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
▶ planAgentTurn
  ✔ parses a structured plan and merges pinned known references first (1.2103ms)
  ✔ throws AgentPlanError for malformed structured output (0.6551ms)
  ✔ uses low reasoning effort for Luna and medium for Sol (0.2552ms)
✔ planAgentTurn (2.7389ms)
▶ executeAgentPlan
  ✔ decodes the first generated image and preserves response metadata (0.7307ms)
  ✔ throws a readable AgentImageError including output text when no image exists (0.3658ms)
  ✔ retries a failed continuation exactly once without previous_response_id (0.3813ms)
  ✔ does not retry a failed fresh request (0.2886ms)
  ✔ orders prompt, current image, and labeled catalog images with high detail (3.028ms)
✔ executeAgentPlan (5.1201ms)
ℹ tests 8
ℹ suites 2
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 567.8871
```

## Final Verification

### Server tests

Command:

```text
npm test -w server
```

Exact output:

```text
npm warn Unknown env config "devdir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> test
> tsx --test src/**/*.test.ts

▶ mergeReferenceIds
  ✔ preserves pinned order, appends valid selections, deduplicates (0.9392ms)
  ✔ removes invalid pinned IDs and preserves valid pinned order (0.1049ms)
✔ mergeReferenceIds (1.6945ms)
▶ buildExecutionPrompt
  ✔ labels canvas and character references when editing (0.4048ms)
  ✔ includes approved prompt, scene, and preservation constraints (0.1533ms)
✔ buildExecutionPrompt (0.6981ms)
▶ planAgentTurn
  ✔ parses a structured plan and merges pinned known references first (1.5219ms)
  ✔ throws AgentPlanError for malformed structured output (0.4456ms)
  ✔ uses low reasoning effort for Luna and medium for Sol (0.3895ms)
✔ planAgentTurn (3.0148ms)
▶ executeAgentPlan
  ✔ decodes the first generated image and preserves response metadata (1.0378ms)
  ✔ throws a readable AgentImageError including output text when no image exists (0.3817ms)
  ✔ retries a failed continuation exactly once without previous_response_id (0.4305ms)
  ✔ does not retry a failed fresh request (0.2779ms)
  ✔ orders prompt, current image, and labeled catalog images with high detail (3.0903ms)
✔ executeAgentPlan (5.4996ms)
ℹ tests 12
ℹ suites 4
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 313.6623
```

Exit code: `0`.

### Typecheck

Command:

```text
npx tsc --noEmit -p server/tsconfig.json
```

Exact output:

```text
npm warn Unknown env config "devdir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
```

Exit code: `0`.

## Files Changed

- Added `server/src/agent.ts`
- Added `server/src/agent.test.ts`
- Added `.superpowers/sdd/2026-09-29-agent-image-editing/task-2-report.md`

## Self-Review

- Confirmed the required director text is verbatim.
- Confirmed the JSON Schema is strict, closes additional properties, and requires every plan field.
- Confirmed all structured output is checked at runtime rather than trusted from TypeScript types.
- Confirmed reference filtering uses the supplied catalog as the validity boundary.
- Confirmed prompt labels and actual image content use the same ordering.
- Confirmed the retry path removes only `previous_response_id` and retains the full explicit request.
- Confirmed a fresh request is attempted only once.
- Confirmed the first qualifying image tool output is selected.
- Confirmed production client retries are disabled, so application retry behavior remains exact.
- Confirmed no changes were made to direct Sunburst behavior.
- Confirmed no Git repository was initialized and no commit was created.

## Concerns

- The installed `openai` dependency is `^6.8.1` and its declarations do not include every September 2026 field (notably the image tool choice/revised prompt contract). The compatibility cast is therefore confined to `createResponsesClient`; fake and live responses still pass through runtime validation.
- The required Context7 documentation lookup was attempted twice but failed with `fetch failed`. The implementation was cross-checked against the installed OpenAI SDK source declarations and the task brief.
- npm emits the pre-existing `Unknown env config "devdir"` warning for every npm/npx invocation. It does not affect tests or typechecking.
