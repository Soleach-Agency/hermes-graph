# Hermes Graph — Product Scope

## Status

This document is the current product boundary. It overrides broader platform interpretations in `writing-block.md` where they conflict with this scope.

## Product in one sentence

Hermes Graph is an installable Hermes plugin that provides a beautiful, real-time 3D galaxy viewer, turning Hermes activity, Obsidian notes, Kanban cards, agents, sessions, tools, artifacts, and their relationships into an animated spatial world with timeline playback.

## The actual product

The primary product is one 3D node-based viewer delivered as a Hermes plugin, visually inspired by Obsidian's galaxy/graph view and science-fiction spatial interfaces.

It is intentionally a decorative 3D layer over runtime state and logs. The decoration is not meaningless: node appearance, motion, connections, spawning, pulses, fading, size, and color communicate what the underlying system is doing. However, the project is not trying to become a comprehensive observability, analytics, tracing, or workflow-management platform.

The experience should be impressive to watch before it is exhaustive to operate. Its essential promise is:

1. Install the plugin in Hermes.
2. Select or configure an Obsidian vault and any relevant project paths.
3. Open the plugin's viewer and watch the world form and react.

## Product priorities

In order of product identity:

1. A visually striking and coherent 3D world.
2. Smooth rendering and animation, including large mostly-static graphs.
3. Correct live synchronization with Hermes, the vault, Kanban state, sessions, and swarms.
4. Timeline recording and playback of the same 3D world.
5. Small, useful interactions such as hover/selection details and visual state changes.
6. Extensibility where it is cheap and does not complicate the first product.

The visual layer must remain semantically consistent, but it does not need to justify itself as a full operational observability product.

## One world, not multiple application views

There is one primary projection: the 3D spatial graph.

- Obsidian notes are nodes.
- Kanban cards are nodes.
- Card dependencies and blockers are edges in 3D space.
- Sessions and agents are nodes or spatial entities.
- Parent/child and swarm relationships are edges or spawn structures.
- Tool calls produce visible activity and may create temporary nodes.
- Artifacts can emerge as nodes connected to their producer.
- External services and search results may temporarily materialize in the same world.

There is no separate Kanban application, Kanban board view, session-tree view, dependency-graph screen, or family of interchangeable data projections in the current scope.

Timeline is different: it is a time control for the same 3D world. It lets the user observe or replay how that world changed; it is not a separate analytics product.

## Core visual behavior

Visual effects should be attractive and should have a stable vocabulary.

### Confirmed node design rules

- All nodes use the same star-like visual language. Different entity types must not use unrelated geometric shapes.
- Entity types are distinguished primarily by configurable colors.
- Node size and color may change dynamically when the underlying state has a meaningful continuous value.
- Agent token/context pressure is the primary MVP example: as an agent approaches its available context limit, its node grows and shifts from white toward purple by default.
- The white-to-purple pressure gradient, type colors, relevant size ranges, and thresholds must be user-configurable rather than hardcoded into the renderer.
- Dynamic changes should remain smooth and visually coherent; they should not cause the surrounding graph layout to jump unnecessarily.

### Confirmed spatial topology

- The Obsidian vault is the visual center of the world and forms a roughly spherical cluster, not a flat galactic disk.
- All vault notes share one configurable base color.
- Vault-note edges reproduce the real Obsidian wikilink/backlink graph.
- Notes with more incoming/outgoing links sit closer to the center of the vault sphere. Less-connected notes occupy its outer volume.
- Sessions, root agents, and Kanban cards occupy the space around the vault sphere rather than mixing uniformly into it.
- A root agent stays near its session or claimed Kanban card.
- Subagents form small swarms around the session, agent, or Kanban card that owns/spawned them.
- Tools and MCP services form smaller satellite nodes close to their owning agent.
- Session, root-agent, and Kanban nodes are visibly larger than notes, tools, MCP services, and subagents.
- Tools/MCP services and subagents use roughly the same smaller size class.
- Artifacts and skills remain in the same star-like node family; their meaning comes from color, size, motion, and relationships rather than unrelated geometry.
- Persistent node links have independently configurable color and screen-space thickness.
- Temporary jump/activity links have their own configurable color and thickness.
- `called`, `retrieved`, and `returned` relationships are drawn only by the temporary jump layer. They do not leave a permanent agent–tool, tool–note, or tool–result line after their activity lifetime ends.
- Every hop has an active target: as jump energy reaches a tool, intermediate vault note, final note, or result, that current target pulses in size and brightness. An active source tool remains emphasized while its outgoing route is still travelling. Size and brightness multipliers are configurable.
- Timeline snapshot changes interpolate node position, color, size, and intensity instead of visibly stepping between discrete states.

