# In-Repository Knowledge Graph (RepoGraph) — Research Deep Dive

**Date:** 2026-05-27
**Author:** Spectra (kanban task t_965ac5ee)
**Source:** `/home/kerwin/KerwinsGeminiNotes/MCP Development Tool Ideas/4. In-Repository Knowledge Graph (Persistent Codebase Memory).md`
**Existing context:** Hermes MCP Toolset at `/home/kerwin/code/hermes-mcp-toolset/` — ARCHITECTURE.md + TOOL_SPECS.md define 4 RepoGraph tools (`repograph_query`, `repograph_update`, `repograph_register_intent`, `repograph_rescan`)

---

## 1. Source Material: The Gemini Notes Blueprint

The original 16-line spec proposes a **persistent state ledger** for codebase memory:

| Aspect | Blueprint Proposal |
|--------|-------------------|
| Storage | JSON/SQLite/Markdown structure inside the repo's config dir |
| Write controller | Standalone MCP server as exclusive read/write gateway |
| Update mechanism | Git hooks for incremental diff tracking — only re-index altered branches |
| Agent integration | Query at session start → build "intent-to-file" map → skip raw text search |

The blueprint is intentionally lightweight: no external vector DB, no LLM at query time, no infrastructure dependencies. It's a "knowledge graph combined with intellisense" — deterministic, local, fast.

---

## 2. The Hermes MCP Toolset's Existing RepoGraph Design

The TOOL_SPECS.md at `/home/kerwin/code/hermes-mcp-toolset/TOOL_SPECS.md` already expands the blueprint into **4 concrete MCP tools** under the RepoGraph pillar:

| Tool | Role |
|------|------|
| `repograph_query` | Read the graph — find files by intent, list dependencies, resolved symbols |
| `repograph_update` | Write/refresh the graph after changes |
| `repograph_register_intent` | Tag intent annotations onto nodes ("This file handles auth") |
| `repograph_rescan` | Full rebuild from scratch |

These tools are **defined in the spec but not yet implemented** (as of the prior synthesis report). The overall TOOL_SPECS describes 16 tools across 5 pillars, with RepoGraph as the persistent state layer that other tools depend on.

Key design decisions already locked in the toolset:
- **SQLite over external vector DB** — no pgvector/Pinecone dependency
- **Tree-sitter over LSP as primary parser** — faster, deterministic, no language server processes
- **Deterministic over LLM-based** — AST analysis, not summarization
- **Config in `.hermes/mcp_config.json`** — portable, CI-compatible

---

## 3. The Ecosystem Landscape (May 2026)

The last ~6 months have seen an explosion of codebase knowledge graph tools. Here's how each compares to the blueprint and the toolset's design.

### 3.1 Codebase-Memory MCP (DeusData) — The Closest Match

**Repo:** https://github.com/DeusData/codebase-memory-mcp
**Paper:** https://arxiv.org/abs/2603.27277 — "Codebase-Memory: Tree-Sitter-Based Knowledge Graphs for LLM Code Exploration via MCP"
**Language:** Pure C, single static binary (zero dependencies)
**License:** MIT
**Languages supported:** 155 (vendored tree-sitter grammars compiled in)
**MCP tools:** 14

This is the most aligned with both the Gemini Notes blueprint AND the Hermes toolset's design philosophy:

| Dimension | Codebase-Memory | Toolset Design | Match? |
|-----------|----------------|----------------|--------|
| Storage | SQLite (in-memory during build, persisted) | SQLite | ✓ |
| Parser | Tree-sitter, 155 languages | Tree-sitter (planned) | ✓ |
| Update model | RAM-first pipeline + git-based change detection | Git hooks (planned) | ✓ |
| LLM dependency | None — MCP client is the intelligence layer | None — deterministic | ✓ |
| Query cost | Free (local, no API) | Free | ✓ |
| Distribution | Single binary, `install` command | MCP server | Compatible |

