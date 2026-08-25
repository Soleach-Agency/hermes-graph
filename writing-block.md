# Hermes Spatial Observability / AI Runtime Visualizer — Project Intent Prompt

You are helping me turn an early concept into a real software project.

Do **not** start coding yet.

Your first task is to understand the product intent, identify architectural implications, surface ambiguities, challenge weak assumptions, and reflect the intended system back to me in a structured way.

I want you to behave like a senior technical product architect who is preparing to build the system later, not like a coding agent that immediately starts scaffolding files.

---

## 1. Core Product Idea

I want to build a **real-time, 3D spatial observability interface for AI agent systems**, starting with Hermes Agent as the first runtime integration.

This is not meant to be a conventional dashboard with tables, cards, logs, and charts.

The core idea is to visualize an AI system as a **living spatial world** where:

- agents are visible entities,
- sessions are visible entities,
- subagents and swarm relationships are visible,
- Obsidian notes are visible as part of a persistent knowledge space,
- Kanban cards are nodes,
- tool calls are visible events,
- search results can temporarily materialize as nodes,
- artifacts are visible,
- dependencies and relationships are visible as edges,
- activity propagates through the graph as animations.

The user should be able to understand what the AI system is doing by **watching the topology and activity**, not only by reading logs.

Think of it as a combination of:

- Obsidian Graph,
- agent observability,
- distributed tracing,
- Mission Control,
- a knowledge graph,
- and a sci-fi spatial interface.

The visual world should feel alive, not decorative.

---

## 2. The Most Important Principle

The 3D visualization is not just presentation.

The spatial representation must carry **meaning**.

Examples:

- agents currently working should visually feel active,
- parent-child session relationships should be spatially obvious,
- subagents should appear to spawn from their parents,
- a RAG query should visually travel from an agent into the vault,
- matching notes should react to the query,
- a web search should produce temporary result nodes,
- an API call should visibly connect the caller to an external service,
- artifacts should emerge from the agents that produced them,
- Kanban task ownership should be visible,
- blockers and dependencies should be visible,
- completed agents may collapse, fade, or transform into artifacts/history,
- context/token pressure may affect the appearance of an agent,
- active attention or current focus may be visually represented.

The visualization must eventually become useful enough that I can develop intuition from looking at it.

I should be able to notice things such as:

- a swarm is overusing web search,
- too many agents are blocked on the same dependency,
- one session is becoming excessively large,
- an agent is repeatedly retrieving the same notes,
- most activity is concentrated around a particular task,
- one part of the agent graph is idle,
- a workflow has become unnecessarily fragmented,
- a particular API/tool is dominating execution.

The interface should therefore be treated as an **observability system**, not a 3D screensaver.

---

## 3. Initial Data Sources

The initial system should support at least the following conceptual sources.

### Hermes Agent

We need to observe:

- sessions,
- parent/child sessions,
- subagent spawning,
- agent status,
- tool calls,
- tool completion/failure,
- arguments and selected result metadata,
- artifacts,
- task assignment,
- lifecycle events,
- timestamps,
- runtime duration,
- token/context usage where available,
- model information where available,
- errors,
- execution state.

Hermes should be treated as the **first runtime adapter**, not as the permanent core of the product.

Do not design the entire visualization around Hermes-specific internal structures.

The architecture should allow future adapters for other systems such as:

- Codex,
- Claude Code,
- OpenAI Agents SDK,
- MCP-based agents,
- custom agent runtimes,
- local scripts,
- orchestration systems.

---

### Obsidian Vault

The Obsidian vault represents persistent knowledge.

We want to visualize:

- notes,
- wikilinks,
- backlinks,
- folders,
- tags,
- metadata,
- optionally embeddings / semantic similarity,
- note creation and modification,
- RAG retrieval activity,
- which agents use which notes,
- which notes repeatedly influence execution.

The vault should not be rescanned continuously.

The intended design should support:

- initial indexing,
- filesystem watching,
- incremental updates,
- eventual semantic indexing.

The knowledge space may eventually have its own spatial region distinct from active runtime entities.

---

### Kanban

Kanban cards should be first-class graph entities.

Possible information:

- task title,
- state,
- owner,
- assignee,
- dependencies,
- blockers,
- parent task,
- related sessions,
- related artifacts,
- timestamps,
- transitions.

A task should not only appear in a traditional Kanban view.

The same task entity should be renderable as a node in the spatial graph.

Ideally, the system supports different projections of the same underlying entities:

- Spatial Graph,
- Kanban,
- Timeline,
- Sessions,
- possibly Dependency Graph.

---

### External Tools and Search

Tools are important.

A tool call must be representable as an event in the visualization.

Examples:

- web search,
- RAG search,
- fuzzy search,
- filesystem access,
- API calls,
- shell/terminal,
- database queries,
- GitHub,
- browser,
- Python,
- MCP tools.

A tool call should not merely append a line to a log.

It should produce visible graph behavior.

Example:

Agent → Search tool → Result nodes

If a web search returns 12 results, the system may temporarily instantiate 12 result nodes.

Those nodes can:

- appear,
- receive relevance weights,
- be selected,
- connect back to the agent,
- fade after a TTL,
- become persistent if referenced later.

Tool activity should be visually animated, possibly with electrical arcs, pulses, particle travel, or similar effects.

The exact visual language can evolve, but it should communicate causality.

---

## 4. Unified Entity Graph

The system should be built around a unified graph model.

Different kinds of entities may include:

- Agent
- Session
- Task
- VaultNote
- Search
- SearchResult
- Tool
- ExternalService
- Artifact
- Repository
- File
- API
- Model
- Machine
- Process

Edges should also have semantic types.

Examples:

- spawned
- belongs_to
- delegated_to
- working_on
- depends_on
- blocked_by
- retrieved
- references
- called
- produced
- modified
- queried
- returned
- assigned_to
- completed_by

Do not assume all nodes behave identically.

Different entity types may require different:

- geometry,
- animation,
- lifecycle,
- persistence,
- labels,
- clustering rules,
- interaction patterns.

---

## 5. Events as a First-Class Concept

I strongly suspect the architecture should be event-driven.

The visualization should not poll the entire world repeatedly.

Conceptually:

runtime event
→ normalized event
→ graph mutation
→ visual animation

Potential normalized events:

- session.started
- session.ended
- agent.spawned
- agent.status_changed
- tool.started
- tool.completed
- tool.failed
- task.created
- task.claimed
- task.blocked
- task.completed
- artifact.created
- note.read
- note.modified
- retrieval.started
- retrieval.result
- search.started
- search.result
- api.called

I want you to evaluate whether a **normalized event protocol** should become a core abstraction of the project.

This matters because I do not want the frontend tightly coupled to Hermes.

The eventual architecture may resemble:

Runtime adapters
→ normalized event protocol
→ collector
→ graph/event store
→ state projection
→ WebSocket event stream
→ 3D renderer

Please analyze this carefully.

---

## 6. Snapshot + Event Stream

A live stream alone is insufficient.

When I open the UI, I need the existing world immediately.

Therefore I expect some variation of:

snapshot
+
event stream

Example:

GET current graph state

then

subscribe to WebSocket events

The system needs to correctly handle:

- browser reconnect,
- network interruption,
- missed events,
- duplicate events,
- late events,
- ordering,
- state reconstruction.

I want you to propose an appropriate model.

Do not overengineer prematurely, but do not ignore these concerns.

---

## 7. Multi-Machine / Server Requirement

Hermes may be running on a remote server.

The visual interface may run on my Mac or in a browser.

The architecture must therefore support:

Server:
- Hermes
- observer / adapter
- event collector
- state/event storage

Client:
- web application
- 3D visualization

The connection should ideally use:

- HTTPS for state,
- WebSocket or equivalent for live events.

Eventually there may be multiple machines and multiple Hermes instances.

I want the system to be able to evolve toward:

Machine A
Machine B
Machine C

all reporting into the same visual world.

Machine identity should eventually be representable in the graph.

---

## 8. Hermes Integration Philosophy

I do not want the whole application implemented as a Hermes plugin.

If Hermes requires an integration layer, that plugin should be as thin as possible.

Preferred philosophy:

Hermes plugin / hook adapter
→ emit structured events
→ independent observability backend

The visualization, persistence, event schema, renderer, replay system, and UI should remain independent.

The Hermes integration layer should behave more like a sensor/adapter.

Please validate whether this is technically realistic with Hermes.

Inspect Hermes' current official capabilities before later implementation.

Potential integration surfaces may include:

- plugins,
- lifecycle hooks,
- tool hooks,
- webhooks,
- session state,
- Kanban storage,
- Gateway events,
- local databases.

Do not assume specific APIs without verifying them during implementation.

---

## 9. 3D World Model

The project must be 3D.

A 2D graph is not an acceptable substitute for the main experience.