### Kanban visual lifecycle

- Kanban cards have four independently configurable state colors: Todo, Doing, Done, and Blocked.
- When a card becomes Done, it begins a long transition after its completion event animation finishes.
- During this transition the card shrinks, darkens toward black, fades, and is eventually removed from the live scene.
- Completed-card fade duration is configurable from 6 hours to 48 hours (two days).
- Removal from the live scene does not erase event history; replay can still reconstruct the card.

### Tool direction and activity routes

Tools are categorized by where their work goes:

- Vault-facing tools: RAG, semantic search, fuzzy search, note retrieval, and similar local-knowledge operations.
- External-facing tools: web search, external MCP services, APIs, Krea, and similar network operations.

Vault-facing activity supports two user-selectable visual modes:

1. Semantic/direct: the tool connects directly to every vault result node. The temporary route remains visible for about 30 seconds in realtime.
2. Beautiful/routed: the activity enters through a nearby vault node, travels through a visually pleasing non-straight sequence of nearby nodes, and eventually reaches the real result node. The route uses a configurable 15–150 hops and a configurable 5–100 ms per-hop delay, defaulting to 25 ms. Previously saved 250 ms-era settings are migrated to the equivalent 10× faster value automatically. The algorithm may shorten the delay for long routes so the result does not arrive unreasonably late.

One tool call may return 1–20 results; every returned node should be shown. Routed animation paths must avoid identical straight-line travel and excessive repetition.

External-facing activity materializes one temporary result node per returned item near the tool. Result nodes:

- use the same base color as vault notes;
- have a visible birth/materialization animation;
- illuminate for roughly 30 seconds in realtime;
- may use time-scaled lifetimes during timeline playback;
- remain available in event history after disappearing from the live scene.

### Artifact and skill scenarios

- An artifact is born from its producing agent/session/task, briefly appears hot and bright, then cools into the configured artifact color and settles near its producer.
- Artifact edges preserve producer and task provenance. Artifacts are persistent by default.
- A newly created or self-authored skill buds from the creating agent and settles into that agent's tool/skill satellite group.
- Using a skill sends activity between the agent and skill node.
- Improving/versioning a skill can increase its size or intensity slightly and produce a short refinement pulse; it must remain within the shared star-node visual language.

Examples:

- An active agent glows or emits controlled motion.
- Token/context pressure changes an agent node's size, color, shell, or intensity.
- A subagent visibly spawns from its parent and settles into the swarm topology.
- A tool call sends a pulse toward a tool or external-service node.
- A RAG request travels toward the vault and illuminates matching notes.
- A web search materializes a temporary search cluster and result nodes.
- A claimed Kanban card connects to the responsible agent/session.
- A blocked card changes state and emphasizes its dependency edge.
- An artifact emerges from the agent/session that produced it.
- Completed or expired temporary activity fades without deleting its history.

Normal activity is expected to be sparse enough that these animations can be shown directly. Event aggregation or rate limiting may be added as a defensive performance measure, not as a central MVP experience.

## Minimal interaction model

The camera and 3D world dominate the interface.

MVP interactions are deliberately small:

- orbit, pan, and zoom;
- hover to show a concise, type-appropriate information card for the node;
- click/select to reveal concise metadata;
- focus or follow an active entity where useful;
- play, pause, seek, and return to live time when timeline support is active;
- basic visual configuration needed to keep the world usable.

Advanced query builders, filtering systems, dashboards, alerting, workflow editing, and analytics are outside the MVP.

The MVP hover card does not need to be exhaustive. It should show only the most useful fields for that entity type, for example an agent's name/status/token pressure, a note's title/path, a Kanban card's title/state, or a tool call's tool/status/duration.

## MVP data scope

The first useful version should display:

- Obsidian notes and wikilinks;
- Hermes sessions and agents;
- parent/child session or subagent relationships;
- swarm relationships where Hermes exposes them;
- Kanban cards and card dependencies;
- live status changes;
- live tool calls and selected result metadata;
- RAG/note retrieval activity where it can be correlated;
- artifacts where Hermes exposes them;
- enough token/context information to create visible pressure states when available.

Missing runtime capabilities should degrade gracefully. The viewer must not fabricate certainty when Hermes does not expose a reliable relationship.

## Required technical foundation

The implementation only needs enough backend structure to make the visual world reliable.

Conceptually:

```text
Hermes plugin event capture + vault watcher
            -> small normalized display-event protocol
            -> append-only event recording
            -> current scene graph
            -> snapshot + resumable live stream
            -> 3D viewer and animation system
```

This foundation exists for four concrete reasons:

