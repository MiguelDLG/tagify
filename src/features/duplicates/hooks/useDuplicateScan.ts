import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TagDataStructure, TrackData } from "@/types/tagData";
import { trackIdentityService } from "@/services/TrackIdentityService";
import type { DuplicateGroup, TrackIdentity } from "../model/duplicates.types";
import { findDuplicateGroups } from "../utils/duplicates.match";
import { buildMergeUpdates } from "../utils/duplicates.merge";
import { loadIgnoredKeys, saveIgnoredKeys } from "../utils/duplicates.storage";

export type ScanStatus = "idle" | "scanning" | "done" | "error";

interface UseDuplicateScanOptions {
  tracks: TagDataStructure["tracks"];
  applyTrackDataUpdates: (updates: Record<string, TrackData | null>) => void;
}

export function useDuplicateScan({ tracks, applyTrackDataUpdates }: UseDuplicateScanOptions) {
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [identities, setIdentities] = useState<Map<string, TrackIdentity>>(new Map());
  const [ignoredKeys, setIgnoredKeys] = useState<Set<string>>(loadIgnoredKeys);
  const [keeperOverrides, setKeeperOverrides] = useState<Record<string, string>>({});
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;

  const scan = useCallback(async () => {
    setStatus("scanning");
    try {
      const current = tracksRef.current;
      const uris = Object.keys(current);
      const expected = Object.fromEntries(
        uris.map((uri) => [uri, { name: current[uri]?.name, artists: current[uri]?.artists }]),
      );
      const result = await trackIdentityService.getIdentities(uris, expected, (done, total) =>
        setProgress({ done, total }),
      );
      setIdentities(result);
      setStatus("done");
    } catch (error) {
      console.error("Tagify: duplicate scan failed", error);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    scan();
  }, [scan]);

  const groups: DuplicateGroup[] = useMemo(() => {
    if (status !== "done") return [];
    const tagged = [...identities.values()].filter((identity) => tracks[identity.uri]);
    return findDuplicateGroups(tagged, { tracks, ignoredKeys }).map((group) => {
      const override = keeperOverrides[group.key];
      return override && group.uris.includes(override) ? { ...group, keeperUri: override } : group;
    });
  }, [identities, ignoredKeys, keeperOverrides, status, tracks]);

  const sourceCounts = useMemo(() => {
    const counts = { metadata: 0, graphql: 0, tagdata: 0, isrc: 0 };
    for (const identity of identities.values()) {
      counts[identity.source] += 1;
      if (identity.isrc) counts.isrc += 1;
    }
    return counts;
  }, [identities]);

  const setKeeper = useCallback((group: DuplicateGroup, uri: string) => {
    setKeeperOverrides((prev) => ({ ...prev, [group.key]: uri }));
  }, []);

  const merge = useCallback(
    (toMerge: DuplicateGroup[]) => {
      const now = Date.now();
      const updates: Record<string, TrackData | null> = {};
      for (const group of toMerge) {
        Object.assign(updates, buildMergeUpdates(group.uris, group.keeperUri, tracksRef.current, now));
      }
      applyTrackDataUpdates(updates);
      const removed = Object.values(updates).filter((v) => v === null).length;
      Spicetify.showNotification(
        `Merged ${toMerge.length} duplicate ${toMerge.length === 1 ? "song" : "songs"} (${removed} extra ${removed === 1 ? "version" : "versions"} removed)`,
      );
    },
    [applyTrackDataUpdates],
  );

  const keepBoth = useCallback((group: DuplicateGroup) => {
    setIgnoredKeys((prev) => {
      const next = new Set(prev);
      next.add(group.key);
      saveIgnoredKeys(next);
      return next;
    });
  }, []);

  return { status, progress, groups, identities, sourceCounts, scan, merge, keepBoth, setKeeper };
}
