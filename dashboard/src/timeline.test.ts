import { describe, expect, it } from "vitest";

import { interpolatePlaybackCursor } from "./timeline";

describe("timeline playback", () => {
  it("starts at the selected window boundary and advances monotonically", () => {
    const samples = [0, 100, 1_000, 12_000, 23_900, 24_000].map((elapsed) =>
      interpolatePlaybackCursor(41_760, 43_200, elapsed, 24_000),
    );

    expect(samples[0]).toBe(41_760);
    expect(samples.at(-1)).toBe(43_200);
    expect(samples).toEqual([...samples].sort((left, right) => left - right));
  });

  it("clamps time outside the playback interval", () => {
    expect(interpolatePlaybackCursor(10, 20, -500, 1_000)).toBe(10);
    expect(interpolatePlaybackCursor(10, 20, 2_000, 1_000)).toBe(20);
  });
});
