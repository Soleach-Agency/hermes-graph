# Hermes Graph — Roadmap

Hermes Graph is now structured as one installable native Hermes plugin: lifecycle
observers, local history/API, and the pre-built Dashboard viewer ship together.

On a multi-profile Hermes host, every enabled profile writes to the same
machine-level SQLite WAL store; the source profile is retained on normalized events.

## First-release status

The first real-host pass was completed on 2026-08-25 against Hermes 0.20.5. The
plugin passed `doctor --ci` with 14 hooks, was enabled for all seven profiles on
the Soleach host, served its authenticated Dashboard bundle/API, indexed the real
Vault, and captured a Luna CLI session plus terminal tool call in the shared store.
Gateway/Kanban-worker event coverage and remote reconnect behavior remain explicit
compatibility-matrix checks; an unavailable host is not a passing result.

The release candidate has a complete native plugin entry point, matching hook
manifest, authenticated Dashboard API declaration, and pre-built Dashboard bundle.
The remaining release gate is recorded in `RELEASE_CHECKLIST.md`: owner selection
of a license, publication authorization, and any unavailable compatibility cells.

## Post-release data fidelity

- Replace heuristic tool direction classification with user-editable rules.
- Add artifact nodes and provenance from the stable Hermes surfaces that expose
  them.
- Add generated/self-improving skill nodes and connect them to their creator,
  session, artifacts, and later tool usage.
- Use an authoritative model context limit so agent pressure is shown only when the
  ratio is trustworthy.
- Expand tool result adapters for RAG/search plugins whose outputs do not use the
  common `path`, `title`, `results`, or `matches` shapes.

## Deliberately later

- Query builders and advanced filters.
- Embedding-driven semantic positioning.
- Multi-Hermes / multi-machine worlds.
- Editing or controlling Hermes from the graph.
- General analytics dashboards and enterprise multi-tenant features.
