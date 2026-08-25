import { describe, expect, it } from "vitest";

import { resolveLifecycleVisuals } from "./lifecycle";

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
});
