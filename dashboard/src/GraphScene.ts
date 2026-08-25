import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

import { computeSpatialLayout, type Position } from "./layout";
import {
  DEFAULT_THEME,
  type GraphTheme,
  type SceneEdge,
  type SceneNode,
  type SceneSnapshot,
} from "./types";

const JUMP_EDGE_KINDS = new Set(["called", "retrieved", "returned"]);

const vertexShader = `
  attribute float aSize;
  attribute float aSizeFrom;
  attribute vec3 aNodeColor;
  attribute vec3 aNodeColorFrom;
  attribute float aIntensity;
  attribute float aIntensityFrom;
  attribute float aDoneAge;
  attribute float aBornAge;
  attribute float aJumpStart;
  attribute float aJumpEnd;
  attribute vec3 aPositionFrom;
  varying vec3 vColor;
  varying float vIntensity;
  varying float vLifecycle;
  varying float vBirth;
  varying float vJumpPulse;
  uniform float uPixelRatio;
  uniform float uTime;
  uniform float uKanbanFadeSeconds;
  uniform float uJumpTargetScale;
  uniform float uTransitionStart;
  uniform float uTransitionDuration;

  void main() {
    float transition = smoothstep(
      0.0,
      1.0,
      clamp((uTime - uTransitionStart) / max(0.001, uTransitionDuration), 0.0, 1.0)
    );
    vec3 animatedPosition = mix(aPositionFrom, position, transition);
    float animatedSize = mix(aSizeFrom, aSize, transition);
    vColor = mix(aNodeColorFrom, aNodeColor, transition);
    vIntensity = mix(aIntensityFrom, aIntensity, transition);
    vLifecycle = aDoneAge < 0.0 ? 0.0 : clamp((aDoneAge + uTime) / uKanbanFadeSeconds, 0.0, 1.0);
    vBirth = aBornAge < 0.0 ? 1.0 : smoothstep(0.0, 0.8, aBornAge + uTime);
    float safeJumpStart = max(0.0, aJumpStart);
    float safeJumpEnd = max(safeJumpStart + 0.08, aJumpEnd);
    float jumpRise = smoothstep(safeJumpStart, safeJumpStart + 0.04, uTime);
    float jumpFallStart = max(safeJumpStart + 0.05, safeJumpEnd - 0.10);
    float jumpFall = 1.0 - smoothstep(jumpFallStart, safeJumpEnd, uTime);
    vJumpPulse = step(0.0, aJumpStart) * jumpRise * jumpFall;
    vec4 mvPosition = modelViewMatrix * vec4(animatedPosition, 1.0);
    float twinkle = 1.0 + sin(uTime * 1.6 + animatedPosition.x * 0.07 + animatedPosition.z * 0.05) * 0.035 * vIntensity;
    float lifecycleScale = mix(1.0, 0.12, vLifecycle);
    float birthScale = mix(0.08, 1.0, vBirth);
    float jumpScale = mix(1.0, uJumpTargetScale, vJumpPulse);
    gl_PointSize = clamp(animatedSize * lifecycleScale * birthScale * jumpScale * uPixelRatio * twinkle * (260.0 / max(1.0, -mvPosition.z)), 1.0, 110.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = `
  precision highp float;
  varying vec3 vColor;
  varying float vIntensity;
  varying float vLifecycle;
  varying float vBirth;
  varying float vJumpPulse;
  uniform float uJumpTargetBrightness;

  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float radius = length(p);
    if (radius > 1.0) discard;

    float angle = atan(p.y, p.x);
    float fourRays = pow(abs(cos(angle * 2.0)), 18.0);
    float eightRays = pow(abs(cos(angle * 4.0)), 34.0) * 0.42;
    float starBoundary = 0.16 + fourRays * 0.49 + eightRays * 0.18;
    float body = 1.0 - smoothstep(starBoundary, starBoundary + 0.075, radius);
    float core = 1.0 - smoothstep(0.0, 0.13, radius);
    float halo = exp(-4.8 * radius * radius) * 0.42;
    float lifecycleVisibility = 1.0 - vLifecycle;
    float alpha = min(1.0, body + core + halo * vIntensity) * lifecycleVisibility * vBirth;
    vec3 color = mix(vColor, vec3(1.0), core * 0.72) * lifecycleVisibility;
    float jumpBrightness = mix(1.0, uJumpTargetBrightness, vJumpPulse);
    gl_FragColor = vec4(color * (0.78 + core * 1.15 + halo * 0.35) * jumpBrightness, min(1.0, alpha * jumpBrightness));
  }
