import type { TagTaxonomy, TrackData } from "@/types/tagData";
import type {
  AppliedEntry,
  NewTagSpec,
  Proposal,
  TagStoreSnapshot,
  TrackChange,
} from "../model/ai.types";

const NEW_PREFIX = "new:";

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function newId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random}`;
}

/**
 * Validate the arguments of the propose_changes tool. Returns errors the model
 * can act on instead of throwing, so it can fix and retry.
 */
export function parseProposal(
  args: unknown,
  taxonomy: TagTaxonomy,
  trackInfo: Record<string, { name: string; artists: string }>,
): { proposal?: Proposal; errors: string[] } {
  const errors: string[] = [];
  const input = (args ?? {}) as Record<string, unknown>;
  const summary = typeof input.summary === "string" ? input.summary.trim() : "";
  if (!summary) errors.push("summary is required");

  const newTags: NewTagSpec[] = [];
  for (const raw of Array.isArray(input.new_tags) ? input.new_tags : []) {
    const spec = raw as Record<string, unknown>;
    const ref = typeof spec.ref === "string" ? spec.ref.trim() : "";
    const name = typeof spec.name === "string" ? spec.name.trim() : "";
    const subcategoryId = typeof spec.subcategory_id === "string" ? spec.subcategory_id : "";
    if (!ref || !name) {
      errors.push("each new_tags entry needs ref and name");
      continue;
    }
    if (!taxonomy.subcategoriesById[subcategoryId]) {
      errors.push(`new tag "${name}": unknown subcategory_id ${subcategoryId}`);
      continue;
    }
    const existing = Object.values(taxonomy.tagsById).find(
      (t) => t.subcategoryId === subcategoryId && t.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      errors.push(`new tag "${name}" already exists as ${existing.id}; use that id`);
      continue;
    }
    newTags.push({ ref, name, subcategoryId });
  }
  const newRefs = new Set(newTags.map((t) => `${NEW_PREFIX}${t.ref}`));

  const checkTag = (id: string, where: string) => {
    if (!taxonomy.tagsById[id] && !newRefs.has(id)) {
      errors.push(`${where}: unknown tag id "${id}" (use ids from the taxonomy or new:<ref>)`);
    }
  };

  const byUri = new Map<string, TrackChange>();
  for (const raw of Array.isArray(input.changes) ? input.changes : []) {
    const change = raw as Record<string, unknown>;
    const trackUri = typeof change.track_uri === "string" ? change.track_uri : "";
    if (!trackUri.startsWith("spotify:track:")) {
      errors.push(`invalid track_uri "${trackUri}"`);
      continue;
    }
    const addTagIds = asStringArray(change.add_tags);
    const removeTagIds = asStringArray(change.remove_tags);
    addTagIds.forEach((id) => checkTag(id, trackUri));
    removeTagIds.forEach((id) => checkTag(id, trackUri));

    const parsed: TrackChange = { trackUri, addTagIds, removeTagIds };
    if (change.energy !== undefined) {
      const energy = change.energy === null ? null : Number(change.energy);
      if (energy !== null && !(Number.isInteger(energy) && energy >= 1 && energy <= 10)) {
        errors.push(`${trackUri}: energy must be an integer 1-10 or null`);
      } else {
        parsed.energy = energy;
      }
    }
    if (change.rating !== undefined) {
      const rating = change.rating === null ? null : Number(change.rating);
      if (rating !== null && !(rating >= 0 && rating <= 5 && Math.round(rating * 2) === rating * 2)) {
        errors.push(`${trackUri}: rating must be 0-5 in half steps or null`);
      } else {
        parsed.rating = rating;
      }
    }
    if (!addTagIds.length && !removeTagIds.length && parsed.energy === undefined && parsed.rating === undefined) {
      continue;
    }
    if (byUri.has(trackUri)) {
      errors.push(`${trackUri} listed twice; merge its changes into one entry`);
      continue;
    }
    byUri.set(trackUri, parsed);
  }
  if (byUri.size === 0) errors.push("changes is empty");

  if (errors.length) return { errors };
  return {
    errors,
    proposal: {
      id: newId("proposal"),
      summary,
      changes: [...byUri.values()],
      newTags,
      trackInfo,
      status: "pending",
    },
  };
}

function isEmpty(track: TrackData): boolean {
  return track.tagIds.length === 0 && !track.rating && !track.energy;
}

/** Taxonomy with the proposal's new tags created (accent copied from siblings). */
export function withNewTags(
  taxonomy: TagTaxonomy,
  newTags: NewTagSpec[],
): { taxonomy: TagTaxonomy; refToId: Record<string, string> } {
  if (newTags.length === 0) return { taxonomy, refToId: {} };
  const next: TagTaxonomy = {
    ...taxonomy,
    tagsById: { ...taxonomy.tagsById },
    subcategoriesById: { ...taxonomy.subcategoriesById },
  };
  const refToId: Record<string, string> = {};
  for (const spec of newTags) {
    const id = newId("tag");
    const sub = next.subcategoriesById[spec.subcategoryId];
    const siblingAccent = sub.tagIds.map((t) => taxonomy.tagsById[t]?.accentId).find(Boolean) ?? null;
    next.tagsById[id] = { id, name: spec.name, subcategoryId: spec.subcategoryId, accentId: siblingAccent };
    next.subcategoriesById[spec.subcategoryId] = { ...sub, tagIds: [...sub.tagIds, id] };
    refToId[`${NEW_PREFIX}${spec.ref}`] = id;
  }
  return { taxonomy: next, refToId };
}

/**
 * Concrete track updates for the accepted part of a proposal.
 * Tracks left with no tags, rating or energy are removed from Tagify.
 */
export function buildProposalUpdates(
  proposal: Proposal,
  snapshot: TagStoreSnapshot,
  acceptedUris: Set<string>,
  now: number,
): {
  updates: Record<string, TrackData | null>;
  before: Record<string, TrackData | null>;
  taxonomy: TagTaxonomy | null;
  createdTagIds: string[];
} {
  const changes = proposal.changes.filter((c) => acceptedUris.has(c.trackUri));
  const usedRefs = new Set(changes.flatMap((c) => [...c.addTagIds, ...c.removeTagIds]));
  const neededNewTags = proposal.newTags.filter((t) => usedRefs.has(`${NEW_PREFIX}${t.ref}`));
  const { taxonomy, refToId } = withNewTags(snapshot.taxonomy, neededNewTags);
  const resolve = (id: string) => refToId[id] ?? id;

  const updates: Record<string, TrackData | null> = {};
  const before: Record<string, TrackData | null> = {};
  for (const change of changes) {
    const existing = snapshot.tracks[change.trackUri] ?? null;
    const info = proposal.trackInfo[change.trackUri];
    const base: TrackData = existing ?? {
      rating: 0,
      energy: 0,
      bpm: null,
      tagIds: [],
      dateCreated: now,
      ...(info ? { name: info.name, artists: info.artists } : {}),
    };
    const remove = new Set(change.removeTagIds.map(resolve));
    const tagIds = Array.from(
      new Set([...base.tagIds.filter((id) => !remove.has(id)), ...change.addTagIds.map(resolve)]),
    );
    const next: TrackData = {
      ...base,
      tagIds,
      ...(change.energy !== undefined ? { energy: change.energy ?? 0 } : {}),
      ...(change.rating !== undefined ? { rating: change.rating ?? 0 } : {}),
      dateModified: now,
    };
    if (isEmpty(next)) {
      if (!existing) continue;
      updates[change.trackUri] = null;
    } else {
      updates[change.trackUri] = next;
    }
    before[change.trackUri] = existing;
  }

  return {
    updates,
    before,
    taxonomy: neededNewTags.length ? taxonomy : null,
    createdTagIds: Object.values(refToId),
  };
}

/** Updates that restore an applied entry; drops tags it created if now unused. */
export function buildUndoUpdates(
  entry: AppliedEntry,
  snapshot: TagStoreSnapshot,
): { updates: Record<string, TrackData | null>; taxonomy: TagTaxonomy | null; conflicts: string[] } {
  const conflicts: string[] = [];
  for (const [uri, after] of Object.entries(entry.after)) {
    const current = snapshot.tracks[uri] ?? null;
    const sameTags = (a: TrackData | null, b: TrackData | null) =>
      JSON.stringify([...(a?.tagIds ?? [])].sort()) === JSON.stringify([...(b?.tagIds ?? [])].sort()) &&
      (a?.energy ?? 0) === (b?.energy ?? 0) &&
      (a?.rating ?? 0) === (b?.rating ?? 0);
    if (!sameTags(current, after)) conflicts.push(uri);
  }

  const updates: Record<string, TrackData | null> = { ...entry.before };
  const remainingTracks: Record<string, TrackData> = { ...snapshot.tracks };
  for (const [uri, data] of Object.entries(updates)) {
    if (data) remainingTracks[uri] = data;
    else delete remainingTracks[uri];
  }

  let taxonomy: TagTaxonomy | null = null;
  const stillUsed = new Set(Object.values(remainingTracks).flatMap((t) => t.tagIds));
  const removable = entry.createdTagIds.filter((id) => snapshot.taxonomy.tagsById[id] && !stillUsed.has(id));
  if (removable.length) {
    const drop = new Set(removable);
    taxonomy = {
      ...snapshot.taxonomy,
      tagsById: Object.fromEntries(Object.entries(snapshot.taxonomy.tagsById).filter(([id]) => !drop.has(id))),
      subcategoriesById: Object.fromEntries(
        Object.entries(snapshot.taxonomy.subcategoriesById).map(([id, sub]) => [
          id,
          { ...sub, tagIds: sub.tagIds.filter((t) => !drop.has(t)) },
        ]),
      ),
    };
  }
  return { updates, taxonomy, conflicts };
}
