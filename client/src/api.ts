export type ViewId = "generate" | "turnaround" | "catalog" | "gallery" | "settings" | "agent";

export type Settings = {
  hasKey: boolean;
  keyHint: string | null;
};

export type Character = {
  id: string;
  name: string;
  notes: string;
  createdAt: string;
};

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
  usage?: ImageCost;
};

export type ImageCost = {
  inputTokens: number;
  textTokens: number;
  imageTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
};

export type Generation = {
  id: string;
  kind: GenerationKind;
  prompt: string;
  quality: string;
  size: string;
  referenceIds: string[];
  createdAt: string;
  usage?: ImageCost;
  agentThreadId?: string;
  agentTurnId?: string;
};

export const QUALITIES = ["low", "medium", "high", "xhigh", "max"] as const;
/** GPT Image `images.edit` accepts at most 16 input images. */
export const MAX_REFERENCE_IMAGES = 16;
export const SIZES = ["1024x1024", "1536x1024", "1024x1536"] as const;

export class ApiError extends Error {}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const text = await response.text();
  const body = text ? (JSON.parse(text) as { error?: string }) : {};
  if (!response.ok) throw new ApiError(body.error || "Request failed.");
  return body as T;
}

export function imageUrl(kind: "catalog" | "gallery", id: string, version?: string): string {
  const base = `/api/images/${kind}/${id}`;
  return version ? `${base}?v=${encodeURIComponent(version)}` : base;
}

const jsonHeaders = { "Content-Type": "application/json" };

export const agentApi = {
  listThreads: () => api<{ threads: AgentThread[] }>("/api/agent/threads"),
  createThread: (sourceGalleryId?: string) =>
    api<{ thread: AgentThread }>("/api/agent/threads", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(sourceGalleryId ? { sourceGalleryId } : {}),
    }),
  patchThread: (id: string, body: Partial<Pick<AgentThread, "title" | "model" | "autoGenerate" | "quality" | "size" | "pinnedReferenceIds">>) =>
    api<{ thread: AgentThread }>(`/api/agent/threads/${id}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    }),
  deleteThread: (id: string) => api<{ ok: true }>(`/api/agent/threads/${id}`, { method: "DELETE" }),
  listTurns: (id: string) => api<{ turns: AgentTurn[] }>(`/api/agent/threads/${id}/turns`),
  createTurn: (id: string, instruction: string) =>
    api<{ turn: AgentTurn }>(`/api/agent/threads/${id}/turns`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ instruction }),
    }),
  patchPlan: (id: string, body: { expandedPrompt: string; referenceIds: string[] }) =>
    api<{ turn: AgentTurn }>(`/api/agent/turns/${id}/plan`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    }),
  generateTurn: (id: string) => api<{ turn: AgentTurn }>(`/api/agent/turns/${id}/generate`, { method: "POST" }),
  retryTurn: (id: string) => api<{ turn: AgentTurn }>(`/api/agent/turns/${id}/retry`, { method: "POST" }),
};

export function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
