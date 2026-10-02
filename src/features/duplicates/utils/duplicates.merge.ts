import type { TrackData } from "@/types/tagData";
import { mergeTrackData } from "./duplicates.match";

/**
 * Track updates that fold every version in `uris` into `keeperUri`:
 * the keeper gets the union of tags, the other versions are deleted.
 * If the keeper is not tagged yet, it is created from the tagged versions
 * using `keeperInfo` for its name/artists.
 */
export function buildMergeUpdates(
  uris: string[],
  keeperUri: string,
  tracks: Record<string, TrackData | undefined>,
  now: number,
  keeperInfo?: { name?: string; artists?: string },
): Record<string, TrackData | null> {
  const others = uris
    .filter((uri) => uri !== keeperUri && tracks[uri])
    .map((uri) => tracks[uri]!) ;
  const existingKeeper = tracks[keeperUri];
  if (!existingKeeper && others.length === 0) return {};

  const base: TrackData = existingKeeper ?? {
    ...others[0],
    tagIds: [],
    rating: 0,
    energy: 0,
    bpm: null,
    ...(keeperInfo?.name ? { name: keeperInfo.name } : {}),
    ...(keeperInfo?.artists ? { artists: keeperInfo.artists } : {}),
  };

  const updates: Record<string, TrackData | null> = {
    [keeperUri]: mergeTrackData(base, others, now),
  };
  for (const uri of uris) {
    if (uri !== keeperUri && tracks[uri]) updates[uri] = null;
  }
  return updates;
}
