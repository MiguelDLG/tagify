import React, { useCallback, useEffect, useRef, useState } from "react";
import type {
  AiContext,
  AiSettings,
  AppliedEntry,
  ChatMessage,
  Proposal,
  TagStoreSnapshot,
  UsageTotals,
} from "../model/ai.types";
import { AI_MODELS, loadAiSettings, saveAiSettings } from "../utils/ai.settings";
import { buildSystemPrompt } from "../utils/ai.prompt";
import { runAgent } from "../utils/ai.agent";
import type { ToolState } from "../utils/ai.tools";
import { buildProposalUpdates, buildUndoUpdates } from "../utils/ai.proposal";
import { loadHistory, markUndone, recordApplied } from "../utils/ai.history";
import { tagName } from "../utils/ai.taxonomy";
import {
  describeUri,
  loadSnapshot,
  spotifyToolEnv,
  writeTaxonomy,
  writeTrackUpdates,
} from "../utils/ai.store";
import { describeCriteria } from "../utils/ai.taxonomy";
import { styles } from "./AiPanel.styles";

type Item =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; text: string }
  | { kind: "error"; text: string }
  | { kind: "proposal"; proposalId: string };

interface Session {
  context: AiContext;
  contextLabel: string;
  contextBlock: string;
  messages: ChatMessage[];
  items: Item[];
  proposals: Record<string, Proposal>;
  accepted: Record<string, string[]>;
  appliedEntryByProposal: Record<string, string>;
  pendingNotes: string[];
  usage: UsageTotals;
  toolState: ToolState;
}

/** Survives closing the panel, so the general chat can be resumed. */
let lastSession: Session | null = null;

const TOOL_LABELS: Record<string, (args: any) => string> = {
  search_tagged_tracks: (a) => `Searching your tags${a.artist ? ` for ${a.artist}` : a.text ? ` for "${a.text}"` : ""}…`,
  get_tracks: (a) => `Reading ${a.uris?.length ?? ""} track${a.uris?.length === 1 ? "" : "s"}…`,
  get_album_tracks: () => "Reading the album…",
  get_playlist_tracks: () => "Reading the playlist…",
  list_smart_playlists: () => "Checking your smart playlists…",
  propose_changes: () => "Preparing changes…",
};

function pageUriFromLocation(): string | null {
  const path: string = Spicetify.Platform?.History?.location?.pathname ?? "";
  const match = /^\/(playlist|album|artist|track)\/([A-Za-z0-9]{22})/.exec(path);
  return match ? `spotify:${match[1]}:${match[2]}` : null;
}

async function buildContext(context: AiContext): Promise<{ label: string; block: string }> {
  const snapshot = await loadSnapshot();
  const lines: string[] = [];
  let label = "General chat";

  const describeSmart = (uri: string) => {
    const smart = spotifyToolEnv.smartPlaylists().find((p) => `spotify:playlist:${p.playlistId}` === uri);
    return smart ? ` It is a Tagify smart playlist with rule: ${describeCriteria(smart.criteria, snapshot.taxonomy)}.` : "";
  };

  if (context.kind === "track" || context.kind === "tracks") {
    const identities = await spotifyToolEnv.identities(
      context.uris,
      Object.fromEntries(context.uris.map((u) => [u, { name: snapshot.tracks[u]?.name, artists: snapshot.tracks[u]?.artists }])),
    );
    lines.push(`Selected track${context.uris.length > 1 ? "s" : ""}:`);
    for (const uri of context.uris.slice(0, 50)) {
      const track = snapshot.tracks[uri];
      const id = identities.get(uri);
      const name = track?.name ?? id?.name ?? uri;
      const artists = track?.artists ?? id?.artists.join(", ") ?? "";
      const tags = track ? track.tagIds.join(", ") || "none" : "not in Tagify yet";
      lines.push(
        `- "${name}" by ${artists} (${uri}); tags: ${tags}` +
          (track?.energy ? `; energy ${track.energy}` : "") +
          (id?.albumName ? `; album "${id.albumName}"${id.albumUri ? ` (${id.albumUri})` : ""}` : ""),
      );
    }
    const first = snapshot.tracks[context.uris[0]]?.name ?? identities.get(context.uris[0])?.name;
    label = context.uris.length > 1 ? `${context.uris.length} tracks` : `“${first ?? "Track"}”`;
    if (context.contextUri) {
      const where = await describeUri(context.contextUri);
      lines.push(`They were right-clicked inside "${where}" (${context.contextUri}).${describeSmart(context.contextUri)}`);
      label += ` in ${where}`;
    }
  } else if (context.kind !== "general") {
    const uri = context.uris[0];
    const name = await describeUri(uri);
    lines.push(`Selected ${context.kind}: "${name}" (${uri}).${context.kind === "playlist" ? describeSmart(uri) : ""}`);
    label = `${context.kind[0].toUpperCase()}${context.kind.slice(1)}: ${name}`;
  } else {
    const page = pageUriFromLocation();
    if (page) {
      const name = await describeUri(page);
      lines.push(`The user is currently viewing ${page.split(":")[1]} "${name}" (${page}).${describeSmart(page)}`);
    }
  }
  return {
    label,
    block: lines.length ? `[Context from where the chat was opened]\n${lines.join("\n")}` : "",
  };
}

