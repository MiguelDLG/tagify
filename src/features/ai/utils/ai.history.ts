import type { AppliedEntry } from "../model/ai.types";

const HISTORY_KEY = "tagify:ai:history";
const MAX_ENTRIES = 30;

export function loadHistory(): AppliedEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHistory(entries: AppliedEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch (error) {
    console.error("Tagify AI: failed to save change history", error);
  }
}

export function recordApplied(entry: AppliedEntry): AppliedEntry[] {
  const next = [entry, ...loadHistory().filter((e) => e.id !== entry.id)];
  saveHistory(next);
  return next;
}

export function markUndone(entryId: string): AppliedEntry[] {
  const next = loadHistory().map((e) => (e.id === entryId ? { ...e, undone: true } : e));
  saveHistory(next);
  return next;
}
