import { randomUUID } from "node:crypto";
import type { Express, RequestHandler } from "express";
import {
  executeAgentPlan as defaultExecuteAgentPlan,
  planAgentTurn as defaultPlanAgentTurn,
  type ExecuteAgentPlanInput,
  type PlanAgentTurnInput,
} from "./agent.js";
import { isQuality, isSize } from "./openai.js";
import { mergeReferenceIds } from "./agent-prompts.js";
import { publishUsage } from "./pricing.js";
import {
  imageFile as defaultImageFile,
  readDb as defaultReadDb,
  saveImage as defaultSaveImage,
  updateDb as defaultUpdateDb,
  type AgentModel,
  type AgentPlan,
  type AgentThread,
  type AgentTurn,
  type Db,
  type Generation,
  type ImageExt,
} from "./store.js";

const MAX_TITLE = 80;
const MAX_PROMPT = 4000;
const AGENT_MODELS: AgentModel[] = ["gpt-6-luna", "gpt-6-sol"];

export class AgentHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "AgentHttpError";
  }
}

export type AgentRouteDeps = {
  readDb: () => Db;
  updateDb: <T>(mutator: (db: Db) => T) => Promise<T>;
  saveImage: (kind: "catalog" | "gallery", id: string, ext: ImageExt, bytes: Buffer) => void;
  imageFile: (kind: "catalog" | "gallery", id: string, ext: ImageExt) => string;
  planAgentTurn: (input: PlanAgentTurnInput) => Promise<AgentPlan>;
  executeAgentPlan: (input: ExecuteAgentPlanInput) => ReturnType<typeof defaultExecuteAgentPlan>;
};

const defaultDeps: AgentRouteDeps = {
  readDb: defaultReadDb,
  updateDb: defaultUpdateDb,
  saveImage: defaultSaveImage,
  imageFile: defaultImageFile,
  planAgentTurn: defaultPlanAgentTurn,
  executeAgentPlan: defaultExecuteAgentPlan,
};

const threadLocks = new Set<string>();

const route =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };

