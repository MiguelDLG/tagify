import type { TrackData } from "@/types/tagData";
import type { TrackIdentity } from "@/features/duplicates/model/duplicates.types";
import type { SmartPlaylistCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import type { Proposal, TagStoreSnapshot } from "../model/ai.types";
import { parseProposal } from "./ai.proposal";
import { describeCriteria } from "./ai.taxonomy";

export interface ListedTrack {
  uri: string;
  name: string;
  artists: string;
  album?: string;
}

/** Everything the tools need from Spotify/Tagify; mocked in tests. */
export interface ToolEnv {
  snapshot(): Promise<TagStoreSnapshot>;
  identities(
    uris: string[],
    expected: Record<string, { name?: string; artists?: string }>,
  ): Promise<Map<string, TrackIdentity>>;
  albumTracks(albumUri: string): Promise<{
    name: string;
    artists: string;
    releaseDate?: string;
    type?: string;
    tracks: ListedTrack[];
  } | null>;
  playlistTracks(playlistUri: string): Promise<{ name: string; tracks: ListedTrack[] } | null>;
  smartPlaylists(): SmartPlaylistCriteria[];
}

/** Per-conversation state the tools write into. */
export interface ToolState {
  seen: Record<string, { name: string; artists: string }>;
  onProposal: (proposal: Proposal) => void;
}

const MAX_RESULTS = 300;

function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function summarize(uri: string, track: TrackData | undefined, extra: Partial<ListedTrack> = {}) {
  return {
    uri,
    name: track?.name ?? extra.name ?? "",
    artists: track?.artists ?? extra.artists ?? "",
    ...(extra.album ? { album: extra.album } : {}),
    tagged: !!track,
    tags: track?.tagIds ?? [],
    ...(track?.energy ? { energy: track.energy } : {}),
    ...(track?.rating ? { rating: track.rating } : {}),
  };
}

function fn(name: string, description: string, properties: Record<string, unknown>, required: string[] = []) {
  return {
    type: "function" as const,
    function: {
      name,
      description,
      parameters: { type: "object", properties, required, additionalProperties: false },
    },
  };
}

const stringArray = (description: string) => ({ type: "array", items: { type: "string" }, description });

export const AI_TOOLS = [
  fn(
    "search_tagged_tracks",
    "Search the tracks already in Tagify (the user's tagged library). All filters are optional and combined with AND. Returns uri, name, artists, album (when known), tag ids, energy (1-10) and rating (0-5).",
    {
      text: { type: "string", description: "Case-insensitive match on track title or artist names" },
      artist: { type: "string", description: "Match on artist names (substring)" },
      album: { type: "string", description: "Match on album/release name (substring)" },
      has_all_tags: stringArray("Tag ids the track must all have"),
      has_any_tags: stringArray("Tag ids of which the track must have at least one"),
      lacks_tags: stringArray("Tag ids the track must not have"),
      limit: { type: "integer", description: `Max results (default 100, max ${MAX_RESULTS})` },
    },
  ),
  fn(
    "get_tracks",
    "Details for specific tracks (tagged or not): tags, energy, rating, album, album_uri, explicit, release year.",
    { uris: stringArray("spotify:track: URIs (max 100)") },
    ["uris"],
  ),
  fn(
    "get_album_tracks",
    "All tracks on a Spotify album, including ones not yet in Tagify, with their current tags.",
    { album_uri: { type: "string", description: "spotify:album: URI" } },
    ["album_uri"],
  ),
  fn(
    "get_playlist_tracks",
    "Tracks of a Spotify playlist with their current Tagify tags. If it is a Tagify smart playlist, also returns its rule.",
    {
      playlist_uri: { type: "string", description: "spotify:playlist: URI" },
      limit: { type: "integer", description: `Max tracks (default 200, max ${MAX_RESULTS})` },
    },
    ["playlist_uri"],
  ),
  fn("list_smart_playlists", "The user's Tagify smart playlists and the tag rules that fill them.", {}),
  fn(
    "propose_changes",
    "Stage tag changes for the user to review. Nothing is applied until the user accepts. Use tag ids from the taxonomy; for a tag that does not exist yet, declare it in new_tags and reference it as \"new:<ref>\".",
    {
      summary: { type: "string", description: "One or two sentences: what changes and why" },
      changes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            track_uri: { type: "string" },
            add_tags: stringArray("Tag ids to add"),
            remove_tags: stringArray("Tag ids to remove"),
            energy: { type: ["integer", "null"], description: "New energy 1-10, or null to clear" },
            rating: { type: ["number", "null"], description: "New rating 0-5 (half steps), or null to clear" },
          },
          required: ["track_uri"],
          additionalProperties: false,
        },
      },
      new_tags: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ref: { type: "string", description: "Short key, referenced as new:<ref>" },
            name: { type: "string" },
            subcategory_id: { type: "string", description: "Existing subcategory id (sub_...)" },
          },
          required: ["ref", "name", "subcategory_id"],
          additionalProperties: false,
        },
      },
    },
    ["summary", "changes"],
  ),
];

function remember(state: ToolState, tracks: { uri: string; name: string; artists: string }[]) {
  for (const t of tracks) {
    if (t.uri && t.name) state.seen[t.uri] = { name: t.name, artists: t.artists };
  }
}

