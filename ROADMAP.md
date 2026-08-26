# Hermes Graph — Roadmap

Hermes Graph is now structured as one installable native Hermes plugin: lifecycle
observers, local history/API, and the pre-built Dashboard viewer ship together.

On a multi-profile Hermes host, every enabled profile writes to the same
machine-level SQLite WAL store; the source profile is retained on normalized events.

## Release status

The first real-host pass was completed on 2026-08-25 against Hermes 0.20.5. The
plugin passed `doctor --ci` with 14 hooks, was enabled for all seven profiles on
the Soleach host, served its authenticated Dashboard bundle/API, indexed the real
Vault, and captured a Luna CLI session plus terminal tool call in the shared store.
Gateway/Kanban-worker event coverage and remote reconnect behavior remain explicit
compatibility-matrix checks; an unavailable host is not a passing result.

The integrated first release includes incremental Vault synchronization,
existing runtime/session hydration, durable Kanban topology, replay-preserving
transient cleanup, a complete native plugin entry point, matching hook manifest,
authenticated Dashboard API declaration, and the pre-built Dashboard bundle.
The owner selected MIT, published the repository, and released the portable
Hermes 0.20.5-compatible `v0.1.1` package. The historical evidence is retained in
`RELEASE_CHECKLIST.md` and `RELEASE_CHECKLIST_0.1.1.md`.

The `0.2.0` candidate on `codex/lifecycle-settings` adds completed runtime
retirement, owned-tool-first fade sequencing, persistent visual preferences,
editable tool routing overrides, configurable Vault result-field mapping,
generic extraction from nested MCP text envelopes, freely draggable timeline
scrubbing, frame-driven playback with overlapping easing, and stable runtime
placement that puts new owners into open space without displacing existing ones.
Playback timing is configurable in two mutually exclusive modes: a fixed total
run duration for any selected window, or a real-duration scale per source-time
hour. Each mode retains its own value and seconds/minutes/hours unit, and the
preference is persisted with the rest of the graph settings.
Community defaults contain no Soleach- or vendor-specific tool rules. Local
verification currently covers 40 backend tests, ten frontend tests, and the
production build. Live Soleach validation resolved three RAG result paths to
three real Vault nodes and emitted three temporary `retrieved` edges. All seven
Soleach profile-local plugin copies carry the exact current candidate commit;
Dashboard was restarted independently while Gateway and its running work stayed
untouched.

## Next data-fidelity work

- Add artifact nodes and provenance from the stable Hermes surfaces that expose
  them.
- Add generated/self-improving skill nodes and connect them to their creator,
  session, artifacts, and later tool usage.
- Use an authoritative model context limit so agent pressure is shown only when the
  ratio is trustworthy.
- Expand structured result adapters beyond configured scalar fields and nested
  text labels without ever storing complete result bodies.
- Validate the current candidate against additional supported Hermes versions;
  the real-host matrix is presently anchored to Hermes 0.20.5.
- Merge, tag, and publish `0.2.0` after an authenticated visual smoke pass records
  saved settings, fade ordering, a live RAG jump, and timeline playback over real
  retained event history.

## Deliberately later

- Query builders and advanced filters.
- Embedding-driven semantic positioning.
- Multi-Hermes / multi-machine worlds.
- Editing or controlling Hermes from the graph.
- General analytics dashboards and enterprise multi-tenant features.
