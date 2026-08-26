import type { SceneEdge, SceneNode } from "./types";

export interface LifecycleVisual {
  age: number;
  duration: number;
  role: "tool" | "owner";
}

const COMPLETED_STATUSES = new Set(["done", "completed", "stopped", "reset"]);
const OWNER_EDGE_KINDS = new Set(["belongs_to", "works_on"]);

export function smoothstepProgress(elapsed: number, duration: number): number {
  const progress = Math.max(0, Math.min(1, elapsed / Math.max(0.001, duration)));
  return progress * progress * (3 - 2 * progress);
}

export function resolveNodeAnimationFrame(
  birthAge: number,
  birthDuration: number,
  fadeAge = -1,
  fadeDuration = 1,
): { scaleProgress: number; visibility: number } {
  const birthProgress = smoothstepProgress(birthAge, birthDuration);
  if (fadeAge < 0) {
    return { scaleProgress: birthProgress, visibility: birthProgress };
  }
  const birthAtFade = smoothstepProgress(
    Math.max(0, birthAge - fadeAge),
    birthDuration,
  );
  const fadeProgress = smoothstepProgress(fadeAge, fadeDuration);
  return {
    scaleProgress: birthAtFade * (1 - fadeProgress),
    visibility: birthAtFade * (1 - fadeProgress),
  };
}

function completedAt(node: SceneNode): number | null {
  if (!COMPLETED_STATUSES.has(String(node.status || "").toLowerCase())) return null;
  const value = Number(node.metadata?.completedAt || 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function resolveLifecycleVisuals(
  nodes: SceneNode[],
  edges: SceneEdge[],
  asOf: number,
  fadeSeconds: number,
): Map<string, LifecycleVisual> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const completion = new Map<string, number>();
  for (const node of nodes) {
    const timestamp = completedAt(node);
    if (timestamp !== null) completion.set(node.id, timestamp);
  }

  // Runtime agents inherit their session completion; Kanban-scoped agents
  // inherit their task completion. Do not infer from assigned_to because a
  // shared profile can own more than one live card.
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (!OWNER_EDGE_KINDS.has(edge.kind) || completion.has(edge.source)) continue;
      const timestamp = completion.get(edge.target);
      const source = byId.get(edge.source);
      if (timestamp !== undefined && source && ["agent", "subagent"].includes(source.kind)) {
        completion.set(edge.source, timestamp);
        changed = true;
      }
    }
  }

  // Tools are owner-scoped in hook projection metadata, so their fade can lead
  // the owning runtime entity without depending on transient called edges.
  for (const node of nodes) {
    if (node.kind !== "tool") continue;
    const owner = String(node.metadata?.owner || "");
    const timestamp = completion.get(owner);
    if (timestamp !== undefined) completion.set(node.id, timestamp);
  }

  const safeFade = Math.max(1, fadeSeconds);
  const toolDuration = safeFade * 0.3;
  const ownerDelay = safeFade * 0.2;
  const ownerDuration = safeFade - ownerDelay;
  const visuals = new Map<string, LifecycleVisual>();
  for (const [nodeId, timestamp] of completion) {
    const node = byId.get(nodeId);
    if (!node) continue;
    const isTool = node.kind === "tool";
    visuals.set(nodeId, {
      age: asOf - timestamp - (isTool ? 0 : ownerDelay),
      duration: isTool ? toolDuration : ownerDuration,
      role: isTool ? "tool" : "owner",
    });
  }
  return visuals;
}
