import fs from "node:fs";
import OpenAI from "openai";
import { buildExecutionPrompt, mergeReferenceIds } from "./agent-prompts.js";
import { parseImageUsage } from "./openai.js";
import {
  mimeForExt,
  type AgentModel,
  type AgentPlan,
  type AgentThread,
  type Character,
  type Generation,
  type ImageExt,
  type ImageUsage,
} from "./store.js";

const DIRECTOR_INSTRUCTION =
  "You are an image-editing director. Turn the user's short request into production-ready image instructions. Select character references only from the supplied catalog IDs. Preserve identity and requested unchanged details. Do not claim to have seen catalog images; selection is based on their names and notes.";

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    expandedPrompt: { type: "string" },
    scene: { type: "string" },
    preserve: { type: "array", items: { type: "string" } },
    referenceIds: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "expandedPrompt", "scene", "preserve", "referenceIds"],
} as const;

type ResponsesRequest = Record<string, unknown>;

export interface ResponsesClient {
  responses: {
    create(request: ResponsesRequest): Promise<unknown>;
  };
}

export interface PlanAgentTurnInput {
  apiKey: string;
  model: AgentModel;
  instruction: string;
  catalog: Array<Pick<Character, "id" | "name" | "notes">>;
  pinnedReferenceIds: string[];
  currentSceneSummary: string;
  latestImageMetadata?: Generation | null;
  client?: ResponsesClient;
}

export interface ExecuteAgentPlanInput {
  apiKey: string;
  thread: AgentThread;
  plan: AgentPlan;
  selectedCatalog: Array<Character & { filePath: string }>;
  currentImage?: {
    filePath: string;
    ext: ImageExt;
  } | null;
  client?: ResponsesClient;
}

export class AgentPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentPlanError";
  }
}

export class AgentImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentImageError";
  }
}

export async function planAgentTurn(input: PlanAgentTurnInput): Promise<AgentPlan> {
  const client = input.client ?? createResponsesClient(input.apiKey);
  const response = await client.responses.create({
    model: input.model,
    instructions: DIRECTOR_INSTRUCTION,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              instruction: input.instruction,
              catalog: input.catalog,
              pinnedReferenceIds: input.pinnedReferenceIds,
              currentSceneSummary: input.currentSceneSummary,
              latestImageMetadata: input.latestImageMetadata ?? null,
            }),
          },
        ],
      },
    ],
    reasoning: {
      effort: input.model === "gpt-6-luna" ? "low" : "medium",
    },
    text: {
      format: {
        type: "json_schema",
        name: "agent_plan",
        strict: true,
        schema: PLAN_SCHEMA,
      },
    },
  });

  const plan = parsePlan(response);
  return {
    ...plan,
    referenceIds: mergeReferenceIds(
      input.pinnedReferenceIds,
      plan.referenceIds,
      new Set(input.catalog.map((entry) => entry.id)),
    ),
  };
}

export async function executeAgentPlan(
  input: ExecuteAgentPlanInput,
): Promise<{
  bytes: Buffer;
  responseId: string;
  imageCallId: string;
  revisedPrompt: string | null;
  usage: ImageUsage | null;
}> {
  const client = input.client ?? createResponsesClient(input.apiKey);
  const content: Array<Record<string, unknown>> = [
    {
      type: "input_text",
      text: buildExecutionPrompt(
        input.plan,
        input.selectedCatalog,
        Boolean(input.currentImage),
      ),
    },
  ];

  if (input.currentImage) {
    content.push(imageContent(input.currentImage.filePath, input.currentImage.ext));
  }
  for (const reference of input.selectedCatalog) {
    content.push(imageContent(reference.filePath, reference.ext));
  }

  const request: ResponsesRequest = {
    model: input.thread.model,
    input: [{ role: "user", content }],
    ...(input.thread.latestResponseId
      ? { previous_response_id: input.thread.latestResponseId }
      : {}),
    tools: [
      {
        type: "image_generation",
        action: "auto",
        quality: input.thread.quality,
        size: input.thread.size,
      },
    ],
    tool_choice: { type: "image_generation" },
  };

  let response: unknown;
  try {
    response = await client.responses.create(request);
  } catch (error) {
    if (!input.thread.latestResponseId) throw error;
    const { previous_response_id: _previousResponseId, ...freshRequest } = request;
    response = await client.responses.create(freshRequest);
  }

  return parseImageResponse(response);
}

function createResponsesClient(apiKey: string): ResponsesClient {
  const client = new OpenAI({ apiKey, timeout: 180_000, maxRetries: 0 });
  // The installed SDK may not yet describe September 2026 Responses fields.
  return client as unknown as ResponsesClient;
}

function parsePlan(response: unknown): AgentPlan {
  const outputText = record(response)?.output_text;
  if (typeof outputText !== "string" || outputText.length === 0) {
    throw new AgentPlanError("The planning model returned no structured content.");
  }

  let value: unknown;
  try {
    value = JSON.parse(outputText);
  } catch {
    throw new AgentPlanError("The planning model returned malformed JSON.");
  }

  const candidate = record(value);
  if (
    !candidate ||
    typeof candidate.summary !== "string" ||
    typeof candidate.expandedPrompt !== "string" ||
    typeof candidate.scene !== "string" ||
    !isStringArray(candidate.preserve) ||
    !isStringArray(candidate.referenceIds)
  ) {
    throw new AgentPlanError("The planning model returned an invalid agent plan.");
  }

  return {
    summary: candidate.summary,
    expandedPrompt: candidate.expandedPrompt,
    scene: candidate.scene,
    preserve: candidate.preserve,
    referenceIds: candidate.referenceIds,
  };
}

function parseImageResponse(response: unknown): {
  bytes: Buffer;
  responseId: string;
  imageCallId: string;
  revisedPrompt: string | null;
  usage: ImageUsage | null;
} {
  const responseRecord = record(response);
  const output = responseRecord?.output;
  const imageCall = Array.isArray(output)
    ? output.map(record).find(
        (item) =>
          item?.type === "image_generation_call" &&
          typeof item.result === "string",
      )
    : undefined;

  if (!imageCall) {
    const outputText =
      typeof responseRecord?.output_text === "string" && responseRecord.output_text.trim()
        ? ` ${responseRecord.output_text.trim()}`
        : "";
    throw new AgentImageError(`The model returned no generated image.${outputText}`);
  }
  if (typeof responseRecord?.id !== "string" || typeof imageCall.id !== "string") {
    throw new AgentImageError("The model returned incomplete image response metadata.");
  }

  return {
    bytes: Buffer.from(imageCall.result as string, "base64"),
    responseId: responseRecord.id,
    imageCallId: imageCall.id,
    revisedPrompt:
      typeof imageCall.revised_prompt === "string" ? imageCall.revised_prompt : null,
    usage: parseImageUsage(imageCall.usage),
  };
}

function imageContent(filePath: string, ext: ImageExt): Record<string, unknown> {
  const data = fs.readFileSync(filePath).toString("base64");
  return {
    type: "input_image",
    image_url: `data:${mimeForExt(ext)};base64,${data}`,
    detail: "high",
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
