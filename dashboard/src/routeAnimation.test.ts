import { describe, expect, it } from "vitest";

import { mergeTimelapseAnimation, resolveRouteAnimationFrame } from "./routeAnimation";

describe("timelapse route animation", () => {
  it("keeps total jump duration independent of route hop count", () => {
    const timing = { jumpDurationSeconds: 2, fadeDurationSeconds: 1 };
    expect(resolveRouteAnimationFrame(1, 1, timing).segmentProgress).toBe(0.5);
    expect(resolveRouteAnimationFrame(1, 40, timing).segmentProgress).toBe(20);
    expect(resolveRouteAnimationFrame(2, 40, timing).segmentProgress).toBe(40);
  });

  it("keeps the completed route alive for the configured fade", () => {
    const timing = { jumpDurationSeconds: 1, fadeDurationSeconds: 2 };
    expect(resolveRouteAnimationFrame(1, 4, timing)).toMatchObject({
      lineOpacity: 0.38,
      visible: true,
      complete: false,
    });
    expect(resolveRouteAnimationFrame(2, 4, timing)).toMatchObject({
      lineOpacity: 0.19,
      visible: true,
      complete: false,
    });
    expect(resolveRouteAnimationFrame(3, 4, timing)).toMatchObject({
      lineOpacity: 0,
      visible: false,
      complete: true,
    });
  });

  it("clamps saved animation settings to supported ranges", () => {
    expect(mergeTimelapseAnimation({
      jumpDurationSeconds: 99,
      fadeDurationSeconds: 0.01,
    })).toEqual({ jumpDurationSeconds: 10, fadeDurationSeconds: 0.2 });
  });
});
