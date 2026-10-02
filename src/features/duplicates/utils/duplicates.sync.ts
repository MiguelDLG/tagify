import type { TrackData } from "@/types/tagData";
import { trackIdentityService } from "@/services/TrackIdentityService";
import { compareIdentities, groupKey, pickKeeper } from "./duplicates.match";
import { loadIgnoredKeys } from "./duplicates.storage";

export interface DuplicateAddDecision {
  /** Do not add this track: a preferred version is already in the playlist. */
  skip: boolean;
  /** Versions already in the playlist that this track should replace. */
  remove: string[];
}

const ADD = { skip: false, remove: [] };

/**
 * Before a smart playlist adds a track, check whether another version of the
 * same song is already in it. Uses cached identities for the playlist's tracks
 * (warmed by full syncs and duplicate scans); never blocks an add on errors.
 */
export async function resolveDuplicateBeforeAdd(
  trackUri: string,
  trackData: TrackData,
  playlistTrackUris: string[],
): Promise<DuplicateAddDecision> {
  if (playlistTrackUris.length === 0) return ADD;
  try {
    const identities = await trackIdentityService.getIdentities([trackUri], {
      [trackUri]: { name: trackData.name, artists: trackData.artists },
    });
    const self = identities.get(trackUri);
    if (!self || self.source === "tagdata") return ADD;

    const cached = trackIdentityService.getCachedMap();
    const versions = playlistTrackUris
      .filter((uri) => uri !== trackUri)
      .map((uri) => cached.get(uri))
      .filter((identity): identity is NonNullable<typeof identity> =>
        !!identity && compareIdentities(self, identity) !== null,
      );
    if (versions.length === 0) return ADD;

    const members = [self, ...versions];
    if (loadIgnoredKeys().has(groupKey(members.map((m) => m.uri)))) return ADD;

    return pickKeeper(members) === trackUri
      ? { skip: false, remove: versions.map((v) => v.uri) }
      : { skip: true, remove: [] };
  } catch (error) {
    console.warn("Tagify: duplicate check before add failed", error);
    return ADD;
  }
}
