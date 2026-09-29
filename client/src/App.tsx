import { useCallback, useState } from "react";
import type { ViewId } from "./api";
import { AgentView } from "./views/Agent";
import { CatalogView } from "./views/Catalog";
import { GalleryView } from "./views/Gallery";
import { GenerateView } from "./views/Generate";
import { SettingsView } from "./views/Settings";
import { TurnaroundView } from "./views/Turnaround";

const NAV: { id: ViewId; index: string; label: string }[] = [
  { id: "agent", index: "00", label: "Agent" },
  { id: "generate", index: "01", label: "Generate" },
  { id: "turnaround", index: "02", label: "Turnaround" },
  { id: "catalog", index: "03", label: "Catalog" },
  { id: "gallery", index: "04", label: "Gallery" },
  { id: "settings", index: "05", label: "Key" },
];

export function App() {
  const [view, setView] = useState<ViewId>("agent");
  const [editSourceId, setEditSourceId] = useState<string | null>(null);
  const [agentSourceId, setAgentSourceId] = useState<string | null>(null);
  const clearAgentSource = useCallback(() => setAgentSourceId(null), []);

  return (
    <div className="shell">
      <aside className="rail">
        <div className="mark">
          <span className="mark-square" aria-hidden="true" />
          <div>
            <p>Image studio</p>
            <strong>Sunburst</strong>
          </div>
        </div>
        <nav aria-label="Studio">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={view === item.id ? "nav on" : "nav"}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => setView(item.id)}
            >
              <span>{item.index}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <p className="rail-foot">gpt-image-2.5-sunburst</p>
      </aside>
      <main>
        {view === "agent" ? (
          <AgentView incomingGalleryId={agentSourceId} onIncomingHandled={clearAgentSource} />
        ) : null}
        {view === "generate" ? (
          <GenerateView gallerySourceId={editSourceId} onGallerySourceChange={setEditSourceId} />
        ) : null}
        {view === "turnaround" ? <TurnaroundView /> : null}
        {view === "catalog" ? <CatalogView /> : null}
        {view === "gallery" ? (
          <GalleryView
            onUseForEdit={(id) => {
              setEditSourceId(id);
              setView("generate");
            }}
            onUseForAgent={(id) => {
              setAgentSourceId(id);
              setView("agent");
            }}
          />
        ) : null}
        {view === "settings" ? <SettingsView /> : null}
      </main>
    </div>
  );
}