1. The UI must synchronize with background Hermes, Kanban, session, and swarm activity.
2. Opening or reconnecting the viewer must restore the existing world.
3. Timeline playback needs recorded events and reproducible scene state.
4. Renderer code must not depend directly on unstable Hermes log/database formats.

The normalized protocol should remain deliberately small. It is an internal seam between data capture and visualization, not the beginning of a general-purpose industry standard.

## Packaging and deployment direction

Hermes Graph must be distributed and installed as a Hermes plugin. A separate observability product or independently deployed backend is not the intended user experience.

The plugin is responsible for presenting one coherent product, even if its internal implementation contains separable modules for event capture, event history, scene-state projection, realtime transport, and the web-based 3D viewer. Those modules are implementation boundaries inside the plugin, not separately operated products.

Configuration should be limited to things such as:

- Obsidian vault path;
- optional project/Kanban location;
- a small number of visual and retention settings.

The plugin runs where Hermes runs. Its viewer may be opened from another machine, such as a Mac connecting to Hermes on a server, but the user should not need to install and operate a separate collector stack. Remote access, authentication, and live transport should use Hermes' supported plugin and gateway surfaces where possible.

The initial implementation should remain single-installation and single-user oriented. Multi-tenant services, collector clusters, enterprise RBAC systems, and distributed infrastructure are not current product requirements.

## Timeline and event history

Timeline is a core feature, even if delivered after the first live rendering milestone.

The event history should be sufficient to:

- reconstruct the current scene after startup or reconnect;
- replay node creation, state changes, edges, tool activity, and expiration;
- seek through historical activity without requiring raw Hermes logs to be reread;
- preserve transient search/tool nodes in history after they disappear from the live scene.

This does not require building a large event-sourcing platform. A compact append-only event store, periodic scene checkpoints, stable event IDs, and deterministic scene updates are enough.

## Performance target

Remaining usable and visually fluid at large node counts is a product requirement, not an optional later polish item. The viewer must be designed and tested for 10,000 or more nodes, especially when most nodes are static Obsidian notes and only a small active subset is animated.

Performance work should be driven by reproducible synthetic scenes and real vault samples. The test harness should eventually cover at least:

- 10k, 25k, and 50k nodes;
- realistic edge densities;
- a small set of simultaneously animated agents/tools;
- node hover and selection latency;
- timeline playback and short event bursts;
- common target hardware and browser combinations.

Likely implementation techniques include GPU instancing, limited labels, level of detail, culling, simplified distant edges, stable layouts, and animation only for the active subset. These are implementation candidates, not product features.

The exact acceptable frame-rate threshold and reference hardware will be fixed during the rendering spike, but an implementation that works only on small demo graphs does not satisfy the MVP.

## Explicit non-goals for MVP

- A conventional observability dashboard.
- A separate Kanban board or editor.
- A separate session-tree interface.
- Query builders or advanced filters.
- Metrics, alerting, anomaly detection, or workflow recommendations.
- Team collaboration, multi-tenancy, or enterprise RBAC.
- A graph database solely because the UI is a graph.
- General support for every agent runtime.
- A public universal tracing/event standard.
- Microservice or collector-cluster architecture.
- Exhaustive inspection of every prompt, argument, token, file, or tool result.
- Bidirectional control of Hermes from the graph.

## Features intentionally left open for later

The initial design may keep inexpensive seams for:

- additional runtime adapters;
- basic filtering and focus controls;
- semantic note positioning;
- larger graph optimizations;
- richer timeline controls;
- optional cost or token overlays;
- user-pinned spatial regions;
- extra visual themes.

These possibilities must not inflate the MVP architecture.

## Scope guardrails for future work

Before adding a subsystem, ask:

1. Does it materially improve the beauty, legibility, synchronization, replay, or performance of the 3D world?
2. Is it required to connect Hermes, the vault, Kanban cards, tools, or artifacts to that world?
3. Can users understand or enjoy the primary experience without it?
4. Is a small local solution sufficient?

If the feature mainly creates another dashboard, management view, analytics product, or general platform abstraction, it is probably outside scope.

## Current uncertainties to validate before implementation

- Which stable Hermes hooks, logs, databases, or plugin APIs expose sessions, subagents, swarms, Kanban changes, tools, artifacts, and token/context data.
- Which Hermes plugin surfaces can host or expose the web-based viewer, live event stream, configuration, and local event history without requiring a separate deployed service.
- Which 3D renderer and layout approach gives the best visual quality at 10k+ nodes on the target hardware.
- How much history should be retained by default and where it should live.
- Whether Obsidian layout should be force-based, deterministic, semantically influenced, or a hybrid.

These are technical validation questions. They do not change the product identity defined above.
