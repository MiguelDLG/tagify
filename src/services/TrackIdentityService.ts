import protobuf from "protobufjs/light";
import { RateLimiter } from "@/utils/RateLimiter";
import type {
  AlbumKind,
  TrackIdentity,
} from "@/features/duplicates/model/duplicates.types";
import { normalizeTitle } from "@/features/duplicates/utils/duplicates.match";

// Field numbers follow librespot's protocol/proto (extended_metadata.proto,
// entity_extension_data.proto, metadata.proto). Unused fields are omitted;
// protobufjs skips unknown fields safely.
const requestDescriptor = {
  nested: {
    BatchedEntityRequest: {
      fields: {
        header: { type: "Header", id: 1 },
        entity_request: { type: "EntityRequest", id: 2, rule: "repeated" },
      },
    },
    Header: {
      fields: {
        country: { type: "string", id: 1 },
        catalogue: { type: "string", id: 2 },
        task_id: { type: "bytes", id: 3 },
      },
    },
    EntityRequest: {
      fields: {
        entity_uri: { type: "string", id: 1 },
        query: { type: "ExtensionQuery", id: 2, rule: "repeated" },
      },
    },
    ExtensionQuery: {
      fields: {
        extension_kind: { type: "uint32", id: 1 },
      },
    },
  },
};

const responseDescriptor = {
  nested: {
    BatchedExtensionResponse: {
      fields: {
        extended_metadata: { type: "EntityExtensionDataArray", id: 2, rule: "repeated" },
      },
    },
    EntityExtensionDataArray: {
      fields: {
        extension_kind: { type: "uint32", id: 2 },
        extension_data: { type: "EntityExtensionData", id: 3, rule: "repeated" },
      },
    },
    EntityExtensionData: {
      fields: {
        header: { type: "EntityExtensionDataHeader", id: 1 },
        entity_uri: { type: "string", id: 2 },
        extension_data: { type: "Any", id: 3 },
      },
    },
    EntityExtensionDataHeader: {
      fields: {
        status_code: { type: "int32", id: 1 },
      },
    },
    Any: {
      fields: {
        type_url: { type: "string", id: 1 },
        value: { type: "bytes", id: 2 },
      },
    },
    Track: {
      fields: {
        name: { type: "string", id: 2 },
        album: { type: "Album", id: 3 },
        artist: { type: "Artist", id: 4, rule: "repeated" },
        duration: { type: "sint32", id: 7 },
        explicit: { type: "bool", id: 9 },
        external_id: { type: "ExternalId", id: 10, rule: "repeated" },
        canonical_uri: { type: "string", id: 36 },
      },
    },
    Album: {
      fields: {
        name: { type: "string", id: 2 },
        type: { type: "int32", id: 4 },
        date: { type: "Date", id: 6 },
        type_str: { type: "string", id: 20 },
      },
    },
    Artist: {
      fields: {
        name: { type: "string", id: 2 },
      },
    },
    Date: {
      fields: {
        year: { type: "sint32", id: 1 },
      },
    },
    ExternalId: {
      fields: {
        type: { type: "string", id: 1 },
        id: { type: "string", id: 2 },
      },
    },
  },
};

export const TRACK_V4_EXTENSION_KIND = 10;
const BATCH_SIZE = 100;
const GRAPHQL_CONCURRENCY = 4;
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const DB_NAME = "tagify-track-identity";
const STORE = "identities";

const ALBUM_TYPES: Record<number, AlbumKind> = {
  1: "album",
  2: "single",
  3: "compilation",
  4: "ep",
};

const identityRateLimiter = new RateLimiter({
  maxRequestsPerSecond: 5,
  maxRequestsPerMinute: 300,
  circuitBreakerThreshold: 10,
  circuitBreakerResetMs: 30000,
  requestTimeoutMs: 20000,
});

const types = {
  request: protobuf.Root.fromJSON(requestDescriptor).lookupType("BatchedEntityRequest"),
  response: protobuf.Root.fromJSON(responseDescriptor).lookupType("BatchedExtensionResponse"),
  array: protobuf.Root.fromJSON(responseDescriptor).lookupType("EntityExtensionDataArray"),
  track: protobuf.Root.fromJSON(responseDescriptor).lookupType("Track"),
};

export interface ExpectedTrackInfo {
  name?: string;
  artists?: string;
}

function albumKindFrom(type: number | undefined, typeStr: string | undefined): AlbumKind {
  if (type && ALBUM_TYPES[type]) return ALBUM_TYPES[type];
  const s = (typeStr || "").toLowerCase();
  if (s === "album" || s === "single" || s === "compilation" || s === "ep") return s;
  return "unknown";
}

