import { describe, expect, it } from "vitest";

import { isActivityEdge, isPersistentVaultEdge } from "./edgePolicy";
import type { SceneEdge, SceneNode } from "./types";

const nodes = new Map<string, SceneNode>([
  ["note:a", { id: "note:a", kind: "note", label: "A" }],
  ["note:b", { id: "note:b", kind: "note", label: "B" }],
  ["agent", { id: "agent", kind: "agent", label: "Agent" }],
  ["task", { id: "task", kind: "task", label: "Task" }],
  ["tool", { id: "tool", kind: "tool", label: "Tool" }],
]);

const edge = (kind: string, source: string, target: string): SceneEdge => ({
  id: `${kind}:${source}:${target}`,
  kind,
  source,
  target,
  active: true,
});

describe("edge rendering policy", () => {
  it("keeps only real Vault note links persistent", () => {
    expect(isPersistentVaultEdge(edge("references", "note:a", "note:b"), nodes)).toBe(true);
    expect(isPersistentVaultEdge(edge("belongs_to", "agent", "task"), nodes)).toBe(false);
    expect(isPersistentVaultEdge(edge("depends_on", "task", "agent"), nodes)).toBe(false);
    expect(isPersistentVaultEdge(edge("references", "agent", "note:a"), nodes)).toBe(false);
  });

  it("keeps cross-boundary and runtime activity on jump styling", () => {
    expect(isActivityEdge(edge("called", "agent", "tool"))).toBe(true);
    expect(isActivityEdge(edge("retrieved", "tool", "note:a"))).toBe(true);
    expect(isActivityEdge(edge("returned", "tool", "note:a"))).toBe(true);
    expect(isActivityEdge(edge("assigned_to", "task", "agent"))).toBe(false);
  });
});
