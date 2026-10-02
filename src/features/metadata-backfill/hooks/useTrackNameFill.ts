import { useEffect, useRef } from "react";
import type { TrackData } from "@/types/tagData";
import { fetchTrackNames, needsTrackDetails, TrackNames } from "@/utils/trackNames";

export interface UseTrackNameFillOptions {
  tracks: Record<string, TrackData>;
  enabled: boolean;
  applyNames: (names: TrackNames) => void;
}

const DEBOUNCE_MS = 400;
const MAX_ATTEMPTS = 3;
const CHUNK_SIZE = 50;

/**
 * Bulk tagging, album "apply to tracks" and the inline editor create tracks
 * with only tags, and older tracks have no album name. Whenever such tracks
 * show up, look them up and fill them in (nameless tracks first, saved
 * chunk by chunk so a large library fills in progressively).
 */
export function useTrackNameFill({ tracks, enabled, applyNames }: UseTrackNameFillOptions) {
  const attempts = useRef(new Map<string, number>());
  const inFlight = useRef(new Set<string>());
  const applyRef = useRef(applyNames);
  applyRef.current = applyNames;
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const pending = Object.entries(tracks)
      .filter(([uri, track]) => needsTrackDetails(uri, track))
      .sort(([, a], [, b]) => Number(!!a.name && !!a.artists) - Number(!!b.name && !!b.artists))
      .map(([uri]) => uri)
      .filter((uri) => !inFlight.current.has(uri) && (attempts.current.get(uri) ?? 0) < MAX_ATTEMPTS);
    if (pending.length === 0) return;

    const timer = setTimeout(() => {
      for (const uri of pending) {
        inFlight.current.add(uri);
        attempts.current.set(uri, (attempts.current.get(uri) ?? 0) + 1);
      }
      void (async () => {
        for (let index = 0; index < pending.length; index += CHUNK_SIZE) {
          if (!mounted.current) return;
          const chunk = pending.slice(index, index + CHUNK_SIZE);
          try {
            const names = await fetchTrackNames(chunk);
            if (Object.keys(names).length > 0) applyRef.current(names);
          } catch (error) {
            console.warn("Tagify: track name lookup failed", error);
          } finally {
            for (const uri of chunk) inFlight.current.delete(uri);
          }
        }
      })();
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [tracks, enabled]);
}
