const IGNORED_KEY = "tagify:duplicates:ignored";

/** Groups the user chose to "keep both" for (keys from groupKey()). */
export function loadIgnoredKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(IGNORED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((k) => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveIgnoredKeys(keys: Set<string>): void {
  try {
    localStorage.setItem(IGNORED_KEY, JSON.stringify([...keys]));
  } catch (error) {
    console.error("Tagify: failed to save ignored duplicate groups", error);
  }
}
