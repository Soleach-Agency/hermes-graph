import { describe, expect, it } from "vitest";

import { resolveLifecycleVisuals, resolveNodeAnimationFrame } from "./lifecycle";

describe("completed lifecycle visuals", () => {
  it("fades tools before their completed session and agent", () => {
    const visuals = resolveLifecycleVisuals(
      [
        { id: "session", kind: "session", label: "Session", status: "completed", metadata: { completedAt: 100 } },
        { id: "agent", kind: "agent", label: "Agent", status: "active" },
        { id: "tool", kind: "tool", label: "Tool", metadata: { owner: "agent" } },
      ],
      [{ id: "belongs", source: "agent", target: "session", kind: "belongs_to" }],
      130,
      100,
    );

    expect(visuals.get("tool")).toMatchObject({ age: 30, duration: 30, role: "tool" });
    expect(visuals.get("agent")).toMatchObject({ age: 10, duration: 80, role: "owner" });
    expect(visuals.get("session")).toMatchObject({ age: 10, duration: 80, role: "owner" });
  });

  it("does not retire a shared assignee from assigned_to alone", () => {
    const visuals = resolveLifecycleVisuals(
      [
        { id: "task", kind: "task", label: "Done", status: "done", metadata: { completedAt: 100 } },
        { id: "profile", kind: "agent", label: "Luna", status: "active" },
      ],
      [{ id: "assigned", source: "task", target: "profile", kind: "assigned_to" }],
      150,
      100,
    );

    expect(visuals.has("task")).toBe(true);
    expect(visuals.has("profile")).toBe(false);
  });

  it("interrupts an unfinished birth and fades from the reached size", () => {
    const beforeFade = resolveNodeAnimationFrame(0.5, 1);
    const fadeStart = resolveNodeAnimationFrame(0.5, 1, 0, 2);
    const halfwayOut = resolveNodeAnimationFrame(1.5, 1, 1, 2);
    const gone = resolveNodeAnimationFrame(2.5, 1, 2, 2);

    expect(beforeFade.scaleProgress).toBeCloseTo(0.5, 5);
    expect(fadeStart.scaleProgress).toBeCloseTo(beforeFade.scaleProgress, 5);
    expect(halfwayOut.scaleProgress).toBeCloseTo(0.25, 5);
    expect(gone).toEqual({ scaleProgress: 0, visibility: 0 });
  });
});
