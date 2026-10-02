import { describe, expect, it } from "vitest";
import protobuf from "protobufjs/light";
import {
  decodeTrackIdentities,
  gidToBase62,
  identityFromGraphQL,
  identityFromTagData,
} from "../TrackIdentityService";

// Full-fidelity encoder built from librespot's protocol definitions, including
// fields the decoder ignores, so the test proves those are skipped safely.
const fullDescriptor = {
  nested: {
    BatchedExtensionResponse: {
      fields: {
        header: { type: "Empty", id: 1 },
        extended_metadata: { type: "EntityExtensionDataArray", id: 2, rule: "repeated" },
      },
    },
    Empty: { fields: {} },
    EntityExtensionDataArray: {
      fields: {
        header: { type: "ArrayHeader", id: 1 },
        extension_kind: { type: "uint32", id: 2 },
        extension_data: { type: "EntityExtensionData", id: 3, rule: "repeated" },
      },
    },
    ArrayHeader: {
      fields: {
        provider_error_status: { type: "int32", id: 1 },
        cache_ttl_in_seconds: { type: "int64", id: 2 },
        extension_type: { type: "uint32", id: 4 },
      },
    },
    EntityExtensionData: {
      fields: {
        header: { type: "DataHeader", id: 1 },
        entity_uri: { type: "string", id: 2 },
        extension_data: { type: "Any", id: 3 },
      },
    },
    DataHeader: {
      fields: {
        status_code: { type: "int32", id: 1 },
        etag: { type: "string", id: 2 },
        locale: { type: "string", id: 3 },
      },
    },
    Any: { fields: { type_url: { type: "string", id: 1 }, value: { type: "bytes", id: 2 } } },
    Track: {
      fields: {
        gid: { type: "bytes", id: 1 },
        name: { type: "string", id: 2 },
        album: { type: "Album", id: 3 },
        artist: { type: "Artist", id: 4, rule: "repeated" },
        number: { type: "sint32", id: 5 },
        disc_number: { type: "sint32", id: 6 },
        duration: { type: "sint32", id: 7 },
        popularity: { type: "sint32", id: 8 },
        explicit: { type: "bool", id: 9 },
        external_id: { type: "ExternalId", id: 10, rule: "repeated" },
        tags: { type: "string", id: 16, rule: "repeated" },
        has_lyrics: { type: "bool", id: 18 },
        version_title: { type: "string", id: 28 },
        canonical_uri: { type: "string", id: 36 },
      },
    },
    Album: {
      fields: {
        gid: { type: "bytes", id: 1 },
        name: { type: "string", id: 2 },
        artist: { type: "Artist", id: 3, rule: "repeated" },
        type: { type: "int32", id: 4 },
        label: { type: "string", id: 5 },
        date: { type: "Date", id: 6 },
        popularity: { type: "sint32", id: 7 },
        version_title: { type: "string", id: 19 },
      },
    },
    Artist: { fields: { gid: { type: "bytes", id: 1 }, name: { type: "string", id: 2 } } },
    Date: { fields: { year: { type: "sint32", id: 1 }, month: { type: "sint32", id: 2 }, day: { type: "sint32", id: 3 } } },
    ExternalId: { fields: { type: { type: "string", id: 1 }, id: { type: "string", id: 2 } } },
  },
};
const root = protobuf.Root.fromJSON(fullDescriptor);
const Track = root.lookupType("Track");
const Response = root.lookupType("BatchedExtensionResponse");

function encodeTrack(fields: Record<string, unknown>): Uint8Array {
  return Track.encode(Track.fromObject(fields)).finish();
}