Likely frontend technologies may include:

- Three.js
- React Three Fiber
- WebGL/WebGPU
- force-directed graph layouts
- physics systems
- GPU instancing
- custom shaders

But do not lock the implementation yet.

I want you to evaluate the best stack later.

Spatial organization should eventually encode semantics.

A possible conceptual layout:

center:
active computation

near center:
sessions, agents, tasks

persistent region:
Obsidian knowledge

outer region:
external services, APIs, web searches

temporary space:
search results / ephemeral tool output

This is only a conceptual example.

I want better ideas if you have them.

---

## 10. Animation Language

Animations should express system events.

Examples:

Agent calls RAG:
agent
→ electric pulse
→ vault
→ matching notes illuminate
→ selected results pulse back

Agent performs search:
agent
→ search node appears
→ result nodes spawn
→ selected result connects back
→ unused results fade

Agent spawns subagent:
parent emits child node
→ child moves into its own spatial orbit/cluster

Task claimed:
agent and task connect

Artifact created:
artifact emerges from agent/session/task relationship

Failure:
connection may flash, break, or visibly destabilize

The system should develop a coherent **visual grammar**.

We must avoid random visual effects.

Every important animation should have semantic meaning.

---

## 11. Timeline and Replay

This is **not optional long-term**.

Do not classify this as a dispensable "nice-to-have".

Historical replay is one of the features that gives the project real value.

I want to eventually scrub backward and forward through system execution.

Example:

10:42:
main agent only

10:45:
main agent spawned three researchers

10:47:
researcher 2 performed a web search

10:49:
coder claimed task

10:51:
reviewer spawned

10:53:
artifact produced

The graph should reconstruct the world at a historical point.

This has implications for event persistence.

I want you to account for this in the architecture from the beginning, even if replay is not built in the first implementation.

Do not design V0 in a way that makes replay extremely difficult later.

---

## 12. Semantic Spatial Layout

Semantic spatial layout is also a feature I consider valuable, not disposable.

Eventually:

- similar notes may cluster,
- related tasks may cluster,
- frequently interacting agents may become spatially related,
- project domains may form regions,
- semantic embeddings may influence knowledge-space positioning.

I understand this is difficult.

Difficulty is not a reason to remove it.

Instead:

design the architecture so this can be added cleanly.

Do not necessarily implement it immediately.

---

## 13. Performance Matters

Potential scale may include:

- thousands or tens of thousands of Obsidian notes,
- hundreds of tasks,
- many historical sessions,
- many temporary search-result nodes,
- concurrent subagents,
- rapid tool events.

The renderer should eventually handle large graphs.

Possible techniques may include:

- instancing,
- LOD,
- clustering,
- culling,
- visibility filters,
- aggregation,
- GPU rendering,
- spatial partitioning.

Do not prematurely optimize everything.

But avoid architectural choices that obviously fail when the graph becomes large.

---

## 14. Interaction Model

The world should remain visually dominant.

I do not want a conventional SaaS interface with the graph squeezed into a small panel.

Primary interaction:

navigate the world.

Selecting a node may open contextual UI containing information such as:

Agent:
- status
- model
- current task
- parent
- children
- tools
- duration
- token/context
- artifacts
- current activity

Task:
- status
- dependencies
- owner
- related sessions
- artifacts

Note:
- title
- tags
- backlinks
- semantic neighbors
- retrieval history

The detailed interface can use panels when necessary, but the graph should remain the main mental model.

---

## 15. Multiple Views Over the Same Data

Long term, I want the same underlying entity graph to support multiple projections:

- 3D Spatial Graph
- Kanban
- Timeline
- Session tree
- Dependency graph
- possibly metrics/observability views

These should not become disconnected duplicated systems.

Selecting an entity in one view should refer to the same underlying entity.

Example:

Task #42 selected in Kanban

→ switching to Spatial Graph focuses Task #42

→ Timeline shows Task #42 history

→ Session view shows agents associated with Task #42.

---

## 16. Observability, Not Just Visualization

Eventually this could become a genuine AI runtime observability tool.

Potential future capabilities:

- context/token pressure visualization
- agent idle detection
- repeated retrieval detection
- tool usage patterns
- excessive search detection
- stuck task detection
- dependency bottlenecks
- swarm topology analysis
- cost overlays
- model usage overlays
- machine health
- artifact provenance
- workflow comparison
- session comparison

Do not implement these now.

But recognize that the underlying event/entity architecture should enable them.

