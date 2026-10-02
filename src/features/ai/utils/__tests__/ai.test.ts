import { describe, expect, it, vi } from "vitest";
import type { TagTaxonomy, TrackData } from "@/types/tagData";
import type { TrackIdentity } from "@/features/duplicates/model/duplicates.types";
import type { ChatMessage, Proposal, TagStoreSnapshot } from "../../model/ai.types";
import { buildProposalUpdates, buildUndoUpdates, parseProposal } from "../ai.proposal";
import { describeCriteria, renderTaxonomy } from "../ai.taxonomy";
import { executeTool, type ToolEnv, type ToolState } from "../ai.tools";
import { runAgent } from "../ai.agent";
import type { CompletionResult } from "../ai.openrouter";

const taxonomy: TagTaxonomy = {
  categoryOrder: ["cat_genre", "cat_vibe"],
  categoriesById: {
    cat_genre: { id: "cat_genre", name: "Genre", subcategoryIds: ["sub_main", "sub_rap"] },
    cat_vibe: { id: "cat_vibe", name: "Vibe", subcategoryIds: ["sub_mood"] },
  },
  subcategoriesById: {
    sub_main: { id: "sub_main", name: "Main", categoryId: "cat_genre", tagIds: ["tag_rap"] },
    sub_rap: { id: "sub_rap", name: "Rap style", categoryId: "cat_genre", tagIds: ["tag_trap"] },
    sub_mood: { id: "sub_mood", name: "Mood", categoryId: "cat_vibe", tagIds: ["tag_hype", "tag_atmo"] },
  },
  tagsById: {
    tag_rap: { id: "tag_rap", name: "Rap", subcategoryId: "sub_main", accentId: "blue" },
    tag_trap: { id: "tag_trap", name: "Trap", subcategoryId: "sub_rap", accentId: "blue" },
    tag_hype: { id: "tag_hype", name: "Hype", subcategoryId: "sub_mood", accentId: "rose" },
    tag_atmo: { id: "tag_atmo", name: "Atmospheric", subcategoryId: "sub_mood", accentId: "rose" },
  },
  customAccentsById: {},
  colorThemesById: {},
  colorThemeOrder: [],
  ungroupedColorIds: [],
};

const t = (tagIds: string[], extra: Partial<TrackData> = {}): TrackData => ({
  rating: 0, energy: 0, bpm: null, tagIds, ...extra,
});

const A = "spotify:track:aaa";
const B = "spotify:track:bbb";
const C = "spotify:track:ccc";

function snapshot(): TagStoreSnapshot {
  return {
    taxonomy,
    tracks: {
      [A]: t(["tag_rap", "tag_hype"], { name: "Destiny", artists: "NAV", energy: 7 }),
      [B]: t(["tag_rap", "tag_trap"], { name: "Mask Off", artists: "Future" }),
    },
  };
}

describe("taxonomy helpers", () => {
  it("renders ids with names and describes smart playlist rules", () => {
    expect(renderTaxonomy(taxonomy)).toContain("[sub_mood] Vibe › Mood\n  tag_hype: Hype");
    expect(
      describeCriteria(
        {
          includeTagClauses: [{ tagIds: ["tag_rap", "tag_atmo"], excludedTagIds: ["tag_hype"], operator: "AND" }],
          clauseConnectors: [],
          ratingFilters: [],
          energyMinFilter: 6,
          energyMaxFilter: null,
          bpmMinFilter: null,
          bpmMaxFilter: null,
        },
        taxonomy,
      ),
    ).toBe("(Rap AND Atmospheric AND NOT Hype) · energy ≥ 6");
  });
});