**Performance benchmarks:**
- Linux kernel (28M LOC, 75K files): **3 min** full index → 2.1M nodes, 4.9M edges
- Django: ~6s full index → 49K nodes, 196K edges
- Graph queries: <1ms (relationship traversal), <10ms (regex name search)
- Token efficiency: **99.2% reduction** vs file-by-file grep exploration (3,400 tokens vs 412,000 for 5 queries)

**Unique features that go beyond the blueprint:**
- **6-strategy call resolution** — import-aware, type-inferred, with LSP-style hybrid type resolution for Go, C, C++, TypeScript/JS/JSX/TSX
- **Louvain community detection** — discovers functional modules by clustering call edges
- **Cross-service HTTP linking** — matches HTTP routes to call sites with confidence scoring (gRPC, GraphQL, tRPC also detected)
- **Cypher-like query language** — `MATCH (f:Function)-[:CALLS]->(g) WHERE f.name = 'main' RETURN g.name`
- **Semantic search** — bundled `nomic-embed-code` embeddings compiled into the binary (no API key, no Ollama, no Docker). 11-signal combined scoring.
- **Dead code detection** — finds functions with zero callers, excluding entry points
- **Team-shared graph artifact** — `.codebase-memory/graph.db.zst` — a zstd-compressed graph snapshot commit-able to the repo. Teammates bootstrap from it instead of re-indexing. `merge=ours` in `.gitattributes` avoids merge conflicts.
- **3D graph visualization UI** — built-in web UI at localhost:9749 (optional binary variant)
- **Infrastructure-as-code indexing** — Dockerfiles, K8s manifests, Kustomize overlays as first-class graph nodes
- **11 agents auto-detected** — Claude Code, Codex CLI, Gemini CLI, Zed, OpenCode, Aider, etc.

**Comparison to Hermes toolset design:**
Codebase-Memory is a **production-ready implementation** of exactly what the TOOL_SPECS's RepoGraph tools want to be. The Hermes toolset's `repograph_query`/`repograph_update`/`repograph_register_intent`/`repograph_rescan` are a subset of what Codebase-Memory already ships.

**The key differentiator** for the Hermes toolset is the **intent annotation layer** (`repograph_register_intent`) — the blueprint's "intent-to-file paths" concept. Codebase-Memory doesn't have an explicit intent-tagging API; its semantic search + Cypher queries cover similar ground but through graph traversal rather than named annotations.

---

### 3.2 CodeGraph (colbymchenry)

**Repo:** https://github.com/colbymchenry/codegraph
**Language:** Node.js (bundles its own runtime — no Node.js required)
**License:** MIT
**Languages:** 20+
**MCP tools:** Context building, full-text search, impact analysis, framework-aware routes

| Metric | Improvement vs No-Graph |
|--------|------------------------|
| Cost | ~35% cheaper |
| Tokens | ~57% fewer |
| Speed | ~46% faster |
| Tool calls | ~71% fewer |

**Key differentiators:**
- **Framework-aware routes** — recognizes Django `path()`, Flask `@app.route`, Express `app.get()`, NestJS `@Controller`, Rails, Spring `@GetMapping`, etc. Links URL patterns to handler functions.
- **Auto-sync via native file watchers** — FSEvents/inotify/ReadDirectoryChangesW with debounced re-indexing. Staleness banners tell the agent when a file is pending re-index.
- **Mixed iOS/React Native/Expo bridging** — crosses language boundaries (Swift ↔ ObjC ↔ JS via React Native bridge)
- **Also supports Hermes Agent** explicitly in its agent list

**Notable:** CodeGraph's README explicitly lists **Hermes Agent** as a supported platform, and its `install.sh` auto-detects and configures for it. This means there may already be integration hooks between CodeGraph and this Hermes installation.

---

### 3.3 GitNexus

**Repo:** https://github.com/abhigyanpatwari/GitNexus
**Language:** Node.js (npm package)
**License:** PolyForm Noncommercial (non-commercial OSS, commercial via akonlabs.com)
**Storage:** LadybugDB (custom embedded DB)
**MCP tools:** 16 (11 per-repo + 5 group-level)
**Web UI:** Yes — gitnexus.vercel.app

