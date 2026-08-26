import { createDemoSnapshot, DEMO_TIMELINE_CURSOR } from "./demo";
import { GraphScene } from "./GraphScene";
import { mergeTimelapseAnimation } from "./routeAnimation";
import { interpolatePlaybackCursor, resolvePlaybackDurationMs } from "./timeline";
import {
  DEFAULT_PLAYBACK,
  DEFAULT_THEME,
  DEFAULT_TOOL_RULES,
  type GraphPreferences,
  type GraphTheme,
  type PlaybackDurationSetting,
  type PlaybackDurationUnit,
  type PlaybackMode,
  type PlaybackPreferences,
  type SceneNode,
  type SceneSnapshot,
  type TimelapseAnimationPreferences,
  type ToolRoutingRule,
} from "./types";

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

function mergeTheme(saved?: Partial<GraphTheme> | null): GraphTheme {
  const migratedHopDelay =
    saved?.jumpTimingVersion === 2
      ? saved.activityHopDelayMs ?? DEFAULT_THEME.activityHopDelayMs
      : (saved?.activityHopDelayMs ?? 250) / 10;
  return {
    ...DEFAULT_THEME,
    ...saved,
    jumpTimingVersion: 2,
    activityHopDelayMs: migratedHopDelay,
    edgeColor:
      saved?.edgeThickness === undefined
        ? DEFAULT_THEME.edgeColor
        : saved.edgeColor || DEFAULT_THEME.edgeColor,
    nodeColors: { ...DEFAULT_THEME.nodeColors, ...saved?.nodeColors },
    kanbanColors: { ...DEFAULT_THEME.kanbanColors, ...saved?.kanbanColors },
  };
}

function mergeDurationSetting(
  saved: Partial<PlaybackDurationSetting> | null | undefined,
  fallback: PlaybackDurationSetting,
): PlaybackDurationSetting {
  const units: PlaybackDurationUnit[] = ["seconds", "minutes", "hours"];
  const value = Number(saved?.value);
  return {
    value: Number.isFinite(value) ? Math.max(0.1, Math.min(1000, value)) : fallback.value,
    unit: units.includes(saved?.unit as PlaybackDurationUnit)
      ? (saved?.unit as PlaybackDurationUnit)
      : fallback.unit,
  };
}

function mergePlayback(saved?: Partial<PlaybackPreferences> | null): PlaybackPreferences {
  return {
    mode: saved?.mode === "per-source-hour" ? "per-source-hour" : "fixed-duration",
    fixedDuration: mergeDurationSetting(
      saved?.fixedDuration,
      DEFAULT_PLAYBACK.fixedDuration,
    ),
    perSourceHour: mergeDurationSetting(
      saved?.perSourceHour,
      DEFAULT_PLAYBACK.perSourceHour,
    ),
  };
}

