import { useState, type FormEvent } from "react";
import { QUALITIES, SIZES, imageUrl, type AgentModel, type AgentThread, type Character } from "../api";
import { Field } from "../ui";

export function AgentComposer({
  thread,
  characters,
  busy,
  refsOpen,
  onToggleRefs,
  onPatch,
  onSubmit,
}: {
  thread: AgentThread;
  characters: Character[];
  busy: boolean;
  refsOpen: boolean;
  onToggleRefs: () => void;
  onPatch: (body: Partial<Pick<AgentThread, "model" | "autoGenerate" | "quality" | "size" | "pinnedReferenceIds">>) => Promise<void>;
  onSubmit: (instruction: string) => Promise<void>;
}) {
  const [instruction, setInstruction] = useState("");

  function togglePin(id: string) {
    const next = thread.pinnedReferenceIds.includes(id)
      ? thread.pinnedReferenceIds.filter((item) => item !== id)
      : [...thread.pinnedReferenceIds, id];
    void onPatch({ pinnedReferenceIds: next });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = instruction;
    setInstruction("");
    void onSubmit(value).catch(() => setInstruction(value));
  }

  return (
    <form className="composer panel" onSubmit={submit}>
      <Field label="Instruction">
        <textarea
          rows={4}
          value={instruction}
          required
          disabled={busy}
          placeholder="Put Mina on a rainy rooftop at dusk, three-quarter view, keep her coat and brass ear cuff."
          onChange={(event) => setInstruction(event.target.value)}
        />
      </Field>
      <div className="split">
        <Field label="Agent">
          <select
            value={thread.model}
            disabled={busy}
            onChange={(event) => void onPatch({ model: event.target.value as AgentModel })}
          >
            <option value="gpt-6-luna">GPT-6 Luna</option>
            <option value="gpt-6-sol">GPT-6 Sol</option>
          </select>
        </Field>
        <Field label="Quality">
          <select
            value={thread.quality}
            disabled={busy}
            onChange={(event) => void onPatch({ quality: event.target.value })}
          >
            {QUALITIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Size">
          <select value={thread.size} disabled={busy} onChange={(event) => void onPatch({ size: event.target.value })}>
            {SIZES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label className="auto-toggle">
        <input
          type="checkbox"
          checked={thread.autoGenerate}
          disabled={busy}
          onChange={(event) => void onPatch({ autoGenerate: event.target.checked })}
        />
        Auto-generate
      </label>
      <div className="actions">
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Working…" : thread.autoGenerate ? "Send and generate" : "Plan turn"}
        </button>
        <button type="button" className="refs-toggle" onClick={onToggleRefs}>
          {refsOpen ? "Hide references" : "Show references"}
        </button>
      </div>
      <aside className={refsOpen ? "ref-tray open" : "ref-tray"}>
        <h3>Pinned characters</h3>
        {characters.length === 0 ? (
          <p className="muted">No characters in the catalog yet.</p>
        ) : (
          <ul className="ref-row">
            {characters.map((character) => {
              const on = thread.pinnedReferenceIds.includes(character.id);
              return (
                <li key={character.id}>
                  <button type="button" className={on ? "ref on" : "ref"} aria-pressed={on} onClick={() => togglePin(character.id)}>
                    <img src={imageUrl("catalog", character.id, character.createdAt)} alt="" />
                    <span>{character.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
    </form>
  );
}
