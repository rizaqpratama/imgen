import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError, api, formatWhen, imageUrl, type Character, type Generation, type GenerationKind } from "../api";
import { Banner, CostLine, PageHeader, ZoomImage } from "../ui";

const FILTERS: { id: "all" | GenerationKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "text", label: "Text" },
  { id: "edit", label: "Edits" },
  { id: "turnaround", label: "Turnarounds" },
  { id: "agent", label: "Agent" },
];

export function GalleryView({
  onUseForEdit,
  onUseForAgent,
}: {
  onUseForEdit: (id: string) => void;
  onUseForAgent: (id: string) => void;
}) {
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [open, setOpen] = useState<Generation | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [gallery, catalog] = await Promise.all([
      api<{ generations: Generation[] }>("/api/gallery"),
      api<{ characters: Character[] }>("/api/catalog"),
    ]);
    setGenerations(gallery.generations);
    setCharacters(catalog.characters);
  }

  useEffect(() => {
    load().catch((reason: unknown) => setError(text(reason)));
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(null);
        setConfirmingDelete(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function remove(generation: Generation) {
    setError(null);
    try {
      await api(`/api/gallery/${generation.id}`, { method: "DELETE" });
      setOpen(null);
      setConfirmingDelete(false);
      await load();
    } catch (reason) {
      setError(text(reason));
    }
  }

  const visible = generations.filter((item) => filter === "all" || item.kind === filter);

  return (
    <section className="page">
      <PageHeader
        index="04"
        title="Gallery"
        lede="Every image this studio has generated. Open one to read the prompt, download it, or send it back into an edit."
      />
      {error ? <Banner tone="error">{error}</Banner> : null}
      <div className="filters" role="tablist" aria-label="Gallery filter">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            className={filter === item.id ? "on" : ""}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="empty">Nothing in this tray yet.</p>
      ) : (
        <ul className="contact">
          {visible.map((generation) => (
            <li key={generation.id}>
              <button
                type="button"
                className="frame"
                onClick={() => {
                  setConfirmingDelete(false);
                  setOpen(generation);
                }}
              >
                <img src={imageUrl("gallery", generation.id, generation.createdAt)} alt="" />
                <span>
                  {label(generation.kind)} · {formatWhen(generation.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open
        ? createPortal(
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="Generated image">
          <button
            type="button"
            className="scrim"
            aria-label="Close"
            onClick={() => {
              setOpen(null);
              setConfirmingDelete(false);
            }}
          />
          <div className="lightbox-card">
            <ZoomImage src={imageUrl("gallery", open.id, open.createdAt)} alt="" />
            <div className="lightbox-copy">
              <p className="kicker">
                {label(open.kind)} · {open.size} · {open.quality}
              </p>
              <h3>Prompt</h3>
              <p className="prompt">{open.prompt}</p>
              <h3>Cost</h3>
              {open.usage ? <CostLine usage={open.usage} /> : <p className="muted">Not recorded for this image.</p>}
              <h3>References</h3>
              <p>{referenceNames(open, characters)}</p>
              <p className="muted">{formatWhen(open.createdAt)}</p>
              <div className="actions">
                <a className="button primary" href={imageUrl("gallery", open.id)} download={`${open.id}.png`}>
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => {
                    onUseForEdit(open.id);
                    setOpen(null);
                    setConfirmingDelete(false);
                  }}
                >
                  Use in image edit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onUseForAgent(open.id);
                    setOpen(null);
                    setConfirmingDelete(false);
                  }}
                >
                  Edit with agent
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    if (!confirmingDelete) {
                      setConfirmingDelete(true);
                      return;
                    }
                    void remove(open);
                  }}
                >
                  {confirmingDelete ? "Confirm delete" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )
        : null}
    </section>
  );
}

function referenceNames(generation: Generation, characters: Character[]): string {
  if (generation.referenceIds.length === 0) return "None";
  return generation.referenceIds
    .map((id) => characters.find((character) => character.id === id)?.name ?? "Removed character")
    .join(", ");
}

function label(kind: GenerationKind): string {
  if (kind === "text") return "Text";
  if (kind === "edit") return "Edit";
  if (kind === "agent") return "Agent";
  return "Turnaround";
}

function text(error: unknown): string {
  return error instanceof ApiError ? error.message : "Could not reach the local server.";
}
