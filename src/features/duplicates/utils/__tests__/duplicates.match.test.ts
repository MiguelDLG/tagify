import { describe, expect, it } from "vitest";
import type { TrackData } from "@/types/tagData";
import type { TrackIdentity } from "../../model/duplicates.types";
import {
  compareIdentities,
  dedupeTrackUris,
  findDuplicateGroups,
  getVersionKind,
  mergeTrackData,
  normalizeTitle,
  pickKeeper,
} from "../duplicates.match";

let counter = 0;
function id(partial: Partial<TrackIdentity> & { name: string; artists: string[] }): TrackIdentity {
  counter += 1;
  return {
    uri: `spotify:track:t${counter}`,
    durationMs: 180000,
    explicit: true,
    isrc: null,
    albumName: "Album",
    albumKind: "album",
    canonicalUri: null,
    releaseYear: 2020,
    source: "metadata",
    fetchedAt: 0,
    ...partial,
  };
}

function track(partial: Partial<TrackData> = {}): TrackData {
  return { rating: 0, energy: 0, bpm: null, tagIds: [], ...partial };
}

describe("normalizeTitle", () => {
  it("drops featuring credits and release noise but keeps version markers", () => {
    expect(normalizeTitle("Turks (with Gunna & ft. Travis Scott)")).toBe("turks");
    expect(normalizeTitle("Pull Up (feat. NAV)")).toBe("pull up");
    expect(normalizeTitle("Hello - Remastered 2011")).toBe("hello");
    expect(normalizeTitle("Sweet Dreams (Explicit)")).toBe("sweet dreams");
    expect(normalizeTitle("Mask Off (Remix)")).toBe("mask off remix");
    expect(normalizeTitle("Ring Ring - Extended Version")).toBe("ring ring extended version");
    expect(normalizeTitle("Après un rêve")).toBe("apres un reve");
  });
});

describe("compareIdentities", () => {
  it("matches the same song on the standard and bonus edition", () => {
    const a = id({ name: "Destiny", artists: ["NAV"], albumName: "Demons Protected By Angels", durationMs: 113000 });
    const b = id({ name: "Destiny", artists: ["NAV"], albumName: "Demons Protected By Angels (Bonus Version)", durationMs: 113400 });
    expect(compareIdentities(a, b)).toBe("same-song");
  });

  it("matches album vs compilation with different feature formatting", () => {
    const a = id({ name: "Pull Up (feat. NAV)", artists: ["A Boogie Wit da Hoodie", "NAV"], albumName: "Hoodie SZN" });
    const b = id({ name: "Pull Up", artists: ["A Boogie Wit da Hoodie", "NAV"], albumName: "International Artist", albumKind: "compilation" });
    expect(compareIdentities(a, b)).toBe("same-song");
  });

  it("flags clean vs explicit versions", () => {
    const a = id({ name: "Sicko Mode", artists: ["Travis Scott"], explicit: true });
    const b = id({ name: "Sicko Mode", artists: ["Travis Scott"], explicit: false, durationMs: 181000 });
    expect(compareIdentities(a, b)).toBe("explicit-clean");
  });

  it("trusts a shared ISRC even when titles differ", () => {
    const a = id({ name: "XO Tour Llif3", artists: ["Lil Uzi Vert"], isrc: "USAT21700543" });
    const b = id({ name: "XO TOUR Llif3", artists: ["Lil Uzi Vert"], isrc: "USAT21700543", durationMs: 999999 });
    expect(compareIdentities(a, b)).toBe("isrc");
  });

  it("keeps remixes, different lengths and different performers apart", () => {
    const original = id({ name: "Mask Off", artists: ["Future"] });
    const remix = id({ name: "Mask Off (Remix)", artists: ["Future", "Kendrick Lamar"] });
    expect(compareIdentities(original, remix)).toBeNull();

    const introA = id({ name: "Intro", artists: ["NAV"], durationMs: 127000 });
    const introB = id({ name: "Intro", artists: ["NAV"], durationMs: 156000 });
    expect(compareIdentities(introA, introB)).toBeNull();

    const rubinstein = id({ name: "Nocturne in E-Flat Major, Op. 9, No. 2", artists: ["Frédéric Chopin", "Arthur Rubinstein"] });
    const pires = id({ name: "Nocturne in E-Flat Major, Op. 9, No. 2", artists: ["Frédéric Chopin", "Maria João Pires"], durationMs: 181500 });
    expect(compareIdentities(rubinstein, pires)).toBeNull();
  });

  it("matches the same classical recording reissued on a compilation", () => {
    const performers = ["Sergei Prokofiev", "Orchestra of the Royal Opera House, Covent Garden", "Mark Ermler"];
    const a = id({ name: "Romeo and Juliet, Op. 64: No. 13 Dance of the Knights", artists: performers, durationMs: 343000, explicit: false });
    const b = id({ name: "Romeo and Juliet, Op. 64: No. 13 Dance of the Knights", artists: performers, durationMs: 345000, explicit: false, albumKind: "compilation" });
    expect(compareIdentities(a, b)).toBe("same-song");
  });

  it("does not guess without lengths", () => {
    const a = id({ name: "Destiny", artists: ["NAV"], durationMs: null });
    const b = id({ name: "Destiny", artists: ["NAV"] });
    expect(compareIdentities(a, b)).toBeNull();
  });
});

