import assert from "node:assert/strict";
import express, { type ErrorRequestHandler } from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import {
  registerAgentRoutes,
  type AgentRouteDeps,
} from "./agent-routes.js";
import type {
  AgentPlan,
  AgentThread,
  AgentTurn,
  Character,
  Db,
  Generation,
  ImageExt,
} from "./store.js";
import type { ExecuteAgentPlanInput, PlanAgentTurnInput } from "./agent.js";

const tempDirectories: string[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

type StoreHandle = {
  root: string;
  readDb: () => Db;
  updateDb: <T>(mutator: (db: Db) => T) => Promise<T>;
  saveImage: (kind: "catalog" | "gallery", id: string, ext: ImageExt, bytes: Buffer) => void;
  imageFile: (kind: "catalog" | "gallery", id: string, ext: ImageExt) => string;
};

function createTempStore(seed?: Partial<Db>): StoreHandle {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-routes-"));
  tempDirectories.push(root);
  const dataDir = path.join(root, "data");
  const catalogDir = path.join(dataDir, "catalog");
  const galleryDir = path.join(dataDir, "gallery");
  const dbPath = path.join(dataDir, "db.json");
  fs.mkdirSync(catalogDir, { recursive: true });
  fs.mkdirSync(galleryDir, { recursive: true });

  const initial: Db = {
    apiKey: seed?.apiKey ?? "test-key",
    characters: seed?.characters ?? [],
    generations: seed?.generations ?? [],
    agentThreads: seed?.agentThreads ?? [],
    agentTurns: seed?.agentTurns ?? [],
  };
  fs.writeFileSync(dbPath, JSON.stringify(initial, null, 2));

  let chain: Promise<void> = Promise.resolve();

  const readDb = (): Db => JSON.parse(fs.readFileSync(dbPath, "utf8")) as Db;

  const writeDb = (db: Db): void => {
    const tmp = `${dbPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, dbPath);
  };

  const updateDb = <T>(mutator: (db: Db) => T): Promise<T> => {
    const run = chain.then(() => {
      const db = readDb();
      const result = mutator(db);
      writeDb(db);
      return result;
    });
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const imageFile = (kind: "catalog" | "gallery", id: string, ext: ImageExt): string =>
    path.join(kind === "catalog" ? catalogDir : galleryDir, `${id}.${ext}`);

  const saveImage = (
    kind: "catalog" | "gallery",
    id: string,
    ext: ImageExt,
    bytes: Buffer,
  ): void => {
    fs.writeFileSync(imageFile(kind, id, ext), bytes);
  };

  return { root, readDb, updateDb, saveImage, imageFile };
}

function seedCharacter(store: StoreHandle, overrides?: Partial<Character>): Character {
  const character: Character = {
    id: overrides?.id ?? "mina",
    name: overrides?.name ?? "Mina",
    notes: overrides?.notes ?? "Red coat",
    ext: overrides?.ext ?? "png",
    createdAt: overrides?.createdAt ?? "2026-09-29T00:00:00.000Z",
  };
  const db = store.readDb();
  db.characters.push(character);
  fs.writeFileSync(
    path.join(store.root, "data", "db.json"),
    JSON.stringify(db, null, 2),
  );
  store.saveImage("catalog", character.id, character.ext, Buffer.from("catalog-image"));
  return character;
}

const samplePlan: AgentPlan = {
  summary: "Move Mina to the roof",
  expandedPrompt: "Place Mina on a rooftop at golden hour.",
  scene: "Warm rooftop cityscape.",
  preserve: ["identity", "outfit"],
  referenceIds: ["mina"],
};

async function startTestServer(deps: AgentRouteDeps): Promise<{ baseUrl: string }> {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  registerAgentRoutes(app, deps);
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    const status =
      typeof err === "object" &&
      err !== null &&
      "status" in err &&
      typeof (err as { status: unknown }).status === "number"
        ? (err as { status: number }).status
        : 500;
    const message = err instanceof Error ? err.message : "Something went wrong.";
    res.status(status).json({ error: message });
  };
  app.use(onError);

  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}` };
}

async function jsonFetch<T>(
  baseUrl: string,
  pathName: string,
  init?: RequestInit,
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json()) as T;
  return { status: response.status, body };
}