function newSession(context: AiContext, snapshot: TagStoreSnapshot): Session {
  const session: Session = {
    context,
    contextLabel: "",
    contextBlock: "",
    messages: [{ role: "system", content: buildSystemPrompt(snapshot.taxonomy) }],
    items: [],
    proposals: {},
    accepted: {},
    appliedEntryByProposal: {},
    pendingNotes: [],
    usage: { promptTokens: 0, completionTokens: 0, cost: 0 },
    toolState: { seen: {}, onProposal: () => undefined },
  };
  return session;
}

const AiPanel: React.FC<{ context: AiContext; onClose: () => void }> = ({ context, onClose }) => {
  const [settings, setSettings] = useState<AiSettings>(loadAiSettings);
  const [view, setView] = useState<"chat" | "settings" | "history">(settings.apiKey ? "chat" : "settings");
  const [session, setSession] = useState<Session | null>(null);
  const [snapshot, setSnapshot] = useState<TagStoreSnapshot | null>(null);
  const [, forceRender] = useState(0);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<AppliedEntry[]>(loadHistory);
  const [confirmUndo, setConfirmUndo] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rerender = () => forceRender((n) => n + 1);

  // Start or resume a session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const snap = await loadSnapshot();
      if (cancelled) return;
      setSnapshot(snap);
      const resume = context.kind === "general" && lastSession && lastSession.context.kind === "general";
      const s = resume ? lastSession! : newSession(context, snap);
      if (!resume) {
        const { label, block } = await buildContext(context).catch(() => ({ label: "Chat", block: "" }));
        s.contextLabel = label;
        s.contextBlock = block;
      }
      s.toolState.onProposal = (proposal) => {
        s.proposals[proposal.id] = proposal;
        s.accepted[proposal.id] = proposal.changes.map((c) => c.trackUri);
        s.items.push({ kind: "proposal", proposalId: proposal.id });
      };
      lastSession = s;
      if (!cancelled) setSession(s);
    })().catch((error) => {
      console.error("Tagify AI: failed to start", error);
    });
    return () => {
      cancelled = true;
    };
  }, [context]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !session || busy) return;
    setInput("");
    const isFirst = session.messages.length === 1;
    const notes = session.pendingNotes.splice(0);
    const content = [isFirst ? session.contextBlock : "", notes.join("\n"), text].filter(Boolean).join("\n\n");
    session.messages.push({ role: "user", content });
    session.items.push({ kind: "user", text });
    setBusy(true);
    rerender();

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      session.messages = await runAgent({
        settings,
        messages: session.messages,
        env: spotifyToolEnv,
        state: session.toolState,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "assistant_text") session.items.push({ kind: "assistant", text: event.text });
          if (event.type === "tool_call") {
            const label = TOOL_LABELS[event.name]?.(event.args) ?? event.name;
            session.items.push({ kind: "tool", text: label });
          }
          if (event.type === "usage") {
            session.usage.promptTokens += event.usage.promptTokens;
            session.usage.completionTokens += event.usage.completionTokens;
            session.usage.cost += event.usage.cost;
          }
          rerender();
        },
      });
    } catch (error) {
      const aborted = (error as Error)?.name === "AbortError";
      session.items.push({ kind: "error", text: aborted ? "Stopped." : (error as Error).message });
      // Keep history valid: drop a trailing user turn the model never answered.
      if (session.messages.at(-1)?.role === "user") session.messages.pop();
    } finally {
      abortRef.current = null;
      setBusy(false);
      rerender();
    }
  }, [busy, input, session, settings]);

  const apply = async (proposal: Proposal) => {
    if (!session) return;
    try {
      const snap = await loadSnapshot();
      const accepted = new Set(session.accepted[proposal.id] ?? []);
      const { updates, before, taxonomy, createdTagIds } = buildProposalUpdates(proposal, snap, accepted, Date.now());
      if (taxonomy) await writeTaxonomy(taxonomy);
      await writeTrackUpdates(updates);
      const entry: AppliedEntry = {
        id: `ai_${Date.now()}`,
        proposalId: proposal.id,
        summary: proposal.summary,
        appliedAt: Date.now(),
        trackCount: Object.keys(updates).length,
        before,
        after: updates,
        createdTagIds,
      };
      setHistory(recordApplied(entry));
      proposal.status = "applied";
      session.appliedEntryByProposal[proposal.id] = entry.id;
      session.pendingNotes.push(
        `(The user applied ${accepted.size} of ${proposal.changes.length} changes from proposal ${proposal.id}.)`,
      );
      setSnapshot(await loadSnapshot());
      Spicetify.showNotification(`Tagify AI: updated ${entry.trackCount} track${entry.trackCount === 1 ? "" : "s"}`);
    } catch (error) {
      session.items.push({ kind: "error", text: `Could not apply: ${(error as Error).message}` });
    }
    rerender();
  };

  const discard = (proposal: Proposal) => {
    if (!session) return;
    proposal.status = "discarded";
    session.pendingNotes.push(`(The user discarded proposal ${proposal.id}.)`);
    rerender();
  };

  const undo = async (entry: AppliedEntry) => {
    try {
      const snap = await loadSnapshot();
      const { updates, taxonomy, conflicts } = buildUndoUpdates(entry, snap);
      if (conflicts.length && confirmUndo !== entry.id) {
        setConfirmUndo(entry.id);
        return;
      }
      await writeTrackUpdates(updates);
      if (taxonomy) await writeTaxonomy(taxonomy);
      setHistory(markUndone(entry.id));
      setConfirmUndo(null);
      if (session) {
        const proposal = session.proposals[entry.proposalId];
        if (proposal) proposal.status = "undone";
        session.pendingNotes.push(`(The user undid the changes from proposal ${entry.proposalId}.)`);
      }
      setSnapshot(await loadSnapshot());
      Spicetify.showNotification("Tagify AI: changes undone");
    } catch (error) {
      Spicetify.showNotification(`Undo failed: ${(error as Error).message}`, true);
    }
    rerender();
  };

  const newChat = async () => {
    const snap = await loadSnapshot();
    const s = newSession({ kind: "general", uris: [] }, snap);
    const { label, block } = await buildContext(s.context).catch(() => ({ label: "General chat", block: "" }));
    s.contextLabel = label;
    s.contextBlock = block;
    s.toolState.onProposal = (proposal) => {
      s.proposals[proposal.id] = proposal;
      s.accepted[proposal.id] = proposal.changes.map((c) => c.trackUri);
      s.items.push({ kind: "proposal", proposalId: proposal.id });
    };
    lastSession = s;
    setSession(s);
  };

  const renderTagChip = (id: string, sign: "+" | "−", proposal: Proposal) => {
    const created = proposal.newTags.find((t) => `new:${t.ref}` === id);
    const name = created ? `${created.name} (new)` : snapshot ? tagName(snapshot.taxonomy, id) : id;
    return (
      <span key={`${sign}${id}`} className={sign === "+" ? styles.chipAdd : styles.chipRemove}>
        {sign} {name}
      </span>
    );
  };

  const renderProposal = (proposal: Proposal) => {
    if (!session) return null;
    const accepted = new Set(session.accepted[proposal.id] ?? []);
    const pending = proposal.status === "pending";
    const entryId = session.appliedEntryByProposal[proposal.id];
    const entry = history.find((h) => h.id === entryId);
    const toggle = (uri: string) => {
      const next = new Set(accepted);
      if (next.has(uri)) next.delete(uri);
      else next.add(uri);
      session.accepted[proposal.id] = [...next];
      rerender();
    };
    return (
      <div key={proposal.id} className={styles.proposal}>
        <div className={styles.proposalSummary}>{proposal.summary}</div>
        <div className={styles.changes}>
          {proposal.changes.map((c) => {
            const track = snapshot?.tracks[c.trackUri];
            const info = proposal.trackInfo[c.trackUri];
            return (
              <label key={c.trackUri} className={styles.change}>
                <input type="checkbox" disabled={!pending} checked={accepted.has(c.trackUri)} onChange={() => toggle(c.trackUri)} />
                <span className={styles.changeTrack}>
                  <span className={styles.changeName}>{track?.name ?? info?.name ?? c.trackUri}</span>
                  <span className={styles.changeArtist}>{track?.artists ?? info?.artists ?? ""}</span>
                </span>
                <span className={styles.chips}>
                  {c.removeTagIds.map((id) => renderTagChip(id, "−", proposal))}
                  {c.addTagIds.map((id) => renderTagChip(id, "+", proposal))}
                  {c.energy !== undefined && (
                    <span className={styles.chipNeutral}>energy {track?.energy || "–"} → {c.energy ?? "–"}</span>
                  )}
                  {c.rating !== undefined && (
                    <span className={styles.chipNeutral}>rating {track?.rating || "–"} → {c.rating ?? "–"}</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
        <div className={styles.proposalActions}>
          {pending && (
            <>
              <button className={styles.secondary} onClick={() => discard(proposal)}>Discard</button>
              <button className={styles.primary} disabled={accepted.size === 0} onClick={() => apply(proposal)}>
                Apply {accepted.size} change{accepted.size === 1 ? "" : "s"}
              </button>
            </>
          )}
          {proposal.status === "discarded" && <span className={styles.status}>Discarded</span>}
          {proposal.status === "undone" && <span className={styles.status}>Undone</span>}
          {proposal.status === "applied" && entry && (
            <>
              <span className={styles.statusOk}>Applied</span>
              <button className={styles.secondary} onClick={() => undo(entry)}>
                {confirmUndo === entry.id ? "Tracks changed since — undo anyway?" : "Undo"}
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  const renderSettings = () => (
    <form
      className={styles.settings}
      onSubmit={(e) => {
        e.preventDefault();
        saveAiSettings(settings);
        setView("chat");
      }}
    >
      <label>
        OpenRouter API key
        <input
          type="password"
          value={settings.apiKey}
          placeholder="sk-or-…"
          onChange={(e) => setSettings({ ...settings, apiKey: e.target.value.trim() })}
        />
        <span className={styles.hint}>
          Create one at <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai/keys</a>. Stored only in this Spotify app.
        </span>
      </label>
      <label>
        Model
        <select value={settings.model} onChange={(e) => setSettings({ ...settings, model: e.target.value })}>
          {AI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label} — {m.note}</option>
          ))}
        </select>
      </label>
      <label>
        Thinking effort
        <select value={settings.effort} onChange={(e) => setSettings({ ...settings, effort: e.target.value as AiSettings["effort"] })}>
          <option value="medium">Medium (faster, cheaper)</option>
          <option value="high">High (recommended)</option>
          <option value="xhigh">Extra high</option>
          <option value="max">Max</option>
        </select>
      </label>
      <button className={styles.primary} type="submit" disabled={!settings.apiKey}>Save</button>
    </form>
  );

  const renderHistory = () => (
    <div className={styles.history}>
      {history.length === 0 && <div className={styles.empty}>No AI changes yet.</div>}
      {history.map((entry) => (
        <div key={entry.id} className={styles.historyItem}>
          <div>
            <div className={styles.proposalSummary}>{entry.summary}</div>
            <div className={styles.hint}>
              {new Date(entry.appliedAt).toLocaleString()} · {entry.trackCount} track{entry.trackCount === 1 ? "" : "s"}
            </div>
          </div>
          {entry.undone ? (
            <span className={styles.status}>Undone</span>
          ) : (
            <button className={styles.secondary} onClick={() => undo(entry)}>
              {confirmUndo === entry.id ? "Changed since — undo anyway?" : "Undo"}
            </button>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className={styles.panel} role="dialog" aria-label="Tagify AI">
      <div className={styles.header}>
        <div className={styles.title}>
          <span className={styles.spark}>✦</span> Tagify AI
          {session?.contextLabel && <span className={styles.context} title={session.contextBlock}>{session.contextLabel}</span>}
        </div>
        <div className={styles.headerActions}>
          <button className={styles.icon} title="New chat" onClick={newChat}>＋</button>
          <button className={`${styles.icon} ${view === "history" ? styles.active : ""}`} title="Recent AI changes" onClick={() => setView(view === "history" ? "chat" : "history")}>⟲</button>
          <button className={`${styles.icon} ${view === "settings" ? styles.active : ""}`} title="AI settings" onClick={() => setView(view === "settings" ? "chat" : "settings")}>⚙</button>
          <button className={styles.icon} title="Close (Esc)" onClick={onClose}>✕</button>
        </div>
      </div>

      {view === "settings" && renderSettings()}
      {view === "history" && renderHistory()}
      {view === "chat" && (
        <>
          <div className={styles.messages} ref={listRef}>
            {!session && <div className={styles.empty}>Loading your tags…</div>}
            {session && session.items.length === 0 && (
              <div className={styles.empty}>
                {session.context.kind === "general"
                  ? "Ask for tag changes, e.g. “every song on this album should be Late night” or “tag all Peso Pluma tracks as Corridos”."
                  : "Say what's wrong or what to change, e.g. “this doesn't belong here, it's too slow for a hype playlist”."}
              </div>
            )}
            {session?.items.map((item, i) => {
              if (item.kind === "proposal") return renderProposal(session.proposals[item.proposalId]);
              const cls = { user: styles.user, assistant: styles.assistant, tool: styles.tool, error: styles.error }[item.kind];
              return <div key={i} className={cls}>{item.text}</div>;
            })}
            {busy && <div className={styles.tool}>Thinking…</div>}
          </div>
          <div className={styles.composer}>
            <textarea
              value={input}
              placeholder={settings.apiKey ? "Describe the change…" : "Add your OpenRouter key in settings first"}
              disabled={!settings.apiKey || !session}
              rows={2}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            {busy ? (
              <button className={styles.secondary} onClick={() => abortRef.current?.abort()}>Stop</button>
            ) : (
              <button className={styles.primary} onClick={send} disabled={!input.trim() || !session}>Send</button>
            )}
          </div>
          <div className={styles.footer}>
            {AI_MODELS.find((m) => m.id === settings.model)?.label ?? settings.model} · {settings.effort}
            {session && session.usage.cost > 0 && ` · $${session.usage.cost.toFixed(3)} this chat`}
          </div>
        </>
      )}
    </div>
  );
};

export default AiPanel;
