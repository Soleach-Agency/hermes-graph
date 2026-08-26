import type { SceneEdge, SceneNode } from "./types";

export const ACTIVITY_EDGE_KINDS = new Set(["called", "retrieved", "returned"]);

export function isPersistentVaultEdge(
  edge: SceneEdge,
  nodesById: Map<string, SceneNode>,
): boolean {
  if (edge.active === false || edge.kind !== "references") return false;
  return (
    nodesById.get(edge.source)?.kind === "note" &&
    nodesById.get(edge.target)?.kind === "note"
  );
}

export function isActivityEdge(edge: SceneEdge): boolean {
  return edge.active !== false && ACTIVITY_EDGE_KINDS.has(edge.kind);
}