/** Decode a TRACK_V4 extended-metadata response into identities keyed by URI. */
export function decodeTrackIdentities(
  buffer: Uint8Array,
  now: number = Date.now(),
): Map<string, TrackIdentity> {
  const result = new Map<string, TrackIdentity>();
  // Normally a BatchedExtensionResponse; tolerate a bare EntityExtensionDataArray too.
  let arrays: any[] = [];
  try {
    arrays = (types.response.decode(buffer) as any).extended_metadata || [];
  } catch {
    arrays = [];
  }
  if (!arrays.some((a) => a.extension_data?.length)) {
    try {
      arrays = [types.array.decode(buffer)];
    } catch {
      return result;
    }
  }
  for (const array of arrays) {
    for (const entry of array.extension_data || []) {
      const value: Uint8Array | undefined = entry.extension_data?.value;
      if (!entry.entity_uri || !value || value.length === 0) continue;
      const t = types.track.decode(value) as any;
      if (!t.name) continue;
      const isrc = (t.external_id || []).find(
        (e: any) => (e.type || "").toLowerCase() === "isrc",
      )?.id;
      result.set(entry.entity_uri, {
        uri: entry.entity_uri,
        name: t.name,
        artists: (t.artist || []).map((a: any) => a.name).filter(Boolean),
        durationMs: typeof t.duration === "number" && t.duration > 0 ? t.duration : null,
        explicit: typeof t.explicit === "boolean" ? t.explicit : false,
        isrc: isrc ? String(isrc).toUpperCase() : null,
        albumName: t.album?.name || null,
        albumKind: albumKindFrom(t.album?.type, t.album?.type_str),
        canonicalUri: t.canonical_uri || null,
        releaseYear: t.album?.date?.year || null,
        source: "metadata",
        fetchedAt: now,
      });
    }
  }
  return result;
}

/** Parse Spotify's GraphQL getTrack response defensively. */
export function identityFromGraphQL(
  uri: string,
  response: any,
  now: number = Date.now(),
): TrackIdentity | null {
  const track = response?.data?.trackUnion;
  if (!track?.name) return null;
  const artistNames = (items: any[] | undefined) =>
    (items || []).map((a) => a?.profile?.name).filter(Boolean) as string[];
  const artists = [
    ...artistNames(track.firstArtist?.items),
    ...artistNames(track.otherArtists?.items),
  ];
  const album = track.albumOfTrack || {};
  const yearMatch = /^(\d{4})/.exec(album.date?.isoString || "");
  return {
    uri,
    name: track.name,
    artists: artists.length > 0 ? artists : artistNames(track.artists?.items),
    durationMs: track.duration?.totalMilliseconds ?? null,
    explicit: track.contentRating?.label ? track.contentRating.label === "EXPLICIT" : null,
    isrc: null,
    albumName: album.name || null,
    albumKind: albumKindFrom(undefined, album.type),
    canonicalUri: null,
    releaseYear: album.date?.year ?? (yearMatch ? Number(yearMatch[1]) : null),
    source: "graphql",
    fetchedAt: now,
  };
}

/** Last-resort identity from what Tagify already stores (cannot match on its own). */
export function identityFromTagData(
  uri: string,
  info: ExpectedTrackInfo | undefined,
): TrackIdentity {
  return {
    uri,
    name: info?.name || "",
    artists: (info?.artists || "").split(", ").filter(Boolean),
    durationMs: null,
    explicit: null,
    isrc: null,
    albumName: null,
    albumKind: "unknown",
    canonicalUri: null,
    releaseYear: null,
    source: "tagdata",
    fetchedAt: 0,
  };
}

/** Decoded name must look like the name Tagify stored, or we distrust the decode. */
function plausible(identity: TrackIdentity, expected: ExpectedTrackInfo | undefined): boolean {
  if (!expected?.name) return true;
  const a = normalizeTitle(identity.name);
  const b = normalizeTitle(expected.name);
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
}

class TrackIdentityService {
  private memory = new Map<string, TrackIdentity>();
  private loaded: Promise<void> | null = null;
  private country = "US";
  private catalogue = "premium";
  private metadataEndpointFailed = false;
  stats = { metadata: 0, graphql: 0, tagdata: 0 };

