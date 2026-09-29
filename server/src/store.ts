import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publishUsage } from "./pricing.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "../..");
export const DATA_DIR = path.join(ROOT, "data");
export const DB_PATH = path.join(DATA_DIR, "db.json");
export const CATALOG_DIR = path.join(DATA_DIR, "catalog");
export const GALLERY_DIR = path.join(DATA_DIR, "gallery");

export type ImageExt = "png" | "jpg" | "webp";
export type GenerationKind = "text" | "edit" | "turnaround" | "agent";

export type AgentModel = "gpt-6-luna" | "gpt-6-sol";
export type AgentTurnStatus =
  | "planning"
  | "awaiting_approval"
  | "generating"
  | "completed"
  | "failed";
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

export type Character = {
  id: string;
  name: string;
  notes: string;
  ext: ImageExt;
  createdAt: string;
};

export type ImageUsage = {
  inputTokens: number;
  textTokens: number;
  imageTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type Generation = {
  id: string;
  kind: GenerationKind;
  prompt: string;
  quality: string;
  size: string;
  referenceIds: string[];
  ext: ImageExt;
  createdAt: string;
  usage?: ImageUsage;
  agentThreadId?: string;
  agentTurnId?: string;
};

export type Db = {
  apiKey: string;
  characters: Character[];
  generations: Generation[];
  agentThreads: AgentThread[];
  agentTurns: AgentTurn[];
};

const IMAGE_TYPES: Record<string, ImageExt> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function extForMime(mime: string): ImageExt | null {
  return IMAGE_TYPES[mime] ?? null;
}

export function mimeForExt(ext: ImageExt): string {
  if (ext === "jpg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

function emptyDb(): Db {
  return { apiKey: "", characters: [], generations: [], agentThreads: [], agentTurns: [] };
}

export function ensureDataDirs(): void {
  for (const dir of [DATA_DIR, CATALOG_DIR, GALLERY_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(emptyDb(), null, 2));
  }
}

export function readDb(): Db {
  ensureDataDirs();
  const parsed = JSON.parse(fs.readFileSync(DB_PATH, "utf8")) as Partial<Db>;
  return {
    apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
    characters: Array.isArray(parsed.characters) ? parsed.characters : [],
    generations: Array.isArray(parsed.generations) ? parsed.generations : [],
    agentThreads: Array.isArray(parsed.agentThreads) ? parsed.agentThreads : [],
    agentTurns: Array.isArray(parsed.agentTurns) ? parsed.agentTurns : [],
  };
}

function writeDb(db: Db): void {
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

let chain: Promise<void> = Promise.resolve();

export function updateDb<T>(mutator: (db: Db) => T): Promise<T> {
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
}

export function keyHint(apiKey: string): string | null {
  if (!apiKey) return null;
  return `sk-…${apiKey.slice(-4)}`;
}

export function imageFile(kind: "catalog" | "gallery", id: string, ext: ImageExt): string {
  const dir = kind === "catalog" ? CATALOG_DIR : GALLERY_DIR;
  return path.join(dir, `${id}.${ext}`);
}

export function saveImage(
  kind: "catalog" | "gallery",
  id: string,
  ext: ImageExt,
  bytes: Buffer,
): void {
  ensureDataDirs();
  fs.writeFileSync(imageFile(kind, id, ext), bytes);
}

export function deleteImage(kind: "catalog" | "gallery", id: string, ext: ImageExt): void {
  const file = imageFile(kind, id, ext);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

export function byNewest<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function publicCharacter(character: Character): Omit<Character, "ext"> {
  return {
    id: character.id,
    name: character.name,
    notes: character.notes,
    createdAt: character.createdAt,
  };
}

export function publicGeneration(generation: Generation): Omit<Generation, "ext"> {
  return {
    id: generation.id,
    kind: generation.kind,
    prompt: generation.prompt,
    quality: generation.quality,
    size: generation.size,
    referenceIds: generation.referenceIds,
    createdAt: generation.createdAt,
    ...(generation.usage ? { usage: publishUsage(generation.usage) } : {}),
    ...(generation.agentThreadId !== undefined ? { agentThreadId: generation.agentThreadId } : {}),
    ...(generation.agentTurnId !== undefined ? { agentTurnId: generation.agentTurnId } : {}),
  };
}
