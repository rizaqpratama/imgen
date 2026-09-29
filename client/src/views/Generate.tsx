import { useEffect, useState, type FormEvent } from "react";
import {
  ApiError,
  QUALITIES,
  SIZES,
  api,
  imageUrl,
  type Character,
  type Generation,
  type Settings,
} from "../api";
import { Banner, CostLine, Field, PageHeader, ZoomImage } from "../ui";
import { useElapsed } from "../useElapsed";

export function GenerateView({
  gallerySourceId,
  onGallerySourceChange,
}: {
  gallerySourceId: string | null;
  onGallerySourceChange: (id: string | null) => void;
}) {
  const [mode, setMode] = useState<"text" | "edit">("text");
  const [prompt, setPrompt] = useState("");
  const [quality, setQuality] = useState<(typeof QUALITIES)[number]>("high");
  const [size, setSize] = useState<(typeof SIZES)[number]>("1024x1024");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [hasKey, setHasKey] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Generation | null>(null);
  const elapsed = useElapsed(busy);

  useEffect(() => {
    api<{ characters: Character[] }>("/api/catalog")
      .then((body) => setCharacters(body.characters))
      .catch((reason: unknown) => setError(text(reason)));
    api<Settings>("/api/settings")
      .then((body) => setHasKey(body.hasKey))
      .catch(() => setHasKey(false));
  }, []);

  useEffect(() => {
    if (!gallerySourceId) return;
    setMode("edit");
    setSourceFile(null);
    setResult(null);
  }, [gallerySourceId]);

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.set("mode", mode);
    body.set("prompt", prompt);
    body.set("quality", quality);
    body.set("size", size);
    body.set("catalogIds", JSON.stringify(selected));
    if (mode === "edit" && sourceFile) body.set("source", sourceFile);
    if (mode === "edit" && !sourceFile && gallerySourceId) body.set("sourceGalleryId", gallerySourceId);
    try {
      const response = await api<{ generation: Generation }>("/api/generate", { method: "POST", body });
      setResult(response.generation);
      setHasKey(true);
    } catch (reason) {
      setError(text(reason));
    } finally {
      setBusy(false);
    }
  }

  const hasSource = mode === "text" || Boolean(sourceFile || gallerySourceId);

  return (
    <section className="page">
      <PageHeader
        index="01"
        title="Generate"
        lede="Text to image, or edit an image. Attach catalog turnarounds when the character has to stay consistent."
      />
      {!hasKey ? (
        <Banner tone="error">Add an OpenAI key in Settings before generating.</Banner>
      ) : null}
      <div className="studio">
        <form className="panel" onSubmit={submit}>
          <div className="mode-switch" role="tablist" aria-label="Generation mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "text"}
              className={mode === "text" ? "on" : ""}
              onClick={() => setMode("text")}
            >
              Text to image
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "edit"}
              className={mode === "edit" ? "on" : ""}
              onClick={() => setMode("edit")}
            >
              Image to image
            </button>
          </div>
          <Field label="Prompt">
            <textarea
              rows={6}
              value={prompt}
              required
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={
                mode === "text"
                  ? "A full-body portrait in a rainy alley, same outfit as the reference…"
                  : "Change the background to a rooftop at dusk. Keep the character."
              }
            />
          </Field>
          {mode === "edit" ? (
            <Field label="Image to edit">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  const next = event.target.files?.[0] ?? null;
                  setSourceFile(next);
                  if (next) onGallerySourceChange(null);
                }}
              />
              {gallerySourceId ? (
                <span className="source-chip">
                  <img src={imageUrl("gallery", gallerySourceId)} alt="" />
                  From the gallery
                  <button type="button" onClick={() => onGallerySourceChange(null)}>
                    Clear
                  </button>
                </span>
              ) : null}
            </Field>
          ) : null}
          <div className="split">
            <Field label="Quality">
              <select value={quality} onChange={(event) => setQuality(event.target.value as typeof quality)}>
                {QUALITIES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Size">
              <select value={size} onChange={(event) => setSize(event.target.value as typeof size)}>
                {SIZES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <fieldset className="refs">
            <legend>Character references</legend>
            {characters.length === 0 ? (
              <p className="muted">No characters in the catalog yet.</p>
            ) : (
              <ul className="ref-row">
                {characters.map((character) => {
                  const on = selected.includes(character.id);
                  return (
                    <li key={character.id}>
                      <button
                        type="button"
                        className={on ? "ref on" : "ref"}
                        aria-pressed={on}
                        onClick={() => toggle(character.id)}
                      >
                        <img src={imageUrl("catalog", character.id, character.createdAt)} alt="" />
                        <span>{character.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>
          {error ? <Banner tone="error">{error}</Banner> : null}
          <div className="actions">
            <button className="primary" type="submit" disabled={busy || !hasSource}>
              {busy ? `Generating… ${elapsed}s` : "Generate"}
            </button>
          </div>
          <p className="fine">Sunburst favors precision over speed. High is the default quality.</p>
        </form>
        <div className="stage">
          {result ? (
            <>
              <ZoomImage src={imageUrl("gallery", result.id, result.createdAt)} alt="Generated image" />
              <p>
                Saved to the gallery · {result.size} · {result.quality}
              </p>
              <CostLine usage={result.usage} />
            </>
          ) : (
            <p className="stage-empty">{busy ? "Holding for Sunburst…" : "The image will land here."}</p>
          )}
        </div>
      </div>
    </section>
  );
}

function text(error: unknown): string {
  return error instanceof ApiError ? error.message : "Could not reach the local server.";
}