describe("parseProposal", () => {
  it("accepts valid changes and new tags", () => {
    const { proposal, errors } = parseProposal(
      {
        summary: "Destiny is not hype",
        changes: [{ track_uri: A, remove_tags: ["tag_hype"], add_tags: ["tag_atmo", "new:late"], energy: 4 }],
        new_tags: [{ ref: "late", name: "Late night drive", subcategory_id: "sub_mood" }],
      },
      taxonomy,
      {},
    );
    expect(errors).toEqual([]);
    expect(proposal!.changes[0]).toEqual({
      trackUri: A, addTagIds: ["tag_atmo", "new:late"], removeTagIds: ["tag_hype"], energy: 4,
    });
    expect(proposal!.newTags).toHaveLength(1);
  });

  it("reports unknown tags, bad values and duplicates so the model can retry", () => {
    const { proposal, errors } = parseProposal(
      {
        summary: "x",
        changes: [
          { track_uri: A, add_tags: ["tag_nope"] },
          { track_uri: B, energy: 11 },
          { track_uri: B, add_tags: ["tag_rap"] },
          { track_uri: "spotify:album:x", add_tags: ["tag_rap"] },
        ],
        new_tags: [{ ref: "dup", name: "hype", subcategory_id: "sub_mood" }],
      },
      taxonomy,
      {},
    );
    expect(proposal).toBeUndefined();
    expect(errors.join("\n")).toMatch(/unknown tag id "tag_nope"/);
    expect(errors.join("\n")).toMatch(/energy must be/);
    expect(errors.join("\n")).toMatch(/invalid track_uri/);
    expect(errors.join("\n")).toMatch(/already exists as tag_hype/);
  });
});

function proposalFor(changes: Proposal["changes"], newTags: Proposal["newTags"] = [], trackInfo = {}): Proposal {
  return { id: "p1", summary: "s", changes, newTags, trackInfo, status: "pending" };
}

describe("buildProposalUpdates / buildUndoUpdates", () => {
  it("applies accepted changes only, creates new tags, and undoes exactly", () => {
    const snap = snapshot();
    const proposal = proposalFor(
      [
        { trackUri: A, addTagIds: ["tag_atmo", "new:late"], removeTagIds: ["tag_hype"], energy: 4 },
        { trackUri: B, addTagIds: ["tag_hype"], removeTagIds: [] },
        { trackUri: C, addTagIds: ["tag_rap"], removeTagIds: [] },
      ],
      [{ ref: "late", name: "Late night", subcategoryId: "sub_mood" }],
      { [C]: { name: "New Song", artists: "Someone" } },
    );
    const result = buildProposalUpdates(proposal, snap, new Set([A, C]), 1000);

    expect(Object.keys(result.updates).sort()).toEqual([A, C]);
    const newTagId = result.createdTagIds[0];
    expect(result.taxonomy!.tagsById[newTagId]).toMatchObject({ name: "Late night", accentId: "rose" });
    expect(result.taxonomy!.subcategoriesById.sub_mood.tagIds).toContain(newTagId);
    expect(result.updates[A]!.tagIds.sort()).toEqual(["tag_atmo", "tag_rap", newTagId].sort());
    expect(result.updates[A]!.energy).toBe(4);
    expect(result.updates[C]).toMatchObject({ name: "New Song", artists: "Someone", tagIds: ["tag_rap"] });
    expect(result.before).toEqual({ [A]: snap.tracks[A], [C]: null });

    // state after apply
    const applied: TagStoreSnapshot = {
      taxonomy: result.taxonomy!,
      tracks: { ...snap.tracks, [A]: result.updates[A]!, [C]: result.updates[C]! },
    };
    const undo = buildUndoUpdates(
      {
        id: "e1", proposalId: "p1", summary: "s", appliedAt: 1, trackCount: 2,
        before: result.before, after: result.updates, createdTagIds: result.createdTagIds,
      },
      applied,
    );
    expect(undo.conflicts).toEqual([]);
    expect(undo.updates).toEqual({ [A]: snap.tracks[A], [C]: null });
    expect(undo.taxonomy!.tagsById[newTagId]).toBeUndefined();
    expect(undo.taxonomy!.subcategoriesById.sub_mood.tagIds).toEqual(["tag_hype", "tag_atmo"]);
  });

  it("removes a track whose last tag is taken away", () => {
    const snap = snapshot();
    snap.tracks[B] = t(["tag_trap"], { name: "x" });
    const result = buildProposalUpdates(
      proposalFor([{ trackUri: B, addTagIds: [], removeTagIds: ["tag_trap"] }]),
      snap,
      new Set([B]),
      1,
    );
    expect(result.updates[B]).toBeNull();
    expect(result.before[B]).toEqual(snap.tracks[B]);
  });

  it("flags undo conflicts when the track changed after applying", () => {
    const snap = snapshot();
    const undo = buildUndoUpdates(
      {
        id: "e", proposalId: "p", summary: "s", appliedAt: 1, trackCount: 1,
        before: { [A]: null }, after: { [A]: t(["tag_rap"]) }, createdTagIds: [],
      },
      snap,
    );
    expect(undo.conflicts).toEqual([A]);
  });
});