export function registerAgentRoutes(app: Express, deps: Partial<AgentRouteDeps> = {}): void {
  const d: AgentRouteDeps = { ...defaultDeps, ...deps };

  app.get("/api/agent/threads", (_req, res) => {
    const threads = [...d.readDb().agentThreads].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    res.json({ threads });
  });

  app.post(
    "/api/agent/threads",
    route(async (req, res) => {
      const now = new Date().toISOString();
      const sourceGalleryId =
        typeof req.body?.sourceGalleryId === "string" && req.body.sourceGalleryId
          ? requireId(req.body.sourceGalleryId)
          : null;
      const thread = await d.updateDb((db) => {
        if (sourceGalleryId && !db.generations.some((item) => item.id === sourceGalleryId)) {
          throw new AgentHttpError(400, "The source image is no longer in the gallery.");
        }
        const created: AgentThread = {
          id: randomUUID(),
          title: "New image thread",
          model: "gpt-6-luna",
          autoGenerate: false,
          quality: "high",
          size: "1024x1024",
          pinnedReferenceIds: [],
          latestResponseId: null,
          createdAt: now,
          updatedAt: now,
        };
        db.agentThreads.push(created);
        if (sourceGalleryId) {
          const generation = db.generations.find((item) => item.id === sourceGalleryId);
          db.agentTurns.push({
            id: randomUUID(),
            threadId: created.id,
            instruction: "Started from a gallery image.",
            status: "completed",
            plan: {
              summary: "Using an existing gallery image as the current canvas.",
              expandedPrompt: generation?.prompt ?? "",
              scene: "",
              preserve: ["Keep the existing image except where the next instruction asks for a change."],
              referenceIds: generation?.referenceIds ?? [],
            },
            approvedPrompt: generation?.prompt ?? "",
            referenceIds: generation?.referenceIds ?? [],
            responseId: null,
            imageCallId: null,
            generationId: sourceGalleryId,
            revisedPrompt: null,
            error: null,
            createdAt: now,
            updatedAt: now,
          });
        }
        return created;
      });
      res.status(201).json({ thread });
    }),
  );

  app.get(
    "/api/agent/threads/:id/turns",
    route(async (req, res) => {
      const threadId = requireId(req.params.id);
      const db = d.readDb();
      requireThread(db, threadId);
      const turns = db.agentTurns
        .filter((turn) => turn.threadId === threadId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((turn) => turnWithUsage(db, turn));
      res.json({ turns });
    }),
  );

  app.patch(
    "/api/agent/threads/:id",
    route(async (req, res) => {
      const threadId = requireId(req.params.id);
      await withThreadLock(threadId, async () => {
        const body = req.body ?? {};
        const thread = await d.updateDb((db) => {
          const found = requireThread(db, threadId);
          if ("title" in body) found.title = cleanTitle(body.title);
          if ("model" in body) found.model = requireModel(body.model);
          if ("autoGenerate" in body) {
            if (typeof body.autoGenerate !== "boolean") {
              throw new AgentHttpError(400, "autoGenerate must be a boolean.");
            }
            found.autoGenerate = body.autoGenerate;
          }
          if ("quality" in body) {
            const quality = typeof body.quality === "string" ? body.quality : "";
            if (!isQuality(quality)) throw new AgentHttpError(400, "Choose a supported quality.");
            found.quality = quality;
          }
          if ("size" in body) {
            const size = typeof body.size === "string" ? body.size : "";
            if (!isSize(size)) throw new AgentHttpError(400, "Choose a supported size.");
            found.size = size;
          }
          if ("pinnedReferenceIds" in body) {
            found.pinnedReferenceIds = requireReferenceIds(body.pinnedReferenceIds, db);
          }
          found.updatedAt = new Date().toISOString();
          return found;
        });
        res.json({ thread });
      });
    }),
  );

  app.delete(
    "/api/agent/threads/:id",
    route(async (req, res) => {
      const threadId = requireId(req.params.id);
      await withThreadLock(threadId, async () => {
        await d.updateDb((db) => {
          const index = db.agentThreads.findIndex((item) => item.id === threadId);
          if (index === -1) throw new AgentHttpError(404, "Thread not found.");
          db.agentThreads.splice(index, 1);
          db.agentTurns = db.agentTurns.filter((turn) => turn.threadId !== threadId);
        });
        res.json({ ok: true });
      });
    }),
  );

  app.post(
    "/api/agent/threads/:id/turns",
    route(async (req, res) => {
      const threadId = requireId(req.params.id);
      const instruction = cleanPrompt(
        typeof req.body?.instruction === "string" ? req.body.instruction : "",
        "Enter an instruction.",
      );

      await withThreadLock(threadId, async () => {
        const apiKey = requireKey(d.readDb());
        const now = new Date().toISOString();
        const turn = await d.updateDb((db) => {
          requireThread(db, threadId);
          const created: AgentTurn = {
            id: randomUUID(),
            threadId,
            instruction,
            status: "planning",
            plan: null,
            approvedPrompt: null,
            referenceIds: [],
            responseId: null,
            imageCallId: null,
            generationId: null,
            revisedPrompt: null,
            error: null,
            createdAt: now,
            updatedAt: now,
          };
          db.agentTurns.push(created);
          touchThread(db, threadId, now);
          return created;
        });

        try {
          const planned = await runPlanning(d, turn.id, apiKey);
          if (!planned.thread.autoGenerate) {
            res.status(201).json({ turn: planned.turn });
            return;
          }
          const completed = await runGeneration(d, planned.turn.id, apiKey);
          res.status(201).json({ turn: completed });
        } catch (error) {
          const failed = await markFailed(d, turn.id, error);
          throw toHttpError(error, failed);
        }
      });
    }),
  );

  app.patch(
    "/api/agent/turns/:id/plan",
    route(async (req, res) => {
      const turnId = requireId(req.params.id);
      const expandedPrompt = cleanPrompt(
        typeof req.body?.expandedPrompt === "string" ? req.body.expandedPrompt : "",
        "Enter a prompt.",
      );
      const selectedIds = requireIdArray(req.body?.referenceIds);

      const existing = d.readDb().agentTurns.find((item) => item.id === turnId);
      if (!existing) throw new AgentHttpError(404, "Turn not found.");

      await withThreadLock(existing.threadId, async () => {
        const turn = await d.updateDb((db) => {
          const found = requireTurn(db, turnId);
          if (found.status !== "awaiting_approval" || !found.plan) {
            throw new AgentHttpError(400, "Only awaiting plans can be edited.");
          }
          const thread = requireThread(db, found.threadId);
          const referenceIds = mergeAndRequireReferences(
            thread.pinnedReferenceIds,
            selectedIds,
            db,
          );
          found.plan = {
            ...found.plan,
            expandedPrompt,
            referenceIds,
          };
          found.approvedPrompt = expandedPrompt;
          found.referenceIds = referenceIds;
          found.updatedAt = new Date().toISOString();
          touchThread(db, found.threadId, found.updatedAt);
          return found;
        });
        res.json({ turn });
      });
    }),
  );

  app.post(
    "/api/agent/turns/:id/generate",
    route(async (req, res) => {
      const turnId = requireId(req.params.id);
      const existing = d.readDb().agentTurns.find((item) => item.id === turnId);
      if (!existing) throw new AgentHttpError(404, "Turn not found.");

      await withThreadLock(existing.threadId, async () => {
        const apiKey = requireKey(d.readDb());
        const current = d.readDb().agentTurns.find((item) => item.id === turnId);
        if (!current || current.status !== "awaiting_approval" || !current.plan) {
          throw new AgentHttpError(400, "Only awaiting plans can be generated.");
        }
        try {
          const turn = await runGeneration(d, turnId, apiKey);
          res.json({ turn });
        } catch (error) {
          const failed = await markFailed(d, turnId, error);
          throw toHttpError(error, failed);
        }
      });
    }),
  );

  app.post(
    "/api/agent/turns/:id/retry",
    route(async (req, res) => {
      const turnId = requireId(req.params.id);
      const existing = d.readDb().agentTurns.find((item) => item.id === turnId);
      if (!existing) throw new AgentHttpError(404, "Turn not found.");

      await withThreadLock(existing.threadId, async () => {
        const apiKey = requireKey(d.readDb());
        const current = requireTurn(d.readDb(), turnId);
        if (current.status !== "failed") {
          throw new AgentHttpError(400, "Only failed turns can be retried.");
        }

        await d.updateDb((db) => {
          const turn = requireTurn(db, turnId);
          turn.error = null;
          turn.updatedAt = new Date().toISOString();
          touchThread(db, turn.threadId, turn.updatedAt);
        });

        try {
          if (!current.plan) {
            const planned = await runPlanning(d, turnId, apiKey);
            if (!planned.thread.autoGenerate) {
              res.json({ turn: planned.turn });
              return;
            }
            const completed = await runGeneration(d, turnId, apiKey);
            res.json({ turn: completed });
            return;
          }

          const completed = await runGeneration(d, turnId, apiKey);
          res.json({ turn: completed });
        } catch (error) {
          const failed = await markFailed(d, turnId, error);
          throw toHttpError(error, failed);
        }
      });
    }),
  );
}

async function runPlanning(
  d: AgentRouteDeps,
  turnId: string,
  apiKey: string,
): Promise<{ turn: AgentTurn; thread: AgentThread }> {
  await d.updateDb((db) => {
    const turn = requireTurn(db, turnId);
    turn.status = "planning";
    turn.error = null;
    turn.updatedAt = new Date().toISOString();
    touchThread(db, turn.threadId, turn.updatedAt);
  });

  const snapshot = d.readDb();
  const turn = requireTurn(snapshot, turnId);
  const thread = requireThread(snapshot, turn.threadId);
  requireReferenceIds(thread.pinnedReferenceIds, snapshot);

  const completedTurns = snapshot.agentTurns
    .filter((item) => item.threadId === thread.id && item.status === "completed")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latestCompleted = completedTurns[0] ?? null;
  const latestGeneration = latestCompleted?.generationId
    ? snapshot.generations.find((item) => item.id === latestCompleted.generationId) ?? null
    : null;

  const plan = await d.planAgentTurn({
    apiKey,
    model: thread.model,
    instruction: turn.instruction,
    catalog: snapshot.characters.map((character) => ({
      id: character.id,
      name: character.name,
      notes: character.notes,
    })),
    pinnedReferenceIds: thread.pinnedReferenceIds,
    currentSceneSummary: latestCompleted?.plan?.scene ?? "",
    latestImageMetadata: latestGeneration,
  });

  const referenceIds = mergeAndRequireReferences(
    thread.pinnedReferenceIds,
    plan.referenceIds,
    snapshot,
  );
  const resolvedPlan: AgentPlan = { ...plan, referenceIds };
  const now = new Date().toISOString();

  return d.updateDb((db) => {
    const found = requireTurn(db, turnId);
    const foundThread = requireThread(db, found.threadId);
    found.plan = resolvedPlan;
    found.approvedPrompt = resolvedPlan.expandedPrompt;
    found.referenceIds = referenceIds;
    found.status = foundThread.autoGenerate ? "generating" : "awaiting_approval";
    found.error = null;
    found.updatedAt = now;
    touchThread(db, found.threadId, now);
    return { turn: found, thread: foundThread };
  });
}

async function runGeneration(
  d: AgentRouteDeps,
  turnId: string,
  apiKey: string,
): Promise<AgentTurn> {
  const now = new Date().toISOString();
  await d.updateDb((db) => {
    const turn = requireTurn(db, turnId);
    if (!turn.plan) throw new AgentHttpError(400, "Turn has no plan to generate.");
    turn.status = "generating";
    turn.error = null;
    turn.updatedAt = now;
    touchThread(db, turn.threadId, now);
  });

  const snapshot = d.readDb();
  const turn = requireTurn(snapshot, turnId);
  const thread = requireThread(snapshot, turn.threadId);
  if (!turn.plan) throw new AgentHttpError(400, "Turn has no plan to generate.");

  const planForExecution: AgentPlan = {
    ...turn.plan,
    expandedPrompt: turn.approvedPrompt ?? turn.plan.expandedPrompt,
    referenceIds: turn.referenceIds,
  };

  const selectedCatalog = turn.referenceIds.map((id) => {
    const character = snapshot.characters.find((item) => item.id === id);
    if (!character) {
      throw new AgentHttpError(400, "A selected character is no longer in the catalog.");
    }
    return {
      ...character,
      filePath: d.imageFile("catalog", character.id, character.ext),
    };
  });

  const completedTurns = snapshot.agentTurns
    .filter(
      (item) =>
        item.threadId === thread.id &&
        item.status === "completed" &&
        item.id !== turn.id &&
        item.generationId,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latestCompleted = completedTurns[0];
  const currentGeneration = latestCompleted?.generationId
    ? snapshot.generations.find((item) => item.id === latestCompleted.generationId)
    : undefined;
  const currentImage = currentGeneration
    ? {
        filePath: d.imageFile("gallery", currentGeneration.id, currentGeneration.ext),
        ext: currentGeneration.ext,
      }
    : null;

  const result = await d.executeAgentPlan({
    apiKey,
    thread,
    plan: planForExecution,
    selectedCatalog,
    currentImage,
  });

  const completedAt = new Date().toISOString();
  return d.updateDb((db) => {
    const found = requireTurn(db, turnId);
    const foundThread = requireThread(db, found.threadId);
    const generation: Generation = {
      id: randomUUID(),
      kind: "agent",
      prompt: found.approvedPrompt ?? found.plan?.expandedPrompt ?? found.instruction,
      quality: foundThread.quality,
      size: foundThread.size,
      referenceIds: [...found.referenceIds],
      ext: "png",
      createdAt: completedAt,
      agentThreadId: foundThread.id,
      agentTurnId: found.id,
      ...(result.usage ? { usage: result.usage } : {}),
    };
    d.saveImage("gallery", generation.id, "png", result.bytes);
    db.generations.push(generation);
    found.status = "completed";
    found.responseId = result.responseId;
    found.imageCallId = result.imageCallId;
    found.generationId = generation.id;
    found.revisedPrompt = result.revisedPrompt;
    found.error = null;
    found.updatedAt = completedAt;
    foundThread.latestResponseId = result.responseId;
    foundThread.updatedAt = completedAt;
    return found;
  });
}

async function markFailed(
  d: AgentRouteDeps,
  turnId: string,
  error: unknown,
): Promise<AgentTurn> {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  const now = new Date().toISOString();
  return d.updateDb((db) => {
    const turn = requireTurn(db, turnId);
    turn.status = "failed";
    turn.error = message;
    turn.updatedAt = now;
    touchThread(db, turn.threadId, now);
    return turn;
  });
}

function turnWithUsage(db: Db, turn: AgentTurn): AgentTurn & { usage?: ReturnType<typeof publishUsage> } {
  const generation = turn.generationId
    ? db.generations.find((item) => item.id === turn.generationId)
    : undefined;
  return generation?.usage ? { ...turn, usage: publishUsage(generation.usage) } : turn;
}

function toHttpError(error: unknown, failed: AgentTurn): AgentHttpError {
  if (error instanceof AgentHttpError) return error;
  return new AgentHttpError(502, failed.error ?? "Something went wrong.");
}

async function withThreadLock<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
  if (threadLocks.has(threadId)) {
    throw new AgentHttpError(409, "Another operation is already running for this thread.");
  }
  threadLocks.add(threadId);
  try {
    return await fn();
  } finally {
    threadLocks.delete(threadId);
  }
}

function requireKey(db: Db): string {
  if (!db.apiKey) throw new AgentHttpError(400, "Add an OpenAI API key in Settings.");
  return db.apiKey;
}

function requireId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) throw new AgentHttpError(400, "Invalid id.");
  return id;
}

