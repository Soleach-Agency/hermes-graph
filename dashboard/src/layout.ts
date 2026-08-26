import type { SceneEdge, SceneNode } from "./types";

export type Position = [number, number, number];

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function randomFrom(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function direction(seed: number): Position {
  const y = randomFrom(seed + 11) * 2 - 1;
  const angle = randomFrom(seed + 29) * Math.PI * 2;
  const radial = Math.sqrt(Math.max(0, 1 - y * y));
  return [Math.cos(angle) * radial, y, Math.sin(angle) * radial];
}

function scale([x, y, z]: Position, amount: number): Position {
  return [x * amount, y * amount, z * amount];
}

function offset(base: Position, seed: number, distance: number): Position {
  const [x, y, z] = scale(direction(seed), distance);
  return [base[0] + x, base[1] + y, base[2] + z];
}

function average(positions: Position[]): Position | null {
  if (!positions.length) return null;
  const total = positions.reduce(
    (sum, current) => [sum[0] + current[0], sum[1] + current[1], sum[2] + current[2]],
    [0, 0, 0] as Position,
  );
  return [total[0] / positions.length, total[1] / positions.length, total[2] / positions.length];
}

function clampRadius(position: Position, minimum: number, seed: number): Position {
  const radius = Math.hypot(position[0], position[1], position[2]);
  if (radius >= minimum) return position;
  if (radius < 0.001) return scale(direction(seed), minimum);
  return scale(position, minimum / radius);
}

interface LayoutOptions {
  vaultRadius: number;
  runtimeOrbitRadius: number;
  previousPositions?: Map<string, Position>;
}

function mostOpenPosition(
  id: string,
  radius: number,
  occupied: Position[],
): Position {
  const seed = hash(id);
  let best = scale(direction(seed), radius);
  let bestClearance = -1;
  for (let candidateIndex = 0; candidateIndex < 32; candidateIndex += 1) {
    const candidateRadius = radius + (randomFrom(seed + candidateIndex * 97) - 0.5) * 28;
    const candidate = scale(direction(seed + candidateIndex * 7919), candidateRadius);
    const clearance = occupied.length
      ? Math.min(
          ...occupied.map((position) => {
            const x = position[0] - candidate[0];
            const y = position[1] - candidate[1];
            const z = position[2] - candidate[2];
            return x * x + y * y + z * z;
          }),
        )
      : Number.POSITIVE_INFINITY;
    if (clearance > bestClearance) {
      best = candidate;
      bestClearance = clearance;
    }
  }
  return best;
}

export function computeSpatialLayout(
  nodes: SceneNode[],
  edges: SceneEdge[],
  options: LayoutOptions,
): Map<string, Position> {
  const positions = new Map<string, Position>();
  const previousPositions = options.previousPositions;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const neighbors = new Map<string, Array<{ node: SceneNode; edge: SceneEdge }>>();

  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target || edge.active === false) continue;
    neighbors.set(source.id, [...(neighbors.get(source.id) || []), { node: target, edge }]);
    neighbors.set(target.id, [...(neighbors.get(target.id) || []), { node: source, edge }]);
  }

  const notes = nodes.filter((node) => node.kind === "note");
  const noteDegrees = new Map<string, number>();
  let maxDegree = 1;
  for (const note of notes) {
    const degree = (neighbors.get(note.id) || []).filter(({ node }) => node.kind === "note").length;
    noteDegrees.set(note.id, degree);
    maxDegree = Math.max(maxDegree, degree);
  }

  for (const note of notes) {
    if (note.position) {
      positions.set(note.id, note.position);
      continue;
    }
    const seed = hash(note.id);
    const degree = noteDegrees.get(note.id) || 0;
    const centrality = Math.log1p(degree) / Math.log1p(maxDegree);
    const outerBias = Math.pow(1 - centrality, 0.72);
    const radius =
      12 + outerBias * (options.vaultRadius - 12) * (0.82 + randomFrom(seed + 43) * 0.18);
    positions.set(note.id, scale(direction(seed), radius));
  }

  const anchors = nodes.filter((node) => node.kind === "session" || node.kind === "task");
  const occupiedRuntime: Position[] = nodes
    .filter((node) => node.kind !== "note")
    .map((node) => previousPositions?.get(node.id))
    .filter((position): position is Position => Boolean(position));
  anchors.forEach((node) => {
    if (node.position) {
      positions.set(node.id, node.position);
      occupiedRuntime.push(node.position);
      return;
    }
    const previous = previousPositions?.get(node.id);
    if (previous) {
      positions.set(node.id, previous);
      return;
    }
    const seed = hash(node.id);
    const radius =
      options.runtimeOrbitRadius +
      (node.kind === "task" ? 22 : 0) +
      (randomFrom(seed + 73) - 0.5) * 34;
    const position = mostOpenPosition(node.id, radius, occupiedRuntime);
    positions.set(node.id, position);
    occupiedRuntime.push(position);
  });

  const agents = nodes.filter((node) => node.kind === "agent");
  agents.forEach((node, index) => {
    if (node.position) {
      positions.set(node.id, node.position);
      return;
    }
    const previous = previousPositions?.get(node.id);
    if (previous) {
      positions.set(node.id, previous);
      return;
    }
    const relatedAnchors = (neighbors.get(node.id) || [])
      .filter(({ node: related }) => related.kind === "session" || related.kind === "task")
      .map(({ node: related }) => positions.get(related.id))
      .filter((position): position is Position => Boolean(position));
    const owner = average(relatedAnchors);
    const fallback = mostOpenPosition(
      node.id,
      options.runtimeOrbitRadius + 38 + (index % 5) * 4,
      occupiedRuntime,
    );
    const position = offset(owner || fallback, hash(node.id) + 101, owner ? 34 : 0);
    positions.set(node.id, position);
    occupiedRuntime.push(position);
  });

  const subagents = nodes.filter(
    (node) =>
      node.kind === "subagent" ||
      (node.kind === "agent" &&
        (neighbors.get(node.id) || []).some(({ edge }) => edge.kind === "spawned")),
  );
  for (const node of subagents) {
    const previous = previousPositions?.get(node.id);
    if (previous) {
      positions.set(node.id, previous);
      continue;
    }
    const parentRelation = (neighbors.get(node.id) || []).find(
      ({ edge, node: related }) =>
        edge.kind === "spawned" && edge.target === node.id && related.id !== node.id,
    );
    const owner = parentRelation ? positions.get(parentRelation.node.id) : undefined;
    if (owner) {
      positions.set(node.id, offset(owner, hash(node.id) + 211, 18 + randomFrom(hash(node.id)) * 15));
    }
  }

  const satellites = nodes
    .filter((node) =>
      ["tool", "artifact", "skill", "result", "search", "external"].includes(node.kind),
    )
    // Snapshot order is not a layout contract. Resolve tools before the
    // transient result nodes that use them as spatial anchors.
    .sort((left, right) => {
      const priority = (node: SceneNode) =>
        node.kind === "tool" ? 0 : node.kind === "result" ? 2 : 1;
      return priority(left) - priority(right);
    });
  for (const node of satellites) {
    if (node.position) {
      positions.set(node.id, node.position);
      continue;
    }
    const previous = previousPositions?.get(node.id);
    const metadataOwnerId =
      node.kind === "tool" && typeof node.metadata?.owner === "string"
        ? node.metadata.owner
        : typeof node.metadata?.tool === "string"
          ? node.metadata.tool
          : undefined;
    const metadataOwner = metadataOwnerId
      ? positions.get(metadataOwnerId)
      : undefined;
    const relatedPositions = (neighbors.get(node.id) || [])
      .filter(({ node: related, edge }) => {
        if (related.kind === "note") return false;
        if (node.kind === "tool") return edge.kind === "called";
        if (node.kind === "result") return edge.kind === "returned";
        return ["produced", "authored", "called", "returned", "belongs_to"].includes(
          edge.kind,
        );
      })
      .map(({ node: related }) => positions.get(related.id))
      .filter((position): position is Position => Boolean(position));
    const owner = metadataOwner || average(relatedPositions);
    if (previous && (!owner || node.kind !== "result")) {
      positions.set(node.id, previous);
      continue;
    }
    const base = owner || scale(direction(hash(node.id)), options.runtimeOrbitRadius + 70);
    const distance = node.kind === "result" ? 11 : node.kind === "tool" ? 22 : 28;
    const candidate = offset(base, hash(node.id) + 307, distance);
    // Results belong to the request that produced them. Recompute this small
    // cluster from the tool so a stale fallback position cannot strand a
    // temporary node on the other side of the graph.
    positions.set(
      node.id,
      node.kind === "result"
        ? clampRadius(candidate, options.vaultRadius + 42, hash(node.id) + 911)
        : candidate,
    );
  }

  nodes.forEach((node, index) => {
    if (!positions.has(node.id)) {
      positions.set(
        node.id,
        scale(direction(hash(node.id) + index), options.runtimeOrbitRadius + 75),
      );
    }
  });

  // Runtime entities are never allowed to drift into the knowledge sphere.
  // Retrieval edges may cross the boundary, but their tool endpoint stays outside.
  const runtimeBoundary = options.vaultRadius + 42;
  for (const node of nodes) {
    if (node.kind === "note") continue;
    const position = positions.get(node.id);
    if (!position) continue;
    positions.set(
      node.id,
      clampRadius(position, runtimeBoundary, hash(node.id) + 911),
    );
  }

  return positions;
}