export async function executeTool(
  name: string,
  rawArgs: string,
  env: ToolEnv,
  state: ToolState,
): Promise<unknown> {
  let args: Record<string, any>;
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return { error: "Arguments were not valid JSON" };
  }

  switch (name) {
    case "search_tagged_tracks": {
      const { tracks } = await env.snapshot();
      const limit = Math.min(Math.max(Number(args.limit) || 100, 1), MAX_RESULTS);
      const text = args.text ? fold(String(args.text)) : null;
      const artist = args.artist ? fold(String(args.artist)) : null;
      const all: string[] = args.has_all_tags ?? [];
      const any: string[] = args.has_any_tags ?? [];
      const lacks: string[] = args.lacks_tags ?? [];
      let matches = Object.entries(tracks).filter(([, t]) => {
        const hay = fold(`${t.name ?? ""} ${t.artists ?? ""}`);
        if (text && !hay.includes(text)) return false;
        if (artist && !fold(t.artists ?? "").includes(artist)) return false;
        if (all.length && !all.every((id) => t.tagIds.includes(id))) return false;
        if (any.length && !any.some((id) => t.tagIds.includes(id))) return false;
        if (lacks.length && lacks.some((id) => t.tagIds.includes(id))) return false;
        return true;
      });
      let albums = new Map<string, TrackIdentity>();
      if (args.album || matches.length <= limit) {
        albums = await env.identities(
          matches.map(([uri]) => uri),
          Object.fromEntries(matches.map(([uri, t]) => [uri, { name: t.name, artists: t.artists }])),
        );
      }
      if (args.album) {
        const album = fold(String(args.album));
        matches = matches.filter(([uri]) => fold(albums.get(uri)?.albumName ?? "").includes(album));
      }
      const results = matches
        .slice(0, limit)
        .map(([uri, t]) => summarize(uri, t, { album: albums.get(uri)?.albumName ?? undefined }));
      remember(state, results);
      return { total: matches.length, returned: results.length, tracks: results };
    }

    case "get_tracks": {
      const uris: string[] = (args.uris ?? []).filter((u: unknown) => typeof u === "string").slice(0, 100);
      const { tracks } = await env.snapshot();
      const identities = await env.identities(
        uris,
        Object.fromEntries(uris.map((u) => [u, { name: tracks[u]?.name, artists: tracks[u]?.artists }])),
      );
      const results = uris.map((uri) => {
        const id = identities.get(uri);
        return {
          ...summarize(uri, tracks[uri], { name: id?.name, artists: id?.artists.join(", ") }),
          album: id?.albumName ?? undefined,
          album_uri: id?.albumUri ?? undefined,
          explicit: id?.explicit ?? undefined,
          release_year: id?.releaseYear ?? undefined,
        };
      });
      remember(state, results);
      return { tracks: results };
    }

    case "get_album_tracks": {
      const album = await env.albumTracks(String(args.album_uri ?? ""));
      if (!album) return { error: "Album not found" };
      const { tracks } = await env.snapshot();
      const results = album.tracks.map((t) => summarize(t.uri, tracks[t.uri], t));
      remember(state, results);
      return {
        album: album.name,
        artists: album.artists,
        release_date: album.releaseDate,
        type: album.type,
        tracks: results,
      };
    }

    case "get_playlist_tracks": {
      const uri = String(args.playlist_uri ?? "");
      const playlist = await env.playlistTracks(uri);
      if (!playlist) return { error: "Playlist not found" };
      const snapshot = await env.snapshot();
      const limit = Math.min(Math.max(Number(args.limit) || 200, 1), MAX_RESULTS);
      const smart = env.smartPlaylists().find((p) => `spotify:playlist:${p.playlistId}` === uri);
      const results = playlist.tracks.slice(0, limit).map((t) => summarize(t.uri, snapshot.tracks[t.uri], t));
      remember(state, results);
      return {
        name: playlist.name,
        total: playlist.tracks.length,
        smart_playlist_rule: smart ? describeCriteria(smart.criteria, snapshot.taxonomy) : undefined,
        tracks: results,
      };
    }

    case "list_smart_playlists": {
      const { taxonomy } = await env.snapshot();
      return {
        smart_playlists: env.smartPlaylists().map((p) => ({
          name: p.playlistName,
          uri: `spotify:playlist:${p.playlistId}`,
          rule: describeCriteria(p.criteria, taxonomy),
          active: p.isActive,
          track_count: p.smartPlaylistTrackUris?.length ?? 0,
        })),
      };
    }

    case "propose_changes": {
      const { taxonomy } = await env.snapshot();
      const { proposal, errors } = parseProposal(args, taxonomy, state.seen);
      if (!proposal) return { error: "Proposal rejected, fix and call again", details: errors };
      state.onProposal(proposal);
      return {
        status: "staged_for_review",
        proposal_id: proposal.id,
        changes: proposal.changes.length,
        note: "The user now sees these changes and will apply or discard them. Do not call propose_changes again unless the user asks for adjustments.",
      };
    }

    default:
      return { error: `Unknown tool ${name}` };
  }
}