function env(overrides: Partial<ToolEnv> = {}): ToolEnv {
  const identity = (uri: string, albumName: string): TrackIdentity => ({
    uri, name: "", artists: [], durationMs: 1, explicit: true, isrc: null, albumName,
    albumUri: "spotify:album:alb", albumKind: "album", canonicalUri: null, releaseYear: 2024,
    source: "metadata", fetchedAt: 0,
  });
  return {
    snapshot: async () => snapshot(),
    identities: async (uris) => new Map(uris.map((u) => [u, identity(u, u === A ? "Demons Protected By Angels" : "Mr. Morale")])),
    albumTracks: async () => ({
      name: "Demons Protected By Angels", artists: "NAV",
      tracks: [{ uri: A, name: "Destiny", artists: "NAV" }, { uri: C, name: "Weirdo", artists: "NAV" }],
    }),
    playlistTracks: async () => ({ name: "ALL RAP", tracks: [{ uri: A, name: "Destiny", artists: "NAV" }] }),
    smartPlaylists: () => [{
      playlistId: "allrap", playlistName: "ALL RAP", isActive: true, createdAt: 0, lastSyncAt: 0,
      smartPlaylistTrackUris: [A],
      criteria: {
        includeTagClauses: [{ tagIds: ["tag_rap"], excludedTagIds: [], operator: "AND" }],
        clauseConnectors: [], ratingFilters: [], energyMinFilter: null, energyMaxFilter: null,
        bpmMinFilter: null, bpmMaxFilter: null,
      },
    }],
    ...overrides,
  };
}

const newState = (): ToolState & { proposals: Proposal[] } => {
  const proposals: Proposal[] = [];
  return { seen: {}, onProposal: (p) => proposals.push(p), proposals };
};

describe("executeTool", () => {
  it("searches by tags, text and album", async () => {
    const state = newState();
    const byTag: any = await executeTool("search_tagged_tracks", JSON.stringify({ has_all_tags: ["tag_trap"] }), env(), state);
    expect(byTag.tracks.map((x: any) => x.uri)).toEqual([B]);
    const byAlbum: any = await executeTool("search_tagged_tracks", JSON.stringify({ album: "demons" }), env(), state);
    expect(byAlbum.tracks).toEqual([
      { uri: A, name: "Destiny", artists: "NAV", album: "Demons Protected By Angels", tagged: true, tags: ["tag_rap", "tag_hype"], energy: 7 },
    ]);
    const lacks: any = await executeTool("search_tagged_tracks", JSON.stringify({ text: "nav", lacks_tags: ["tag_hype"] }), env(), state);
    expect(lacks.total).toBe(0);
  });

  it("lists album tracks including untagged ones and remembers their names", async () => {
    const state = newState();
    const result: any = await executeTool("get_album_tracks", JSON.stringify({ album_uri: "spotify:album:alb" }), env(), state);
    expect(result.tracks.map((x: any) => [x.uri, x.tagged])).toEqual([[A, true], [C, false]]);
    expect(state.seen[C]).toEqual({ name: "Weirdo", artists: "NAV" });
  });

  it("returns the smart playlist rule with playlist tracks", async () => {
    const result: any = await executeTool("get_playlist_tracks", JSON.stringify({ playlist_uri: "spotify:playlist:allrap" }), env(), newState());
    expect(result.smart_playlist_rule).toBe("Rap");
  });

  it("stages proposals and returns validation errors", async () => {
    const state = newState();
    const bad: any = await executeTool("propose_changes", JSON.stringify({ summary: "x", changes: [{ track_uri: A, add_tags: ["nope"] }] }), env(), state);
    expect(bad.error).toBeTruthy();
    const ok: any = await executeTool("propose_changes", JSON.stringify({ summary: "x", changes: [{ track_uri: A, remove_tags: ["tag_hype"] }] }), env(), state);
    expect(ok.status).toBe("staged_for_review");
    expect(state.proposals).toHaveLength(1);
  });

  it("handles invalid JSON arguments", async () => {
    expect(await executeTool("get_tracks", "{nope", env(), newState())).toEqual({ error: "Arguments were not valid JSON" });
  });
});