function baseDeps(
  store: StoreHandle,
  overrides?: Partial<AgentRouteDeps>,
): AgentRouteDeps {
  return {
    readDb: store.readDb,
    updateDb: store.updateDb,
    saveImage: store.saveImage,
    imageFile: store.imageFile,
    planAgentTurn: async (_input: PlanAgentTurnInput) => structuredClone(samplePlan),
    executeAgentPlan: async (_input: ExecuteAgentPlanInput) => ({
      bytes: Buffer.from("generated-image-bytes"),
      responseId: "resp-generated",
      imageCallId: "call-generated",
      revisedPrompt: "Revised rooftop prompt",
      usage: null,
    }),
    ...overrides,
  };
}

describe("agent routes", () => {
  it("creates threads with Luna review-mode defaults", async () => {
    const store = createTempStore();
    const { baseUrl } = await startTestServer(baseDeps(store));

    const created = await jsonFetch<{ thread: AgentThread }>(baseUrl, "/api/agent/threads", {
      method: "POST",
      body: "{}",
    });

    assert.equal(created.status, 201);
    assert.equal(created.body.thread.title, "New image thread");
    assert.equal(created.body.thread.model, "gpt-6-luna");
    assert.equal(created.body.thread.autoGenerate, false);
    assert.equal(created.body.thread.quality, "high");
    assert.equal(created.body.thread.size, "1024x1024");
    assert.deepEqual(created.body.thread.pinnedReferenceIds, []);
    assert.equal(created.body.thread.latestResponseId, null);

    const listed = await jsonFetch<{ threads: AgentThread[] }>(baseUrl, "/api/agent/threads");
    assert.equal(listed.status, 200);
    assert.equal(listed.body.threads.length, 1);
    assert.equal(listed.body.threads[0]?.id, created.body.thread.id);
  });

  it("seeds a completed turn from an existing gallery image", async () => {
    const store = createTempStore({
      generations: [
        {
          id: "gallery-seed",
          kind: "text",
          prompt: "A quiet harbor at dusk",
          quality: "high",
          size: "1024x1024",
          referenceIds: ["mina"],
          ext: "png",
          createdAt: "2026-09-29T00:00:00.000Z",
        },
      ],
    });
    const { baseUrl } = await startTestServer(baseDeps(store));

    const created = await jsonFetch<{ thread: AgentThread }>(baseUrl, "/api/agent/threads", {
      method: "POST",
      body: JSON.stringify({ sourceGalleryId: "gallery-seed" }),
    });
    assert.equal(created.status, 201);

    const turns = await jsonFetch<{ turns: AgentTurn[] }>(
      baseUrl,
      `/api/agent/threads/${created.body.thread.id}/turns`,
    );
    assert.equal(turns.status, 200);
    assert.equal(turns.body.turns.length, 1);
    assert.equal(turns.body.turns[0]?.status, "completed");
    assert.equal(turns.body.turns[0]?.generationId, "gallery-seed");
    assert.equal(turns.body.turns[0]?.instruction, "Started from a gallery image.");
    assert.deepEqual(turns.body.turns[0]?.referenceIds, ["mina"]);

    const missing = await jsonFetch(baseUrl, "/api/agent/threads", {
      method: "POST",
      body: JSON.stringify({ sourceGalleryId: "missing-image" }),
    });
    assert.equal(missing.status, 400);
    assert.match(String((missing.body as { error?: string }).error), /no longer in the gallery/);
  });

  it("rejects invalid models and missing references", async () => {
    const store = createTempStore();
    seedCharacter(store);
    const { baseUrl } = await startTestServer(baseDeps(store));

    const created = await jsonFetch<{ thread: AgentThread }>(baseUrl, "/api/agent/threads", {
      method: "POST",
      body: "{}",
    });
    const threadId = created.body.thread.id;

    const badModel = await jsonFetch<{ error: string }>(
      baseUrl,
      `/api/agent/threads/${threadId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ model: "gpt-image-1" }),
      },
    );
    assert.equal(badModel.status, 400);
    assert.match(badModel.body.error, /model/i);

    const badPin = await jsonFetch<{ error: string }>(
      baseUrl,
      `/api/agent/threads/${threadId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ pinnedReferenceIds: ["missing-character"] }),
      },
    );
    assert.equal(badPin.status, 400);
    assert.match(badPin.body.error, /catalog|reference|character/i);
  });

  it("plans manually to awaiting_approval and allows plan edits", async () => {
    const store = createTempStore();
    seedCharacter(store);
    const planCalls: PlanAgentTurnInput[] = [];
    const { baseUrl } = await startTestServer(
      baseDeps(store, {
        planAgentTurn: async (input) => {
          planCalls.push(input);
          return {
            ...samplePlan,
            referenceIds: ["mina"],
          };
        },
      }),
    );

    const created = await jsonFetch<{ thread: AgentThread }>(baseUrl, "/api/agent/threads", {
      method: "POST",
      body: "{}",
    });
    const threadId = created.body.thread.id;

    const turnResponse = await jsonFetch<{ turn: AgentTurn }>(
      baseUrl,
      `/api/agent/threads/${threadId}/turns`,
      {
        method: "POST",
        body: JSON.stringify({ instruction: "Put Mina on a rooftop" }),
      },
    );

    assert.equal(turnResponse.status, 201);
    assert.equal(turnResponse.body.turn.status, "awaiting_approval");
    assert.equal(turnResponse.body.turn.plan?.summary, samplePlan.summary);
    assert.equal(turnResponse.body.turn.approvedPrompt, samplePlan.expandedPrompt);
    assert.deepEqual(turnResponse.body.turn.referenceIds, ["mina"]);
    assert.equal(planCalls.length, 1);
    assert.equal(planCalls[0]?.model, "gpt-6-luna");

    const patched = await jsonFetch<{ turn: AgentTurn }>(
      baseUrl,
      `/api/agent/turns/${turnResponse.body.turn.id}/plan`,
      {
        method: "PATCH",
        body: JSON.stringify({
          expandedPrompt: "Edited rooftop prompt with stronger light.",
          referenceIds: ["mina"],
        }),
      },
    );

    assert.equal(patched.status, 200);
    assert.equal(patched.body.turn.status, "awaiting_approval");
    assert.equal(patched.body.turn.plan?.summary, samplePlan.summary);
    assert.equal(patched.body.turn.plan?.scene, samplePlan.scene);
    assert.deepEqual(patched.body.turn.plan?.preserve, samplePlan.preserve);
    assert.equal(
      patched.body.turn.plan?.expandedPrompt,
      "Edited rooftop prompt with stronger light.",
    );
    assert.equal(
      patched.body.turn.approvedPrompt,
      "Edited rooftop prompt with stronger light.",
    );
  });

  it("auto-generates a completed gallery record", async () => {
    const store = createTempStore();
    seedCharacter(store);
    let executeCalls = 0;
    const { baseUrl } = await startTestServer(
      baseDeps(store, {
        executeAgentPlan: async () => {
          executeCalls += 1;
          return {
            bytes: Buffer.from("auto-generated-bytes"),
            responseId: "resp-auto",
            imageCallId: "call-auto",
            revisedPrompt: "Auto revised",
            usage: null,
          };
        },
      }),
    );

    const created = await jsonFetch<{ thread: AgentThread }>(baseUrl, "/api/agent/threads", {
      method: "POST",
      body: "{}",
    });
    const threadId = created.body.thread.id;

    await jsonFetch(baseUrl, `/api/agent/threads/${threadId}`, {
      method: "PATCH",
      body: JSON.stringify({ autoGenerate: true }),
    });

    const turnResponse = await jsonFetch<{ turn: AgentTurn }>(
      baseUrl,
      `/api/agent/threads/${threadId}/turns`,
      {
        method: "POST",
        body: JSON.stringify({ instruction: "Put Mina on a rooftop" }),
      },
    );

    assert.equal(turnResponse.status, 201);
    assert.equal(turnResponse.body.turn.status, "completed");
    assert.equal(turnResponse.body.turn.responseId, "resp-auto");
    assert.equal(turnResponse.body.turn.imageCallId, "call-auto");
    assert.equal(turnResponse.body.turn.revisedPrompt, "Auto revised");
    assert.ok(turnResponse.body.turn.generationId);
    assert.equal(executeCalls, 1);

    const db = store.readDb();
    const generation = db.generations.find(
      (item) => item.id === turnResponse.body.turn.generationId,
    );
    assert.ok(generation);
    assert.equal(generation.kind, "agent");
    assert.equal(generation.agentThreadId, threadId);
    assert.equal(generation.agentTurnId, turnResponse.body.turn.id);
    assert.equal(generation.prompt, samplePlan.expandedPrompt);
    assert.equal(db.agentThreads[0]?.latestResponseId, "resp-auto");
    assert.ok(
      fs.existsSync(store.imageFile("gallery", generation.id, generation.ext)),
    );
  });

  it("retries failed planning and failed generation appropriately", async () => {
    const store = createTempStore();
    seedCharacter(store);
    let planAttempts = 0;
    let executeAttempts = 0;
    const { baseUrl } = await startTestServer(
      baseDeps(store, {
        planAgentTurn: async () => {
          planAttempts += 1;
          if (planAttempts === 1) {
            throw new Error("planner offline");
          }
          return structuredClone(samplePlan);
        },
        executeAgentPlan: async () => {
          executeAttempts += 1;
          if (executeAttempts === 1) {
            throw new Error("image tool offline");
          }
          return {
            bytes: Buffer.from("retry-bytes"),
            responseId: "resp-retry",
            imageCallId: "call-retry",
            revisedPrompt: null,
            usage: null,
          };
        },
      }),
    );

    const created = await jsonFetch<{ thread: AgentThread }>(baseUrl, "/api/agent/threads", {
      method: "POST",
      body: "{}",
    });
    const threadId = created.body.thread.id;

    const failedPlan = await jsonFetch<{ error: string; turn?: AgentTurn }>(
      baseUrl,
      `/api/agent/threads/${threadId}/turns`,
      {
        method: "POST",
        body: JSON.stringify({ instruction: "Put Mina on a rooftop" }),
      },
    );
    assert.equal(failedPlan.status, 502);
    assert.match(failedPlan.body.error, /planner offline/);

    const turnsAfterFail = await jsonFetch<{ turns: AgentTurn[] }>(
      baseUrl,
      `/api/agent/threads/${threadId}/turns`,
    );
    const failedTurn = turnsAfterFail.body.turns[0];
    assert.ok(failedTurn);
    assert.equal(failedTurn.status, "failed");
    assert.equal(failedTurn.plan, null);
    assert.equal(failedTurn.error, "planner offline");

    const retryPlan = await jsonFetch<{ turn: AgentTurn }>(
      baseUrl,
      `/api/agent/turns/${failedTurn.id}/retry`,
      { method: "POST", body: "{}" },
    );
    assert.equal(retryPlan.status, 200);
    assert.equal(retryPlan.body.turn.status, "awaiting_approval");
    assert.equal(retryPlan.body.turn.error, null);
    assert.ok(retryPlan.body.turn.plan);
    assert.equal(planAttempts, 2);

    const failedGenerate = await jsonFetch<{ error: string }>(
      baseUrl,
      `/api/agent/turns/${retryPlan.body.turn.id}/generate`,
      { method: "POST", body: "{}" },
    );
    assert.equal(failedGenerate.status, 502);
    assert.match(failedGenerate.body.error, /image tool offline/);

    const turnsAfterGenerateFail = await jsonFetch<{ turns: AgentTurn[] }>(
      baseUrl,
      `/api/agent/threads/${threadId}/turns`,
    );
    assert.equal(turnsAfterGenerateFail.body.turns[0]?.status, "failed");
    assert.ok(turnsAfterGenerateFail.body.turns[0]?.plan);

    const retryGenerate = await jsonFetch<{ turn: AgentTurn }>(
      baseUrl,
      `/api/agent/turns/${retryPlan.body.turn.id}/retry`,
      { method: "POST", body: "{}" },
    );
    assert.equal(retryGenerate.status, 200);
    assert.equal(retryGenerate.body.turn.status, "completed");
    assert.equal(retryGenerate.body.turn.error, null);
    assert.equal(retryGenerate.body.turn.responseId, "resp-retry");
    assert.equal(executeAttempts, 2);
  });

  it("deletes threads and turns while preserving gallery records", async () => {
    const store = createTempStore();
    seedCharacter(store);
    const { baseUrl } = await startTestServer(baseDeps(store));

    const created = await jsonFetch<{ thread: AgentThread }>(baseUrl, "/api/agent/threads", {
      method: "POST",
      body: "{}",
    });
    const threadId = created.body.thread.id;

    await jsonFetch(baseUrl, `/api/agent/threads/${threadId}`, {
      method: "PATCH",
      body: JSON.stringify({ autoGenerate: true }),
    });

    const turnResponse = await jsonFetch<{ turn: AgentTurn }>(
      baseUrl,
      `/api/agent/threads/${threadId}/turns`,
      {
        method: "POST",
        body: JSON.stringify({ instruction: "Put Mina on a rooftop" }),
      },
    );
    const generationId = turnResponse.body.turn.generationId;
    assert.ok(generationId);

    const deleted = await jsonFetch<{ ok: boolean }>(
      baseUrl,
      `/api/agent/threads/${threadId}`,
      { method: "DELETE" },
    );
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.ok, true);

    const db = store.readDb();
    assert.equal(db.agentThreads.length, 0);
    assert.equal(db.agentTurns.length, 0);
    const generation = db.generations.find((item) => item.id === generationId);
    assert.ok(generation);
    assert.equal(generation.kind, "agent");
    assert.ok(fs.existsSync(store.imageFile("gallery", generation.id, generation.ext)));
  });

  it("returns 409 when a thread operation is already active", async () => {
    const store = createTempStore();
    seedCharacter(store);
    let releasePlan!: () => void;
    const planGate = new Promise<void>((resolve) => {
      releasePlan = resolve;
    });

    const { baseUrl } = await startTestServer(
      baseDeps(store, {
        planAgentTurn: async () => {
          await planGate;
          return structuredClone(samplePlan);
        },
      }),
    );

    const created = await jsonFetch<{ thread: AgentThread }>(baseUrl, "/api/agent/threads", {
      method: "POST",
      body: "{}",
    });
    const threadId = created.body.thread.id;

    const first = jsonFetch<{ turn: AgentTurn }>(
      baseUrl,
      `/api/agent/threads/${threadId}/turns`,
      {
        method: "POST",
        body: JSON.stringify({ instruction: "First instruction" }),
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 30));

    const conflict = await jsonFetch<{ error: string }>(
      baseUrl,
      `/api/agent/threads/${threadId}/turns`,
      {
        method: "POST",
        body: JSON.stringify({ instruction: "Second instruction" }),
      },
    );
    assert.equal(conflict.status, 409);

    releasePlan();
    const finished = await first;
    assert.equal(finished.status, 201);
    assert.equal(finished.body.turn.status, "awaiting_approval");
  });
});
