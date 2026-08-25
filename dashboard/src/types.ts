export type NodeKind =
  | "agent"
  | "session"
  | "task"
  | "note"
  | "tool"
  | "subagent"
  | "artifact"
  | "skill"
  | "result"
  | "search"
  | "external"
  | string;

export interface SceneNode {
  id: string;
  kind: NodeKind;
  label: string;
  status?: string;
  color?: string | null;
  size?: number | null;
  pressure?: number | null;
  metadata?: Record<string, unknown>;
  position?: [number, number, number];
}

export interface SceneEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
  active?: boolean;
  metadata?: Record<string, unknown>;
}

export interface SceneSnapshot {
  schemaVersion: number;
  cursor: number;
  nodes: SceneNode[];
  edges: SceneEdge[];
}

export interface GraphTheme {
  jumpTimingVersion: number;
  nodeColors: Record<string, string>;
  kanbanColors: Record<string, string>;
  pressureLow: string;
  pressureHigh: string;
  minNodeSize: number;
  maxPressureScale: number;
  kanbanFadeHours: number;
  vaultRadius: number;
  runtimeOrbitRadius: number;
  activityMode: "semantic" | "beautiful";
  activityHopCount: number;
  activityHopDelayMs: number;
  activityTtlSeconds: number;
  edgeColor: string;
  edgeThickness: number;
  jumpColor: string;
  jumpThickness: number;
  jumpTargetScale: number;
  jumpTargetBrightness: number;
  background: string;
}

export const DEFAULT_THEME: GraphTheme = {
  jumpTimingVersion: 2,
  nodeColors: {
    agent: "#ffffff",
    session: "#65ffe2",
    task: "#ffbe68",
    note: "#72a7ff",
    tool: "#ff7da8",
    artifact: "#a0ff83",
    skill: "#70f6ff",
    subagent: "#d8c9ff",
    search: "#65d8ff",
    external: "#ff745c",
    "tool-vault": "#a585ff",
    "tool-external": "#ff83ad",
  },
  kanbanColors: {
    todo: "#8d98b8",
    doing: "#5e9dff",
    done: "#70e6a2",
    blocked: "#ff665e",
  },
  pressureLow: "#ffffff",
  pressureHigh: "#9f53ff",
  minNodeSize: 4.5,
  maxPressureScale: 2.8,
  kanbanFadeHours: 24,
  vaultRadius: 155,
  runtimeOrbitRadius: 255,
  activityMode: "beautiful",
  activityHopCount: 24,
  activityHopDelayMs: 25,
  activityTtlSeconds: 30,
  edgeColor: "#11182e",
  edgeThickness: 0.45,
  jumpColor: "#c59aff",
  jumpThickness: 2.2,
  jumpTargetScale: 1.8,
  jumpTargetBrightness: 2.3,
  background: "#02030a",
};
