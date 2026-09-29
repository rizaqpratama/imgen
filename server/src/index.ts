import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import multer from "multer";
import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AgentHttpError, registerAgentRoutes } from "./agent-routes.js";
import {
  MODEL,
  MAX_REFERENCE_IMAGES,
  TURNAROUND_SIZE,
  composePrompt,
  createImage,
  isQuality,
  isSize,
  testKey,
  turnaroundPrompt,
} from "./openai.js";
import {
  byNewest,
  deleteImage,
  extForMime,
  imageFile,
  keyHint,
  mimeForExt,
  publicCharacter,
  publicGeneration,
  readDb,
  saveImage,
  updateDb,
  type Character,
  type Generation,
  type ImageExt,
} from "./store.js";

const PORT = 3001;
const MAX_IMAGES = MAX_REFERENCE_IMAGES;
const MAX_NAME = 80;
const MAX_NOTES = 2000;
const MAX_PROMPT = 4000;

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const app = express();
app.use(express.json({ limit: "1mb" }));

const route =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };

app.get("/api/settings", (_req, res) => {
  res.json(settingsPayload());
});

app.put(
  "/api/settings",
  route(async (req, res) => {
    const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
    if (!apiKey) throw new HttpError(400, "Enter an OpenAI API key.");
    await updateDb((db) => {
      db.apiKey = apiKey;
    });
    res.json(settingsPayload());
  }),
);

app.delete(
  "/api/settings",
  route(async (_req, res) => {
    await updateDb((db) => {
      db.apiKey = "";
    });
    res.json(settingsPayload());
  }),
);

app.post(
  "/api/settings/test",
  route(async (_req, res) => {
    const apiKey = requireKey();
    await testKey(apiKey);
    res.json({ ok: true, model: MODEL });
  }),
);

app.get("/api/catalog", (_req, res) => {
  const db = readDb();
  res.json({ characters: byNewest(db.characters).map(publicCharacter) });
});

app.post(
  "/api/catalog",
  upload.single("image"),
  route(async (req, res) => {
    const name = cleanName(field(req, "name"));
    const notes = cleanNotes(field(req, "notes"));
    const file = req.file;
    if (!file) throw new HttpError(400, "Choose a turnaround image.");
    const ext = requireExt(file.mimetype);
    const character = await updateDb((db) => {
      const created: Character = {
        id: randomUUID(),
        name,
        notes,
        ext,
        createdAt: new Date().toISOString(),
      };
      saveImage("catalog", created.id, ext, file.buffer);
      db.characters.push(created);
      return created;
    });
    res.status(201).json({ character: publicCharacter(character) });
  }),
);

app.patch(
  "/api/catalog/:id",
  route(async (req, res) => {
    const id = requireId(req.params.id);
    const name = cleanName(typeof req.body?.name === "string" ? req.body.name : "");
    const notes = cleanNotes(typeof req.body?.notes === "string" ? req.body.notes : "");
    const character = await updateDb((db) => {
      const found = db.characters.find((item) => item.id === id);
      if (!found) throw new HttpError(404, "Character not found.");
      found.name = name;
      found.notes = notes;
      return found;
    });
    res.json({ character: publicCharacter(character) });
  }),
);

app.delete(
  "/api/catalog/:id",
  route(async (req, res) => {
    const id = requireId(req.params.id);
    await updateDb((db) => {
      const index = db.characters.findIndex((item) => item.id === id);
      if (index === -1) throw new HttpError(404, "Character not found.");
      const [removed] = db.characters.splice(index, 1);
      deleteImage("catalog", removed.id, removed.ext);
    });
    res.json({ ok: true });
  }),
);

app.get("/api/gallery", (_req, res) => {
  const db = readDb();
  res.json({ generations: byNewest(db.generations).map(publicGeneration) });
});

app.get(
  "/api/gallery/:id",
  route(async (req, res) => {
    const id = requireId(req.params.id);
    const generation = readDb().generations.find((item) => item.id === id);
    if (!generation) throw new HttpError(404, "Image not found.");
    res.json({ generation: publicGeneration(generation) });
  }),
);

app.delete(
  "/api/gallery/:id",
  route(async (req, res) => {
    const id = requireId(req.params.id);
    await updateDb((db) => {
      const index = db.generations.findIndex((item) => item.id === id);
      if (index === -1) throw new HttpError(404, "Image not found.");
      const [removed] = db.generations.splice(index, 1);
      deleteImage("gallery", removed.id, removed.ext);
    });
    res.json({ ok: true });
  }),
);

