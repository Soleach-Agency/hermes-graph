import { describe, expect, it } from "vitest";

import { computeSpatialLayout } from "./layout";
import type { SceneEdge, SceneNode } from "./types";


describe("runtime layout boundary", () => {
  it("keeps agents, tools, skills, and artifacts outside the vault sphere", () => {
    const nodes: SceneNode[] = [
      { id: "note:1", kind: "note", label: "Note", position: [0, 0, 0] },
      { id: "session:1", kind: "session", label: "Session" },
      { id: "agent:1", kind: "agent", label: "Agent", position: [10, 0, 0] },
      { id: "tool:1", kind: "tool", label: "RAG", position: [20, 0, 0] },
      { id: "skill:1", kind: "skill", label: "Skill", position: [0, 5, 0] },
      { id: "artifact:1", kind: "artifact", label: "Artifact", position: [0, 0, 0] },
    ];
    const edges: SceneEdge[] = [
      { id: "belongs", source: "agent:1", target: "session:1", kind: "belongs_to" },
      { id: "called", source: "agent:1", target: "tool:1", kind: "called" },
      { id: "retrieved", source: "tool:1", target: "note:1", kind: "retrieved" },
      { id: "authored", source: "agent:1", target: "skill:1", kind: "authored" },
      { id: "produced", source: "agent:1", target: "artifact:1", kind: "produced" },
    ];

    const positions = computeSpatialLayout(nodes, edges, {
      vaultRadius: 155,
      runtimeOrbitRadius: 255,
    });

    for (const node of nodes.filter((candidate) => candidate.kind !== "note")) {
      const position = positions.get(node.id)!;
      expect(Math.hypot(...position)).toBeGreaterThanOrEqual(196.999);
    }
  });

  it("keeps existing runtime nodes fixed when a new task takes an open position", () => {
    const initialNodes: SceneNode[] = [
      { id: "session:1", kind: "session", label: "Session" },
      { id: "task:1", kind: "task", label: "First task" },
      { id: "agent:1", kind: "agent", label: "Agent" },
    ];
    const edges: SceneEdge[] = [
      { id: "belongs", source: "agent:1", target: "session:1", kind: "belongs_to" },
      { id: "assigned", source: "task:1", target: "agent:1", kind: "assigned_to" },
    ];
    const initial = computeSpatialLayout(initialNodes, edges, {
      vaultRadius: 155,
      runtimeOrbitRadius: 255,
    });
    const nextNodes = [
      ...initialNodes,
      { id: "task:2", kind: "task", label: "New task" } satisfies SceneNode,
    ];
    const next = computeSpatialLayout(nextNodes, edges, {
      vaultRadius: 155,
      runtimeOrbitRadius: 255,
      previousPositions: initial,
    });

    for (const node of initialNodes) {
      expect(next.get(node.id)).toEqual(initial.get(node.id));
    }
    expect(next.get("task:2")).toBeDefined();
    expect(next.get("task:2")).not.toEqual(initial.get("task:1"));
  });

  it("keeps a tool beside its metadata owner after the called edge expires", () => {
    const nodes: SceneNode[] = [
      { id: "session:1", kind: "session", label: "Session" },
      { id: "agent:1", kind: "agent", label: "Agent" },
      {
        id: "tool:1",
        kind: "tool",
        label: "terminal",
        metadata: { owner: "agent:1" },
      },
    ];
    const positions = computeSpatialLayout(
      nodes,
      [{ id: "belongs", source: "agent:1", target: "session:1", kind: "belongs_to" }],
      { vaultRadius: 155, runtimeOrbitRadius: 255 },
    );
    const agent = positions.get("agent:1")!;
    const tool = positions.get("tool:1")!;
    expect(Math.hypot(tool[0] - agent[0], tool[1] - agent[1], tool[2] - agent[2]))
      .toBeCloseTo(22, 5);
  });

  it("keeps external results beside their source tool regardless of snapshot order", () => {
    const nodes: SceneNode[] = [
      {
        id: "result:1",
        kind: "result",
        label: "File search result",
        metadata: { tool: "tool:1" },
      },
      { id: "session:1", kind: "session", label: "Session" },
      { id: "agent:1", kind: "agent", label: "Agent" },
      {
        id: "tool:1",
        kind: "tool",
        label: "file_search",
        metadata: { owner: "agent:1", direction: "external" },
      },
    ];
    const positions = computeSpatialLayout(
      nodes,
      [{ id: "belongs", source: "agent:1", target: "session:1", kind: "belongs_to" }],
      { vaultRadius: 155, runtimeOrbitRadius: 255 },
    );
    const tool = positions.get("tool:1")!;
    const result = positions.get("result:1")!;

    expect(Math.hypot(result[0] - tool[0], result[1] - tool[1], result[2] - tool[2]))
      .toBeCloseTo(11, 5);
  });

  it("pulls a result back to its tool when an earlier fallback placed it far away", () => {
    const nodes: SceneNode[] = [
      { id: "session:1", kind: "session", label: "Session" },
      { id: "agent:1", kind: "agent", label: "Agent" },
      {
        id: "tool:1",
        kind: "tool",
        label: "file_search",
        metadata: { owner: "agent:1", direction: "external" },
      },
      {
        id: "result:1",
        kind: "result",
        label: "File search result",
        metadata: { tool: "tool:1" },
      },
    ];
    const first = computeSpatialLayout(nodes, [], {
      vaultRadius: 155,
      runtimeOrbitRadius: 255,
    });
    const previousPositions = new Map(first);
    previousPositions.set("result:1", [-320, 40, 15]);
    const next = computeSpatialLayout(nodes, [], {
      vaultRadius: 155,
      runtimeOrbitRadius: 255,
      previousPositions,
    });
    const tool = next.get("tool:1")!;
    const result = next.get("result:1")!;

    expect(Math.hypot(result[0] - tool[0], result[1] - tool[1], result[2] - tool[2]))
      .toBeCloseTo(11, 5);
  });
});