function requireModel(value: unknown): AgentModel {
  if (typeof value !== "string" || !AGENT_MODELS.includes(value as AgentModel)) {
    throw new AgentHttpError(400, "Choose a supported agent model.");
  }
  return value as AgentModel;
}

function cleanTitle(value: unknown): string {
  if (typeof value !== "string") throw new AgentHttpError(400, "Enter a thread title.");
  const title = value.trim();
  if (!title) throw new AgentHttpError(400, "Enter a thread title.");
  if (title.length > MAX_TITLE) {
    throw new AgentHttpError(400, `Title must be ${MAX_TITLE} characters or fewer.`);
  }
  return title;
}

function cleanPrompt(value: string, emptyMessage: string): string {
  const prompt = value.trim();
  if (!prompt) throw new AgentHttpError(400, emptyMessage);
  if (prompt.length > MAX_PROMPT) {
    throw new AgentHttpError(400, `Prompt must be ${MAX_PROMPT} characters or fewer.`);
  }
  return prompt;
}

function requireIdArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new AgentHttpError(400, "Character selection was invalid.");
  }
  return [...new Set(value.map((item) => requireId(item)))];
}

function requireReferenceIds(value: unknown, db: Db): string[] {
  const ids = requireIdArray(value);
  for (const id of ids) {
    if (!db.characters.some((character) => character.id === id)) {
      throw new AgentHttpError(400, "A selected character is no longer in the catalog.");
    }
  }
  return ids;
}

function mergeAndRequireReferences(
  pinnedIds: string[],
  selectedIds: string[],
  db: Db,
): string[] {
  const validIds = new Set(db.characters.map((character) => character.id));
  for (const id of pinnedIds) {
    if (!validIds.has(id)) {
      throw new AgentHttpError(400, "A selected character is no longer in the catalog.");
    }
  }
  for (const id of selectedIds) {
    if (!validIds.has(id)) {
      throw new AgentHttpError(400, "A selected character is no longer in the catalog.");
    }
  }
  return mergeReferenceIds(pinnedIds, selectedIds, validIds);
}

function requireThread(db: Db, threadId: string): AgentThread {
  const thread = db.agentThreads.find((item) => item.id === threadId);
  if (!thread) throw new AgentHttpError(404, "Thread not found.");
  return thread;
}

function requireTurn(db: Db, turnId: string): AgentTurn {
  const turn = db.agentTurns.find((item) => item.id === turnId);
  if (!turn) throw new AgentHttpError(404, "Turn not found.");
  return turn;
}

function touchThread(db: Db, threadId: string, updatedAt: string): void {
  const thread = requireThread(db, threadId);
  thread.updatedAt = updatedAt;
}