app.get("/api/images/:kind/:id", (req, res) => {
  const kind = req.params.kind;
  if (kind !== "catalog" && kind !== "gallery") {
    res.status(404).json({ error: "Image not found." });
    return;
  }
  let id: string;
  try {
    id = requireId(req.params.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image not found.";
    res.status(400).json({ error: message });
    return;
  }
  const db = readDb();
  const record =
    kind === "catalog"
      ? db.characters.find((item) => item.id === id)
      : db.generations.find((item) => item.id === id);
  const file = record ? imageFile(kind, record.id, record.ext) : "";
  if (!record || !fs.existsSync(file)) {
    res.status(404).json({ error: "Image not found." });
    return;
  }
  res.type(mimeForExt(record.ext));
  res.sendFile(file);
});

app.post(
  "/api/generate",
  upload.single("source"),
  route(async (req, res) => {
    const mode = field(req, "mode");
    if (mode !== "text" && mode !== "edit") throw new HttpError(400, "Choose text or image mode.");
    const userPrompt = cleanPrompt(field(req, "prompt"));
    const quality = field(req, "quality") || "high";
    const size = field(req, "size") || "1024x1024";
    if (!isQuality(quality)) throw new HttpError(400, "Choose a supported quality.");
    if (!isSize(size)) throw new HttpError(400, "Choose a supported size.");

    const referenceIds = parseIds(field(req, "catalogIds"));
    const sourceGalleryId = field(req, "sourceGalleryId");
    const db = readDb();
    const references = referenceIds.map((id) => {
      const character = db.characters.find((item) => item.id === id);
      if (!character) throw new HttpError(400, "A selected character is no longer in the catalog.");
      return character;
    });

    const images: { bytes?: Buffer; filePath?: string; filename: string; ext: ImageExt }[] = [];
    if (mode === "edit") {
      if (req.file) {
        const ext = requireExt(req.file.mimetype);
        images.push({
          bytes: req.file.buffer,
          filename: `source.${ext}`,
          ext,
        });
      } else if (sourceGalleryId) {
        const id = requireId(sourceGalleryId);
        const generation = db.generations.find((item) => item.id === id);
        if (!generation) throw new HttpError(400, "The source image is no longer in the gallery.");
        images.push({
          filePath: imageFile("gallery", generation.id, generation.ext),
          filename: `source.${generation.ext}`,
          ext: generation.ext,
        });
      } else {
        throw new HttpError(400, "Add an image to edit.");
      }
    }

    if (images.length + references.length > MAX_IMAGES) {
      throw new HttpError(400, `Use at most ${MAX_IMAGES} images.`);
    }
    for (const character of references) {
      images.push({
        filePath: imageFile("catalog", character.id, character.ext),
        filename: `reference-${character.id}.${character.ext}`,
        ext: character.ext,
      });
    }

    const prompt = composePrompt(userPrompt, {
      hasSource: mode === "edit",
      referenceCount: references.length,
    });
    const createdImage = await createImage({
      apiKey: requireKey(),
      prompt,
      quality,
      size,
      images,
    });
    const generation = await rememberGeneration({
      kind: mode === "edit" ? "edit" : "text",
      prompt,
      quality,
      size,
      referenceIds,
      bytes: createdImage.bytes,
      usage: createdImage.usage,
    });
    res.status(201).json({ generation: publicGeneration(generation) });
  }),
);

app.post(
  "/api/turnaround",
  upload.array("references", MAX_IMAGES),
  route(async (req, res) => {
    const name = cleanName(field(req, "name"));
    const description = cleanNotes(field(req, "description"));
    const quality = field(req, "quality") || "high";
    if (!isQuality(quality)) throw new HttpError(400, "Choose a supported quality.");

    const uploads = Array.isArray(req.files) ? req.files : [];
    if (uploads.length > MAX_IMAGES) {
      throw new HttpError(400, `Use at most ${MAX_IMAGES} images.`);
    }
    const images = uploads.map((file, index) => {
      const ext = requireExt(file.mimetype);
      return { bytes: file.buffer, filename: `reference-${index + 1}.${ext}`, ext };
    });

    const prompt = turnaroundPrompt(name, description, images.length);
    const createdImage = await createImage({
      apiKey: requireKey(),
      prompt,
      quality,
      size: TURNAROUND_SIZE,
      images,
    });

    const created = await updateDb((db) => {
      const now = new Date().toISOString();
      const generation: Generation = {
        id: randomUUID(),
        kind: "turnaround",
        prompt,
        quality,
        size: TURNAROUND_SIZE,
        referenceIds: [],
        ext: "png",
        createdAt: now,
        ...(createdImage.usage ? { usage: createdImage.usage } : {}),
      };
      const character: Character = {
        id: randomUUID(),
        name,
        notes: description,
        ext: "png",
        createdAt: now,
      };
      saveImage("gallery", generation.id, "png", createdImage.bytes);
      saveImage("catalog", character.id, "png", createdImage.bytes);
      db.generations.push(generation);
      db.characters.push(character);
      return { generation, character };
    });

    res.status(201).json({
      generation: publicGeneration(created.generation),
      character: publicCharacter(created.character),
    });
  }),
);

registerAgentRoutes(app);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found." });
});

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "Image must be 25MB or smaller."
        : err.code === "LIMIT_UNEXPECTED_FILE"
          ? `Use at most ${MAX_IMAGES} images.`
          : err.message;
    res.status(400).json({ error: message });
    return;
  }
  if (err instanceof OpenAI.APIError) {
    res.status(err.status ?? 502).json({ error: err.message });
    return;
  }
  if (err instanceof HttpError || err instanceof AgentHttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : "Something went wrong.";
  res.status(500).json({ error: message });
};

