import type { TagTaxonomy, TrackData } from "@/types/tagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { trackIdentityService } from "@/services/TrackIdentityService";
import { loadSmartPlaylistsFromStorage } from "@/features/smart-playlists/utils/smartPlaylist.storage";
import type { TagStoreSnapshot } from "../model/ai.types";
import type { ListedTrack, ToolEnv } from "./ai.tools";

/** Same events the extension and keyboard shortcuts use, so open views and smart playlists follow. */
const TRACK_CHANGED_EVENT = "tagify:trackChanged";
const DATA_UPDATED_EVENT = "tagify:dataUpdated";
export const TAXONOMY_CHANGED_EVENT = "tagify:taxonomyChanged";

export async function loadSnapshot(): Promise<TagStoreSnapshot> {
  const data = await indexedDBStorage.loadAll();
  if (!data) throw new Error("Tagify data is not available yet");
  return { taxonomy: data.taxonomy, tracks: data.tracks };
}

/** Persist track updates (null = remove) and notify Tagify, the extension and smart playlists. */
export async function writeTrackUpdates(updates: Record<string, TrackData | null>): Promise<void> {
  const entries = Object.entries(updates);
  const puts = new Map(entries.filter((e): e is [string, TrackData] => e[1] !== null));
  if (puts.size && !(await indexedDBStorage.saveTracks(puts))) {
    throw new Error("Could not save tag changes");
  }
  for (const [uri, data] of entries) {
    if (data === null && !(await indexedDBStorage.deleteTrack(uri))) {
      throw new Error(`Could not remove ${uri}`);
    }
  }
  for (const [trackUri, trackData] of entries) {
    window.dispatchEvent(new CustomEvent(TRACK_CHANGED_EVENT, { detail: { trackUri, trackData } }));
  }
  window.dispatchEvent(
    new CustomEvent(DATA_UPDATED_EVENT, { detail: { type: "save", trackUris: entries.map(([u]) => u) } }),
  );
}

export async function writeTaxonomy(taxonomy: TagTaxonomy): Promise<void> {
  if (!(await indexedDBStorage.saveTaxonomy(taxonomy))) throw new Error("Could not save new tags");
  window.dispatchEvent(new CustomEvent(TAXONOMY_CHANGED_EVENT));
}

const names = (items: any[] | undefined) =>
  (items || []).map((a) => a?.profile?.name).filter(Boolean).join(", ");

async function albumTracks(albumUri: string) {
  const definition = Spicetify.GraphQL?.Definitions?.getAlbum;
  if (!definition || !albumUri.startsWith("spotify:album:")) return null;
  const tracks: ListedTrack[] = [];
  let album: any = null;
  for (let offset = 0; offset < 1000; offset += 50) {
    const response = await Spicetify.GraphQL.Request(definition, { uri: albumUri, locale: "", offset, limit: 50 });
    album = response?.data?.albumUnion;
    if (!album) return null;
    const items = album.tracksV2?.items ?? [];
    for (const item of items) {
      const t = item?.track;
      if (t?.uri) tracks.push({ uri: t.uri, name: t.name, artists: names(t.artists?.items), album: album.name });
    }
    if (items.length < 50 || tracks.length >= (album.tracksV2?.totalCount ?? 0)) break;
  }
  return {
    name: album.name,
    artists: names(album.artists?.items),
    releaseDate: album.date?.isoString?.slice(0, 10),
    type: album.type,
    tracks,
  };
}

async function playlistTracks(playlistUri: string) {
  if (!playlistUri.startsWith("spotify:playlist:")) return null;
  const [meta, contents] = await Promise.all([
    Spicetify.Platform.PlaylistAPI.getMetadata(playlistUri).catch(() => null),
    Spicetify.Platform.PlaylistAPI.getContents(playlistUri, { limit: 9999 }),
  ]);
  const tracks: ListedTrack[] = (contents?.items ?? [])
    .filter((i: any) => i?.uri?.startsWith("spotify:track:"))
    .map((i: any) => ({
      uri: i.uri,
      name: i.name,
      artists: (i.artists ?? []).map((a: any) => a.name).join(", "),
      album: i.album?.name,
    }));
  return { name: meta?.name ?? "Playlist", tracks };
}

export const spotifyToolEnv: ToolEnv = {
  snapshot: loadSnapshot,
  identities: (uris, expected) => trackIdentityService.getIdentities(uris, expected),
  albumTracks,
  playlistTracks,
  smartPlaylists: () => loadSmartPlaylistsFromStorage(),
};

/** Display name for a URI (track/album/artist/playlist), for the context line. */
export async function describeUri(uri: string): Promise<string> {
  try {
    if (uri.startsWith("spotify:playlist:")) {
      return (await Spicetify.Platform.PlaylistAPI.getMetadata(uri))?.name ?? uri;
    }
    if (uri.startsWith("spotify:album:")) {
      return (await albumTracks(uri))?.name ?? uri;
    }
    if (uri.startsWith("spotify:artist:")) {
      const def = Spicetify.GraphQL?.Definitions?.queryArtistMinimal;
      if (def) {
        const r = await Spicetify.GraphQL.Request(def, { uri });
        return r?.data?.artistUnion?.profile?.name ?? uri;
      }
    }
  } catch {
    // fall through to the raw URI
  }
  return uri;
}
