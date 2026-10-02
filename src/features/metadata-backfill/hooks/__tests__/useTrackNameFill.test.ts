import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { TrackData } from "@/types/tagData";
import { fetchTrackNames, mergeTrackNames, needsTrackName } from "@/utils/trackNames";
import { useTrackNameFill } from "../useTrackNameFill";

const { mockSpotifyService } = vi.hoisted(() => ({
  mockSpotifyService: { getBatchTracks: vi.fn() },
}));

vi.mock("@/services/SpotifyService", () => ({
  spotifyService: mockSpotifyService,
}));

const A = "spotify:track:aaa";
const B = "spotify:track:bbb";
const LOCAL = "spotify:local:artist:album:title:200";

function track(extra: Partial<TrackData> = {}): TrackData {
  return { rating: 0, energy: 0, bpm: null, tagIds: ["tag_rap"], ...extra } as TrackData;
}

describe("trackNames", () => {
  it("flags Spotify tracks missing a name or artist", () => {
    expect(needsTrackName(A, track())).toBe(true);
    expect(needsTrackName(A, track({ name: "Fomo" }))).toBe(true);
    expect(needsTrackName(A, track({ name: "Fomo", artists: "Drake" }))).toBe(false);
    expect(needsTrackName(LOCAL, track())).toBe(false);
    expect(needsTrackName(A, undefined)).toBe(false);
  });

  it("fills only missing fields and keeps the object when nothing changes", () => {
    const tracks = { [A]: track({ name: "Kept" }), [B]: track({ name: "Done", artists: "X" }) };
    const result = mergeTrackNames(tracks, {
      [A]: { name: "Other", artists: "Drake" },
      [B]: { name: "Ignored", artists: "Ignored" },
    });
    expect(result.changed).toEqual([A]);
    expect(result.tracks[A]).toMatchObject({ name: "Kept", artists: "Drake", tagIds: ["tag_rap"] });
    expect(result.tracks[B]).toBe(tracks[B]);

    const unchanged = mergeTrackNames(result.tracks, { [A]: { name: "x", artists: "y" } });
    expect(unchanged.tracks).toBe(result.tracks);
  });

  it("drops lookups without a usable name", async () => {
    mockSpotifyService.getBatchTracks.mockResolvedValueOnce({
      [A]: { name: "Fomo", artists: "Drake" },
      [B]: { name: "", artists: "" },
    });
    expect(await fetchTrackNames([A, B])).toEqual({ [A]: { name: "Fomo", artists: "Drake" } });
  });
});

describe("useTrackNameFill", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSpotifyService.getBatchTracks.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("looks up nameless tracks and applies the names", async () => {
    mockSpotifyService.getBatchTracks.mockResolvedValue({ [A]: { name: "Fomo", artists: "Drake" } });
    const applyNames = vi.fn();
    renderHook(() =>
      useTrackNameFill({
        tracks: { [A]: track(), [B]: track({ name: "Named", artists: "Y" }) },
        enabled: true,
        applyNames,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(mockSpotifyService.getBatchTracks).toHaveBeenCalledWith([A]);
    expect(applyNames).toHaveBeenCalledWith({ [A]: { name: "Fomo", artists: "Drake" } });
  });

  it("gives up on a track after three failed lookups", async () => {
    mockSpotifyService.getBatchTracks.mockResolvedValue({});
    const applyNames = vi.fn();
    const { rerender } = renderHook(
      ({ tracks }) => useTrackNameFill({ tracks, enabled: true, applyNames }),
      { initialProps: { tracks: { [A]: track() } } },
    );

    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      rerender({ tracks: { [A]: track() } });
    }
    expect(mockSpotifyService.getBatchTracks).toHaveBeenCalledTimes(3);
    expect(applyNames).not.toHaveBeenCalled();
  });

  it("does nothing while disabled", async () => {
    const applyNames = vi.fn();
    renderHook(() => useTrackNameFill({ tracks: { [A]: track() }, enabled: false, applyNames }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(mockSpotifyService.getBatchTracks).not.toHaveBeenCalled();
  });
});
