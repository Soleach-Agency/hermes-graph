import type { SceneEdge, SceneNode } from "./types";

export const ACTIVITY_EDGE_KINDS = new Set([
  "called",
  "delegated",
  "retrieved",
  "returned",
]);

export const STRUCTURAL_EDGE_KINDS = new Set([
  "assigned_to",
  "belongs_to",
  "blocked_by",
  "depends_on",
  "parent_session",
  "spawned",
  "works_on",
]);

export function isPersistentEdge(
  edge: SceneEdge,
  nodesById: Map<string, SceneNode>,
): boolean {
  if (edge.active === false) return false;
  const source = nodesById.get(edge.source);
  const target = nodesById.get(edge.target);
  if (!source || !target) return false;
  if (edge.kind === "references") {
    return source.kind === "note" && target.kind === "note";
  }
  return STRUCTURAL_EDGE_KINDS.has(edge.kind);
}

export function isActivityEdge(edge: SceneEdge): boolean {
  return edge.active !== false && ACTIVITY_EDGE_KINDS.has(edge.kind);
}