app.use(onError);

const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  const server = app.listen(PORT, "127.0.0.1", () => {
    console.log(`studio server http://127.0.0.1:${PORT}`);
  });
  server.requestTimeout = 200_000;
  server.headersTimeout = 210_000;
}

export { app };

function settingsPayload() {
  const apiKey = readDb().apiKey;
  return { hasKey: Boolean(apiKey), keyHint: keyHint(apiKey) };
}

function requireKey(): string {
  const apiKey = readDb().apiKey;
  if (!apiKey) throw new HttpError(400, "Add an OpenAI API key in Settings.");
  return apiKey;
}

function field(req: express.Request, name: string): string {
  const value = req.body?.[name];
  return typeof value === "string" ? value.trim() : "";
}

function requireId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) throw new HttpError(400, "Invalid id.");
  return id;
}

function cleanName(value: string): string {
  const name = value.trim();
  if (!name) throw new HttpError(400, "Enter a character name.");
  if (name.length > MAX_NAME) throw new HttpError(400, `Name must be ${MAX_NAME} characters or fewer.`);
  return name;
}

function cleanNotes(value: string): string {
  const notes = value.trim();
  if (notes.length > MAX_NOTES) {
    throw new HttpError(400, `Notes must be ${MAX_NOTES} characters or fewer.`);
  }
  return notes;
}

function cleanPrompt(value: string): string {
  const prompt = value.trim();
  if (!prompt) throw new HttpError(400, "Enter a prompt.");
  if (prompt.length > MAX_PROMPT) {
    throw new HttpError(400, `Prompt must be ${MAX_PROMPT} characters or fewer.`);
  }
  return prompt;
}

function requireExt(mime: string): ImageExt {
  const ext = extForMime(mime);
  if (!ext) throw new HttpError(400, "Use a PNG, JPEG, or WebP image.");
  return ext;
}

function parseIds(value: string): string[] {
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new HttpError(400, "Character selection was invalid.");
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new HttpError(400, "Character selection was invalid.");
  }
  const ids = parsed.map((item) => requireId(item));
  return [...new Set(ids)];
}

async function rememberGeneration(input: {
  kind: Generation["kind"];
  prompt: string;
  quality: string;
  size: string;
  referenceIds: string[];
  bytes: Buffer;
  usage: Generation["usage"] | null;
}): Promise<Generation> {
  return updateDb((db) => {
    const generation: Generation = {
      id: randomUUID(),
      kind: input.kind,
      prompt: input.prompt,
      quality: input.quality,
      size: input.size,
      referenceIds: input.referenceIds,
      ext: "png",
      createdAt: new Date().toISOString(),
      ...(input.usage ? { usage: input.usage } : {}),
    };
    saveImage("gallery", generation.id, "png", input.bytes);
    db.generations.push(generation);
    return generation;
  });
}