function loadLocalPreferences(): GraphPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem("hermes-graph:theme") || "null") as
      | Partial<GraphTheme>
      | null;
    const playback = JSON.parse(
      localStorage.getItem("hermes-graph:playback") || "null",
    ) as Partial<PlaybackPreferences> | null;
    const timelapse = JSON.parse(
      localStorage.getItem("hermes-graph:timelapse") || "null",
    ) as Partial<TimelapseAnimationPreferences> | null;
    return {
      theme: mergeTheme(saved),
      toolRules: [...DEFAULT_TOOL_RULES],
      playback: mergePlayback(playback),
      timelapse: mergeTimelapseAnimation(timelapse),
    };
  } catch {
    return {
      theme: mergeTheme(),
      toolRules: [...DEFAULT_TOOL_RULES],
      playback: mergePlayback(),
      timelapse: mergeTimelapseAnimation(),
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
    const playbackEndRef = React.useRef(0);
    const playbackDurationMsRef = React.useRef(24_000);
    const playbackLoadingRef = React.useRef(false);
    const snapshotRequestRef = React.useRef(0);
    const seekTimerRef = React.useRef(0);
    const seekCursorRef = React.useRef(0);
    const initialPreferencesRef = React.useRef<GraphPreferences>(loadLocalPreferences());
    const [hover, setHover] = React.useState<HoverState>(null);
    const [stats, setStats] = React.useState<Stats>({ nodes: 0, edges: 0, fps: 0 });
    const [connection, setConnection] = React.useState("CONNECTING");
    const [isDemo, setIsDemo] = React.useState(false);
    const [isLive, setIsLive] = React.useState(true);
    const [playing, setPlaying] = React.useState(false);
    const [viewCursor, setViewCursor] = React.useState(0);
    const [maxCursor, setMaxCursor] = React.useState(0);
    const [theme, setTheme] = React.useState(initialPreferencesRef.current.theme);
    const [toolRules, setToolRules] = React.useState<ToolRoutingRule[]>(
      initialPreferencesRef.current.toolRules,
    );
    const [playback, setPlayback] = React.useState<PlaybackPreferences>(
      initialPreferencesRef.current.playback,
    );
    const [timelapse, setTimelapse] = React.useState<TimelapseAnimationPreferences>(
      initialPreferencesRef.current.timelapse,
    );
    const [knownTools, setKnownTools] = React.useState<string[]>([]);
    const [settingsBusy, setSettingsBusy] = React.useState(false);
    const [settingsMessage, setSettingsMessage] = React.useState("NOT SAVED");
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

    const loadSnapshot = React.useCallback(async (
      at?: number,
      updateView = true,
      activityAfter?: number,
    ) => {
      const requestId = ++snapshotRequestRef.current;
      try {
        const suffix = at === undefined
          ? ""
          : `?at=${Math.max(0, Math.round(at))}${
              activityAfter === undefined
                ? ""
                : `&activityAfter=${Math.max(0, Math.round(activityAfter))}`
            }`;
        const snapshot = await fetchJSON<SceneSnapshot>(
          `/api/plugins/hermes-graph/snapshot${suffix}`,
        );
        if (requestId !== snapshotRequestRef.current) return;
        if (at === undefined) {
          cursorRef.current = snapshot.cursor;
          setMaxCursor(snapshot.cursor);
          setViewCursor(snapshot.cursor);
          setIsLive(true);
          liveRef.current = true;
        } else {
          if (updateView) setViewCursor(snapshot.cursor);
          setIsLive(false);
          liveRef.current = false;
        }
        if (snapshot.nodes.length === 0 && options.demoOnEmpty) {
          showDemoFrame(10_000);
        } else {
          sceneRef.current?.setSnapshot(snapshot);
          setIsDemo(false);
        }
        setKnownTools((current) => Array.from(new Set([
          ...current,
          ...snapshot.nodes.filter((node) => node.kind === "tool").map((node) => node.label),
        ])).sort((left, right) => left.localeCompare(right)));
        setConnection("LIVE");
        return snapshot;
      } catch (error) {
        if (requestId !== snapshotRequestRef.current) return;
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
        theme: initialPreferencesRef.current.theme,
        timelapse: initialPreferencesRef.current.timelapse,
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
        window.clearTimeout(seekTimerRef.current);
        socket?.close();
        scene.dispose();
        sceneRef.current = null;
      };
    }, []);

    React.useEffect(() => {
      void fetchJSON<Partial<GraphPreferences>>("/api/plugins/hermes-graph/settings")
        .then((saved) => {
          const hasServerPreferences =
            Boolean(saved.theme && Object.keys(saved.theme).length) ||
            Boolean(saved.toolRules?.length);
          if (!hasServerPreferences) {
            setSettingsMessage("LOCAL SETTINGS · SAVE TO SERVER");
            return;
          }
          const nextTheme = mergeTheme(saved.theme);
          const nextRules = Array.isArray(saved.toolRules) ? saved.toolRules : [];
          const nextPlayback = mergePlayback(saved.playback);
          const nextTimelapse = mergeTimelapseAnimation(saved.timelapse);
          setTheme(nextTheme);
          setToolRules(nextRules);
          setPlayback(nextPlayback);
          setTimelapse(nextTimelapse);
          sceneRef.current?.setTheme(nextTheme);
          sceneRef.current?.setTimelapseAnimation(nextTimelapse);
          setSettingsMessage("SAVED ON SERVER");
        })
        .catch(() => setSettingsMessage("LOCAL FALLBACK"));
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
      if (!playing) return;
      const startCursor = playbackStartRef.current;
      const endCursor = playbackEndRef.current;
      if (endCursor <= startCursor) {
        setPlaying(false);
        return;
      }
      const snapshotCadenceMs =
        stats.nodes >= 40_000 ? 620 : stats.nodes >= 20_000 ? 430 : 260;
      const transitionSeconds =
        stats.nodes >= 40_000 ? 1.8 : stats.nodes >= 20_000 ? 1.5 : 1.2;
      sceneRef.current?.setTransitionDuration(transitionSeconds);
      const startedAt = performance.now();
      const durationMs = playbackDurationMsRef.current;
      let lastSnapshotAt = -snapshotCadenceMs;
      let activityAfterCursor = startCursor;
      let frame = 0;
      let disposed = false;

      const tick = (now: number) => {
        if (disposed) return;
        const elapsed = now - startedAt;
        const progress = Math.min(1, Math.max(0, elapsed / durationMs));
        const next = interpolatePlaybackCursor(
          startCursor,
          endCursor,
          elapsed,
          durationMs,
        );
        setViewCursor(next);
        setIsLive(false);
        liveRef.current = false;

        if (now - lastSnapshotAt >= snapshotCadenceMs && !playbackLoadingRef.current) {
          lastSnapshotAt = now;
          if (isDemo) {
            sceneRef.current?.setSnapshot(createDemoSnapshot(demoCountRef.current, next));
          } else {
            playbackLoadingRef.current = true;
            void loadSnapshot(next, false, activityAfterCursor)
              .then((snapshot) => {
                if (snapshot) activityAfterCursor = snapshot.cursor;
              })
              .finally(() => {
                playbackLoadingRef.current = false;
              });
          }
        }

        if (progress >= 1) {
          sceneRef.current?.setTransitionDuration(0.72);
          setPlaying(false);
          if (isDemo) showDemoFrame(demoCountRef.current, endCursor, true);
          else void loadSnapshot();
          return;
        }
        frame = window.requestAnimationFrame(tick);
      };
      frame = window.requestAnimationFrame(tick);
      return () => {
        disposed = true;
        window.cancelAnimationFrame(frame);
      };
    }, [playing, isDemo, loadSnapshot, showDemoFrame]);

    const showDemo = (count: number) => {
      const started = performance.now();
      setPlaying(false);
      showDemoFrame(count);
      setConnection(`DEMO ${Math.round(performance.now() - started)}MS`);
    };

    const commitSeek = (cursor = seekCursorRef.current) => {
      window.clearTimeout(seekTimerRef.current);
      if (isDemo) {
        sceneRef.current?.setSnapshot(createDemoSnapshot(demoCountRef.current, cursor));
        return;
      }
      void loadSnapshot(cursor >= maxCursor ? undefined : cursor);
    };

    const seek = (cursor: number, immediate = false) => {
      const next = Math.max(0, Math.min(maxCursor, Math.round(cursor)));
      setPlaying(false);
      sceneRef.current?.setTransitionDuration(0.24);
      snapshotRequestRef.current += 1;
      seekCursorRef.current = next;
      setViewCursor(next);
      const atLiveEdge = next >= maxCursor;
      setIsLive(atLiveEdge);
      liveRef.current = atLiveEdge;
      window.clearTimeout(seekTimerRef.current);
      if (immediate) commitSeek(next);
      else seekTimerRef.current = window.setTimeout(() => commitSeek(next), 80);
    };

    const returnLive = () => {
      setPlaying(false);
      window.clearTimeout(seekTimerRef.current);
      snapshotRequestRef.current += 1;
      sceneRef.current?.setTransitionDuration(0.72);
      if (isDemo) showDemoFrame(demoCountRef.current);
      else void loadSnapshot();
    };

    const beginPlayback = (
      startCursor: number,
      endCursor: number,
      sourceSeconds: number,
    ) => {
      playbackStartRef.current = startCursor;
      playbackEndRef.current = endCursor;
      playbackDurationMsRef.current = resolvePlaybackDurationMs(playback, sourceSeconds);
      setPlaying(startCursor < endCursor);
    };

    const togglePlayback = async () => {
      if (playing) {
        setPlaying(false);
        snapshotRequestRef.current += 1;
        sceneRef.current?.setTransitionDuration(0.24);
        commitSeek(viewCursor);
        return;
      }
      if (maxCursor <= 0) return;
      window.clearTimeout(seekTimerRef.current);
      snapshotRequestRef.current += 1;
      setIsLive(false);
      liveRef.current = false;

      if (!isLive && viewCursor < maxCursor) {
        if (isDemo) {
          beginPlayback(viewCursor, maxCursor, (maxCursor - viewCursor) * 60);
          return;
        }
        const [range, startSnapshot] = await Promise.all([
          fetchJSON<TimelineRange>("/api/plugins/hermes-graph/timeline/range"),
          loadSnapshot(viewCursor, false),
        ]);
        const sourceStartAt = Number(startSnapshot?.asOf || 0) || range.startAt || 0;
        const sourceSeconds = Math.max(1, Number(range.endAt || 0) - sourceStartAt);
        beginPlayback(viewCursor, range.endCursor, sourceSeconds);
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
        beginPlayback(
          startCursor,
          DEMO_TIMELINE_CURSOR,
          (DEMO_TIMELINE_CURSOR - startCursor) * 60,
        );
      } else {
        const query = selected.seconds === null ? "" : `?seconds=${selected.seconds}`;
        const range = await fetchJSON<TimelineRange>(
          `/api/plugins/hermes-graph/timeline/range${query}`,
        );
        startCursor = range.startCursor;
        if (range.endCursor <= startCursor) return;
        await loadSnapshot(startCursor);
        beginPlayback(
          startCursor,
          range.endCursor,
          Math.max(1, Number(range.endAt || 0) - Number(range.startAt || 0)),
        );
      }
    };

    const updatePlaybackMode = (mode: PlaybackMode) => {
      setPlayback((current) => ({ ...current, mode }));
      setSettingsMessage("UNSAVED CHANGES");
    };

    const updatePlaybackDuration = (patch: Partial<PlaybackDurationSetting>) => {
      setPlayback((current) => {
        const key = current.mode === "fixed-duration" ? "fixedDuration" : "perSourceHour";
        return {
          ...current,
          [key]: mergeDurationSetting({ ...current[key], ...patch }, current[key]),
        };
      });
      setSettingsMessage("UNSAVED CHANGES");
    };

    const previewTheme = (next: GraphTheme) => {
      setTheme(next);
      setSettingsMessage("UNSAVED CHANGES");
      sceneRef.current?.setTheme(next);
    };

    const previewTimelapse = (patch: Partial<TimelapseAnimationPreferences>) => {
      const next = mergeTimelapseAnimation({ ...timelapse, ...patch });
      setTimelapse(next);
      setSettingsMessage("UNSAVED CHANGES");
      sceneRef.current?.setTimelapseAnimation(next);
    };

    const setTypeColor = (kind: string, color: string) => {
      previewTheme({
        ...theme,
        nodeColors: { ...theme.nodeColors, [kind]: color },
      });
    };

    const setKanbanColor = (status: string, color: string) => {
      previewTheme({
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

    const updateToolRule = (index: number, patch: Partial<ToolRoutingRule>) => {
      setToolRules((current) => current.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule,
      ));
      setSettingsMessage("UNSAVED CHANGES");
    };

    const addToolRule = () => {
      setToolRules((current) => [
        ...current,
        { tool: "", direction: "vault", referenceField: "path" },
      ]);
      setSettingsMessage("UNSAVED CHANGES");
    };

    const removeToolRule = (index: number) => {
      setToolRules((current) => current.filter((_, ruleIndex) => ruleIndex !== index));
      setSettingsMessage("UNSAVED CHANGES");
    };

    const persistSettings = async () => {
      if (settingsBusy) return;
      setSettingsBusy(true);
      setSettingsMessage("SAVING…");
      try {
        const saved = await fetchJSON<GraphPreferences>("/api/plugins/hermes-graph/settings", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ theme, toolRules, playback, timelapse }),
        });
        const nextTheme = mergeTheme(saved.theme);
        const nextPlayback = mergePlayback(saved.playback);
        const nextTimelapse = mergeTimelapseAnimation(saved.timelapse);
        setTheme(nextTheme);
        setToolRules(saved.toolRules || []);
        setPlayback(nextPlayback);
        setTimelapse(nextTimelapse);
        localStorage.setItem("hermes-graph:theme", JSON.stringify(nextTheme));
        localStorage.setItem("hermes-graph:playback", JSON.stringify(nextPlayback));
        localStorage.setItem("hermes-graph:timelapse", JSON.stringify(nextTimelapse));
        sceneRef.current?.setTheme(nextTheme);
        sceneRef.current?.setTimelapseAnimation(nextTimelapse);
        setSettingsMessage("SAVED ON SERVER");
      } catch (error) {
        setSettingsMessage(error instanceof Error ? "SAVE FAILED" : "ERROR");
      } finally {
        setSettingsBusy(false);
      }
    };

    const rows = hover ? metadataRows(hover.node) : [];
    const toolOptions = Array.from(new Set([
      ...knownTools,
      ...toolRules.map((rule) => rule.tool).filter(Boolean),
    ])).sort((left, right) => left.localeCompare(right));
    const activePlaybackDuration = playback.mode === "fixed-duration"
      ? playback.fixedDuration
      : playback.perSourceHour;
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
                previewTheme({
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
                previewTheme({ ...theme, pressureLow: (event.target as HTMLInputElement).value }),
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
                previewTheme({ ...theme, pressureHigh: (event.target as HTMLInputElement).value }),
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
                previewTheme({
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
                previewTheme({ ...theme, edgeColor: (event.target as HTMLInputElement).value }),
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
                previewTheme({
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
                previewTheme({ ...theme, jumpColor: (event.target as HTMLInputElement).value }),
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
                previewTheme({
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
                previewTheme({
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
                previewTheme({
                  ...theme,
                  jumpTargetBrightness: Number((event.target as HTMLInputElement).value),
                }),
            }),
          ),
          h("div", { className: "hg-settings-title hg-pressure-title" }, "TIMELAPSE ANIMATION"),
          h(
            "div",
            { className: "hg-tool-help" },
            "Animation timing stays constant even when the selected timeline plays faster.",
          ),
          h(
            "label",
            { className: "hg-scale-row" },
            h("span", null, `jump duration ${timelapse.jumpDurationSeconds.toFixed(1)}s`),
            h("input", {
              type: "range",
              min: 0.1,
              max: 10,
              step: 0.1,
              value: timelapse.jumpDurationSeconds,
              "aria-label": "Timelapse jump duration seconds",
              onChange: (event: Event) =>
                previewTimelapse({
                  jumpDurationSeconds: Number((event.target as HTMLInputElement).value),
                }),
            }),
          ),
          h(
            "label",
            { className: "hg-scale-row" },
            h("span", null, `fade duration ${timelapse.fadeDurationSeconds.toFixed(1)}s`),
            h("input", {
              type: "range",
              min: 0.2,
              max: 10,
              step: 0.1,
              value: timelapse.fadeDurationSeconds,
              "aria-label": "Timelapse fade duration seconds",
              onChange: (event: Event) =>
                previewTimelapse({
                  fadeDurationSeconds: Number((event.target as HTMLInputElement).value),
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
                  onClick: () => previewTheme({ ...theme, activityMode: mode }),
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
                previewTheme({
                  ...theme,
                  activityHopCount: Number((event.target as HTMLInputElement).value),
                }),
            }),
          ),
          h("div", { className: "hg-settings-title hg-pressure-title" }, "TOOL OVERRIDES"),
          h(
            "div",
            { className: "hg-tool-help" },
            "Override name heuristics and map a returned field to Vault paths.",
          ),
          h(
            "datalist",
            { id: "hg-known-tools" },
            ...toolOptions.map((tool) => h("option", { key: tool, value: tool })),
          ),
          ...toolRules.map((rule, index) =>
            h(
              "div",
              { className: "hg-tool-rule", key: `${index}:${rule.tool}` },
              h("input", {
                type: "text",
                list: "hg-known-tools",
                value: rule.tool,
                placeholder: "tool name",
                "aria-label": `Tool override ${index + 1} name`,
                onChange: (event: Event) =>
                  updateToolRule(index, { tool: (event.target as HTMLInputElement).value }),
              }),
              h(
                "select",
                {
                  value: rule.direction,
                  "aria-label": `Tool override ${index + 1} direction`,
                  onChange: (event: Event) =>
                    updateToolRule(index, {
                      direction: (event.target as HTMLSelectElement).value as ToolRoutingRule["direction"],
                    }),
                },
                h("option", { value: "vault" }, "VAULT"),
                h("option", { value: "external" }, "EXTERNAL"),
                h("option", { value: "local" }, "LOCAL"),
              ),
              h(
                "select",
                {
                  value: rule.referenceField,
                  disabled: rule.direction !== "vault",
                  "aria-label": `Tool override ${index + 1} Vault result field`,
                  onChange: (event: Event) =>
                    updateToolRule(index, {
                      referenceField: (event.target as HTMLSelectElement).value,
                    }),
                },
                h("option", { value: "" }, "NO FIELD"),
                ...["path", "file", "filepath", "note", "source", "title"].map((field) =>
                  h("option", { key: field, value: field }, field.toUpperCase()),
                ),
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "hg-tool-remove",
                  "aria-label": `Remove tool override ${index + 1}`,
                  onClick: () => removeToolRule(index),
                },
                "REMOVE",
              ),
            ),
          ),
          h(
            "button",
            { type: "button", className: "hg-tool-add", onClick: addToolRule },
            "+ ADD TOOL OVERRIDE",
          ),
          h(
            "button",
            {
              type: "button",
              className: "hg-reset-theme",
              onClick: () =>
                previewTheme({
                  ...DEFAULT_THEME,
                  nodeColors: { ...DEFAULT_THEME.nodeColors },
                  kanbanColors: { ...DEFAULT_THEME.kanbanColors },
                }),
            },
            "RESET VISUAL DEFAULTS",
          ),
          h(
            "button",
            {
              type: "button",
              className: "hg-save-settings",
              disabled: settingsBusy,
              onClick: () => void persistSettings(),
            },
            settingsBusy ? "SAVING…" : "SAVE SETTINGS",
          ),
          h("div", { className: "hg-settings-message" }, settingsMessage),
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
        h(
          "div",
          {
            className: "hg-playback-speed",
            title: playback.mode === "fixed-duration"
              ? "Play every selected window in this total real duration"
              : "Real duration used for each source-time hour",
          },
          h(
            "select",
            {
              className: "hg-playback-mode",
              value: playback.mode,
              disabled: playing,
              "aria-label": "Playback speed mode",
              onChange: (event: Event) =>
                updatePlaybackMode(
                  (event.target as HTMLSelectElement).value as PlaybackMode,
                ),
            },
            h("option", { value: "fixed-duration" }, "TOTAL"),
            h("option", { value: "per-source-hour" }, "1H SOURCE"),
          ),
          h("span", { className: "hg-playback-equals" }, "="),
          h("input", {
            className: "hg-playback-value",
            type: "number",
            min: 0.1,
            max: 1000,
            step: 0.1,
            value: activePlaybackDuration.value,
            disabled: playing,
            "aria-label": "Playback duration value",
            onChange: (event: Event) =>
              updatePlaybackDuration({
                value: Number((event.target as HTMLInputElement).value),
              }),
          }),
          h(
            "select",
            {
              className: "hg-playback-unit",
              value: activePlaybackDuration.unit,
              disabled: playing,
              "aria-label": "Playback duration unit",
              onChange: (event: Event) =>
                updatePlaybackDuration({
                  unit: (event.target as HTMLSelectElement).value as PlaybackDurationUnit,
                }),
            },
            h("option", { value: "seconds" }, "SEC"),
            h("option", { value: "minutes" }, "MIN"),
            h("option", { value: "hours" }, "HOUR"),
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
          onInput: (event: Event) => seek(Number((event.target as HTMLInputElement).value)),
          onPointerUp: () => commitSeek(),
          onKeyUp: () => commitSeek(),
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
