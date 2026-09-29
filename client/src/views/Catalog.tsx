import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, api, imageUrl, type Character } from "../api";
import { Banner, Field, PageHeader } from "../ui";

export function CatalogView() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Character | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function load() {
    const body = await api<{ characters: Character[] }>("/api/catalog");
    setCharacters(body.characters);
  }

  useEffect(() => {
    load().catch((reason: unknown) => setError(text(reason)));
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("Choose a turnaround image.");
      return;
    }
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.set("name", name);
    body.set("notes", notes);
    body.set("image", file);
    try {
      await api("/api/catalog", { method: "POST", body });
      setName("");
      setNotes("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      await load();
    } catch (reason) {
      setError(text(reason));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setError(null);
    try {
      await api(`/api/catalog/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editing.name, notes: editing.notes }),
      });
      setEditing(null);
      await load();
    } catch (reason) {
      setError(text(reason));
    }
  }

  async function remove(character: Character) {
    setError(null);
    try {
      await api(`/api/catalog/${character.id}`, { method: "DELETE" });
      setPendingDeleteId(null);
      await load();
    } catch (reason) {
      setError(text(reason));
    }
  }

  return (
    <section className="page">
      <PageHeader
        index="03"
        title="Catalog"
        lede="Character turnaround sheets used as image references. Upload one you already have, or keep sheets from the turnaround tool."
      />
      {error ? <Banner tone="error">{error}</Banner> : null}
      <form className="panel" onSubmit={create}>
        <div className="split">
          <Field label="Character name">
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </Field>
          <Field label="Turnaround image">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </Field>
        </div>
        <Field label="Notes">
          <textarea value={notes} rows={3} onChange={(event) => setNotes(event.target.value)} />
        </Field>
        <div className="actions">
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add to catalog"}
          </button>
        </div>
      </form>

      {characters.length === 0 ? (
        <p className="empty">The catalog is empty. Add a turnaround sheet to use it as a reference.</p>
      ) : (
        <ul className="card-grid">
          {characters.map((character) => (
            <li key={character.id} className="sleeve">
              <img src={imageUrl("catalog", character.id, character.createdAt)} alt="" />
              {editing?.id === character.id ? (
                <form className="sleeve-edit" onSubmit={saveEdit}>
                  <input
                    value={editing.name}
                    onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                    required
                  />
                  <textarea
                    rows={3}
                    value={editing.notes}
                    onChange={(event) => setEditing({ ...editing, notes: event.target.value })}
                  />
                  <div className="actions">
                    <button className="primary" type="submit">
                      Save
                    </button>
                    <button type="button" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="sleeve-copy">
                  <h3>{character.name}</h3>
                  {character.notes ? <p>{character.notes}</p> : <p className="muted">No notes</p>}
                  <div className="actions">
                    <button type="button" onClick={() => setEditing(character)}>
                      Rename
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        if (pendingDeleteId !== character.id) {
                          setPendingDeleteId(character.id);
                          return;
                        }
                        void remove(character);
                      }}
                    >
                      {pendingDeleteId === character.id ? "Confirm delete" : "Delete"}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function text(error: unknown): string {
  return error instanceof ApiError ? error.message : "Could not reach the local server.";
}
