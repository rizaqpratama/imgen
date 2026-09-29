import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  AgentImageError,
  AgentPlanError,
  executeAgentPlan,
  planAgentTurn,
  type ResponsesClient,
} from "./agent.js";
import type { AgentPlan, AgentThread, Character, Generation } from "./store.js";

type Request = Record<string, unknown>;

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fakeClient(...replies: Array<unknown | Error>): ResponsesClient & { requests: Request[] } {
  const requests: Request[] = [];
  return {
    requests,
    responses: {
      async create(request: Request): Promise<unknown> {
        requests.push(request);
        const reply = replies.shift();
        if (reply instanceof Error) throw reply;
        return reply;
      },
    },
  };
}

function planResponse(value: unknown) {
  return {
    id: "resp-plan",
    output_text: JSON.stringify(value),
    output: [],
  };
}

const validPlan = {
  summary: "Move Mina to the roof",
  expandedPrompt: "Place Mina on a rooftop at golden hour.",
  scene: "Warm rooftop cityscape.",
  preserve: ["identity", "outfit"],
  referenceIds: ["mina", "unknown", "pinned"],
};

function plannerInput(client: ResponsesClient, model: "gpt-6-luna" | "gpt-6-sol" = "gpt-6-luna") {
  return {
    apiKey: "test-key",
    model,
    instruction: "Put Mina on a rooftop",
    catalog: [
      { id: "pinned", name: "Pinned", notes: "Pinned reference" },
      { id: "mina", name: "Mina", notes: "Red coat" },
    ],
    pinnedReferenceIds: ["pinned"],
    currentSceneSummary: "Studio portrait",
    latestImageMetadata: {
      id: "generation-1",
      kind: "agent",
      prompt: "Studio portrait",
      quality: "high",
      size: "1024x1024",
      referenceIds: ["mina"],
      ext: "png",
      createdAt: "2026-09-29T00:00:00.000Z",
    } satisfies Generation,
    client,
  };
}

describe("planAgentTurn", () => {
  it("parses a structured plan and merges pinned known references first", async () => {
    const client = fakeClient(planResponse(validPlan));

    const plan = await planAgentTurn(plannerInput(client));

    assert.deepEqual(plan, {
      ...validPlan,
      referenceIds: ["pinned", "mina"],
    });
    const request = client.requests[0];
    assert.match(
      String(request.instructions),
      /You are an image-editing director\. Turn the user's short request into production-ready image instructions\. Select character references only from the supplied catalog IDs\. Preserve identity and requested unchanged details\. Do not claim to have seen catalog images; selection is based on their names and notes\./,
    );
    assert.deepEqual(
      (request.text as { format: { strict: boolean } }).format.strict,
      true,
    );
  });

  it("throws AgentPlanError for malformed structured output", async () => {
    const client = fakeClient(planResponse({ summary: "Incomplete" }));

    await assert.rejects(planAgentTurn(plannerInput(client)), AgentPlanError);
  });

  it("uses low reasoning effort for Luna and medium for Sol", async () => {
    const luna = fakeClient(planResponse(validPlan));
    const sol = fakeClient(planResponse(validPlan));

    await planAgentTurn(plannerInput(luna, "gpt-6-luna"));
    await planAgentTurn(plannerInput(sol, "gpt-6-sol"));

    assert.deepEqual(luna.requests[0].reasoning, { effort: "low" });
    assert.deepEqual(sol.requests[0].reasoning, { effort: "medium" });
  });
});

const thread: AgentThread = {
  id: "thread-1",
  title: "Rooftop edit",
  model: "gpt-6-luna",
  autoGenerate: false,
  quality: "high",
  size: "1024x1024",
  pinnedReferenceIds: ["mina"],
  latestResponseId: null,
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
};

const approvedPlan: AgentPlan = {
  summary: "Move Mina",
  expandedPrompt: "Place Mina on a rooftop.",
  scene: "Golden-hour rooftop.",
  preserve: ["identity"],
  referenceIds: ["mina"],
};

function imageFiles() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-test-"));
  tempDirectories.push(directory);
  const currentPath = path.join(directory, "current.webp");
  const minaPath = path.join(directory, "mina.png");
  const ariPath = path.join(directory, "ari.jpg");
  fs.writeFileSync(currentPath, Buffer.from("current-image"));
  fs.writeFileSync(minaPath, Buffer.from("mina-image"));
  fs.writeFileSync(ariPath, Buffer.from("ari-image"));
  return { currentPath, minaPath, ariPath };
}

function character(
  id: string,
  name: string,
  ext: "png" | "jpg" | "webp",
  filePath: string,
): Character & { filePath: string } {
  return {
    id,
    name,
    notes: "",
    ext,
    createdAt: "2026-09-29T00:00:00.000Z",
    filePath,
  };
}