describe("pickKeeper (explicit > album > deluxe > single > compilation)", () => {
  it("prefers explicit over everything", () => {
    const clean = id({ name: "S", artists: ["A"], explicit: false, albumKind: "album" });
    const explicitSingle = id({ name: "S", artists: ["A"], explicit: true, albumKind: "single" });
    expect(pickKeeper([clean, explicitSingle])).toBe(explicitSingle.uri);
  });

  it("orders album > deluxe > single > compilation", () => {
    const comp = id({ name: "S", artists: ["A"], albumKind: "compilation" });
    const single = id({ name: "S", artists: ["A"], albumKind: "single" });
    const deluxe = id({ name: "S", artists: ["A"], albumName: "X (Deluxe)" });
    const album = id({ name: "S", artists: ["A"], albumName: "X" });
    expect(getVersionKind(deluxe)).toBe("deluxe");
    expect(pickKeeper([comp, single, deluxe, album])).toBe(album.uri);
    expect(pickKeeper([comp, single, deluxe])).toBe(deluxe.uri);
    expect(pickKeeper([comp, single])).toBe(single.uri);
  });

  it("breaks exact ties by Spotify's canonical release, then tag count", () => {
    const a = id({ name: "T-Shirt", artists: ["Migos"], albumName: "Culture" });
    const b = id({ name: "T-Shirt", artists: ["Migos"], albumName: "Culture", canonicalUri: a.uri });
    expect(pickKeeper([b, a])).toBe(a.uri);

    const c = id({ name: "Y", artists: ["A"] });
    const d = id({ name: "Y", artists: ["A"] });
    const tracks = { [c.uri]: track({ tagIds: ["x"] }), [d.uri]: track({ tagIds: ["x", "y"] }) };
    expect(pickKeeper([c, d], tracks)).toBe(d.uri);
  });
});

describe("findDuplicateGroups", () => {
  it("groups chains, skips ignored groups and picks a keeper", () => {
    const album = id({ name: "Destiny", artists: ["NAV"], albumName: "Demons Protected By Angels", isrc: "X1" });
    const bonus = id({ name: "Destiny", artists: ["NAV"], albumName: "Demons Protected By Angels (Bonus Version)", isrc: "X1" });
    const single = id({ name: "Destiny", artists: ["NAV"], albumKind: "single", durationMs: 181000 });
    const other = id({ name: "Weirdo", artists: ["NAV"] });

    const groups = findDuplicateGroups([album, bonus, single, other]);
    expect(groups).toHaveLength(1);
    expect(groups[0].uris.sort()).toEqual([album.uri, bonus.uri, single.uri].sort());
    expect(groups[0].keeperUri).toBe(album.uri);

    expect(findDuplicateGroups([album, bonus, single], { ignoredKeys: new Set([groups[0].key]) })).toHaveLength(0);
  });
});

describe("mergeTrackData", () => {
  it("unions tags and fills empty fields from the other versions", () => {
    const keeper = track({ tagIds: ["rap"], energy: 0, bpm: null, dateCreated: 20 });
    const other = track({ tagIds: ["rap", "hype"], energy: 7, bpm: 140, rating: 4, camelotKey: "8A", dateCreated: 10 });
    const merged = mergeTrackData(keeper, [other], 99);
    expect(merged.tagIds.sort()).toEqual(["hype", "rap"]);
    expect(merged.energy).toBe(7);
    expect(merged.bpm).toBe(140);
    expect(merged.rating).toBe(4);
    expect(merged.camelotKey).toBe("8A");
    expect(merged.dateCreated).toBe(10);
    expect(merged.dateModified).toBe(99);
  });

  it("keeps the keeper's own values when set", () => {
    const merged = mergeTrackData(track({ energy: 3, rating: 2, bpm: 90 }), [track({ energy: 8, rating: 5, bpm: 140 })], 1);
    expect([merged.energy, merged.rating, merged.bpm]).toEqual([3, 2, 90]);
  });
});

describe("dedupeTrackUris", () => {
  it("drops non-kept versions and leaves unknown URIs alone", () => {
    const album = id({ name: "Robbery", artists: ["Juice WRLD"], albumName: "Death Race For Love" });
    const bonus = id({ name: "Robbery", artists: ["Juice WRLD"], albumName: "Death Race For Love (Bonus Track Version)" });
    const identities = new Map([album, bonus].map((i) => [i.uri, i]));
    const result = dedupeTrackUris([bonus.uri, album.uri, "spotify:track:unknown"], identities, {});
    expect(result.uris).toEqual([album.uri, "spotify:track:unknown"]);
    expect(result.dropped).toEqual([bonus.uri]);
  });
});
