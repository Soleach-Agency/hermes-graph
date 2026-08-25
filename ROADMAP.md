# Hermes Graph — Roadmap

Hermes Graph is now structured as one installable native Hermes plugin: lifecycle
observers, local history/API, and the pre-built Dashboard viewer ship together.

On a multi-profile Hermes host, every enabled profile writes to the same
machine-level SQLite WAL store; the source profile is retained on normalized events.

## Before the first public release

The first real-host pass was completed on 2026-08-25 against Hermes 0.20.5. The
plugin passed `doctor --ci` with 14 hooks, was enabled for all seven profiles on
the Soleach host, served its authenticated Dashboard bundle/API, indexed the real
Vault, and captured a Luna CLI session plus terminal tool call in the shared store.
Gateway/Kanban-worker event coverage and remote reconnect behavior still belong in
the release compatibility matrix.

1. **Incremental vault watching** — watch Markdown creates, edits, renames, and
   deletes after the user connects a vault. Do not continuously rebuild the entire
   vault. Manual Connect / Refresh is the current fallback.
2. **Initial Hermes hydration** — load already-existing sessions and Kanban cards
   when the plugin starts. Hooks correctly cover new activity, but a new install
   should not begin with an empty runtime world.
3. **Kanban topology** — hydrate Todo cards plus card dependencies/blockers from
   Hermes' durable Kanban store. Transition hooks already cover claimed, completed,
   and blocked activity.
4. **Transient cleanup** — expire result nodes and temporary activity relationships
   from the current SQLite projection after their TTL while retaining replayable
   history through explicit scene-delete events.
5. **Release packaging** — choose a license, publish the repository, run the host
   compatibility matrix, and document `hermes plugins install <owner>/<repo>`.

## Data fidelity after the first release

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
