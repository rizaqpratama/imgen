import { useState } from "react";
import type { AgentTurn, Character } from "../api";

export function AgentPlanCard({
  turn,
  characters,
  pinnedIds,
  busy,
  onSave,
  onGenerate,
}: {
  turn: AgentTurn;
  characters: Character[];
  pinnedIds: string[];
  busy: boolean;
  onSave: (expandedPrompt: string, referenceIds: string[]) => Promise<void>;
  onGenerate: () => Promise<void>;
}) {
  const [prompt, setPrompt] = useState(turn.approvedPrompt ?? turn.plan?.expandedPrompt ?? "");
  const [selected, setSelected] = useState<string[]>(turn.referenceIds);

  function toggle(id: string) {
    if (pinnedIds.includes(id)) return;
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  return (
    <form
      className="plan-card"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(prompt, selected);
      }}
    >
      <p className="kicker">Plan waiting for approval</p>
      <p>{turn.plan?.summary}</p>
      {turn.plan?.scene ? <p className="muted">{turn.plan.scene}</p> : null}
      {turn.plan && turn.plan.preserve.length > 0 ? (
        <ul className="preserve">
          {turn.plan.preserve.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      <label className="field">
        <span>Expanded prompt</span>
        <textarea rows={6} value={prompt} onChange={(event) => setPrompt(event.target.value)} required />
      </label>
      <fieldset className="refs">
        <legend>References for this turn</legend>
        {characters.length === 0 ? (
          <p className="muted">No characters in the catalog yet.</p>
        ) : (
          <ul className="ref-row">
            {characters.map((character) => {
              const pinned = pinnedIds.includes(character.id);
              const on = pinned || selected.includes(character.id);
              return (
                <li key={character.id}>
                  <button
                    type="button"
                    className={on ? "ref on" : "ref"}
                    aria-pressed={on}
                    disabled={pinned}
                    onClick={() => toggle(character.id)}
                  >
                    <span>{character.name}</span>
                    {pinned ? <small>Pinned</small> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>
      <div className="actions">
        <button type="submit" disabled={busy}>
          Save plan
        </button>
        <button
          className="primary"
          type="button"
          disabled={busy}
          onClick={() => void onGenerate()}
        >
          Generate
        </button>
      </div>
    </form>
  );
}