describe("runAgent", () => {
  it("loops through tool calls, keeps reasoning_details and stops on plain text", async () => {
    const reasoning = [{ type: "reasoning.encrypted", data: "opaque" }];
    const script: CompletionResult[] = [
      {
        message: {
          role: "assistant",
          content: null,
          reasoning_details: reasoning,
          tool_calls: [
            { id: "c1", type: "function", function: { name: "get_playlist_tracks", arguments: JSON.stringify({ playlist_uri: "spotify:playlist:allrap" }) } },
            { id: "c2", type: "function", function: { name: "get_tracks", arguments: JSON.stringify({ uris: [A] }) } },
          ],
        },
        finishReason: "tool_calls",
        usage: { promptTokens: 100, completionTokens: 10, cost: 0.01 },
      },
      {
        message: {
          role: "assistant",
          content: "Staging it.",
          tool_calls: [
            { id: "c3", type: "function", function: { name: "propose_changes", arguments: JSON.stringify({ summary: "Not hype", changes: [{ track_uri: A, remove_tags: ["tag_hype"], add_tags: ["tag_atmo"] }] }) } },
          ],
        },
        finishReason: "tool_calls",
        usage: { promptTokens: 200, completionTokens: 20, cost: 0.02 },
      },
      {
        message: { role: "assistant", content: "Ready to review: Destiny loses Hype, gains Atmospheric." },
        finishReason: "stop",
        usage: { promptTokens: 300, completionTokens: 30, cost: 0.03 },
      },
    ];
    const seenRequests: ChatMessage[][] = [];
    const complete = vi.fn(async (_s: unknown, messages: ChatMessage[]) => {
      seenRequests.push(JSON.parse(JSON.stringify(messages)));
      return script.shift()!;
    });
    const state = newState();
    const events: any[] = [];
    const messages = await runAgent({
      settings: { apiKey: "k", model: "m", effort: "high" },
      messages: [{ role: "system", content: "sys" }, { role: "user", content: "Destiny doesn't belong in ALL RAP's hype set" }],
      env: env(),
      state,
      onEvent: (e) => events.push(e),
      complete: complete as any,
    });

    expect(complete).toHaveBeenCalledTimes(3);
    // second request carries the first assistant turn unmodified, then both tool results
    expect(seenRequests[1][2].reasoning_details).toEqual(reasoning);
    expect(seenRequests[1].slice(3).map((m) => [m.role, m.tool_call_id])).toEqual([["tool", "c1"], ["tool", "c2"]]);
    expect(state.proposals).toHaveLength(1);
    expect(events.filter((e) => e.type === "tool_call").map((e) => e.name)).toEqual([
      "get_playlist_tracks", "get_tracks", "propose_changes",
    ]);
    expect(events.filter((e) => e.type === "assistant_text").map((e) => e.text)).toEqual([
      "Staging it.", "Ready to review: Destiny loses Hype, gains Atmospheric.",
    ]);
    expect(messages.at(-1)!.content).toMatch(/Ready to review/);
  });
});