describe("executeAgentPlan", () => {
  it("decodes the first generated image and preserves response metadata", async () => {
    const client = fakeClient({
      id: "resp-image",
      output_text: "",
      output: [
        { type: "message", id: "message-1" },
        {
          type: "image_generation_call",
          id: "image-call-1",
          result: Buffer.from("generated").toString("base64"),
          revised_prompt: "A refined rooftop prompt",
        },
      ],
    });

    const result = await executeAgentPlan({
      apiKey: "test-key",
      thread,
      plan: approvedPlan,
      selectedCatalog: [],
      client,
    });

    assert.equal(result.bytes.toString(), "generated");
    assert.equal(result.responseId, "resp-image");
    assert.equal(result.imageCallId, "image-call-1");
    assert.equal(result.revisedPrompt, "A refined rooftop prompt");
  });

  it("throws a readable AgentImageError including output text when no image exists", async () => {
    const client = fakeClient({
      id: "resp-no-image",
      output_text: "The request could not be rendered.",
      output: [{ type: "message", id: "message-1" }],
    });

    await assert.rejects(
      executeAgentPlan({
        apiKey: "test-key",
        thread,
        plan: approvedPlan,
        selectedCatalog: [],
        client,
      }),
      (error: unknown) =>
        error instanceof AgentImageError &&
        /The request could not be rendered\./.test(error.message),
    );
  });

  it("retries a failed continuation exactly once without previous_response_id", async () => {
    const client = fakeClient(
      new Error("continuation expired"),
      {
        id: "resp-retry",
        output_text: "",
        output: [
          {
            type: "image_generation_call",
            id: "image-call-retry",
            result: Buffer.from("retry").toString("base64"),
          },
        ],
      },
    );

    await executeAgentPlan({
      apiKey: "test-key",
      thread: { ...thread, latestResponseId: "resp-previous" },
      plan: approvedPlan,
      selectedCatalog: [],
      client,
    });

    assert.equal(client.requests.length, 2);
    assert.equal(client.requests[0].previous_response_id, "resp-previous");
    assert.equal("previous_response_id" in client.requests[1], false);
    assert.deepEqual(client.requests[1].input, client.requests[0].input);
  });

  it("does not retry a failed fresh request", async () => {
    const client = fakeClient(new Error("request failed"));

    await assert.rejects(
      executeAgentPlan({
        apiKey: "test-key",
        thread,
        plan: approvedPlan,
        selectedCatalog: [],
        client,
      }),
      /request failed/,
    );
    assert.equal(client.requests.length, 1);
  });

  it("orders prompt, current image, and labeled catalog images with high detail", async () => {
    const { currentPath, minaPath, ariPath } = imageFiles();
    const client = fakeClient({
      id: "resp-order",
      output_text: "",
      output: [
        {
          type: "image_generation_call",
          id: "image-call-order",
          result: Buffer.from("ordered").toString("base64"),
        },
      ],
    });

    await executeAgentPlan({
      apiKey: "test-key",
      thread,
      plan: approvedPlan,
      currentImage: { filePath: currentPath, ext: "webp" },
      selectedCatalog: [
        character("mina", "Mina", "png", minaPath),
        character("ari", "Ari", "jpg", ariPath),
      ],
      client,
    });

    const request = client.requests[0] as {
      input: Array<{ content: Array<Record<string, unknown>> }>;
      tools: unknown;
      tool_choice: unknown;
    };
    const content = request.input[0].content;
    assert.equal(content[0].type, "input_text");
    assert.match(String(content[0].text), /Image 1 is the current canvas/);
    assert.match(String(content[0].text), /Image 2 is the character reference for "Mina"/);
    assert.match(String(content[0].text), /Image 3 is the character reference for "Ari"/);
    assert.deepEqual(content.slice(1), [
      {
        type: "input_image",
        image_url: `data:image/webp;base64,${Buffer.from("current-image").toString("base64")}`,
        detail: "high",
      },
      {
        type: "input_image",
        image_url: `data:image/png;base64,${Buffer.from("mina-image").toString("base64")}`,
        detail: "high",
      },
      {
        type: "input_image",
        image_url: `data:image/jpeg;base64,${Buffer.from("ari-image").toString("base64")}`,
        detail: "high",
      },
    ]);
    assert.deepEqual(request.tools, [
      {
        type: "image_generation",
        action: "auto",
        quality: "high",
        size: "1024x1024",
      },
    ]);
    assert.deepEqual(request.tool_choice, { type: "image_generation" });
  });
});
