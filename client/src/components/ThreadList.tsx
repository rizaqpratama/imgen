import { useState } from "react";
import type { AgentThread } from "../api";

export function ThreadList({
  threads,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  threads: AgentThread[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  return (
    <div className="thread-list">
      <div className="thread-list-head">
        <h3>Threads</h3>
        <button type="button" onClick={onCreate}>
          New
        </button>
      </div>
      <label className="thread-picker">
        <span>Thread</span>
        <select value={activeId ?? ""} onChange={(event) => onSelect(event.target.value)}>
          {threads.map((thread) => (
            <option key={thread.id} value={thread.id}>
              {thread.title}
            </option>
          ))}
        </select>
      </label>
      <ul>
        {threads.map((thread) => (
          <li key={thread.id}>
            {editingId === thread.id ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void onRename(thread.id, title).then(() => setEditingId(null));
                }}
              >
                <input value={title} onChange={(event) => setTitle(event.target.value)} required />
                <button className="primary" type="submit">
                  Save
                </button>
              </form>
            ) : (
              <button
                type="button"
                className={thread.id === activeId ? "thread on" : "thread"}
                onClick={() => onSelect(thread.id)}
              >
                <strong>{thread.title}</strong>
                <span>{thread.model === "gpt-6-sol" ? "Sol" : "Luna"}</span>
              </button>
            )}
            <div className="actions">
              <button
                type="button"
                onClick={() => {
                  setEditingId(thread.id);
                  setTitle(thread.title);
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  if (pendingDeleteId !== thread.id) {
                    setPendingDeleteId(thread.id);
                    return;
                  }
                  void onDelete(thread.id).then(() => setPendingDeleteId(null));
                }}
              >
                {pendingDeleteId === thread.id ? "Confirm delete" : "Delete"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
