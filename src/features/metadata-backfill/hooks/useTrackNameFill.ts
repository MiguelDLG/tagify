import { useEffect, useRef } from "react";
import type { TrackData } from "@/types/tagData";
import { fetchTrackNames, needsTrackName, TrackNames } from "@/utils/trackNames";

export interface UseTrackNameFillOptions {
  tracks: Record<string, TrackData>;
  enabled: boolean;
  applyNames: (names: TrackNames) => void;
}

const DEBOUNCE_MS = 400;
const MAX_ATTEMPTS = 3;

/**
 * Bulk tagging, album "apply to tracks" and the inline editor create tracks
 * with only tags. Whenever tracks without a name show up, look them up and
 * fill them in, so the list never settles on "Unknown Track".
 */
export function useTrackNameFill({ tracks, enabled, applyNames }: UseTrackNameFillOptions) {
  const attempts = useRef(new Map<string, number>());
  const inFlight = useRef(new Set<string>());
  const applyRef = useRef(applyNames);
  applyRef.current = applyNames;

  useEffect(() => {
    if (!enabled) return;

    const pending = Object.entries(tracks)
      .filter(([uri, track]) => needsTrackName(uri, track))
      .map(([uri]) => uri)
      .filter((uri) => !inFlight.current.has(uri) && (attempts.current.get(uri) ?? 0) < MAX_ATTEMPTS);
    if (pending.length === 0) return;

    const timer = setTimeout(() => {
      for (const uri of pending) {
        inFlight.current.add(uri);
        attempts.current.set(uri, (attempts.current.get(uri) ?? 0) + 1);
      }
      void fetchTrackNames(pending)
        .then((names) => {
          if (Object.keys(names).length > 0) applyRef.current(names);
        })
        .catch((error) => console.warn("Tagify: track name lookup failed", error))
        .finally(() => {
          for (const uri of pending) inFlight.current.delete(uri);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [tracks, enabled]);
}
