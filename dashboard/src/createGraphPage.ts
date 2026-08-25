import { createDemoSnapshot, DEMO_TIMELINE_CURSOR } from "./demo";
import { GraphScene } from "./GraphScene";
import { DEFAULT_THEME, type GraphTheme, type SceneNode, type SceneSnapshot } from "./types";

type ReactApi = {
  createElement: (...args: any[]) => any;
  useCallback: <T extends (...args: any[]) => any>(fn: T, deps: unknown[]) => T;
  useEffect: (fn: () => void | (() => void), deps: unknown[]) => void;
  useRef: <T>(initial: T) => { current: T };
  useState: <T>(initial: T) => [T, (value: T | ((current: T) => T)) => void];
};

interface PageOptions {
  demoOnEmpty?: boolean;
  fetchJSON?: <T>(path: string, init?: RequestInit) => Promise<T>;
  buildWsUrl?: (path: string, params?: Record<string, string>) => Promise<string>;
}

type Stats = { nodes: number; edges: number; fps: number };
type HoverState = { node: SceneNode; x: number; y: number } | null;
type VaultStatus = {
  configured?: boolean;
  path?: string;
  name?: string;
  available?: boolean;
  notes?: number;
  links?: number;
};
type TimelineRange = {
  startCursor: number;
  endCursor: number;
  startAt: number | null;
  endAt: number | null;
};

const PLAYBACK_WINDOWS = [
  { key: "1h", label: "1 HOUR", seconds: 3_600 },
  { key: "6h", label: "6 HOURS", seconds: 21_600 },
  { key: "1d", label: "1 DAY", seconds: 86_400 },
  { key: "7d", label: "7 DAYS", seconds: 604_800 },
  { key: "30d", label: "30 DAYS", seconds: 2_592_000 },
  { key: "max", label: "MAX", seconds: null },
] as const;

type PlaybackWindowKey = (typeof PLAYBACK_WINDOWS)[number]["key"];

function metadataRows(node: SceneNode): Array<[string, string]> {
  const rows: Array<[string, string]> = [["Status", node.status || "observed"]];
  if (node.kind === "agent" && node.pressure != null) {
    rows.push(["Context", `${Math.round(node.pressure * 100)}%`]);
  }
  const keysByKind: Record<string, string[]> = {
    agent: ["model", "provider", "tokens"],
    note: ["path", "folder"],
    task: ["board", "assignee", "reason"],
    tool: ["duration", "sessionId"],
    session: ["platform", "model"],
  };
  for (const key of keysByKind[node.kind] || []) {
    const value = node.metadata?.[key];
    if (value !== undefined && value !== null && value !== "") {
      rows.push([key.charAt(0).toUpperCase() + key.slice(1), String(value)]);
    }
  }
  return rows.slice(0, 5);
}

function loadSavedTheme(): GraphTheme {
  try {
    const saved = JSON.parse(localStorage.getItem("hermes-graph:theme") || "null") as
      | Partial<GraphTheme>
      | null;
    const migratedHopDelay =
      saved?.jumpTimingVersion === 2
        ? saved.activityHopDelayMs ?? DEFAULT_THEME.activityHopDelayMs
        : (saved?.activityHopDelayMs ?? 250) / 10;
    return {
      ...DEFAULT_THEME,
      ...saved,
      jumpTimingVersion: 2,
      activityHopDelayMs: migratedHopDelay,
      // Edge color existed internally before it was user-configurable. Migrate
      // those old saved themes to the new, darker wide-line default.
      edgeColor:
        saved?.edgeThickness === undefined
          ? DEFAULT_THEME.edgeColor
          : saved.edgeColor || DEFAULT_THEME.edgeColor,
      nodeColors: { ...DEFAULT_THEME.nodeColors, ...saved?.nodeColors },
      kanbanColors: { ...DEFAULT_THEME.kanbanColors, ...saved?.kanbanColors },
    };
  } catch {
    return {
      ...DEFAULT_THEME,
      nodeColors: { ...DEFAULT_THEME.nodeColors },
      kanbanColors: { ...DEFAULT_THEME.kanbanColors },
    };
  }
}

