import { spotifyService } from "@/services/SpotifyService";

export type TrackNames = Record<string, { name: string; artists: string }>;

interface NamedTrack {
  name?: string;
  artists?: string;
}

/** Spotify tracks saved without a name or artist (bulk and inline tagging create these). */
export function needsTrackName(uri: string, track: NamedTrack | null | undefined): boolean {
  return !!track && !uri.startsWith("spotify:local:") && (!track.name || !track.artists);
}

/** Look up names via GraphQL; tracks that fail are left out. */
export async function fetchTrackNames(uris: string[]): Promise<TrackNames> {
  const results = await spotifyService.getBatchTracks(uris);
  const names: TrackNames = {};
  for (const [uri, info] of Object.entries(results)) {
    if (info?.name?.trim() && info.artists?.trim()) {
      names[uri] = { name: info.name, artists: info.artists };
    }
  }
  return names;
}

/**
 * Fill in missing names without touching anything else. Returns the same
 * object when nothing changed so callers can skip a state update.
 */
export function mergeTrackNames<T extends NamedTrack>(
  tracks: Record<string, T>,
  names: TrackNames,
): { tracks: Record<string, T>; changed: string[] } {
  const changed: string[] = [];
  let next = tracks;
  for (const [uri, info] of Object.entries(names)) {
    const track = tracks[uri];
    if (!needsTrackName(uri, track)) continue;
    if (next === tracks) next = { ...tracks };
    next[uri] = {
      ...track,
      name: track.name || info.name,
      artists: track.artists || info.artists,
    };
    changed.push(uri);
  }
  return { tracks: next, changed };
}
