import { useCallback, useEffect, useState } from "react";
import type { TagDataStructure, TrackData } from "@/types/tagData";
import { trackIdentityService } from "@/services/TrackIdentityService";
import type { TrackIdentity } from "../model/duplicates.types";
import {
  compareIdentities,
  groupKey,
  normalizeArtist,
  normalizeTitle,
  pickKeeper,
} from "../utils/duplicates.match";
import { buildMergeUpdates } from "../utils/duplicates.merge";
import { loadIgnoredKeys, saveIgnoredKeys } from "../utils/duplicates.storage";

export interface DuplicateCheckResult {
  self: TrackIdentity;
  others: TrackIdentity[];
  keeperUri: string;
  key: string;
}

interface UseDuplicateCheckOptions {
  trackUri: string | null;
  trackName?: string;
  trackArtists?: string;
  tracks: TagDataStructure["tracks"];
  applyTrackDataUpdates: (updates: Record<string, TrackData | null>) => void;
}

/**
 * Is the track on screen the same song as another, already tagged version?
 * Cheap pre-filter on stored title/artist, then confirms with release metadata.
 */
export function useDuplicateCheck({
  trackUri,
  trackName,
  trackArtists,
  tracks,
  applyTrackDataUpdates,
}: UseDuplicateCheckOptions) {
  const [result, setResult] = useState<DuplicateCheckResult | null>(null);

  useEffect(() => {
    setResult(null);
    if (!trackUri || !trackUri.startsWith("spotify:track:")) return;
    const name = tracks[trackUri]?.name ?? trackName;
    const artists = tracks[trackUri]?.artists ?? trackArtists;
    if (!name) return;

    const title = normalizeTitle(name);
    const primary = normalizeArtist((artists || "").split(", ")[0] || "");
    const candidates = Object.entries(tracks)
      .filter(([uri, data]) =>
        uri !== trackUri &&
        normalizeTitle(data.name || "") === title &&
        normalizeArtist((data.artists || "").split(", ")[0] || "") === primary,
      )
      .map(([uri]) => uri);
    if (candidates.length === 0) return;

    let cancelled = false;
    (async () => {
      const expected = Object.fromEntries(
        [trackUri, ...candidates].map((uri) => [
          uri,
          { name: tracks[uri]?.name ?? name, artists: tracks[uri]?.artists ?? artists },
        ]),
      );
      const identities = await trackIdentityService.getIdentities([trackUri, ...candidates], expected);
      const self = identities.get(trackUri);
      if (cancelled || !self) return;
      const others = candidates
        .map((uri) => identities.get(uri))
        .filter((i): i is TrackIdentity => !!i && compareIdentities(self, i) !== null);
      if (others.length === 0) return;
      const members = [self, ...others];
      const key = groupKey(members.map((m) => m.uri));
      if (loadIgnoredKeys().has(key)) return;
      setResult({ self, others, keeperUri: pickKeeper(members, tracks), key });
    })().catch((error) => console.warn("Tagify: duplicate check failed", error));

    return () => {
      cancelled = true;
    };
  }, [trackUri, trackName, trackArtists, tracks]);

  const merge = useCallback(() => {
    if (!result) return;
    const uris = [result.self.uri, ...result.others.map((o) => o.uri)];
    applyTrackDataUpdates(
      buildMergeUpdates(uris, result.keeperUri, tracks, Date.now(), {
        name: result.self.name,
        artists: result.self.artists.join(", "),
      }),
    );
    setResult(null);
  }, [applyTrackDataUpdates, result, tracks]);

  const keepBoth = useCallback(() => {
    if (!result) return;
    const keys = loadIgnoredKeys();
    keys.add(result.key);
    saveIgnoredKeys(keys);
    setResult(null);
  }, [result]);

  return { duplicate: result, merge, keepBoth };
}
