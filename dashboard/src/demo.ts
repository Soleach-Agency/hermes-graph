import type { SceneEdge, SceneNode, SceneSnapshot } from "./types";

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function edge(
  edges: SceneEdge[],
  id: string,
  source: string,
  target: string,
  kind: string,
): void {
  edges.push({ id, source, target, kind, active: true });
}

export const DEMO_TIMELINE_CURSOR = 43_200; // thirty days in minute-sized cursors

export function createDemoSnapshot(
  count = 10_000,
  cursor = DEMO_TIMELINE_CURSOR,
): SceneSnapshot {
  const random = mulberry32(0x4845524d ^ count);
  const runtimeNodes: SceneNode[] = [];
  const edges: SceneEdge[] = [];
  const vaultTools: string[] = [];
  const sessionCount = Math.max(2, Math.min(8, Math.round(count / 8_000)));
  const kanbanStates = ["todo", "doing", "done", "blocked"];
  const now = Date.now() / 1000;
  const phase = Math.max(0, Math.min(1, cursor / DEMO_TIMELINE_CURSOR));

  for (let sessionIndex = 0; sessionIndex < sessionCount; sessionIndex += 1) {
    const sessionId = `session:${sessionIndex}`;
    const agentId = `agent:${sessionIndex}`;
    runtimeNodes.push({
      id: sessionId,
      kind: "session",
      label: `Session ${sessionIndex + 1}`,
      status: "active",
      metadata: { platform: sessionIndex % 2 ? "gateway" : "cli" },
    });
    runtimeNodes.push({
      id: agentId,
      kind: "agent",
      label: sessionIndex === 0 ? "Main Agent" : `Agent ${sessionIndex + 1}`,
      status: "active",
      pressure:
        0.12 +
        ((Math.sin(phase * Math.PI * 5 + sessionIndex * 1.7) + 1) / 2) * 0.82,
      metadata: { model: "Hermes 4", sessionId },
    });
    edge(edges, `belongs:${agentId}`, agentId, sessionId, "belongs_to");

    for (let taskIndex = 0; taskIndex < 4; taskIndex += 1) {
      const taskId = `task:${sessionIndex}:${taskIndex}`;
      const status =
        kanbanStates[
          (sessionIndex + taskIndex + Math.floor(phase * 5)) % kanbanStates.length
        ];
      const completedAt = status === "done" ? now - (1 + random() * 18) * 3600 : undefined;
      runtimeNodes.push({
        id: taskId,
        kind: "task",
        label: `Kanban ${sessionIndex + 1}.${taskIndex + 1}`,
        status,
        metadata: { board: "Demo Board", assignee: agentId, completedAt },
      });
      edge(edges, `assigned:${taskId}`, taskId, agentId, "assigned_to");
      if (taskIndex > 0) {
        edge(
          edges,
          `depends:${taskId}`,
          taskId,
          `task:${sessionIndex}:${taskIndex - 1}`,
          "depends_on",
        );
      }
    }

    const subagentCount = 2 + Math.floor(random() * 5);
    for (let subIndex = 0; subIndex < subagentCount; subIndex += 1) {
      const subagentId = `subagent:${sessionIndex}:${subIndex}`;
      runtimeNodes.push({
        id: subagentId,
        kind: "subagent",
        label: `Worker ${sessionIndex + 1}.${subIndex + 1}`,
        status: subIndex % 3 ? "active" : "observed",
        metadata: { role: subIndex % 2 ? "researcher" : "coder" },
      });
      edge(edges, `spawned:${subagentId}`, agentId, subagentId, "spawned");
    }

    const tools = [
      ["RAG", "vault"],
      ["Semantic Search", "vault"],
      ["Web Search", "external"],
      ["Krea MCP", "external"],
    ] as const;
    tools.forEach(([label, direction], toolIndex) => {
      const toolId = `tool:${sessionIndex}:${toolIndex}`;
      runtimeNodes.push({
        id: toolId,
        kind: "tool",
        label,
        status: toolIndex === sessionIndex % tools.length ? "active" : "observed",
        metadata: { direction, owner: agentId },
      });
      edge(edges, `called:${toolId}`, agentId, toolId, "called");
      if (direction === "vault") vaultTools.push(toolId);

      if (direction === "external" && toolIndex === 2) {
        for (let resultIndex = 0; resultIndex < 4; resultIndex += 1) {
          const resultId = `result:${sessionIndex}:${resultIndex}`;
          runtimeNodes.push({
            id: resultId,
            kind: "result",
            label: `Search result ${resultIndex + 1}`,
            status: "active",
            metadata: { ttlSeconds: 30, createdAt: now - resultIndex * 2 },
          });
          edge(edges, `returned:${resultId}`, toolId, resultId, "returned");
        }
      }
    });

    const artifactId = `artifact:${sessionIndex}`;
    runtimeNodes.push({
      id: artifactId,
      kind: "artifact",
      label: `Artifact ${sessionIndex + 1}`,
      status: "created",
      metadata: { producer: agentId, createdAt: now - sessionIndex * 3 },
    });
    edge(edges, `produced:${artifactId}`, agentId, artifactId, "produced");

    const skillId = `skill:${sessionIndex}`;
    runtimeNodes.push({
      id: skillId,
      kind: "skill",
      label: `Evolved Skill ${sessionIndex + 1}`,
      status: "ready",
      size: 6 + random() * 2,
      metadata: {
        version: 1 + Math.floor(random() * 5),
        producer: agentId,
        createdAt: now - sessionIndex * 4,
      },
    });
    edge(edges, `authored:${skillId}`, agentId, skillId, "authored");
  }

  const noteCount = Math.max(1, count - runtimeNodes.length);
  const notes: SceneNode[] = Array.from({ length: noteCount }, (_, index) => ({
    id: `note:${index}`,
    kind: "note",
    label: index < 12 ? `Vault Hub ${index + 1}` : `Vault Note ${index + 1}`,
    status: "persistent",
    metadata: { path: `Notes/note-${index + 1}.md`, vault: "Demo Vault" },
  }));

  for (let index = 1; index < noteCount; index += 1) {
    const linkCount = 1 + (random() < 0.34 ? 1 : 0) + (random() < 0.07 ? 1 : 0);
    for (let linkIndex = 0; linkIndex < linkCount; linkIndex += 1) {
      const target = Math.floor(Math.pow(random(), 2.35) * index);
      edge(edges, `wikilink:${index}:${linkIndex}`, `note:${index}`, `note:${target}`, "references");
    }
  }

  vaultTools.forEach((toolId, index) => {
    const resultCount = 1 + Math.floor(random() * 6);
    for (let resultIndex = 0; resultIndex < resultCount; resultIndex += 1) {
      const noteIndex = Math.floor(random() * noteCount);
      edge(
        edges,
        `retrieved:${index}:${resultIndex}`,
        toolId,
        `note:${noteIndex}`,
        "retrieved",
      );
    }
  });

  return {
    schemaVersion: 1,
    cursor,
    nodes: [...notes, ...runtimeNodes],
    edges,
  };
}
