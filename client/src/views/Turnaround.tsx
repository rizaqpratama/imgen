import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, MAX_REFERENCE_IMAGES, QUALITIES, api, imageUrl, type Character, type Generation } from "../api";
import { Banner, CostLine, Field, PageHeader, ZoomImage } from "../ui";
import { useElapsed } from "../useElapsed";

export function TurnaroundView() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [quality, setQuality] = useState<(typeof QUALITIES)[number]>("high");
  const [picks, setPicks] = useState<Picked[]>([]);
  const picksRef = useRef(picks);
  picksRef.current = picks;
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ generation: Generation; character: Character } | null>(null);
  const elapsed = useElapsed(busy);

  useEffect(() => {
    return () => {
      for (const pick of picksRef.current) URL.revokeObjectURL(pick.url);
    };
  }, []);

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    const room = MAX_REFERENCE_IMAGES - picks.length;
    if (incoming.length > room) {
      setError(`GPT Image accepts at most ${MAX_REFERENCE_IMAGES} reference images.`);
    } else {
      setError(null);
    }
    const accepted = incoming.slice(0, Math.max(0, room)).map((file) => ({
      id: crypto.randomUUID(),
      file,
      url: URL.createObjectURL(file),
    }));
    setPicks((current) => [...current, ...accepted]);
    if (fileInput.current) fileInput.current.value = "";
  }

  function removePick(id: string) {
    const found = picks.find((pick) => pick.id === id);
    if (found) URL.revokeObjectURL(found.url);
    setPicks((current) => current.filter((pick) => pick.id !== id));
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.set("name", name);
    body.set("description", description);
    body.set("quality", quality);
    for (const pick of picks) body.append("references", pick.file);
    try {
      const response = await api<{ generation: Generation; character: Character }>("/api/turnaround", {
        method: "POST",
        body,
      });
      setResult(response);
    } catch (reason) {
      setError(text(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page">
      <PageHeader
        index="02"
        title="Turnaround"
        lede="Builds a full-body sheet: front, three-quarter, side, and back. The sheet is saved to the gallery and the catalog."
      />
      <div className="studio">
        <form className="panel" onSubmit={submit}>
          <Field label="Character name">
            <input value={name} required onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Appearance">
            <textarea
              rows={6}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Short black hair, olive coat, brass ear cuff, worn boots…"
            />
          </Field>
          <Field label="Reference photos or sketches">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={(event) => addFiles(event.target.files)}
            />
            {picks.length > 0 ? (
              <ul className="pick-row">
                {picks.map((pick, index) => (
                  <li key={pick.id}>
                    <img src={pick.url} alt="" />
                    <span>Image {index + 1}</span>
                    <button type="button" onClick={() => removePick(pick.id)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="fine">
              {picks.length} of {MAX_REFERENCE_IMAGES}. GPT Image can use up to {MAX_REFERENCE_IMAGES} references
              in one sheet.
            </p>
          </Field>
          <Field label="Quality">
            <select value={quality} onChange={(event) => setQuality(event.target.value as typeof quality)}>
              {QUALITIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </Field>
          {error ? <Banner tone="error">{error}</Banner> : null}
          <div className="actions">
            <button className="primary" type="submit" disabled={busy}>
              {busy ? `Drawing sheet… ${elapsed}s` : "Generate sheet"}
            </button>
          </div>
          <p className="fine">Wide sheet, 2048×1024, neutral gray ground, no labels.</p>
        </form>
        <div className="stage stage-wide">
          {result ? (
            <>
              <ZoomImage
                src={imageUrl("gallery", result.generation.id, result.generation.createdAt)}
                alt={`Turnaround sheet for ${result.character.name}`}
              />
              <p>
                {result.character.name} is in the catalog and the gallery.
              </p>
              <CostLine usage={result.generation.usage} />
            </>
          ) : (
            <p className="stage-empty">{busy ? "Laying out the four views…" : "The sheet will land here."}</p>
          )}
        </div>
      </div>
    </section>
  );
}

type Picked = { id: string; file: File; url: string };

function text(error: unknown): string {
  return error instanceof ApiError ? error.message : "Could not reach the local server.";
}
