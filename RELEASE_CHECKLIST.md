# Hermes Graph 0.1.0 release checklist

This is the release-candidate record for `Soleach-Agency/hermes-graph`. The owner
selected the MIT License and authorized publication on 2026-08-25. Publication
still waits for the integrated candidate to pass the live-host deployment and
compatibility checks below; authorization is not treated as evidence that those
checks passed.

## Package checks

| Check | Command | Result |
| --- | --- | --- |
| Native package doctor | `hermes plugins doctor . --ci` | PASS — Hermes 0.20.5; runtime discovery, manifest parsing, import, registration; 14 hooks |
| Backend tests | `python3 -m unittest discover -s tests -v` | PASS — 36 tests after dependency integration |
| Locked frontend install | `cd dashboard && npm ci` | PASS — 115 packages added; 0 vulnerabilities |
| Frontend tests | `cd dashboard && npm test -- --run` | PASS — 1 file, 1 test |
| Frontend build | `cd dashboard && npm run build` | PASS — TypeScript check and Vite build |
| Built bundle consistency | `git status --short` after build | PASS — regenerated `dashboard/dist/` produced no working-tree diff |
| Dashboard files | `dashboard/manifest.json` entry/css/api paths | PASS — `dist/index.js`, `dist/style.css`, and `plugin_api.py` exist |
| Diff hygiene | `git diff --check` | PASS |

## Compatibility matrix

`PASS` means the command or evidence was executed and observed in this release
worktree. `UNVERIFIED` is intentionally not a pass.

| Scenario | Evidence command or source | Result |
| --- | --- | --- |
| Supported Hermes version | `hermes --version` | PASS — Hermes Agent v0.20.5 |
| All declared hooks agree with registrations | `hermes plugins doctor . --ci`; `tests/test_plugin_package.py` | PASS — 14 declared and registered hooks |
| CLI event capture | Real Luna CLI exercise on the Soleach host | PASS for the pre-integration plugin — session `20260825_163254_871a9e`; repeat after candidate deployment remains required |
| Gateway/worker event capture | Gateway and Kanban-worker smoke run | UNVERIFIED — no gateway/worker host was available |
| Shared multi-profile store | Path contract plus real Luna/default Dashboard event store | PASS — all configured profiles resolve to `/root/.hermes/plugin-data/hermes-graph/events.sqlite3` |
| Cold startup and snapshot cursor | `tests/test_storage.py` snapshot/cursor tests | PASS — deterministic local contract; cold real-host restart remains UNVERIFIED |
| Reconnect behavior | Dashboard WebSocket reconnect smoke run | UNVERIFIED — no authenticated remote host was available |
| Kanban hydration | `tests/test_kanban_hydration.py`; startup registration test | PASS — five deterministic tests plus combined startup test |
| Vault watcher recovery | `tests/test_vault.py` incremental edit/rename/create/delete and recovery tests | PASS — watcher and recovery paths integrated |
| TTL cleanup/replay | `tests/test_storage.py` cleanup/delete/replay tests | PASS — temporary nodes and all temporary edge kinds covered |
| Authenticated remote Dashboard | Authenticated Dashboard discovery, snapshot, Vault, and asset smoke run | PASS for the pre-integration plugin; repeat after candidate deployment remains required |
| 10k visual smoke path | Dashboard deterministic `PERF` scene | PASS in the local in-app-browser visual pass |
| 25k visual smoke path | Dashboard deterministic `PERF` scene | PASS in the local in-app-browser visual pass |
| 50k visual smoke path | Dashboard deterministic `PERF` scene | PASS — settled at the development display's 120 FPS ceiling; hardware-specific, not a universal guarantee |

## Release gate

- [x] Owner chose and recorded the MIT License.
- [x] Owner authorized publication of `Soleach-Agency/hermes-graph`.
- [x] Dependency implementations are integrated and affected local checks rerun.
- [ ] An operator with the required host access reruns every `UNVERIFIED` cell and
  records the verbatim command/result without converting unavailable cells to pass.
- [ ] Only after the previous items are complete: create the repository release and
  then replace the provisional installation wording with the published release URL.