**Key differentiators:**
- **Multi-repo groups** — group repos by domain, extract cross-service contracts, search across execution flows spanning multiple repos
- **Cypher queries** — full graph query language support
- **Bridge mode** — web UI connects to local server for browsing all indexed repos
- **Change impact analysis** — maps changed lines to affected processes
- **Automated code wiki generation** — `gitnexus wiki` creates repo documentation from the knowledge graph
- **Enterprise tier** — PR review blast radius analysis, auto-reindexing, multi-repo support

**Notable differences from the blueprint:**
- Storage is LadybugDB, not SQLite — more specialized for graph operations but less portable
- Non-commercial license limits reuse
- Web UI adds a visualization layer the blueprint doesn't discuss
- Auto-detects agents but doesn't list Hermes Agent support (Claude Code, Cursor, Antigravity, Codex, Windsurf, OpenCode)

---

### 3.4 Graphify

**Repo:** https://github.com/rhanka/graphify
**Website:** https://graphify.net/
**Language:** Skill/pipeline (Claude Code, Codex, OpenCode, Cursor, etc.)
**License:** Open-source
**Backend:** Tree-sitter + NetworkX + Leiden clustering

**Key differentiators:**
- **71.5x token compression** claimed — "any input, one graph, complete recall"
- **Multi-modal** — code, docs, images, papers, SQL schemas all go into the same graph
- **Skill-based distribution** — installed as a skill/plugin for coding agents, not a standalone server
- **Claimed 71.5x token compression** for structured code understanding

**Relevance:** Graphify validates the thesis that agent skills + knowledge graphs are a viable distribution model. It's also the most directly "in-repo" approach — the graph lives in a `graphify-out/` directory committed alongside the code, similar to the blueprint's "stored directly within the target repository configuration directory."

---

### 3.5 Argos Brain (Commercial)

**Website:** https://argosbrain.com/
**Model:** Commercial, MCP-native
**Key claims:**
- Graph-deterministic for exact symbol lookups — $0 retrieval cost (no LLM at read time)
- Sub-millisecond warm-cache recall
- Structural memory for Claude Code, Codex, Cursor, GitHub Copilot, Aider, OpenCode, Cline, Continue, Zed

**Relevance:** Validates the commercial viability of the approach. Argos's "no LLM at read time" principle mirrors the toolset's deterministic-over-LLM design choice.

---

## 4. Comparative Analysis

### 4.1 Feature Matrix

| Feature | Blueprint (Ideal) | Codebase-Memory | CodeGraph | GitNexus | Graphify |
|---------|-------------------|-----------------|-----------|----------|----------|
| Tree-sitter parsing | ✓ | ✓ (155 langs) | ✓ (20+ langs) | ✓ | ✓ |
| SQLite storage | ✓ | ✓ | ✓ | LadybugDB | graphify-out/ |
| MCP tools | ✓ | 14 tools | context+search | 16 tools | Skill-based |
| Intent annotations | ✓ (key feature) | ✗ (semantic search) | ✗ | ✗ | ✗ |
| Git hooks / auto-sync | ✓ | ✓ (watcher + artifact) | ✓ (native watcher) | auto-reindex (enterprise) | manual |
| Team artifact sharing | ✗ mentioned | ✓ (.graph.db.zst) | ✗ | ✗ | ✓ (graphify-out/) |
| No external deps | ✓ | ✓ (1 binary) | ✓ (bundled runtime) | Node.js | Skill |
| Call graph / impact | Partial | ✓ (6 strategies) | ✓ | ✓ | ✓ |
| 3D visualization | ✗ | ✓ (optional) | ✗ | ✓ (web UI) | ✗ |
| Dead code detection | ✗ | ✓ | ✗ | ✗ | ✗ |
| Cross-service linking | ✗ | ✓ (HTTP/gRPC/GraphQL) | ✗ | ✓ (groups) | ✗ |
| Intent-to-file mapping | ✓ (core feature) | ✗ | ✗ | ✗ | ✗ |
| License | — | MIT | MIT | PolyForm NC | MIT |