export function createGraphPage(React: ReactApi, options: PageOptions = {}) {
  const h = React.createElement;
  const fetchJSON =
    options.fetchJSON ||
    (async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(path, init);
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      return response.json() as Promise<T>;
    });

  return function HermesGraphPage() {
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
    const sceneRef = React.useRef<GraphScene | null>(null);
    const cursorRef = React.useRef(0);
    const liveRef = React.useRef(true);
    const demoCountRef = React.useRef(10_000);
    const playbackStartRef = React.useRef(0);
    const playbackLoadingRef = React.useRef(false);
    const initialThemeRef = React.useRef<GraphTheme>(loadSavedTheme());
    const [hover, setHover] = React.useState<HoverState>(null);
    const [stats, setStats] = React.useState<Stats>({ nodes: 0, edges: 0, fps: 0 });
    const [connection, setConnection] = React.useState("CONNECTING");
    const [isDemo, setIsDemo] = React.useState(false);
    const [isLive, setIsLive] = React.useState(true);
    const [playing, setPlaying] = React.useState(false);
    const [viewCursor, setViewCursor] = React.useState(0);
    const [maxCursor, setMaxCursor] = React.useState(0);
    const [theme, setTheme] = React.useState(initialThemeRef.current);
    const [settingsOpen, setSettingsOpen] = React.useState(false);
    const [vaultPath, setVaultPath] = React.useState("");
    const [vaultMessage, setVaultMessage] = React.useState("NOT CONNECTED");
    const [vaultBusy, setVaultBusy] = React.useState(false);
    const [playbackWindow, setPlaybackWindow] =
      React.useState<PlaybackWindowKey>("1d");

    const showDemoFrame = React.useCallback(
      (count: number, cursor = DEMO_TIMELINE_CURSOR, live = true) => {
        demoCountRef.current = count;
        sceneRef.current?.setSnapshot(createDemoSnapshot(count, cursor));
        setIsDemo(true);
        setMaxCursor(DEMO_TIMELINE_CURSOR);
        setViewCursor(cursor);
        setIsLive(live);
        liveRef.current = live;
      },
      [],
    );

    const loadSnapshot = React.useCallback(async (at?: number) => {
      try {
        const suffix = at === undefined ? "" : `?at=${Math.max(0, Math.round(at))}`;
        const snapshot = await fetchJSON<SceneSnapshot>(
          `/api/plugins/hermes-graph/snapshot${suffix}`,
        );
        if (at === undefined) {
          cursorRef.current = snapshot.cursor;
          setMaxCursor(snapshot.cursor);
          setViewCursor(snapshot.cursor);
          setIsLive(true);
          liveRef.current = true;
        } else {
          setViewCursor(snapshot.cursor);
          setIsLive(false);
          liveRef.current = false;
        }
        if (snapshot.nodes.length === 0 && options.demoOnEmpty) {
          showDemoFrame(10_000);
        } else {
          sceneRef.current?.setSnapshot(snapshot);
          setIsDemo(false);
        }
        setConnection("LIVE");
      } catch (error) {
        if (options.demoOnEmpty) {
          showDemoFrame(10_000);
          setConnection("DEMO");
        } else {
          setConnection(error instanceof Error ? "OFFLINE" : "ERROR");
        }
      }
    }, [showDemoFrame]);

    React.useEffect(() => {
      if (!canvasRef.current) return;
      const scene = new GraphScene(canvasRef.current, {
        onHover: (node, x, y) => setHover(node ? { node, x, y } : null),
        onStats: (next) =>
          setStats((current) => ({ ...next, fps: next.fps || current.fps })),
        theme: initialThemeRef.current,
      });
      sceneRef.current = scene;
      void loadSnapshot();

      let socket: WebSocket | null = null;
      let reconnectTimer = 0;
      let pollTimer = 0;
      let disposed = false;
      const applyBatch = (batch: { cursor: number; events: unknown[] }) => {
        cursorRef.current = batch.cursor;
        setMaxCursor(batch.cursor);
        if (batch.events.length > 0 && liveRef.current) void loadSnapshot();
      };
      const scheduleReconnect = () => {
        if (disposed) return;
        setConnection("RECONNECTING");
        window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(() => void connect(), 1500);
      };
      const connect = async () => {
        if (options.demoOnEmpty && window.location.hostname === "localhost") return;
        try {
          if (!options.buildWsUrl) return;
          const url = await options.buildWsUrl("/api/plugins/hermes-graph/stream", {
            after: String(cursorRef.current),
          });
          if (disposed) return;
          socket = new WebSocket(url);
        } catch {
          scheduleReconnect();
          return;
        }
        socket.onopen = () => setConnection("LIVE");
        socket.onmessage = (message) => {
          const batch = JSON.parse(String(message.data)) as { cursor: number; events: unknown[] };
          applyBatch(batch);
        };
        socket.onclose = scheduleReconnect;
        socket.onerror = () => socket?.close();
      };
      const poll = async () => {
        if (disposed) return;
        try {
          const batch = await fetchJSON<{ cursor: number; events: unknown[] }>(
            `/api/plugins/hermes-graph/events?after=${cursorRef.current}&limit=1000`,
          );
          applyBatch(batch);
          setConnection("LIVE");
          pollTimer = window.setTimeout(() => void poll(), 350);
        } catch {
          setConnection("RECONNECTING");
          pollTimer = window.setTimeout(() => void poll(), 1500);
        }
      };
      if (options.buildWsUrl) void connect();
      else void poll();

      return () => {
        disposed = true;
        window.clearTimeout(reconnectTimer);
        window.clearTimeout(pollTimer);
        socket?.close();
        scene.dispose();
        sceneRef.current = null;
      };
    }, []);

    React.useEffect(() => {
      void fetchJSON<VaultStatus>("/api/plugins/hermes-graph/vault")
        .then((status) => {
          setVaultPath(status.path || "");
          setVaultMessage(
            status.configured
              ? `${status.name || "VAULT"}${status.available === false ? " · MISSING" : " · CONNECTED"}`
              : "NOT CONNECTED",
          );
        })
        .catch(() => undefined);
    }, []);

    React.useEffect(() => {
      if (!playing || maxCursor <= 0) return;
      const tickMs = stats.nodes >= 40_000 ? 650 : stats.nodes >= 20_000 ? 450 : 300;
      const playbackSteps = Math.max(24, Math.round(24_000 / tickMs));
      const timer = window.setInterval(() => {
        setViewCursor((current) => {
          const step = Math.max(
            1,
            Math.ceil((maxCursor - playbackStartRef.current) / playbackSteps),
          );
          const next = Math.min(maxCursor, current + step);
          if (isDemo) {
            sceneRef.current?.setSnapshot(createDemoSnapshot(demoCountRef.current, next));
            const atLiveEdge = next >= maxCursor;
            setIsLive(atLiveEdge);
            liveRef.current = atLiveEdge;
          } else {
            if (playbackLoadingRef.current) return current;
            playbackLoadingRef.current = true;
            void loadSnapshot(next >= maxCursor ? undefined : next).finally(() => {
              playbackLoadingRef.current = false;
            });
          }
          if (next >= maxCursor) setPlaying(false);
          return next;
        });
      }, tickMs);
      return () => window.clearInterval(timer);
    }, [playing, isDemo, maxCursor, loadSnapshot, stats.nodes]);

    const showDemo = (count: number) => {
      const started = performance.now();
      setPlaying(false);
      showDemoFrame(count);
      setConnection(`DEMO ${Math.round(performance.now() - started)}MS`);
    };

    const seek = (cursor: number) => {
      setPlaying(false);
      if (isDemo) {
        showDemoFrame(demoCountRef.current, cursor, cursor >= maxCursor);
        return;
      }
      if (cursor >= maxCursor) {
        void loadSnapshot();
      } else {
        void loadSnapshot(cursor);
      }
    };

    const returnLive = () => {
      setPlaying(false);
      if (isDemo) showDemoFrame(demoCountRef.current);
      else void loadSnapshot();
    };

    const togglePlayback = async () => {
      if (playing) {
        setPlaying(false);
        return;
      }
      if (maxCursor <= 0) return;

      if (!isLive && viewCursor < maxCursor) {
        playbackStartRef.current = viewCursor;
        setPlaying(true);
        return;
      }

      const selected = PLAYBACK_WINDOWS.find((window) => window.key === playbackWindow)!;
      let startCursor = 0;
      if (isDemo) {
        const cursorSpan =
          selected.seconds === null
            ? DEMO_TIMELINE_CURSOR
            : Math.ceil(selected.seconds / 60);
        startCursor = Math.max(0, DEMO_TIMELINE_CURSOR - cursorSpan);
        showDemoFrame(demoCountRef.current, startCursor, false);
      } else {
        const query = selected.seconds === null ? "" : `?seconds=${selected.seconds}`;
        const range = await fetchJSON<TimelineRange>(
          `/api/plugins/hermes-graph/timeline/range${query}`,
        );
        startCursor = range.startCursor;
        if (range.endCursor <= startCursor) return;
        await loadSnapshot(startCursor);
      }
      playbackStartRef.current = startCursor;
      setPlaying(startCursor < maxCursor);
    };

    const saveTheme = (next: GraphTheme) => {
      setTheme(next);
      localStorage.setItem("hermes-graph:theme", JSON.stringify(next));
      sceneRef.current?.setTheme(next);
    };

    const setTypeColor = (kind: string, color: string) => {
      saveTheme({
        ...theme,
        nodeColors: { ...theme.nodeColors, [kind]: color },
      });
    };

    const setKanbanColor = (status: string, color: string) => {
      saveTheme({
        ...theme,
        kanbanColors: { ...theme.kanbanColors, [status]: color },
      });
    };

    const configureVault = async () => {
      if (!vaultPath.trim() || vaultBusy) return;
      setVaultBusy(true);
      setVaultMessage("INDEXING…");
      try {
        const result = await fetchJSON<VaultStatus>("/api/plugins/hermes-graph/vault/configure", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: vaultPath.trim() }),
        });
        setVaultPath(result.path || vaultPath);
        setVaultMessage(`${result.notes || 0} NOTES · ${result.links || 0} LINKS`);
        await loadSnapshot();
      } catch (error) {
        setVaultMessage(error instanceof Error ? error.message.toUpperCase() : "INDEX FAILED");
      } finally {
        setVaultBusy(false);
      }
    };

    const rows = hover ? metadataRows(hover.node) : [];
    return h(
      "div",
      { className: "hg-root" },
      h("canvas", { ref: canvasRef, className: "hg-canvas", "aria-label": "Hermes Graph 3D viewer" }),
      h(
        "div",
        { className: "hg-topbar" },
        h(
          "div",
          { className: "hg-brand" },
          h("span", { className: "hg-brand-mark" }, "✦"),
          h("span", null, "HERMES GRAPH"),
        ),
        h(
          "div",
          { className: "hg-stats" },
          h("span", null, `${stats.nodes.toLocaleString()} NODES`),
          h("span", null, `${Math.round(stats.edges).toLocaleString()} EDGES`),
          h("span", null, `${stats.fps || "—"} FPS`),
          h("span", { className: `hg-connection hg-${connection.toLowerCase().replace(/\s.*/, "")}` }, connection),
        ),
      ),
      h(
        "div",
        { className: "hg-demo-controls" },
        h("span", null, "PERF"),
        ...[10_000, 25_000, 50_000].map((count) =>
          h(
            "button",
            { key: count, type: "button", onClick: () => showDemo(count) },
            `${count / 1000}K`,
          ),
        ),
        h(
          "button",
          {
            type: "button",
            className: settingsOpen ? "hg-settings-button hg-selected" : "hg-settings-button",
            onClick: () => setSettingsOpen((current) => !current),
          },
          "SETTINGS",
        ),
        isDemo &&
          h(
            "button",
            { type: "button", className: "hg-live-button", onClick: () => void loadSnapshot() },
            "LIVE DATA",
          ),
      ),
      settingsOpen &&
        h(
          "div",
          { className: "hg-settings" },
          h("div", { className: "hg-settings-title" }, "OBSIDIAN VAULT"),
          h("input", {
            className: "hg-vault-path",
            type: "text",
            value: vaultPath,
            placeholder: "/path/to/vault",
            "aria-label": "Obsidian vault path",
            onChange: (event: Event) => setVaultPath((event.target as HTMLInputElement).value),
          }),
          h(
            "button",
            {
              type: "button",
              className: "hg-vault-connect",
              disabled: vaultBusy || !vaultPath.trim(),
              onClick: () => void configureVault(),
            },
            vaultBusy ? "INDEXING" : "CONNECT / REFRESH",
          ),
          h("div", { className: "hg-vault-message" }, vaultMessage),
          h("div", { className: "hg-settings-title hg-pressure-title" }, "NODE PALETTE"),
          ...[
            "note",
            "session",
            "agent",
            "subagent",
            "tool-vault",
            "tool-external",
            "artifact",
            "skill",
          ].map(
            (kind) =>
              h(
                "label",
                { className: "hg-color-row", key: kind },
                h("span", null, kind),
                h("input", {
                  type: "color",
                  value: theme.nodeColors[kind] || "#b9c4e8",
                  "aria-label": `${kind} node color`,
                  onChange: (event: Event) =>
                    setTypeColor(kind, (event.target as HTMLInputElement).value),
                }),
              ),
          ),
          h("div", { className: "hg-settings-title hg-pressure-title" }, "KANBAN STATUS"),
          ...["todo", "doing", "done", "blocked"].map((status) =>
            h(
              "label",
              { className: "hg-color-row", key: status },
              h("span", null, status),
              h("input", {
                type: "color",
                value: theme.kanbanColors[status],
                "aria-label": `Kanban ${status} color`,
                onChange: (event: Event) =>
                  setKanbanColor(status, (event.target as HTMLInputElement).value),
              }),
            ),
          ),
          h(
            "label",
            { className: "hg-scale-row" },
            h("span", null, `done fade ${theme.kanbanFadeHours}h`),
            h("input", {
              type: "range",
              min: 6,
              max: 48,
              step: 1,
              value: theme.kanbanFadeHours,
              "aria-label": "Kanban done fade hours",
              onChange: (event: Event) =>
                saveTheme({
                  ...theme,
                  kanbanFadeHours: Number((event.target as HTMLInputElement).value),
                }),
            }),
          ),
          h("div", { className: "hg-settings-title hg-pressure-title" }, "AGENT PRESSURE"),
          h(
            "label",
            { className: "hg-color-row" },
            h("span", null, "low"),
            h("input", {
              type: "color",
              value: theme.pressureLow,
              "aria-label": "Agent low pressure color",
              onChange: (event: Event) =>
                saveTheme({ ...theme, pressureLow: (event.target as HTMLInputElement).value }),
            }),
          ),
          h(
            "label",
            { className: "hg-color-row" },
            h("span", null, "limit"),
            h("input", {
              type: "color",
              value: theme.pressureHigh,
              "aria-label": "Agent context limit color",
              onChange: (event: Event) =>
                saveTheme({ ...theme, pressureHigh: (event.target as HTMLInputElement).value }),
            }),
          ),
          h(
            "label",
            { className: "hg-scale-row" },
            h("span", null, `max size ${theme.maxPressureScale.toFixed(1)}×`),
            h("input", {
              type: "range",
              min: 1.2,
              max: 5,
              step: 0.1,
              value: theme.maxPressureScale,
              "aria-label": "Agent maximum pressure size",
              onChange: (event: Event) =>
                saveTheme({
                  ...theme,
                  maxPressureScale: Number((event.target as HTMLInputElement).value),
              }),
            }),
          ),
          h("div", { className: "hg-settings-title hg-pressure-title" }, "NODE LINKS"),
          h(
            "label",
            { className: "hg-color-row" },
            h("span", null, "color"),
            h("input", {
              type: "color",
              value: theme.edgeColor,
              "aria-label": "Node link color",
              onChange: (event: Event) =>
                saveTheme({ ...theme, edgeColor: (event.target as HTMLInputElement).value }),
            }),
          ),
          h(
            "label",
            { className: "hg-scale-row" },
            h("span", null, `thickness ${theme.edgeThickness.toFixed(2)}px`),
            h("input", {
              type: "range",
              min: 0.25,
              max: 3,
              step: 0.05,
              value: theme.edgeThickness,
              "aria-label": "Node link thickness",
              onChange: (event: Event) =>
                saveTheme({
                  ...theme,
                  edgeThickness: Number((event.target as HTMLInputElement).value),
                }),
            }),
          ),
          h("div", { className: "hg-settings-title hg-pressure-title" }, "JUMP LINKS"),
          h(
            "label",
            { className: "hg-color-row" },
            h("span", null, "color"),
            h("input", {
              type: "color",
              value: theme.jumpColor,
              "aria-label": "Jump link color",
              onChange: (event: Event) =>
                saveTheme({ ...theme, jumpColor: (event.target as HTMLInputElement).value }),
            }),
          ),
          h(
            "label",
            { className: "hg-scale-row" },
            h("span", null, `thickness ${theme.jumpThickness.toFixed(1)}px`),
            h("input", {
              type: "range",
              min: 0.5,
              max: 8,
              step: 0.1,
              value: theme.jumpThickness,
              "aria-label": "Jump link thickness",
              onChange: (event: Event) =>
                saveTheme({
                  ...theme,
                  jumpThickness: Number((event.target as HTMLInputElement).value),
                }),
            }),
          ),
          h(
            "label",
            { className: "hg-scale-row" },
            h("span", null, `target size ${theme.jumpTargetScale.toFixed(1)}×`),
            h("input", {
              type: "range",
              min: 1,
              max: 5,
              step: 0.1,
              value: theme.jumpTargetScale,
              "aria-label": "Jump target size multiplier",
              onChange: (event: Event) =>
                saveTheme({
                  ...theme,
                  jumpTargetScale: Number((event.target as HTMLInputElement).value),
                }),
            }),
          ),
          h(
            "label",
            { className: "hg-scale-row" },
            h("span", null, `target brightness ${theme.jumpTargetBrightness.toFixed(1)}×`),
            h("input", {
              type: "range",
              min: 1,
              max: 6,
              step: 0.1,
              value: theme.jumpTargetBrightness,
              "aria-label": "Jump target brightness multiplier",
              onChange: (event: Event) =>
                saveTheme({
                  ...theme,
                  jumpTargetBrightness: Number((event.target as HTMLInputElement).value),
                }),
            }),
          ),
          h("div", { className: "hg-settings-title hg-pressure-title" }, "ACTIVITY ROUTING"),
          h(
            "div",
            { className: "hg-mode-toggle" },
            ...(["semantic", "beautiful"] as const).map((mode) =>
              h(
                "button",
                {
                  type: "button",
                  key: mode,
                  className: theme.activityMode === mode ? "hg-mode-active" : "",
                  onClick: () => saveTheme({ ...theme, activityMode: mode }),
                },
                mode.toUpperCase(),
              ),
            ),
          ),
          h(
            "label",
            { className: "hg-scale-row" },
            h("span", null, `beautiful hops ${theme.activityHopCount}`),
            h("input", {
              type: "range",
              min: 15,
              max: 150,
              step: 1,
              value: theme.activityHopCount,
              disabled: theme.activityMode !== "beautiful",
              "aria-label": "Beautiful route hop count",
              onChange: (event: Event) =>
                saveTheme({
                  ...theme,
                  activityHopCount: Number((event.target as HTMLInputElement).value),
                }),
            }),
          ),
          h(
            "label",
            { className: "hg-scale-row" },
            h("span", null, `hop delay ${theme.activityHopDelayMs}ms`),
            h("input", {
              type: "range",
              min: 5,
              max: 100,
              step: 5,
              value: theme.activityHopDelayMs,
              disabled: theme.activityMode !== "beautiful",
              "aria-label": "Beautiful route hop delay",
              onChange: (event: Event) =>
                saveTheme({
                  ...theme,
                  activityHopDelayMs: Number((event.target as HTMLInputElement).value),
                }),
            }),
          ),
          h(
            "label",
            { className: "hg-scale-row" },
            h("span", null, `route lifetime ${theme.activityTtlSeconds}s`),
            h("input", {
              type: "range",
              min: 10,
              max: 90,
              step: 5,
              value: theme.activityTtlSeconds,
              "aria-label": "Activity route lifetime",
              onChange: (event: Event) =>
                saveTheme({
                  ...theme,
                  activityTtlSeconds: Number((event.target as HTMLInputElement).value),
                }),
            }),
          ),
          h(
            "button",
            {
              type: "button",
              className: "hg-reset-theme",
              onClick: () =>
                saveTheme({
                  ...DEFAULT_THEME,
                  nodeColors: { ...DEFAULT_THEME.nodeColors },
                  kanbanColors: { ...DEFAULT_THEME.kanbanColors },
                }),
            },
            "RESET DEFAULTS",
          ),
        ),
      hover &&
        h(
          "div",
          {
            className: "hg-informant",
            style: {
              left: `${Math.min(hover.x + 18, window.innerWidth - 290)}px`,
              top: `${Math.max(16, hover.y - 24)}px`,
            },
          },
          h("div", { className: "hg-informant-kind" }, hover.node.kind.toUpperCase()),
          h("div", { className: "hg-informant-title" }, hover.node.label),
          ...rows.map(([key, value]) =>
            h(
              "div",
              { className: "hg-informant-row", key },
              h("span", null, key),
              h("strong", null, value),
            ),
          ),
        ),
      h(
        "div",
        { className: "hg-timeline" },
        h("span", { className: "hg-live-dot" }),
        h(
          "button",
          {
            type: "button",
            className: "hg-play",
            disabled: maxCursor <= 0,
            onClick: () => void togglePlayback(),
          },
          playing ? "PAUSE" : "PLAY",
        ),
        h(
          "select",
          {
            className: "hg-playback-window",
            value: playbackWindow,
            "aria-label": "Playback time range",
            onChange: (event: Event) =>
              setPlaybackWindow(
                (event.target as HTMLSelectElement).value as PlaybackWindowKey,
              ),
          },
          ...PLAYBACK_WINDOWS.map((window) =>
            h("option", { key: window.key, value: window.key }, window.label),
          ),
        ),
        h("input", {
          className: "hg-timeline-range",
          type: "range",
          min: 0,
          max: Math.max(1, maxCursor),
          value: isLive ? maxCursor : viewCursor,
          disabled: maxCursor <= 0,
          "aria-label": "Timeline cursor",
          onChange: (event: Event) => seek(Number((event.target as HTMLInputElement).value)),
        }),
        h(
          "button",
          {
            type: "button",
            className: isLive ? "hg-live-label hg-active" : "hg-live-label",
            onClick: returnLive,
          },
          isLive ? "LIVE" : "RETURN LIVE",
        ),
        h("span", { className: "hg-cursor" }, `CURSOR ${isLive ? maxCursor : viewCursor}`),
      ),
    );
  };
}