---

## 17. Scope Philosophy

I do not want the project reduced to an intentionally simplistic dashboard just because some components are difficult.

Features such as:

- replay,
- semantic positioning,
- high-performance rendering,
- rich tool visualizations,
- swarm topology,

are among the things that make the project valuable.

They may be staged.

They should not be silently dropped.

The correct strategy is:

build a narrow vertical slice,
while preserving the architecture required for the ambitious product.

---

## 18. Suggested Initial Vertical Slice

A good first demonstrable version might contain:

1. Obsidian vault nodes.
2. Hermes sessions.
3. parent-child session relations.
4. Hermes Kanban tasks.
5. relationships between sessions/agents/tasks.
6. live tool-call events.
7. visually animated tool activity.
8. a remote-server-compatible event stream.
9. persistent event recording.
10. 3D graph rendering.

Example demonstration:

A Hermes agent is running on a remote server.

I open the visualization on my Mac.

I see:

- the vault knowledge space,
- currently open sessions,
- task nodes,
- a main agent.

The agent executes a RAG query.

A visible pulse travels toward the vault.

Relevant notes illuminate.

The agent launches web search.

A temporary search entity appears.

Search results materialize around it.

The agent assigns a task to a subagent.

A new child session appears.

The Kanban task connects to the child.

The task completes.

An artifact is produced.

All of this happens live.

That would prove the concept.

---

## 19. What I Need From You First

Again:

**DO NOT WRITE CODE YET.**

Before implementation, produce a project-understanding document.

Your response should contain these sections:

### A. Your understanding of the product

Explain the system back to me in your own words.

Do not just repeat my sentences.

Explain what you think the product fundamentally is.

### B. Product boundaries

Explain what this project is and is not.

For example:

- observability system vs dashboard
- independent platform vs Hermes-only plugin
- semantic spatial system vs decorative graph

### C. Proposed high-level architecture

Propose the major components and responsibilities.

Include:

- Hermes adapter
- Obsidian adapter
- event protocol
- collector
- storage
- state projection
- realtime transport
- frontend
- 3D renderer

### D. Core entities

Propose an initial entity schema.

### E. Core event types

Propose an initial normalized event taxonomy.

### F. Difficult technical problems

Identify the genuinely hard parts.

Do not avoid them.

Explain why they are difficult and how you would approach them.

I expect at minimum discussion of:

- 3D large-graph rendering
- event ordering/state reconstruction
- replay
- semantic positioning
- transient nodes
- agent/tool correlation
- Hermes integration stability
- multi-machine architecture

### G. Architectural decisions we should make before coding

List the decisions that have high downstream cost.

### H. Things we can postpone safely

Separate "not needed in first implementation" from "should not exist".

For every deferred important feature, explain how the initial design keeps the door open.

### I. Proposed project phases

Do not estimate only by arbitrary calendar time.

Break the project into capability milestones.

For example:

Phase 0 — technical validation

Phase 1 — live vertical slice

Phase 2 — replay

Phase 3 — semantic spatial model

Phase 4 — multi-runtime / multi-machine observability

Feel free to improve this.

### J. Risks

Give me the top technical and product risks.

### K. Questions for me

Ask only questions that materially affect architecture, visual language, or scope.

Do not ask trivial implementation questions.

---

## 20. Important Working Rules

For this project:

1. Do not immediately code when I describe a feature.
2. First understand the intent and its effect on the overall architecture.
3. Challenge me when a design choice would create unnecessary coupling.
4. Prefer adapters and protocols over hardcoded runtime-specific behavior.
5. Keep the renderer separate from the runtime integrations.
6. Treat event history as valuable data.
7. Preserve future replay capability.
8. Preserve future semantic-layout capability.
9. Do not downgrade ambitious features simply because they are technically difficult.
10. Optimize the project around a strong conceptual core rather than producing a pile of dashboard features.
11. Avoid premature microservice complexity.
12. Prefer a system that one person with strong AI coding assistance can realistically maintain.
13. Every abstraction should justify its existence.
14. Where uncertainty exists, explicitly distinguish:
   - verified fact,
   - assumption,
   - proposal,
   - open question.
15. Before touching Hermes internals later, inspect its current repository/docs and verify the relevant extension surfaces.

---

## Final instruction

Your next response must **not contain implementation code or project scaffolding**.

I want your next response to be the architectural/product understanding review described above.

The objective is to make sure you understand what I am trying to build before we commit to an implementation direction.