### 4.2 The Gap: Intent Annotations

The single feature in the Gemini Notes blueprint that **no existing tool fully implements** is **intent-to-file annotation** — `repograph_register_intent` in the Hermes toolset's tool list.

The idea: an agent working on a codebase can tag files with human-readable intent descriptions ("handles Stripe payment routing", "validates user session tokens"). These tags persist in the graph across sessions, so future agents (or the same agent in a new session) can answer "what does this file do?" without re-reading it or running an LLM over it.

Codebase-Memory comes closest with its semantic search (bundled embeddings + 11-signal scoring), but that's a query-time inference, not a persistent annotation. The intent tag is fundamentally a **user/agent-driven write** operation — the agent decides "I now know what this file does" and writes that knowledge into the graph. This is a different interaction model from "search the graph for what's already there."

### 4.3 The Existing Toolset Gap

The Hermes MCP Toolset defines these RepoGraph tools but they are **not implemented**. Meanwhile, Codebase-Memory provides a **production-ready, MIT-licensed implementation** that covers ~80% of the spec with 155-language support, sub-ms queries, and a single binary with zero dependencies.

The remaining 20% — the intent annotation layer — is the unique contribution the Hermes toolset could still own.

---

## 5. Recommendations

### Option A: Adopt Codebase-Memory as the RepoGraph backend

**Rationale:** Codebase-Memory ships as a single binary, covers 155 languages, has 14 MCP tools, supports sub-ms queries, and is MIT-licensed. It already implements the `repograph_query` equivalent (via `search_graph`, `trace_call_path`, `get_architecture`, etc.) and the `repograph_update` equivalent (via auto-indexing + git detection).

**What to build on top:**
- An **intent annotation layer** (`repograph_register_intent`) that stores human-readable tags in a companion SQLite table, linked to Codebase-Memory's node IDs
- A **thin Hermes MCP adapter** that wraps Codebase-Memory's tools under the Hermes TOOL_SPECS namespace (`repograph_query` → `codebase_memory.search_graph`, etc.)
- The `repograph_rescan` tool maps directly to Codebase-Memory's `index_repository` with `--force`

**Effort:** Low. The adapter layer is ~200 lines of glue code.

### Option B: Implement from scratch with Tree-sitter + SQLite

**Rationale:** Full control, no external dependency, aligned with the "we build everything" ethos of the toolset.

**What to build:**
- Python bindings for Tree-sitter (`tree-sitter-language-pack`)
- SQLite schema: `files`, `symbols`, `edges`, `intent_tags`
- MCP tool stubs matching TOOL_SPECS signatures
- Git hook installer for incremental updates

**Effort:** Medium-high. Tree-sitter grammar management across languages is non-trivial. The Hermes toolset already has Babel-based AST parsing for JS/TS and Tree-sitter for Python — these could be extended.

### Option C: Hybrid — Use Codebase-Memory for parsing + graph, add intent layer on top

**Rationale:** Codebase-Memory handles the hard part (155-language Tree-sitter, LSP-style type resolution, call graph, sub-ms querying). The Hermes toolset adds the intent annotation layer that makes the graph "intellisense-aware."

**Implementation sketch:**
1. `codebase-memory-mcp` installed as a sidecar process
2. Hermes MCP adapter wraps its 14 tools under RepoGraph namespace
3. Companion SQLite DB (`~/.hermes/repo_intents.db`) stores intent tags, linked by file path + symbol name
4. `repograph_register_intent` writes to companion DB
5. `repograph_query` chains: Codebase-Memory query → companion DB tag lookup → merged response

**Effort:** Low-medium. The adapter handles routing, the companion DB is a simple SQLite schema.

