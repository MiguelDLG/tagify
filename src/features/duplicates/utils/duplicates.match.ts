import type { TrackData } from "@/types/tagData";
import type {
  DuplicateGroup,
  DuplicateReason,
  TrackIdentity,
  VersionKind,
} from "../model/duplicates.types";

/** Two releases of one recording rarely differ by more than this. */
export const DURATION_TOLERANCE_MS = 3000;

// Bracketed or dashed suffixes that describe the release, not the song.
// Remix/live/sped up/acoustic/extended etc. are deliberately NOT here: they stay
// in the title, so those versions never match the original.
const BRACKET_NOISE =
  /\s*[([][^)\]]*\b(feat\.?|ft\.?|with|prod\.?|explicit|clean|remaster(ed)?|deluxe|bonus( track)?|album version|single version|radio edit)\b[^)\]]*[)\]]/gi;
const DASH_NOISE =
  /\s+-\s+.*\b(remaster(ed)?|explicit|clean|album version|single version|feat\.?|bonus( track)?)\b.*$/i;
const TRAILING_FEAT = /\s+(feat\.?|ft\.?)\s+.*$/i;

const DELUXE_ALBUM =
  /\b(deluxe|bonus|expanded|edition|complete|anniversary|special|extended|remaster(ed)?|reissue|platinum|re-?up|version|collector'?s)\b/i;

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function normalizeTitle(name: string): string {
  let title = name.replace(BRACKET_NOISE, "");
  title = title.replace(DASH_NOISE, "");
  title = title.replace(TRAILING_FEAT, "");
  title = stripDiacritics(title.toLowerCase())
    .replace(/[’‘`]/g, "'")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s']/gu, " ");
  return title.replace(/\s+/g, " ").trim();
}

export function normalizeArtist(name: string): string {
  return stripDiacritics(name.toLowerCase())
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function getVersionKind(identity: TrackIdentity): VersionKind {
  switch (identity.albumKind) {
    case "compilation":
      return "compilation";
    case "single":
    case "ep":
      return "single";
    case "album":
      return identity.albumName && DELUXE_ALBUM.test(identity.albumName)
        ? "deluxe"
        : "album";
    default:
      return "unknown";
  }
}

const VERSION_RANK: Record<VersionKind, number> = {
  album: 0,
  deluxe: 1,
  single: 2,
  unknown: 3,
  compilation: 4,
};

function explicitRank(explicit: boolean | null): number {
  if (explicit === true) return 0;
  if (explicit === null) return 1;
  return 2;
}

/**
 * Same song on a different release? Returns why, or null.
 * ISRC equality wins; otherwise title, primary artist and length must agree,
 * and two credited performer lists must overlap (keeps different recordings
 * of a classical piece apart).
 */
export function compareIdentities(
  a: TrackIdentity,
  b: TrackIdentity,
): DuplicateReason | null {
  if (a.uri === b.uri) return null;

  const explicitDiffers =
    a.explicit !== null && b.explicit !== null && a.explicit !== b.explicit;

  if (a.isrc && b.isrc && a.isrc === b.isrc) {
    return explicitDiffers ? "explicit-clean" : "isrc";
  }

  const titleA = normalizeTitle(a.name);
  if (!titleA || titleA !== normalizeTitle(b.name)) return null;

  const [primaryA, ...restA] = a.artists.map(normalizeArtist);
  const [primaryB, ...restB] = b.artists.map(normalizeArtist);
  if (!primaryA || primaryA !== primaryB) return null;

  if (restA.length > 0 && restB.length > 0) {
    const setB = new Set(restB);
    if (!restA.some((artist) => setB.has(artist))) return null;
  }

  if (a.durationMs === null || b.durationMs === null) return null;
  if (Math.abs(a.durationMs - b.durationMs) > DURATION_TOLERANCE_MS) return null;

  return explicitDiffers ? "explicit-clean" : "same-song";
}

export function groupKey(uris: string[]): string {
  return [...uris].sort().join("|");
}

/**
 * Keep rule: explicit > original album > deluxe > single/EP > compilation.
 * Ties: the release Spotify relinks to, then more tags, then tagged first.
 */
export function pickKeeper(
  members: TrackIdentity[],
  tracks: Record<string, TrackData | undefined> = {},
): string {
  const memberUris = new Set(members.map((m) => m.uri));
  const canonicalTargets = new Set(
    members
      .map((m) => m.canonicalUri)
      .filter((uri): uri is string => !!uri && memberUris.has(uri)),
  );

  const score = (identity: TrackIdentity): number[] => {
    const track = tracks[identity.uri];
    const isRelinkAlias =
      !!identity.canonicalUri &&
      identity.canonicalUri !== identity.uri &&
      memberUris.has(identity.canonicalUri);
    return [
      explicitRank(identity.explicit),
      VERSION_RANK[getVersionKind(identity)],
      canonicalTargets.has(identity.uri) ? 0 : isRelinkAlias ? 2 : 1,
      -(track?.tagIds.length ?? 0),
      track?.dateCreated ?? Number.MAX_SAFE_INTEGER,
    ];
  };

  const sorted = [...members].sort((x, y) => {
    const sx = score(x);
    const sy = score(y);
    for (let i = 0; i < sx.length; i++) {
      if (sx[i] !== sy[i]) return sx[i] - sy[i];
    }
    return x.uri < y.uri ? -1 : 1;
  });

  return sorted[0].uri;
}

const REASON_PRIORITY: Record<DuplicateReason, number> = {
  "explicit-clean": 0,
  isrc: 1,
  "same-song": 2,
};

/** Group identities that are the same song (union-find over candidate pairs). */
export function findDuplicateGroups(
  identities: TrackIdentity[],
  options: {
    tracks?: Record<string, TrackData | undefined>;
    ignoredKeys?: Set<string>;
  } = {},
): DuplicateGroup[] {
  const { tracks = {}, ignoredKeys = new Set<string>() } = options;
  const list = identities.filter((i) => !i.uri.startsWith("spotify:local:"));

  const parent = new Map<string, string>(list.map((i) => [i.uri, i.uri]));
  const find = (uri: string): string => {
    let root = uri;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(uri, root);
    return root;
  };
  const reasons = new Map<string, DuplicateReason>();
  const link = (a: TrackIdentity, b: TrackIdentity, reason: DuplicateReason) => {
    const ra = find(a.uri);
    const rb = find(b.uri);
    if (ra !== rb) parent.set(ra, rb);
    for (const uri of [a.uri, b.uri]) {
      const prev = reasons.get(uri);
      if (!prev || REASON_PRIORITY[reason] < REASON_PRIORITY[prev]) {
        reasons.set(uri, reason);
      }
    }
  };

  // Only compare tracks that share an ISRC or a (title, primary artist) bucket.
  const buckets = new Map<string, TrackIdentity[]>();
  const addToBucket = (key: string, identity: TrackIdentity) => {
    const bucket = buckets.get(key);
    if (bucket) bucket.push(identity);
    else buckets.set(key, [identity]);
  };
  for (const identity of list) {
    if (identity.isrc) addToBucket(`isrc:${identity.isrc}`, identity);
    const primary = identity.artists[0] ? normalizeArtist(identity.artists[0]) : "";
    addToBucket(`song:${normalizeTitle(identity.name)}:${primary}`, identity);
  }
  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const reason = compareIdentities(bucket[i], bucket[j]);
        if (reason) link(bucket[i], bucket[j], reason);
      }
    }
  }

  const byRoot = new Map<string, TrackIdentity[]>();
  for (const identity of list) {
    const root = find(identity.uri);
    const members = byRoot.get(root);
    if (members) members.push(identity);
    else byRoot.set(root, [identity]);
  }

  const groups: DuplicateGroup[] = [];
  for (const members of byRoot.values()) {
    if (members.length < 2) continue;
    const uris = members.map((m) => m.uri);
    const key = groupKey(uris);
    if (ignoredKeys.has(key)) continue;
    const reason = members
      .map((m) => reasons.get(m.uri) ?? "same-song")
      .sort((x, y) => REASON_PRIORITY[x] - REASON_PRIORITY[y])[0];
    groups.push({ key, uris, keeperUri: pickKeeper(members, tracks), reason });
  }
  return groups;
}

/** Fold the tags and ratings of duplicate versions into the kept version. */
export function mergeTrackData(
  keeper: TrackData,
  others: TrackData[],
  now: number,
): TrackData {
  const all = [keeper, ...others];
  const firstSet = <T,>(pick: (t: TrackData) => T | null | undefined, empty: (v: T) => boolean) => {
    for (const t of all) {
      const value = pick(t);
      if (value !== null && value !== undefined && !empty(value)) return value;
    }
    return undefined;
  };

  const merged: TrackData = {
    ...keeper,
    tagIds: Array.from(new Set(all.flatMap((t) => t.tagIds))),
    rating: keeper.rating > 0 ? keeper.rating : Math.max(...all.map((t) => t.rating || 0)),
    energy: firstSet((t) => t.energy, (v) => v === 0) ?? 0,
    bpm: firstSet((t) => t.bpm, () => false) ?? null,
    dateModified: now,
  };

  const camelot = firstSet((t) => t.camelotKey, () => false);
  if (camelot !== undefined) merged.camelotKey = camelot;

  const created = all
    .map((t) => t.dateCreated)
    .filter((v): v is number => typeof v === "number");
  if (created.length > 0) merged.dateCreated = Math.min(...created);

  return merged;
}

/**
 * For smart playlist sync: drop every non-kept version from a list of URIs.
 * Groups the user marked "keep both" are left alone.
 */
export function dedupeTrackUris(
  uris: string[],
  identities: Map<string, TrackIdentity>,
  tracks: Record<string, TrackData | undefined>,
  ignoredKeys: Set<string> = new Set(),
): { uris: string[]; dropped: string[] } {
  const known = uris
    .map((uri) => identities.get(uri))
    .filter((i): i is TrackIdentity => !!i);
  const groups = findDuplicateGroups(known, { tracks, ignoredKeys });
  const dropped = new Set<string>();
  for (const group of groups) {
    for (const uri of group.uris) {
      if (uri !== group.keeperUri) dropped.add(uri);
    }
  }
  return {
    uris: uris.filter((uri) => !dropped.has(uri)),
    dropped: [...dropped],
  };
}

export function describeVersion(identity: TrackIdentity): string {
  const labels: Record<VersionKind, string> = {
    album: "Album",
    deluxe: "Deluxe / bonus",
    single: identity.albumKind === "ep" ? "EP" : "Single",
    unknown: "Release",
    compilation: "Compilation",
  };
  return labels[getVersionKind(identity)];
}
