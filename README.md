# Hermes Graph

Hermes Graph is a Hermes Agent plugin that renders live agent activity, sessions, Kanban tasks, tools, artifacts, and Obsidian knowledge as a 3D animated world inside the Hermes Web Dashboard.

The product scope lives in [`PROJECT_SCOPE.md`](PROJECT_SCOPE.md).

## Current vertical slice

- Native Hermes agent plugin with observer-only lifecycle hooks.
- Hermes Dashboard tab at `/hermes-graph`.
- Central spherical Obsidian vault cluster generated from real Markdown files and `[[wikilinks]]`.
- Link-degree centrality: heavily linked notes settle deeper in the vault sphere.
- Sessions, agents, Kanban cards, subagent swarms, and tool satellites arranged around the vault.
- One GPU-batched, star-like node geometry for every entity type.
- Batched edge rendering.
- Configurable node-type and four-state Kanban colors.
- Configurable agent context-pressure gradient, white to purple by default.
- Agent nodes grow as context pressure rises.
- Configurable 6–48 hour Done-card shrink/darken/fade lifecycle.
- Semantic/direct and 15–150-hop beautiful vault retrieval animations.
- Independent color/thickness controls for persistent links and jump links, plus configurable hop-by-hop target size/brightness pulses and smooth timeline interpolation.
- Activity links exist only while their call/retrieval/return animation is active, then fade away without leaving a static duplicate.
- External tool result materialization with short-lived result stars.
- Type-appropriate hover informant.
- SQLite WAL event history shared across Hermes processes.
- Current scene snapshot plus cursor-based live WebSocket stream.
- Historical scene reconstruction and timeline controls.
- Playback windows for 1 hour, 6 hours, 1 day (default), 7 days, 30 days, or the complete retained history.
- Built-in 10k, 25k, and 50k node performance scenes.

Vault indexing is available from the viewer's **Settings** panel: enter the vault directory that is visible to the machine running Hermes, then choose **Connect / Refresh**. The plugin-owned watcher keeps Markdown creates, edits, renames, and deletes synchronized after configuration; **Connect / Refresh** remains the explicit recovery path when the vault was unavailable or events were missed. Kanban hydration is read-only and preserves task/dependency topology without copying card bodies or comments.

## Plugin layout

```text
plugin.yaml                     Hermes agent plugin manifest
__init__.py                     plugin register(ctx) entry point
hermes_graph/                   hook normalization, SQLite history, projection
dashboard/manifest.json         Hermes Dashboard extension manifest
dashboard/plugin_api.py         authenticated snapshot/live/history routes
dashboard/src/                  TypeScript + direct Three.js viewer
dashboard/dist/                 pre-built installable IIFE bundle
tests/                          backend contract and replay tests
```

Hermes officially supports these agent and Dashboard halves in the same plugin directory. The viewer uses the Dashboard's React instance but renders the 3D scene directly with Three.js.

The remaining work is tracked in [`ROADMAP.md`](ROADMAP.md), separated into first-release requirements, data-fidelity improvements, and deliberately later work.

## Development

Requirements:

- Node.js 20 or newer
- Python 3.11 or newer

Build and test:

```bash
cd dashboard
npm ci
npm run build

npm test -- --run

cd ..
python3 -m unittest discover -s tests -v
```

Run the standalone visual development scene:

```bash
cd dashboard
npm run dev
```

Open `http://127.0.0.1:5173/`. When the Hermes API is absent, development mode loads the deterministic 10k-node scene. Use the `PERF` controls for the larger scenes.

## Installation and lifecycle

The source repository is `Soleach-Agency/hermes-graph`. A local checkout can be installed by copying or cloning this directory to:

```text
~/.hermes/plugins/hermes-graph/
```

Then enable the agent half and start or restart the Dashboard:

```bash
hermes plugins enable hermes-graph
hermes dashboard --no-open
```

Open the Dashboard and choose **Hermes Graph** in its navigation. Dashboard API routes are protected by Hermes' normal Dashboard authentication gate.

Before publishing or after upgrading Hermes, validate the directory with the host's own loader:

```bash
hermes plugins doctor ~/.hermes/plugins/hermes-graph --ci
```

Install the published repository with:

```bash
hermes plugins install Soleach-Agency/hermes-graph --no-enable
hermes plugins enable hermes-graph
hermes plugins doctor ~/.hermes/plugins/hermes-graph --ci
```

The pre-built Dashboard bundle is included, so end users do not need Node.js or npm. To upgrade an installed checkout, run `hermes plugins update hermes-graph`, then run the doctor command and restart the Dashboard. To roll back, reinstall a previously verified commit with `hermes plugins install Soleach-Agency/hermes-graph --ref <40-character-commit-sha> --force`, validate it, and enable it again. Disable without deleting data with `hermes plugins disable hermes-graph`; remove the plugin with `hermes plugins uninstall hermes-graph` only after preserving any data required for a later migration.

The plugin has no separate collector or service. Its SQLite store is local and plugin-owned. To migrate or preserve local data, stop Hermes, copy `$HERMES_HOME/plugin-data/hermes-graph/events.sqlite3` together with its `-wal` and `-shm` companions when present, install the target version, and restore the files before restarting. The older `$HERMES_HOME/hermes-graph/events.sqlite3` location is read as a compatibility fallback; no remote upload or automatic cloud migration occurs.

For an internet-reachable Hermes server, bind the Dashboard only with Hermes' authenticated configuration. `--insecure` is deprecated and does not disable authentication; prefer the default loopback bind and an authenticated tunnel. Never expose an unauthenticated Dashboard port publicly.

## Data location

Fresh installations store local history in Hermes' plugin-owned data directory:

```text
$HERMES_HOME/plugin-data/hermes-graph/events.sqlite3
```

If an earlier prototype database exists at `$HERMES_HOME/hermes-graph/events.sqlite3`, it is reused automatically. If `HERMES_HOME` is unset, the normal `~/.hermes` location is used. SQLite runs in WAL mode because Hermes hooks may fire from gateway, CLI, dispatcher, and Kanban worker processes.

Named Hermes profiles resolve back to the same machine-level database. This is intentional: sessions from `default`, `home`, worker/model profiles, and the unified Dashboard belong to one spatial world. Set `HERMES_GRAPH_DATA_DIR` only when an operator explicitly needs a different shared data root.

Raw prompt and message fields are excluded from recorded hook payloads by default.
Vault note contents are not copied into the event database. The index stores relative paths, display titles, and resolved graph links only.

## Performance design

Nodes are not individual React or Three.js objects. All visible nodes are attributes in one `THREE.Points` geometry and all edges are batched into one `THREE.LineSegments` geometry. The star appearance, glow, color, pressure size, and subtle active-state twinkle are calculated on the GPU.

The built-in benchmark is a practical visual smoke test rather than a formal cross-device score. In the current in-app-browser pass, the 50,000-node / 70,326-edge deterministic scene held 120 FPS after settling; results will naturally vary by GPU, display refresh rate, and browser.

## Official Hermes references

- [Build a Hermes Plugin](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins)
- [Plugin lifecycle hooks](https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks)
- [Extending the Web Dashboard](https://hermes-agent.nousresearch.com/docs/user-guide/features/extending-the-dashboard)

## License

Hermes Graph is released under the [MIT License](LICENSE), matching Hermes Agent's permissive license.