`;

export interface GraphSceneOptions {
  onHover?: (node: SceneNode | null, x: number, y: number) => void;
  onStats?: (stats: { nodes: number; edges: number; fps: number }) => void;
  theme?: Partial<GraphTheme>;
}

interface ActiveRoute {
  line: Line2;
  marker: THREE.Sprite;
  path: RoutePoint[];
  startedAt: number;
  hopDelay: number;
  vertexCount: number;
  ttl: number;
}

interface RoutePoint {
  id: string;
  position: Position;
}

interface NodeVisual {
  position: Position;
  color: [number, number, number];
  size: number;
  intensity: number;
}

export class GraphScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2(2, 2);
  private readonly resizeObserver: ResizeObserver;
  private theme: GraphTheme;
  private readonly onHover?: GraphSceneOptions["onHover"];
  private readonly onStats?: GraphSceneOptions["onStats"];
  private points: THREE.Points | null = null;
  private edges: LineSegments2 | null = null;
  private edgeCount = 0;
  private readonly jumpTexture = this.createJumpTexture();
  private transitionStartedAt = 0;
  private readonly transitionDuration = 0.72;
  private nodes: SceneNode[] = [];
  private snapshot: SceneSnapshot | null = null;
  private activeRoutes: ActiveRoute[] = [];
  private readonly activityRouteTiming = new Map<
    string,
    { startedAt: number; lastSeenAt: number }
  >();
  private animationFrame = 0;
  private hoverFrame = 0;
  private lastHovered = -1;
  private frameCount = 0;
  private frameWindowStart = performance.now();

  constructor(private readonly canvas: HTMLCanvasElement, options: GraphSceneOptions = {}) {
    this.theme = {
      ...DEFAULT_THEME,
      ...options.theme,
      nodeColors: { ...DEFAULT_THEME.nodeColors, ...options.theme?.nodeColors },
      kanbanColors: { ...DEFAULT_THEME.kanbanColors, ...options.theme?.kanbanColors },
    };
    this.onHover = options.onHover;
    this.onStats = options.onStats;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
      logarithmicDepthBuffer: false,
    });
    this.renderer.setClearColor(this.theme.background, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 4000);
    this.camera.position.set(0, 170, 430);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 1500;
    this.controls.zoomToCursor = true;

    this.scene.fog = new THREE.FogExp2(this.theme.background, 0.00125);
    this.raycaster.params.Points = { threshold: 2.8 };

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener("pointermove", this.handlePointerMove, { passive: true });
    canvas.addEventListener("pointerleave", this.handlePointerLeave, { passive: true });
    this.resize();
    this.animate();
  }

  setSnapshot(snapshot: SceneSnapshot): void {
    const previousVisuals = this.captureCurrentVisuals();
    this.snapshot = snapshot;
    const now = Date.now() / 1000;
    const fadeSeconds = this.theme.kanbanFadeHours * 3600;
    this.nodes = snapshot.nodes.filter((node) => {
      if (node.kind === "result") {
        const createdAt = Number(node.metadata?.createdAt || 0);
        const ttlSeconds = Number(node.metadata?.ttlSeconds || 30);
        if (createdAt && now - createdAt >= ttlSeconds) return false;
      }
      if (node.kind !== "task" || node.status !== "done") return true;
      const completedAt = Number(node.metadata?.completedAt || 0);
      return !completedAt || now - completedAt < fadeSeconds;
    });
    const visibleIds = new Set(this.nodes.map((node) => node.id));
    const visibleEdges = snapshot.edges.filter(
      (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
    );
    const positions = computeSpatialLayout(this.nodes, visibleEdges, {
      vaultRadius: this.theme.vaultRadius,
      runtimeOrbitRadius: this.theme.runtimeOrbitRadius,
    });
    this.disposeGraph();
    this.transitionStartedAt = this.clock.elapsedTime;
    this.points = this.createPoints(this.nodes, positions, previousVisuals);
    this.edges = this.createEdges(this.nodes, visibleEdges, positions);
    this.edgeCount = visibleEdges.length;
    this.scene.add(this.edges, this.points);
    this.createActivityRoutes(this.nodes, visibleEdges, positions);
    this.onStats?.({ nodes: this.nodes.length, edges: visibleEdges.length, fps: 0 });
  }

  setTheme(theme: Partial<GraphTheme>): void {
    this.theme = {
      ...this.theme,
      ...theme,
      nodeColors: { ...this.theme.nodeColors, ...theme.nodeColors },
      kanbanColors: { ...this.theme.kanbanColors, ...theme.kanbanColors },
    };
    this.renderer.setClearColor(this.theme.background, 1);
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.set(this.theme.background);
    }
    if (this.snapshot) this.setSnapshot(this.snapshot);
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    cancelAnimationFrame(this.hoverFrame);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerleave", this.handlePointerLeave);
    this.disposeGraph();
    this.controls.dispose();
    this.renderer.dispose();
    this.jumpTexture.dispose();
  }

  private captureCurrentVisuals(): Map<string, NodeVisual> | null {
    if (!this.points || !this.nodes.length) return null;
    const geometry = this.points.geometry;
    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    const positionsFrom = geometry.getAttribute("aPositionFrom") as THREE.BufferAttribute;
    const colors = geometry.getAttribute("aNodeColor") as THREE.BufferAttribute;
    const colorsFrom = geometry.getAttribute("aNodeColorFrom") as THREE.BufferAttribute;
    const sizes = geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const sizesFrom = geometry.getAttribute("aSizeFrom") as THREE.BufferAttribute;
    const intensities = geometry.getAttribute("aIntensity") as THREE.BufferAttribute;
    const intensitiesFrom = geometry.getAttribute("aIntensityFrom") as THREE.BufferAttribute;
    const rawProgress = Math.max(
      0,
      Math.min(
        1,
        (this.clock.elapsedTime - this.transitionStartedAt) / this.transitionDuration,
      ),
    );
    const progress = rawProgress * rawProgress * (3 - 2 * rawProgress);
    const mix = (from: number, to: number) => from + (to - from) * progress;
    const visuals = new Map<string, NodeVisual>();
    this.nodes.forEach((node, index) => {
      visuals.set(node.id, {
        position: [
          mix(positionsFrom.getX(index), positions.getX(index)),
          mix(positionsFrom.getY(index), positions.getY(index)),
          mix(positionsFrom.getZ(index), positions.getZ(index)),
        ],
        color: [
          mix(colorsFrom.getX(index), colors.getX(index)),
          mix(colorsFrom.getY(index), colors.getY(index)),
          mix(colorsFrom.getZ(index), colors.getZ(index)),
        ],
        size: mix(sizesFrom.getX(index), sizes.getX(index)),
        intensity: mix(intensitiesFrom.getX(index), intensities.getX(index)),
      });
    });
    return visuals;
  }

  private createPoints(
    nodes: SceneNode[],
    nodePositions: Map<string, Position>,
    previousVisuals: Map<string, NodeVisual> | null,
  ): THREE.Points {
    const positions = new Float32Array(nodes.length * 3);
    const positionsFrom = new Float32Array(nodes.length * 3);
    const colors = new Float32Array(nodes.length * 3);
    const colorsFrom = new Float32Array(nodes.length * 3);
    const sizes = new Float32Array(nodes.length);
    const sizesFrom = new Float32Array(nodes.length);
    const intensities = new Float32Array(nodes.length);
    const intensitiesFrom = new Float32Array(nodes.length);
    const doneAges = new Float32Array(nodes.length);
    const bornAges = new Float32Array(nodes.length);
    const jumpStarts = new Float32Array(nodes.length);
    const jumpEnds = new Float32Array(nodes.length);
    jumpStarts.fill(-1);
    jumpEnds.fill(-1);
    const low = new THREE.Color(this.theme.pressureLow);
    const high = new THREE.Color(this.theme.pressureHigh);

    nodes.forEach((node, index) => {
      const [x, y, z] = nodePositions.get(node.id) || [0, 0, 0];
      positions.set([x, y, z], index * 3);
      const pressure = Math.max(0, Math.min(1, node.pressure ?? 0));
      const toolDirection = String(node.metadata?.direction || "");
      const colorKey =
        node.kind === "result"
          ? "note"
          : node.kind === "tool" && toolDirection
            ? `tool-${toolDirection}`
            : node.kind;
      const baseColor = new THREE.Color(
        node.color ||
          (node.kind === "task"
            ? this.theme.kanbanColors[node.status || "todo"]
            : this.theme.nodeColors[colorKey]) ||
          "#b9c4e8",
      );
      const color = node.kind === "agent" ? low.clone().lerp(high, pressure) : baseColor;
      colors.set([color.r, color.g, color.b], index * 3);
      const defaultSizes: Record<string, number> = {
        session: 34,
        agent: 30,
        task: 25,
        subagent: 7.5,
        tool: 7.5,
        skill: 7,
        artifact: 9,
        note: 3.6,
        result: 3.6,
        search: 5,
        external: 5,
      };
      const baseSize = node.size ?? defaultSizes[node.kind] ?? this.theme.minNodeSize;
      sizes[index] = baseSize * (1 + pressure * (this.theme.maxPressureScale - 1));
      intensities[index] = node.status === "active" ? 1.2 : 0.72;
      const previous = previousVisuals?.get(node.id);
      const hasPreviousScene = previousVisuals !== null;
      positionsFrom.set(previous?.position || [x, y, z], index * 3);
      colorsFrom.set(previous?.color || [color.r, color.g, color.b], index * 3);
      sizesFrom[index] = previous?.size ?? (hasPreviousScene ? sizes[index] * 0.12 : sizes[index]);
      intensitiesFrom[index] = previous?.intensity ?? (hasPreviousScene ? 0 : intensities[index]);
      const completedAt = Number(node.metadata?.completedAt || 0);
      doneAges[index] = node.kind === "task" && node.status === "done" && completedAt
        ? Math.max(0, Date.now() / 1000 - completedAt)
        : -1;
      const createdAt = Number(node.metadata?.createdAt || 0);
      bornAges[index] = ["result", "artifact", "skill"].includes(node.kind) && createdAt
        ? Math.max(0, Date.now() / 1000 - createdAt)
        : -1;
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aPositionFrom", new THREE.BufferAttribute(positionsFrom, 3));
    geometry.setAttribute("aNodeColor", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aNodeColorFrom", new THREE.BufferAttribute(colorsFrom, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aSizeFrom", new THREE.BufferAttribute(sizesFrom, 1));
    geometry.setAttribute("aIntensity", new THREE.BufferAttribute(intensities, 1));
    geometry.setAttribute("aIntensityFrom", new THREE.BufferAttribute(intensitiesFrom, 1));
    geometry.setAttribute("aDoneAge", new THREE.BufferAttribute(doneAges, 1));
    geometry.setAttribute("aBornAge", new THREE.BufferAttribute(bornAges, 1));
    geometry.setAttribute("aJumpStart", new THREE.BufferAttribute(jumpStarts, 1));
    geometry.setAttribute("aJumpEnd", new THREE.BufferAttribute(jumpEnds, 1));
    geometry.computeBoundingSphere();

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uPixelRatio: { value: this.renderer.getPixelRatio() },
        uTime: { value: 0 },
        uKanbanFadeSeconds: { value: this.theme.kanbanFadeHours * 3600 },
        uJumpTargetScale: { value: this.theme.jumpTargetScale },
        uJumpTargetBrightness: { value: this.theme.jumpTargetBrightness },
        uTransitionStart: { value: this.transitionStartedAt },
        uTransitionDuration: { value: previousVisuals ? this.transitionDuration : 0.001 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });
    return new THREE.Points(geometry, material);
  }

  private createEdges(
    nodes: SceneNode[],
    edges: SceneEdge[],
    nodePositions: Map<string, Position>,
  ): LineSegments2 {
    const nodeIndex = new Map(nodes.map((node, index) => [node.id, index]));
    const validEdges = edges.filter(
      (edge) =>
        edge.active !== false &&
        !JUMP_EDGE_KINDS.has(edge.kind) &&
        nodeIndex.has(edge.source) &&
        nodeIndex.has(edge.target),
    );
    const positions = new Float32Array(validEdges.length * 6);
    const colors = new Float32Array(validEdges.length * 6);
    validEdges.forEach((edge, index) => {
      const source = nodePositions.get(edge.source)!;
      const target = nodePositions.get(edge.target)!;
      positions.set(source, index * 6);
      positions.set(target, index * 6 + 3);
      const edgeColor = new THREE.Color(this.theme.edgeColor);
      colors.set([edgeColor.r, edgeColor.g, edgeColor.b], index * 6);
      colors.set([edgeColor.r, edgeColor.g, edgeColor.b], index * 6 + 3);
    });
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    geometry.setColors(colors);
    const material = new LineMaterial({
      color: "#ffffff",
      vertexColors: true,
      linewidth: this.theme.edgeThickness,
      transparent: true,
      opacity: 0.13,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    material.resolution.set(
      Math.max(1, this.canvas.clientWidth),
      Math.max(1, this.canvas.clientHeight),
    );
    return new LineSegments2(geometry, material);
  }

  private createActivityRoutes(
    nodes: SceneNode[],
    edges: SceneEdge[],
    positions: Map<string, Position>,
  ): void {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const nodeIndex = new Map(nodes.map((node, index) => [node.id, index]));
    const notePositions = nodes
      .filter((node) => node.kind === "note")
      .map((node) => ({ id: node.id, position: positions.get(node.id)! }));
    const activityEdges = edges
      .filter((edge) => {
        if (!JUMP_EDGE_KINDS.has(edge.kind)) return false;
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        const createdAt = Number(edge.metadata?.createdAt ?? 0);
        const ttlSeconds = Number(
          edge.metadata?.ttlSeconds ?? this.theme.activityTtlSeconds,
        );
        const recentlyCreated =
          createdAt > 0 && Date.now() / 1000 - createdAt <= ttlSeconds;
        return (
          Boolean(source) &&
          (source?.status === "active" || target?.status === "active" || recentlyCreated || createdAt === 0)
        );
      })
      .slice(0, 20);
    const sceneNow = this.clock.elapsedTime;
    const plannedStarts = new Map<string, number>();
    const toolReadyAt = new Map<string, number>();
    const timingKeyFor = (edge: SceneEdge) =>
      `${edge.id}:${Number(edge.metadata?.createdAt || 0)}`;
    activityEdges.forEach((edge, index) => {
      if (edge.kind !== "called") return;
      const existing = this.activityRouteTiming.get(timingKeyFor(edge));
      const start = existing?.startedAt ?? sceneNow + index * 0.012;
      plannedStarts.set(edge.id, start);
      toolReadyAt.set(edge.target, start + 0.07);
    });
    activityEdges.forEach((edge, index) => {
      if (plannedStarts.has(edge.id)) return;
      const existing = this.activityRouteTiming.get(timingKeyFor(edge));
      const naturalStart = sceneNow + index * 0.012;
      plannedStarts.set(
        edge.id,
        existing?.startedAt ?? Math.max(naturalStart, toolReadyAt.get(edge.source) || 0),
      );
    });

    activityEdges.forEach((edge) => {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      if (!source || !target) return;
      const path: RoutePoint[] =
        edge.kind === "retrieved" && this.theme.activityMode === "beautiful"
          ? this.buildBeautifulRoute(
              { id: edge.source, position: source },
              { id: edge.target, position: target },
              notePositions,
              edge.id,
            )
          : [
              { id: edge.source, position: source },
              { id: edge.target, position: target },
            ];
      const coordinates = new Float32Array(path.length * 3);
      path.forEach((point, pathIndex) => coordinates.set(point.position, pathIndex * 3));
      const geometry = new LineGeometry();
      geometry.setPositions(coordinates);
      geometry.instanceCount = 0;
      const material = new LineMaterial({
        color: this.theme.jumpColor,
        linewidth: this.theme.jumpThickness,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      material.resolution.set(
        Math.max(1, this.canvas.clientWidth),
        Math.max(1, this.canvas.clientHeight),
      );
      const line = new Line2(geometry, material);
      line.frustumCulled = false;
      const markerMaterial = new THREE.SpriteMaterial({
        map: this.jumpTexture,
        color: this.theme.jumpColor,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const marker = new THREE.Sprite(markerMaterial);
      marker.scale.setScalar(7.5);
      marker.position.set(...path[0].position);
      marker.visible = false;
      this.scene.add(line);
      this.scene.add(marker);
      const timingKey = timingKeyFor(edge);
      const existingTiming = this.activityRouteTiming.get(timingKey);
      const startedAt = existingTiming?.startedAt ?? plannedStarts.get(edge.id)!;
      this.activityRouteTiming.set(timingKey, { startedAt, lastSeenAt: sceneNow });
      const hopDelay =
        path.length <= 2
          ? 0.07
          : Math.max(0.008, this.theme.activityHopDelayMs / 1000);
      this.activeRoutes.push({
        line,
        marker,
        path,
        startedAt,
        hopDelay,
        vertexCount: path.length,
        ttl: this.theme.activityTtlSeconds,
      });
      const completion = startedAt + (path.length - 1) * hopDelay;
      if (["retrieved", "returned"].includes(edge.kind)) {
        this.markJumpWindow(nodeIndex, edge.source, startedAt, completion + 0.18);
      }
      for (let pathIndex = 1; pathIndex < path.length; pathIndex += 1) {
        const arrival = startedAt + pathIndex * hopDelay;
        const isFinal = pathIndex === path.length - 1;
        const hold = isFinal ? 0.55 : Math.max(0.14, hopDelay * 3.5);
        this.markJumpWindow(nodeIndex, path[pathIndex].id, arrival, arrival + hold);
      }
    });
    for (const [key, timing] of this.activityRouteTiming) {
      if (sceneNow - timing.lastSeenAt > this.theme.activityTtlSeconds + 2) {
        this.activityRouteTiming.delete(key);
      }
    }
  }

  private markJumpWindow(
    nodeIndex: Map<string, number>,
    nodeId: string,
    start: number,
    end: number,
  ): void {
    const index = nodeIndex.get(nodeId);
    if (index === undefined || !this.points) return;
    const startAttribute = this.points.geometry.getAttribute(
      "aJumpStart",
    ) as THREE.BufferAttribute;
    const endAttribute = this.points.geometry.getAttribute(
      "aJumpEnd",
    ) as THREE.BufferAttribute;
    const currentStart = startAttribute.getX(index);
    const currentEnd = endAttribute.getX(index);
    startAttribute.setX(index, currentStart < 0 ? start : Math.min(currentStart, start));
    endAttribute.setX(index, Math.max(currentEnd, end));
    startAttribute.needsUpdate = true;
    endAttribute.needsUpdate = true;
  }

  private buildBeautifulRoute(
    source: RoutePoint,
    target: RoutePoint,
    notes: RoutePoint[],
    routeId: string,
  ): RoutePoint[] {
    if (!notes.length) return [source, target];
    const hopCount = Math.max(15, Math.min(150, Math.round(this.theme.activityHopCount)));
    const seed = Array.from(routeId).reduce((sum, character) => sum + character.charCodeAt(0), 0);
    const nearestEntry = notes.reduce((best, candidate) => {
      const distance = this.distanceSquared(source.position, candidate.position);
      return distance < best.distance ? { candidate, distance } : best;
    }, { candidate: notes[0], distance: Number.POSITIVE_INFINITY }).candidate;
    const route: RoutePoint[] = [source, nearestEntry];
    const used = new Set<string>([nearestEntry.id]);

    for (let hop = 1; hop < hopCount; hop += 1) {
      const progress = hop / hopCount;
      const bend = Math.sin(progress * Math.PI) * (18 + (seed % 17));
      const waypoint: Position = [
        nearestEntry.position[0] + (target.position[0] - nearestEntry.position[0]) * progress + Math.sin(hop * 1.7 + seed) * bend,
        nearestEntry.position[1] + (target.position[1] - nearestEntry.position[1]) * progress + Math.cos(hop * 1.31 + seed) * bend,
        nearestEntry.position[2] + (target.position[2] - nearestEntry.position[2]) * progress + Math.sin(hop * 0.91 + seed) * bend,
      ];
      let best: { id: string; position: Position } | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      const samples = Math.min(notes.length, 128);
      for (let sample = 0; sample < samples; sample += 1) {
        const candidate = notes[(seed + hop * 104729 + sample * 7919) % notes.length];
        if (used.has(candidate.id)) continue;
        const distance = this.distanceSquared(waypoint, candidate.position);
        if (distance < bestDistance) {
          best = candidate;
          bestDistance = distance;
        }
      }
      if (best) {
        used.add(best.id);
        route.push(best);
      }
    }
    route.push(target);
    return route;
  }

  private distanceSquared(a: Position, b: Position): number {
    const x = a[0] - b[0];
    const y = a[1] - b[1];
    const z = a[2] - b[2];
    return x * x + y * y + z * z;
  }

  private updateActivityRoutes(now: number): void {
    for (const route of this.activeRoutes) {
      const elapsed = now - route.startedAt;
      if (elapsed < 0) {
        route.line.geometry.instanceCount = 0;
        route.marker.visible = false;
        continue;
      }
      const segmentCount = route.vertexCount - 1;
      const segmentProgress = elapsed / route.hopDelay;
      const completedSegments = Math.min(segmentCount, Math.floor(segmentProgress));
      route.line.geometry.instanceCount = completedSegments;
      if (completedSegments < segmentCount) {
        const local = segmentProgress - completedSegments;
        const eased = local * local * (3 - 2 * local);
        const from = route.path[completedSegments].position;
        const to = route.path[completedSegments + 1].position;
        route.marker.position.set(
          from[0] + (to[0] - from[0]) * eased,
          from[1] + (to[1] - from[1]) * eased,
          from[2] + (to[2] - from[2]) * eased,
        );
        route.marker.visible = true;
      } else {
        route.marker.visible = false;
      }
      const completion = (route.vertexCount - 1) * route.hopDelay;
      const linger = elapsed - completion;
      route.line.material.opacity = linger <= 0 ? 0.38 : Math.max(0, 0.38 * (1 - linger / route.ttl));
      route.line.visible = linger < route.ttl;
      route.marker.material.opacity = linger <= 0 ? 0.95 : 0;
    }
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    if (this.hoverFrame) return;
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = 0;
      this.pick(event.clientX - rect.left, event.clientY - rect.top);
    });
  };

  private readonly handlePointerLeave = (): void => {
    this.pointer.set(2, 2);
    this.lastHovered = -1;
    this.onHover?.(null, 0, 0);
  };

  private pick(x: number, y: number): void {
    if (!this.points) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.points, false)[0];
    const index = hit?.index ?? -1;
    if (index === this.lastHovered) return;
    this.lastHovered = index;
    this.canvas.style.cursor = index >= 0 ? "pointer" : "grab";
    this.onHover?.(index >= 0 ? this.nodes[index] : null, x, y);
  }

  private createJumpTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d")!;
    const glow = context.createRadialGradient(32, 32, 0, 32, 32, 31);
    glow.addColorStop(0, "rgba(255,255,255,1)");
    glow.addColorStop(0.12, "rgba(255,255,255,0.95)");
    glow.addColorStop(0.38, "rgba(255,255,255,0.36)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, 64, 64);
    context.strokeStyle = "rgba(255,255,255,0.8)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(4, 32);
    context.lineTo(60, 32);
    context.moveTo(32, 4);
    context.lineTo(32, 60);
    context.stroke();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    const material = this.points?.material as THREE.ShaderMaterial | undefined;
    if (material?.uniforms.uPixelRatio) {
      material.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
    }
    this.edges?.material.resolution.set(width, height);
    for (const route of this.activeRoutes) route.line.material.resolution.set(width, height);
  }

  private animate = (): void => {
    this.animationFrame = requestAnimationFrame(this.animate);
    this.controls.update();
    const elapsedTime = this.clock.getElapsedTime();
    const material = this.points?.material as THREE.ShaderMaterial | undefined;
    if (material?.uniforms.uTime) material.uniforms.uTime.value = elapsedTime;
    this.updateActivityRoutes(elapsedTime);
    this.renderer.render(this.scene, this.camera);

    this.frameCount += 1;
    const now = performance.now();
    if (now - this.frameWindowStart >= 1000) {
      const fps = Math.round((this.frameCount * 1000) / (now - this.frameWindowStart));
      this.onStats?.({
        nodes: this.nodes.length,
        edges: this.edgeCount,
        fps,
      });
      this.frameCount = 0;
      this.frameWindowStart = now;
    }
  };

  private disposeGraph(): void {
    for (const route of this.activeRoutes) {
      this.scene.remove(route.line);
      this.scene.remove(route.marker);
      route.line.geometry.dispose();
      route.line.material.dispose();
      route.marker.material.dispose();
    }
    this.activeRoutes = [];
    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      (this.points.material as THREE.Material).dispose();
      this.points = null;
    }
    if (this.edges) {
      this.scene.remove(this.edges);
      this.edges.geometry.dispose();
      (this.edges.material as THREE.Material).dispose();
      this.edges = null;
    }
  }
}
