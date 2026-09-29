import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  agentApi,
  api,
  type AgentThread,
  type AgentTurn,
  type Character,
  type Settings,
} from "../api";
import { AgentComposer } from "../components/AgentComposer";
import { AgentTimeline } from "../components/AgentTimeline";
import { ThreadList } from "../components/ThreadList";
import { Banner, PageHeader } from "../ui";

let defaultThreadRequest: Promise<AgentThread> | null = null;
const pendingGallerySeeds = new Set<string>();

async function ensureThread(threads: AgentThread[]): Promise<AgentThread[]> {
  if (threads.length > 0) return threads;
  if (!defaultThreadRequest) {
    defaultThreadRequest = agentApi
      .createThread()
      .then((body) => body.thread)
      .finally(() => {
        defaultThreadRequest = null;
      });
  }
  return [await defaultThreadRequest];
}

export function AgentView({
  incomingGalleryId,
  onIncomingHandled,
}: {
  incomingGalleryId: string | null;
  onIncomingHandled: () => void;
}) {
  const [threads, setThreads] = useState<AgentThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [turns, setTurns] = useState<AgentTurn[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [hasKey, setHasKey] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refsOpen, setRefsOpen] = useState(true);

  const incomingRef = useRef(incomingGalleryId);
  incomingRef.current = incomingGalleryId;
  const active = threads.find((thread) => thread.id === activeId) ?? null;
  const running = turns.some((turn) => turn.status === "planning" || turn.status === "generating");

  const refreshTurns = useCallback(async (threadId: string) => {
    const body = await agentApi.listTurns(threadId);
    setTurns(body.turns);
  }, []);

  const refreshThreads = useCallback(async (selectId?: string) => {
    const body = await agentApi.listThreads();
    setThreads(body.threads);
    setActiveId((current) => selectId ?? current ?? body.threads[0]?.id ?? null);
    return body.threads;
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([agentApi.listThreads(), api<{ characters: Character[] }>("/api/catalog"), api<Settings>("/api/settings")])
      .then(async ([threadBody, catalogBody, settings]) => {
        if (cancelled) return;
        setCharacters(catalogBody.characters);
        setHasKey(settings.hasKey);
        if (incomingRef.current) {
          setThreads(threadBody.threads);
          return;
        }
        if (cancelled) return;
        const next = await ensureThread(threadBody.threads);
        if (cancelled) return;
        setThreads(next);
        setActiveId(next[0]?.id ?? null);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(text(reason));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!incomingGalleryId || pendingGallerySeeds.has(incomingGalleryId)) return;
    pendingGallerySeeds.add(incomingGalleryId);
    setBusy(true);
    agentApi
      .createThread(incomingGalleryId)
      .then(async (body) => {
        await refreshThreads(body.thread.id);
        onIncomingHandled();
      })
      .catch((reason: unknown) => setError(text(reason)))
      .finally(() => {
        pendingGallerySeeds.delete(incomingGalleryId);
        setBusy(false);
      });
  }, [incomingGalleryId, onIncomingHandled, refreshThreads]);

  useEffect(() => {
    if (!activeId) return;
    refreshTurns(activeId).catch((reason: unknown) => setError(text(reason)));
  }, [activeId, refreshTurns]);

  useEffect(() => {
    if (!activeId || !running) return;
    const timer = window.setInterval(() => {
      refreshTurns(activeId).catch((reason: unknown) => setError(text(reason)));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [activeId, refreshTurns, running]);

  async function mutate(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      if (activeId) await refreshTurns(activeId);
      await refreshThreads();
    } catch (reason) {
      setError(text(reason));
      throw reason;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page agent-page">
      <PageHeader
        index="00"
        title="Agent"
        lede="GPT-6 plans each turn, chooses character references, and edits the latest image through OpenAI’s image tool. Luna is the default."
      />
      {!hasKey ? <Banner tone="error">Add an OpenAI key in Settings before generating.</Banner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      <div className="agent-layout">
        <ThreadList
          threads={threads}
          activeId={activeId}
          onSelect={setActiveId}
          onCreate={() => void mutate(async () => {
            const created = await agentApi.createThread();
            await refreshThreads(created.thread.id);
          })}
          onRename={(id, title) => mutate(() => agentApi.patchThread(id, { title }).then(() => undefined))}
          onDelete={(id) =>
            mutate(async () => {
              await agentApi.deleteThread(id);
              const remaining = await refreshThreads();
              if (id === activeId) setActiveId(remaining.find((thread) => thread.id !== id)?.id ?? remaining[0]?.id ?? null);
            })
          }
        />
        <div className="agent-main">
          <AgentTimeline
            turns={turns}
            characters={characters}
            pinnedIds={active?.pinnedReferenceIds ?? []}
            busy={busy || running}
            onChange={async () => {
              if (activeId) await refreshTurns(activeId);
            }}
          />
          {active ? (
            <AgentComposer
              thread={active}
              characters={characters}
              busy={busy || running}
              refsOpen={refsOpen}
              onToggleRefs={() => setRefsOpen((open) => !open)}
              onPatch={(body) => mutate(() => agentApi.patchThread(active.id, body).then(() => undefined))}
              onSubmit={(instruction) => mutate(() => agentApi.createTurn(active.id, instruction).then(() => undefined))}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function text(error: unknown): string {
  return error instanceof ApiError ? error.message : "Could not reach the local server.";
}
