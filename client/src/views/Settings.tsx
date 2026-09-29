import { useEffect, useState, type FormEvent } from "react";
import { ApiError, api, type Settings } from "../api";
import { Banner, Field, PageHeader } from "../ui";

export function SettingsView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | "clear" | null>(null);

  useEffect(() => {
    api<Settings>("/api/settings")
      .then(setSettings)
      .catch((error: unknown) => setMessage({ tone: "error", text: messageOf(error) }));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    setMessage(null);
    try {
      const next = await api<Settings>("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      setSettings(next);
      setApiKey("");
      setMessage({ tone: "ok", text: "Key saved on this machine." });
    } catch (error) {
      setMessage({ tone: "error", text: messageOf(error) });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setMessage(null);
    try {
      await api("/api/settings/test", { method: "POST" });
      setMessage({ tone: "ok", text: "Connected to gpt-image-2.5-sunburst." });
    } catch (error) {
      setMessage({ tone: "error", text: messageOf(error) });
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    setBusy("clear");
    setMessage(null);
    try {
      const next = await api<Settings>("/api/settings", { method: "DELETE" });
      setSettings(next);
      setApiKey("");
      setMessage({ tone: "ok", text: "Key removed." });
    } catch (error) {
      setMessage({ tone: "error", text: messageOf(error) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="page">
      <PageHeader
        index="05"
        title="Key"
        lede="The OpenAI key stays in the local data folder. This page only shows the last four characters."
      />
      <form className="panel narrow" onSubmit={save}>
        <p className="key-state">
          {settings?.hasKey ? (
            <>
              Saved key <strong>{settings.keyHint}</strong>
            </>
          ) : (
            "No key saved yet."
          )}
        </p>
        <Field label="OpenAI API key">
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            placeholder={settings?.hasKey ? "Paste a replacement key" : "sk-…"}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </Field>
        {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}
        <div className="actions">
          <button type="submit" className="primary" disabled={busy !== null || !apiKey.trim()}>
            {busy === "save" ? "Saving…" : "Save key"}
          </button>
          <button type="button" disabled={busy !== null || !settings?.hasKey} onClick={test}>
            {busy === "test" ? "Checking…" : "Test connection"}
          </button>
          <button type="button" className="danger" disabled={busy !== null || !settings?.hasKey} onClick={clear}>
            {busy === "clear" ? "Removing…" : "Remove key"}
          </button>
        </div>
      </form>
    </section>
  );
}

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Could not reach the local server.";
}