  private openDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === "undefined") return Promise.resolve(null);
    return new Promise((resolve) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: "uri" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }

  private ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      this.loaded = (async () => {
        try {
          const values = await Spicetify.Platform.ProductStateAPI.getValues();
          this.country = values["country"] ?? "US";
          this.catalogue = values["catalogue"] ?? "premium";
        } catch {
          // keep defaults
        }
        const db = await this.openDb();
        if (!db) return;
        await new Promise<void>((resolve) => {
          const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
          req.onsuccess = () => {
            const now = Date.now();
            for (const identity of req.result as TrackIdentity[]) {
              if (now - identity.fetchedAt < CACHE_TTL_MS) this.memory.set(identity.uri, identity);
            }
            resolve();
          };
          req.onerror = () => resolve();
        });
        db.close();
      })();
    }
    return this.loaded;
  }

  private async persist(identities: TrackIdentity[]): Promise<void> {
    const fetched = identities.filter((i) => i.source !== "tagdata");
    if (fetched.length === 0) return;
    const db = await this.openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      fetched.forEach((identity) => store.put(identity));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  }

  /** Cached identity, if any (synchronous; used during playlist sync). */
  getCached(uri: string): TrackIdentity | undefined {
    return this.memory.get(uri);
  }

  getCachedMap(): Map<string, TrackIdentity> {
    return this.memory;
  }

  private async fetchMetadataBatch(uris: string[]): Promise<Map<string, TrackIdentity>> {
    const taskId = new Uint8Array(16);
    crypto.getRandomValues(taskId);
    const payload = types.request
      .encode({
        header: { country: this.country, catalogue: this.catalogue, task_id: taskId },
        entity_request: uris.map((uri) => ({
          entity_uri: uri,
          query: [{ extension_kind: TRACK_V4_EXTENSION_KIND }],
        })),
      })
      .finish();
    const body = new ArrayBuffer(payload.byteLength);
    new Uint8Array(body).set(payload);

    const resp = await fetch(
      "https://spclient.wg.spotify.com/extended-metadata/v0/extended-metadata",
      {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/protobuf",
          Authorization: `Bearer ${Spicetify.Platform.AuthorizationAPI.getState().token.accessToken}`,
          "Spotify-App-Version": Spicetify.Platform.version,
          "App-Platform": Spicetify.Platform.PlatformData.app_platform,
        },
      },
    );
    if (!resp.ok) throw new Error(`Track metadata request failed: ${resp.status}`);
    return decodeTrackIdentities(new Uint8Array(await resp.arrayBuffer()));
  }

  private async fetchGraphQL(uri: string): Promise<TrackIdentity | null> {
    const definition = Spicetify.GraphQL?.Definitions?.getTrack;
    if (!definition) return null;
    try {
      const response = await Spicetify.GraphQL.Request(definition, { uri });
      return identityFromGraphQL(uri, response);
    } catch (error) {
      console.warn("TrackIdentityService: GraphQL getTrack failed", uri, error);
      return null;
    }
  }

  /**
   * Identities for the given URIs, fetching what is not cached.
   * @param expected names Tagify already stores, used to sanity-check decodes.
   */
  async getIdentities(
    uris: string[],
    expected: Record<string, ExpectedTrackInfo | undefined> = {},
    onProgress?: (done: number, total: number) => void,
  ): Promise<Map<string, TrackIdentity>> {
    await this.ensureLoaded();
    const wanted = Array.from(new Set(uris.filter((u) => u.startsWith("spotify:track:"))));
    const missing = wanted.filter((uri) => !this.memory.has(uri));
    let done = wanted.length - missing.length;
    onProgress?.(done, wanted.length);

    const fresh: TrackIdentity[] = [];
    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
      const batch = missing.slice(i, i + BATCH_SIZE);
      let decoded = new Map<string, TrackIdentity>();
      if (!this.metadataEndpointFailed) {
        try {
          decoded = await identityRateLimiter.execute(`identity:${batch[0]}:${batch.length}`, () =>
            this.fetchMetadataBatch(batch),
          );
        } catch (error) {
          console.warn("TrackIdentityService: metadata endpoint failed, using GraphQL", error);
          this.metadataEndpointFailed = true;
        }
      }

      const resolveOne = async (uri: string): Promise<void> => {
        let identity = decoded.get(uri) ?? null;
        if (identity && !plausible(identity, expected[uri])) {
          console.warn("TrackIdentityService: implausible metadata decode", uri, identity.name);
          identity = null;
        }
        if (!identity) identity = await this.fetchGraphQL(uri);
        if (!identity) identity = identityFromTagData(uri, expected[uri]);
        this.stats[identity.source] += 1;
        if (identity.source !== "tagdata") this.memory.set(uri, identity);
        fresh.push(identity);
        done += 1;
      };
      for (let j = 0; j < batch.length; j += GRAPHQL_CONCURRENCY) {
        await Promise.all(batch.slice(j, j + GRAPHQL_CONCURRENCY).map(resolveOne));
        onProgress?.(done, wanted.length);
      }
    }
    await this.persist(fresh);

    const result = new Map<string, TrackIdentity>();
    for (const uri of wanted) {
      const identity =
        this.memory.get(uri) ?? fresh.find((f) => f.uri === uri) ?? identityFromTagData(uri, expected[uri]);
      result.set(uri, identity);
    }
    return result;
  }
}

export const trackIdentityService = new TrackIdentityService();