---

## 6. Key Design Decisions for Whichever Path

| Decision | Recommendation | Reason |
|----------|---------------|--------|
| Storage | SQLite | Proven, portable, zero-infrastructure. Codebase-Memory validates this at scale (28M LOC repo). |
| Parser | Tree-sitter | Industry consensus across all 5 tools surveyed. Babel for JS/TS can be a fallback (already in toolset). |
| Embeddings | Optional / bundled-only | Codebase-Memory bundles `nomic-embed-code` at zero external cost. Don't require an API key. |
| Update model | Git hooks (single-file changes) + periodic full refresh | The blueprint's "localized repository triggers" are exactly git hooks. Codebase-Memory also supports a background watcher. |
| Intent layer | Separate companion DB | Keeps the core graph tool-agnostic. Intents are the Hermes-specific value-add. |
| Visualization | Built-in (Codebase-Memory provides it) or optional | Not essential but high-signal for human comprehension. Codebase-Memory's 3D UI is already good. |
| License compatibility | MIT (Codebase-Memory) ✅ | No conflict with Hermes toolset's license. |

---

## 7. Integration with Broader Toolset Pipeline

The RepoGraph tools fit into the TOOL_SPECS orchestration flow:

```
Planner
  → repograph_query ("what exists?")
  → blueprint_scout_analyze_plan ("is this duplicated?")
  → task_router_decompose ("break into micro-tasks")
  → solid_enforcer_translate_prompt
  → context_slasher_skeleton
  → Code Generation
  → solid_enforcer_audit
  → If PASS: repograph_update + merge
```

**With Codebase-Memory as backend**, `repograph_query` would:
1. Call `codebase-memory-mcp search_graph` for symbol-level queries
2. Call `codebase-memory-mcp get_architecture` for high-level structure
3. Cross-reference with intent tags from companion DB
4. Return merged result to the planner

**Without Codebase-Memory**, each tool must be built from scratch — Tree-sitter parsing, graph construction, query execution, incremental updates. This is a substantial engineering effort.

---

## 8. Summary

The codebase knowledge graph space has **matured dramatically** in the 6 months since the Gemini Notes were written. Codebase-Memory (DeusData) is the standout: a production-ready, MIT-licensed implementation in pure C that covers 155 languages, achieves sub-ms queries, and delivers 99.2% token reduction vs. file-by-file exploration. It aligns perfectly with the Hermes toolset's design philosophy (deterministic, no LLM at read time, SQLite-backed, zero infrastructure).

**The unique opportunity** for the Hermes toolset is the **intent annotation layer** — the `repograph_register_intent` concept from the TOOL_SPECS — which no existing tool implements. This is the "intent-to-file mapping" from the original blueprint, and it's what makes the graph an agentic memory rather than just a static index.

**Recommendation:** Option C (hybrid) — adopt Codebase-Memory as the parsing/graph backend, wrap its 14 tools under the RepoGraph namespace via a thin Hermes MCP adapter, and build the intent annotation layer as the Hermes-specific value-add. This gives 80% of the functionality at 10% of the implementation cost.

---

## Appendix: Quick Reference — Ecosystem Tools

| Tool | Stars (approx) | Install | Key Strength |
|------|--------------|---------|--------------|
| Codebase-Memory | High | `curl ... \| bash` | Speed, 155 langs, single binary, MIT |
| CodeGraph | Growing | `npx @colbymchenry/codegraph` | Framework-aware routes, auto-sync, Hermes Agent support |
| GitNexus | Fast-growing | `npm i -g gitnexus` | Multi-repo groups, web UI, Cypher queries |
| Graphify | Growing | `git clone` + skill install | Multi-modal, 71.5x token compression, skill-based |
| Argos Brain | Commercial | npm/curl | $0 retrieval, sub-ms recall |

---

*End of deep dive — covers the original blueprint, existing Hermes toolset design, 5 competitive tools with detailed feature analysis, and 3 implementation options with effort estimates.*