describe("decodeTrackIdentities", () => {
  it("reads name, artists, length, explicit, ISRC, album type/year and canonical URI", () => {
    const deluxe = encodeTrack({
      gid: new Uint8Array([1, 2, 3]),
      name: "Destiny",
      album: { name: "Demons Protected By Angels (Bonus Version)", type: 1, label: "XO", date: { year: 2024, month: 5, day: 3 } },
      artist: [{ name: "NAV" }],
      number: 7,
      duration: 113421,
      popularity: 55,
      explicit: true,
      external_id: [{ type: "isrc", id: "usum72401234" }],
      tags: ["x"],
      has_lyrics: true,
      canonical_uri: "spotify:track:standard",
    });
    const single = encodeTrack({
      name: "Lemonade",
      album: { name: "Lemonade", type: 2, date: { year: 2020 } },
      artist: [{ name: "Internet Money" }, { name: "Gunna" }],
      duration: 195000,
    });
    const buffer = Response.encode(
      Response.fromObject({
        header: {},
        extended_metadata: [
          {
            header: { provider_error_status: 0, cache_ttl_in_seconds: 3600, extension_type: 1 },
            extension_kind: 10,
            extension_data: [
              { header: { status_code: 200, etag: "e" }, entity_uri: "spotify:track:deluxe", extension_data: { type_url: "type.googleapis.com/spotify.metadata.Track", value: deluxe } },
              { header: { status_code: 200 }, entity_uri: "spotify:track:single", extension_data: { type_url: "t", value: single } },
              { header: { status_code: 404 }, entity_uri: "spotify:track:missing" },
            ],
          },
        ],
      }),
    ).finish();

    const result = decodeTrackIdentities(buffer, 123);
    expect(result.size).toBe(2);
    expect(result.get("spotify:track:deluxe")).toEqual({
      uri: "spotify:track:deluxe",
      name: "Destiny",
      artists: ["NAV"],
      durationMs: 113421,
      explicit: true,
      isrc: "USUM72401234",
      albumName: "Demons Protected By Angels (Bonus Version)",
      albumUri: null,
      albumKind: "album",
      canonicalUri: "spotify:track:standard",
      releaseYear: 2024,
      source: "metadata",
      fetchedAt: 123,
    });
    const s = result.get("spotify:track:single")!;
    expect([s.albumKind, s.explicit, s.isrc, s.artists]).toEqual(["single", false, null, ["Internet Money", "Gunna"]]);
  });
});

describe("gidToBase62", () => {
  it("encodes 16 bytes as 22 base62 chars and round-trips", () => {
    const hex = "d7b0c7c1f53646e3b3b2d4c0d2a0f9a5";
    const bytes = new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));
    const id = gidToBase62(bytes)!;
    expect(id).toHaveLength(22);
    // round-trip back to hex
    let n = 0n;
    for (const ch of id) n = n * 62n + BigInt("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".indexOf(ch));
    expect(n.toString(16).padStart(32, "0")).toBe(hex);
  });
});

describe("identityFromGraphQL", () => {
  it("parses a getTrack response", () => {
    const identity = identityFromGraphQL("spotify:track:x", {
      data: {
        trackUnion: {
          name: "Pull Up (feat. NAV)",
          duration: { totalMilliseconds: 194000 },
          contentRating: { label: "EXPLICIT" },
          albumOfTrack: { name: "International Artist", type: "COMPILATION", date: { isoString: "2019-02-01T00:00:00Z" } },
          firstArtist: { items: [{ profile: { name: "A Boogie Wit da Hoodie" } }] },
          otherArtists: { items: [{ profile: { name: "NAV" } }] },
        },
      },
    }, 5);
    expect(identity).toMatchObject({
      artists: ["A Boogie Wit da Hoodie", "NAV"],
      durationMs: 194000,
      explicit: true,
      albumKind: "compilation",
      releaseYear: 2019,
      source: "graphql",
    });
  });

  it("returns null for errors", () => {
    expect(identityFromGraphQL("spotify:track:x", { errors: [{}] })).toBeNull();
  });
});

describe("identityFromTagData", () => {
  it("splits stored artists", () => {
    expect(identityFromTagData("u", { name: "N", artists: "A, B" }).artists).toEqual(["A", "B"]);
  });
});
