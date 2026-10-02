import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TagStoreSnapshot } from "../../model/ai.types";

const A = "spotify:track:aaa";
let snapshot: TagStoreSnapshot;

vi.mock("../../utils/ai.store", () => ({
  loadSnapshot: vi.fn(async () => JSON.parse(JSON.stringify(snapshot))),
  writeTrackUpdates: vi.fn(async (updates: Record<string, any>) => {
    for (const [uri, data] of Object.entries(updates)) {
      if (data) snapshot.tracks[uri] = data;
      else delete snapshot.tracks[uri];
    }
  }),
  writeTaxonomy: vi.fn(async () => undefined),
  describeUri: vi.fn(async (uri: string) => (uri.includes("playlist") ? "ALL RAP" : uri)),
  spotifyToolEnv: {
    snapshot: async () => JSON.parse(JSON.stringify(snapshot)),
    identities: async (uris: string[]) => new Map(uris.map((u) => [u, { uri: u, name: "Destiny", artists: ["NAV"], albumName: "DPBA" }])),
    albumTracks: async () => null,
    playlistTracks: async () => ({ name: "ALL RAP", tracks: [{ uri: A, name: "Destiny", artists: "NAV" }] }),
    smartPlaylists: () => [],
  },
}));

const script: any[] = [];
vi.mock("../../utils/ai.openrouter", () => ({
  chatCompletion: vi.fn(async () => script.shift()),
}));

import AiPanel from "../AiPanel";
import * as store from "../../utils/ai.store";
import { chatCompletion } from "../../utils/ai.openrouter";

function freshSnapshot(): TagStoreSnapshot {
  return {
    taxonomy: {
      categoryOrder: ["cat_v"],
      categoriesById: { cat_v: { id: "cat_v", name: "Vibe", subcategoryIds: ["sub_m"] } },
      subcategoriesById: { sub_m: { id: "sub_m", name: "Mood", categoryId: "cat_v", tagIds: ["tag_hype", "tag_atmo"] } },
      tagsById: {
        tag_hype: { id: "tag_hype", name: "Hype", subcategoryId: "sub_m", accentId: "rose" },
        tag_atmo: { id: "tag_atmo", name: "Atmospheric", subcategoryId: "sub_m", accentId: "rose" },
      },
      customAccentsById: {},
      colorThemesById: {},
      colorThemeOrder: [],
      ungroupedColorIds: [],
    },
    tracks: { [A]: { rating: 0, energy: 8, bpm: null, tagIds: ["tag_hype"], name: "Destiny", artists: "NAV" } },
  };
}

describe("AiPanel", () => {
  beforeEach(() => {
    snapshot = freshSnapshot();
    localStorage.clear();
    vi.clearAllMocks();
    (globalThis as any).Spicetify.showNotification = vi.fn();
  });

  it("asks for an API key first", async () => {
    render(<AiPanel context={{ kind: "general", uris: [] }} onClose={() => undefined} />);
    expect(screen.getByText("OpenRouter API key")).toBeTruthy();
  });

  it("runs a request, applies the staged change and undoes it", async () => {
    localStorage.setItem("tagify:ai:settings", JSON.stringify({ apiKey: "sk-or-test" }));
    script.push(
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "c1", type: "function",
            function: { name: "propose_changes", arguments: JSON.stringify({ summary: "Destiny is mellow, not hype", changes: [{ track_uri: A, remove_tags: ["tag_hype"], add_tags: ["tag_atmo"], energy: 4 }] }) },
          }],
        },
        finishReason: "tool_calls",
        usage: { promptTokens: 1000, completionTokens: 100, cost: 0.012 },
      },
      {
        message: { role: "assistant", content: "Ready to review." },
        finishReason: "stop",
        usage: { promptTokens: 1200, completionTokens: 20, cost: 0.006 },
      },
    );

    render(<AiPanel context={{ kind: "track", uris: [A], contextUri: "spotify:playlist:allrap" }} onClose={() => undefined} />);
    const box = await screen.findByPlaceholderText("Describe the change…");
    await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(box, { target: { value: "this doesn't belong here, too slow" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });

    await screen.findByText("Ready to review.");
    // the first user turn carries the right-click context
    const firstCall = (chatCompletion as any).mock.calls[0][1];
    expect(firstCall[1].content).toMatch(/right-clicked inside "ALL RAP"/);
    expect(firstCall[1].content).toMatch(/this doesn't belong here, too slow/);

    expect(screen.getByText("Destiny is mellow, not hype")).toBeTruthy();
    expect(screen.getByText("− Hype")).toBeTruthy();
    expect(screen.getByText("+ Atmospheric")).toBeTruthy();
    expect(screen.getByText(/\$0\.018 this chat/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText("Apply 1 change"));
    });
    await screen.findByText("Applied");
    expect(store.writeTrackUpdates).toHaveBeenCalledWith({
      [A]: expect.objectContaining({ tagIds: ["tag_atmo"], energy: 4 }),
    });
    expect(snapshot.tracks[A].tagIds).toEqual(["tag_atmo"]);

    await act(async () => {
      fireEvent.click(screen.getByText("Undo"));
    });
    await screen.findByText("Undone");
    expect(snapshot.tracks[A]).toMatchObject({ tagIds: ["tag_hype"], energy: 8 });
  });
});
