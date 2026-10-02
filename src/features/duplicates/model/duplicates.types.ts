export type AlbumKind = "album" | "single" | "ep" | "compilation" | "unknown";

/** Release-level facts used to decide whether two track URIs are the same song. */
export interface TrackIdentity {
  uri: string;
  name: string;
  artists: string[];
  durationMs: number | null;
  explicit: boolean | null;
  isrc: string | null;
  albumName: string | null;
  albumKind: AlbumKind;
  /** Spotify's canonical URI when the track is relinked to another release. */
  canonicalUri: string | null;
  releaseYear: number | null;
  source: "metadata" | "graphql" | "tagdata";
  fetchedAt: number;
}

/** Version label used for the keep rule: explicit > album > deluxe > single > compilation. */
export type VersionKind = "album" | "deluxe" | "single" | "unknown" | "compilation";

export type DuplicateReason = "isrc" | "explicit-clean" | "same-song";

export interface DuplicateGroup {
  /** Stable id: sorted URIs joined by "|". */
  key: string;
  uris: string[];
  keeperUri: string;
  reason: DuplicateReason;
}
