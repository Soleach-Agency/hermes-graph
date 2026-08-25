# Hermes Graph 0.1.0 release checklist

This is a release-candidate record, not a publication claim. The repository target
visible in the checkout is `Soleach-Agency/hermes-graph`. No license choice or
publication authorization was supplied for this run, so no LICENSE file, tag,
GitHub release, or public install claim is created here.

## Package checks

| Check | Command | Result |
| --- | --- | --- |
| Native package doctor | `hermes plugins doctor . --ci` | PASS — Hermes 0.20.5; runtime discovery, manifest parsing, import, registration; 14 hooks |
| Backend tests | `python3 -m unittest discover -s tests -v` | PASS — 18 tests |
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
| CLI event capture | Real CLI exercise on a host with the plugin enabled | UNVERIFIED in this isolated worktree; no live host capture was repeated |
| Gateway/worker event capture | Gateway and Kanban-worker smoke run | UNVERIFIED — no gateway/worker host was available |
| Shared multi-profile store | `tests/test_storage.py::ProfileStoragePathTests::test_profile_home_resolves_to_shared_machine_database` | PASS — path contract; live multi-profile process run remains UNVERIFIED |
| Cold startup and snapshot cursor | `tests/test_storage.py` snapshot/cursor tests | PASS — deterministic local contract; cold real-host restart remains UNVERIFIED |
| Reconnect behavior | Dashboard WebSocket reconnect smoke run | UNVERIFIED — no authenticated remote host was available |
| Kanban hydration | Durable Kanban fixture and hydration test from the completed dependency card | UNVERIFIED in this checkout — hydration implementation is not present in the release branch |
| Vault watcher recovery | Vault unavailable/missed-event recovery smoke run | UNVERIFIED in this checkout — no watcher implementation is present in the release branch |
| TTL cleanup/replay | Expiry, delete-event, and replay tests from the completed dependency card | UNVERIFIED in this checkout — cleanup implementation is not present in the release branch |
| Authenticated remote Dashboard | Authenticated remote Dashboard + API/WebSocket smoke run | UNVERIFIED — no remote authenticated host was available |
| 10k visual smoke path | Dashboard deterministic `PERF` scene | UNVERIFIED — browser/GPU capture not available in this run |
| 25k visual smoke path | Dashboard deterministic `PERF` scene | UNVERIFIED — browser/GPU capture not available in this run |
| 50k visual smoke path | Dashboard deterministic `PERF` scene | UNVERIFIED — browser/GPU capture not available in this run |

## Release gate

- [ ] Owner chooses and records an explicit repository license.
- [ ] Owner authorizes publication of `Soleach-Agency/hermes-graph`.
- [ ] Dependency implementations are integrated into this release branch and the
  affected checks above are rerun.
- [ ] An operator with the required host access reruns every `UNVERIFIED` cell and
  records the verbatim command/result without converting unavailable cells to pass.
- [ ] Only after the previous items are complete: create the repository release and
  then replace the provisional installation wording with the published release URL.