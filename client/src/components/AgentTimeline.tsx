import { agentApi, imageUrl, type AgentTurn, type Character } from "../api";
import { CostLine, ZoomImage } from "../ui";
import { AgentPlanCard } from "./AgentPlanCard";

export function AgentTimeline({
  turns,
  characters,
  pinnedIds,
  busy,
  onChange,
}: {
  turns: AgentTurn[];
  characters: Character[];
  pinnedIds: string[];
  busy: boolean;
  onChange: () => Promise<void>;
}) {
  if (turns.length === 0) {
    return <p className="empty">Describe the first image. Later messages edit the latest result.</p>;
  }

  return (
    <ol className="timeline">
      {turns.map((turn) => (
        <li key={turn.id} className={`turn turn-${turn.status}`}>
          <p className="kicker">{turn.status.replaceAll("_", " ")}</p>
          <p>{turn.instruction}</p>
          {turn.plan ? <p className="muted">{turn.plan.summary}</p> : null}
          {turn.revisedPrompt ? <p className="prompt">{turn.revisedPrompt}</p> : null}
          {turn.generationId ? (
            <ZoomImage src={imageUrl("gallery", turn.generationId, turn.updatedAt)} alt="" />
          ) : null}
          <CostLine usage={turn.usage} />
          {turn.error ? <p className="banner banner-error">{turn.error}</p> : null}
          {turn.status === "failed" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void agentApi.retryTurn(turn.id).then(() => onChange())}
            >
              Retry
            </button>
          ) : null}
          {turn.status === "awaiting_approval" && turn.plan ? (
            <AgentPlanCard
              turn={turn}
              characters={characters}
              pinnedIds={pinnedIds}
              busy={busy}
              onSave={async (expandedPrompt, referenceIds) => {
                await agentApi.patchPlan(turn.id, { expandedPrompt, referenceIds });
                await onChange();
              }}
              onGenerate={async () => {
                await agentApi.generateTurn(turn.id);
                await onChange();
              }}
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}
