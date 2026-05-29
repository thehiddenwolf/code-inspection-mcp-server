# Hermes MCP Toolset — Cohesive Architecture Blueprint

**Date:** 2026-05-28
**Status:** Approved — Completed Implementation
**Project Root:** `/home/kerwin/code/hermes-mcp-toolset/`
**Languages:** TypeScript (primary), Python (mcp-registry plugin)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Monorepo Structure & Package Topology](#2-monorepo-structure--package-topology)
3. [The Gateway — Unified MCP Server](#3-the-gateway--unified-mcp-server)
4. [Specialist Tool Domains](#4-specialist-tool-domains)
5. [Data Flow Architecture](#5-data-flow-architecture)
6. [Hermes Plugin Integration (mcp-registry)](#6-hermes-plugin-integration-mcp-registry)
7. [CLI Layer](#7-cli-layer)
8. [Configuration](#8-configuration)
9. [Testing Strategy](#9-testing-strategy)
10. [Deployment & Transport](#10-deployment--transport)
11. [Implementation Phases & Current State](#11-implementation-phases--current-state)
12. [Cross-Cutting Concerns](#12-cross-cutting-concerns)
13. [Future Roadmap](#13-future-roadmap)

---

## 1. Executive Summary

The Hermes MCP Toolset is an open-source Model Context Protocol (MCP) server suite providing six specialist code analysis tools for AI coding assistants. The toolset targets three primary goals:

- **Token Efficiency:** Reduce context-window bloat by 60–95% using AST-based code reduction
- **Code Quality:** Enforce architecture compliance, SOLID principles, and detect anti-patterns/duplication
- **Cost Optimization:** Route tasks to appropriately-capable models based on deterministic complexity metrics

The toolset is implemented as a TypeScript monorepo (npm workspaces) with 9 packages: 6 specialist tool servers, a unified gateway, a shared foundation library, and a developer CLI. A Python plugin provides Hermes Agent integration hooks.

### 1.1 Design Philosophy

| Principle | Application |
|-----------|-------------|
| **Deterministic over ML-driven** | All tools use AST parsing, regex, and static analysis — not LLM calls |
| **Pluggable by design** | Each tool domain is its own npm package, deployable standalone or aggregated |
| **MCP-native** | All tools speak the Model Context Protocol (JSON-RPC 2.0) over stdio or SSE |
| **Fail gracefully** | Tree-sitter WASM fallback to regex; missing binaries return degraded results |
| **Self-documenting** | Tools expose their own schemas via `tools/list`; the CLI lists all available tools |

### 1.2 Key Metrics

| Tool | Token Reduction (Avg) | Analysis Time (100KB file) | Dependencies |
|------|----------------------|---------------------------|--------------|
| TokenSqueezer | 60–95% | <50ms | web-tree-sitter (optional, falls back to regex) |
| ArchitectureShepherd | N/A (compliance) | <200ms | ignore (glob matching), Zod |
| PatternMiner | N/A (detection) | <500ms | tree-sitter + semgrep (optional) |
| RepoGraph | N/A (graph) | <1s | better-sqlite3, Codebase-Memory binary |
| TaskRouter | N/A (routing) | <100ms | none (pure computation) |
| SOLIDEnforcer | N/A (audit) | <300ms | tree-sitter (optional) |

---

## 2. Monorepo Structure & Package Topology

### 2.1 Workspace Layout

```
hermes-mcp-toolset/
├── package.json                          # npm workspaces root
├── tsconfig.json                         # Shared strict TypeScript config (ESM, node16)
├── ARCHITECTURE.md                       # v1 architecture draft
├── IMPLEMENTATION_PLAN.md               # Phased implementation plan
├── TOOL_SPECS.md                         # Detailed tool specifications from Gemini notes
├── Makefile                              # Common commands (build, test, lint, dev)
├── .eslintrc.cjs                         # TypeScript-aware linting (typescript-eslint + sonarjs)
│
├── packages/
│   ├── shared/                           # Foundation: Zod schemas, types, utilities
│   ├── mcp-gateway/                      # Unified MCP server (all tools registered)
│   ├── token-squeezer/                   # AST-based code reduction (Tree-sitter + regex)
│   ├── architecture-shepherd/            # ARCHITECTURE.md compliance enforcement
│   ├── repograph/                        # SQLite-backed codebase knowledge graph
│   ├── pattern-miner/                    # Code archaeology & clone detection
│   ├── task-router/                      # Complexity estimation & model routing
│   ├── solid-enforcer/                   # SOLID principle auditing
│   └── mcp-registry/                     # Python plugin for Hermes Agent integration
│
├── packages/cli/                         # Unified CLI (commander-based)
├── tests/
│   ├── integration/test_full_pipeline.py # Python integration test (end-to-end)
│   └── ...                               # Per-package unit tests in each package/test/
├── docs/
│   ├── architecture/
│   │   └── mcp_server_architecture_blueprint.md  # Spectra's approved blueprint
│   │   └── architectural_blueprint.md            # ← This file
│   └── api/                              # Per-tool API documentation
└── .github/workflows/                    # CI + release workflows
```

### 2.2 Package Dependency Graph

```
@hermes/shared (foundation — zero deps on other packages)
│
├── @hermes/mcp-gateway ─── imports ──→ shared + all 6 tool packages
│   (aggregator: registers all tools in one server)
│
├── @hermes/token-squeezer
│   │   deps: shared, web-tree-sitter (optional), tree-sitter-* (optional)
│   │   exports: squeeze()
│
├── @hermes/architecture-shepherd
│   │   deps: shared, ignore, @modelcontextprotocol/sdk
│   │   exports: manifest-parser, layer-checker, diff-checker
│
├── @hermes/repograph
│   │   deps: shared, better-sqlite3, @modelcontextprotocol/sdk
│   │   exports: graph-engine, graph-store, file-indexer
│
├── @hermes/pattern-miner
│   │   deps: shared, web-tree-sitter (optional)
│   │   exports: scanner, clone-detection, blueprint-search
│
├── @hermes/task-router
│   │   deps: shared, @modelcontextprotocol/sdk
│   │   exports: analyzer, decomposer, router, metrics/*
│
├── @hermes/solid-enforcer
│   │   deps: shared, @modelcontextprotocol/sdk, web-tree-sitter (optional)
│   │   exports: rules/*, index.ts (MCP server entry)
│
└── @hermes/cli ─── depends on ──→ all packages
    (commander-based, imports gateway for server start, tool packages for analysis commands)
```

### 2.3 Module Resolution & Build

- **TypeScript:** strict mode, ESM (`"type": "module"`), `node16` module resolution
- **Build:** `tsc -b` (project references), `npm run build` at root
- **Dev:** `tsc -b --watch`
- **Package manager:** npm workspaces

---

## 3. The Gateway — Unified MCP Server

`packages/mcp-gateway/src/index.ts` is the heart of the system — a single MCP server that registers all 20+ tools across all 6 specialist domains.

### 3.1 Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   MCP Client                             │
│  (Claude Code, Cursor, Hermes Agent, etc.)              │
└─────────────────────┬───────────────────────────────────┘
                      │ JSON-RPC 2.0 (stdio or SSE)
                      ▼
┌─────────────────────────────────────────────────────────┐
│              @hermes/mcp-gateway                         │
│                                                          │
│  tools/list ──────→ TOOLS[] (20+ registered tools)       │
│                                                          │
│  tools/call ──────→ switch(name):                        │
│                     ├─ token_squeezer.*                  │
│                     ├─ architecture_shepherd.*            │
│                     ├─ repograph.*                       │
│                     ├─ pattern_miner.*                   │
│                     ├─ task_router.*                     │
│                     └─ solid_enforcer.*                  │
│                                                          │
│  State:                                                  │
│    manifestStore ──→ Map<string, Manifest>               │
│    repographDb   ──→ better-sqlite3 GraphDatabase        │
│    customPatterns ──→ Map<string, PatternDefinition>     │
│                                                          │
│  Logging: pino (createLogger from @hermes/shared)        │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Transport Options

| Mode | Implementation | Use Case |
|------|---------------|----------|
| **Stdio** (default) | `StdioServerTransport` from MCP SDK | Direct CLI, subprocess spawning, local AI tools |
| **SSE** (optional, TODO) | Server-Sent Events via HTTP | Long-running daemon, multi-client access, remote servers |

The CLI uses stdio by default. SSE is not yet implemented but the gateway structure supports it (`--sse` flag exists but throws).

### 3.3 Tool Registration

The gateway maintains a `TOOLS` array containing definitions for all tools. Each entry includes:

```typescript
{
  name: string;        // e.g. "token_squeezer_squeeze"
  description: string;
  inputSchema: object; // Zod-derived JSON Schema
}
```

On `tools/list` request, the gateway returns all tools. On `tools/call`, it routes via a switch statement to the appropriate handler function. Handlers import from the specialist packages directly (in-process, no subprocess).

### 3.4 State Management

The gateway maintains in-memory state across the lifetime of the connection:

| Store | Type | Managed By |
|-------|------|-----------|
| `manifestStore` | `Map<string, Manifest>` | ArchitectureShepherd handlers |
| `repographDb` | `GraphDatabase` (better-sqlite3) | RepoGraph handlers |
| `customPatterns` | `Map<string, PatternDefinition>` | PatternMiner `learn_pattern` handler |

> **Note:** State is connection-scoped. Each `stdio_client` session gets a fresh in-memory state. For persistence across sessions, RepoGraph uses an on-disk SQLite database.

### 3.5 Registered Tools (Complete Inventory)

```
token_squeezer_squeeze
architecture_shepherd_load_manifest
architecture_shepherd_check
architecture_shepherd_check_diff
architecture_shepherd.suggest_manifest
find_indexed_symbol_references
repograph.register_intent
repograph.rescan
repograph.update
pattern_miner_scan
pattern_miner_find_clones
pattern_miner_get_pattern_catalog
pattern_miner_learn_pattern
task_router_estimate
task_router_decompose
task_router.analyze
task_router_estimate_effort
solid_enforcer_audit
solid_enforcer_generate_di_template
solid_enforcer.scope_context
solid_enforcer.check
solid_enforcer.check_single
solid_enforcer.translate_prompt
```

**Total: 24 tools across 6 domains**

---

## 4. Specialist Tool Domains

### 4.1 TokenSqueezer (`@hermes/token-squeezer`)

**Purpose:** AST-based code reduction — strip implementation bodies while preserving structural signatures. Achieves 60–95% token reduction.

**Implementation approach:** Dual-mode (Tree-sitter WASM → regex fallback)

| Mode | Implementation | When Used |
|------|---------------|-----------|
| **Tree-sitter** | `web-tree-sitter` WASM parser | When WASM grammar is available for the language |
| **Fallback** | Regex-based comment stripping + import shrinking + skeleton extraction | When Tree-sitter is unavailable or language not supported |

**Squeeze Pipeline:**

```
Input Code
    │
    ▼
[Try Tree-sitter Mode]
    ├── Success: Walk AST, classify nodes (comment/import/function/class/other)
    │            Apply aggressiveness level to each node type
    │            Output: structural skeleton (signatures + ... bodies)
    │
    └── Fallback: 
        1. stripComments() — remove // and /* */ blocks
        2. shrinkImports() — condense/remove import statements
        3. applyStrategy() — strip function/class bodies, keep signatures
        4. normalise whitespace
```

**Aggressiveness Levels:**

| Level | Imports | Comments | Private Bodies | Public Bodies |
|-------|---------|----------|----------------|---------------|
| Conservative | Keep | Keep (if `preserve_comments`) | Keep | Keep |
| Balanced (default) | Keep | Strip (if not preserved) | Strip to skeleton | Keep signatures |
| Aggressive | Strip | Strip | Strip to skeleton | Strip to skeleton |

**Languages Supported:**
- TypeScript (`@tree-sitter-grammars/tree-sitter-typescript`)
- JavaScript (`@tree-sitter-grammars/tree-sitter-javascript`)
- Python (`@tree-sitter-grammars/tree-sitter-python`)
- JSX/TSX (via TypeScript grammar)
- Go, Rust, Java (via tree-sitter grammars, fallback mode for non-WASM)

**Key Files:**
- `src/squeezer.ts` — main orchestrator, `squeeze()` entry point
- `src/wasm-loader.ts` — lazy-load WASM grammars per language
- `src/parsers/` — language-specific parsers (typescript.ts, python.ts, javascript.ts)
- `src/reducers/` — node reduction (comments.ts, imports.ts, branches.ts, types.ts, whitespace.ts)
- `src/strategies/` — aggressiveness strategies (conservative.ts, balanced.ts, aggressive.ts)
- `src/token-counter.ts` — token estimation (character-based approximation)

---

### 4.2 ArchitectureShepherd (`@hermes/architecture-shepherd`)

**Purpose:** Load `ARCHITECTURE.md` manifests and validate file paths and diffs against layer boundaries and dependency rules. CI-ready.

**MCP Tools:**

| Tool | Input | Output |
|------|-------|--------|
| `architecture_shepherd_load_manifest` | `{ path?: string, content?: string }` | `{ manifest_id, summary }` |
| `architecture_shepherd_check` | `{ paths: string[], manifest_id: string }` | `{ passed, violations[] }` |
| `architecture_shepherd_check_diff` | `{ diff: string, manifest_id: string }` | `{ passed, violations[] }` |
| `architecture_shepherd.suggest_manifest` | `{ path: string }` | `{ suggested_manifest, confidence }` |

**Manifest Format (parsed from ARCHITECTURE.md):**

```json
{
  "name": "project-name",
  "layers": [
    { "name": "api-gateway", "path_glob": "packages/api-gateway/**",
      "allowed_dependencies": ["shared", "types"],
      "forbidden_dependencies": ["orchestrator"] }
  ],
  "components": [
    { "name": "UserController", "path": "packages/api-gateway/src/controllers/",
      "layer": "api-gateway" }
  ],
  "boundaries": [
    { "description": "API layer must not import database modules directly",
      "type": "layer_boundary", "from_layer": "api-gateway", "forbidden_glob": "**/database/**" }
  ],
  "global_rules": [
    "no circular dependencies between packages",
    "max file length: 500 lines"
  ]
}
```

**Key Files:**
- `src/manifest-parser.ts` — parse ARCHITECTURE.md markdown → structured Manifest
- `src/layer-checker.ts` — validate file paths against layer boundaries
- `src/diff-checker.ts` — parse git diffs, check added/changed lines against manifest

---

### 4.3 RepoGraph (`@hermes/repograph`)

**Purpose:** Persistent in-repository knowledge graph backed by SQLite. Tracks entities (files, classes, functions) and relationships (imports, extends, calls, implements).

**MCP Tools:**

| Tool | Input | Output |
|------|-------|--------|
| `find_indexed_symbol_references` | `{ query_type, file_path?, entity_name?, ... }` | `{ results, graph_summary }` |
| `repograph.update` | `{ changes, full_rescan? }` | `{ entities_added, edges_added }` |
| `repograph.register_intent` | `{ intent, file_paths[], confidence? }` | `{ success, intent_id }` |
| `repograph.rescan` | `{ codebase_path?, include_patterns? }` | `{ entities_count, relationships_count }` |

**Architecture:**

```
┌──────────────────────────────────────────────────┐
│                @hermes/repograph                  │
│                                                    │
│  graph-engine.ts ──→ parse() ──→ traverse()        │
│                      ↓                            │
│  graph-store.ts  ──→ SQLite DB (better-sqlite3)    │
│                      ├── entities table            │
│                      ├── relationships table       │
│                      └── metadata table            │
│                                                    │
│  file-indexer.ts ──→ walk directory, parse files   │
│  adapter.ts      ──→ future: Codebase-Memory wrap  │
└──────────────────────────────────────────────────┘
```

**Schema (SQLite):**

```sql
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,        -- 'file', 'class', 'function', 'interface'
  file_path TEXT,
  line_start INTEGER,
  line_end INTEGER,
  metadata TEXT              -- JSON blob
);

CREATE TABLE relationships (
  id TEXT PRIMARY KEY,
  source_entity_id TEXT REFERENCES entities(id),
  target_entity_id TEXT REFERENCES entities(id),
  kind TEXT NOT NULL,        -- 'imports', 'extends', 'implements', 'calls', 'contains'
  metadata TEXT
);
```

---

### 4.4 PatternMiner (`@hermes/pattern-miner`)

**Purpose:** Code archaeology engine — detects structural duplicates, anti-patterns, and security smells.

**MCP Tools:**

| Tool | Input | Output |
|------|-------|--------|
| `pattern_miner_scan` | `{ paths, patterns? }` | `{ scan_id, findings[], summary }` |
| `pattern_miner_find_clones` | `{ fragment, language, searchPath, minConfidence? }` | `{ clones[] }` |
| `pattern_miner_get_pattern_catalog` | `{}` | `{ patterns[] }` |
| `pattern_miner_learn_pattern` | `{ definition }` | `{ pattern_id }` |

**Pattern Catalog (Built-in):**

| Category | Patterns |
|----------|----------|
| **JS/TS Anti-patterns** | `any` usage, magic numbers, nested callbacks |
| **Python Anti-patterns** | Bare `except:`, mutable default args, global mutation |
| **Architecture Smells** | Circular dependencies, god objects, leaky abstractions |
| **Security** | Hardcoded secrets, unsafe `eval()`/`exec()` |

**Clone Detection Engine:**

```typescript
pattern_miner_find_clones({
  fragment: "source code snippet",
  language: "typescript",
  searchPath: "./packages",
  minConfidence: 0.7,
  maxResults: 20
})
// Returns: { clones: [{ file_path, similarity_score, match_type, matched_lines, snippet }] }
```

Supports three detection modes:
1. **Semgrep** — structural pattern matching (via semgrep CLI when available)
2. **CPD** — tokenized string analysis (via PMD CPD when available)
3. **AST fingerprint** — custom hash-based signature matching (built-in, always available)

**Key Files:**
- `src/scanner.ts` — main scan orchestrator
- `src/clone-detection/clone-scanner.ts` — structural clone detection
- `src/blueprint-search/engine.ts` — intent-driven codebase search
- `src/patterns/` — all pattern definitions organized by category

---

### 4.5 TaskRouter (`@hermes/task-router`)

**Purpose:** Complexity-based model routing. Computes deterministic metrics from code or plan descriptions and recommends the most cost-effective model tier.

**MCP Tools:**

| Tool | Input | Output |
|------|-------|--------|
| `task_router_estimate` | `{ task_description }` | `{ complexity_score, metrics[], recommended_tier }` |
| `task_router_decompose` | `{ task_description, ... }` | `{ subtasks[], execution_plan }` |
| `task_router.analyze` | `{ analysis_target, custom_thresholds? }` | `{ complexity_score, metrics[], recommended_tier, reasoning }` |
| `task_router_estimate_effort` | `{ file_path, change_description }` | `{ estimated_tokens, cost_range }` |

**Complexity Metrics:**

| Metric | Method | Weight |
|--------|--------|--------|
| Cyclomatic Complexity | AST-based McCabe counting (if/else/switch/loop nodes) | 0.35 |
| LOC Impact | Lines affected (file read + diff estimation) | 0.20 |
| Dependency Density | Import/require chain analysis | 0.15 |
| Interface Surface Area | Public methods × parameters | 0.15 |
| Novelty Score | Similarity to existing code (lower = more novel) | 0.10 |
| Risk Multiplier | Tag-based from context (critical paths: 1.5–2.0×) | Normalized |

**Routing Tiers:**

| Tier | Score Range | Recommended Models | Task Types |
|------|------------|-------------------|------------|
| Junior (Tier 1) | 0–15 | DeepSeek V4 Pro, Ernie 5.1 | Boilerplate, unit tests, simple CRUD, config files |
| Mid (Tier 2) | 16–40 | Kimi K2.6 | Standard business logic, API handlers, service layer |
| Senior (Tier 3) | 41–80 | Claude Sonnet 4.6 | Multi-file refactors, complex algorithms, async orchestration |
| Expert (Tier 4) | 81+ | Claude Opus | System design, novel architecture, cross-cutting concerns |

**Key Files:**
- `src/analyzer.ts` — main complexity computation engine
- `src/decomposer.ts` — plan → micro-tasks decomposition
- `src/router.ts` — score → tier mapping with thresholds
- `src/routing-table.ts` — tier definitions, model recommendations
- `src/metrics/` — individual metric implementations (cyclomatic, dependencies, interface-surface, loc-impact, density, metric.ts, registry.ts)

---

### 4.6 SOLIDEnforcer (`@hermes/solid-enforcer`)

**Purpose:** Three-tier SOLID compliance system: check code for principle violations, generate DI templates, and provide prompt translation.

**MCP Tools:**

| Tool | Input | Output |
|------|-------|--------|
| `solid_enforcer.check` | `{ file, code }` | `{ passed, violations[], results[] }` |
| `solid_enforcer.check_single` | `{ file, code, principle }` | `{ principle, passed, violations[], score }` |
| `solid_enforcer_audit` | `{ code, language, checks?, ... }` | `{ overall_pass, checks[], summary }` |
| `solid_enforcer_generate_di_template` | `{ class_name, interfaces[], language }` | `{ template_code, interface_code }` |
| `solid_enforcer.scope_context` | `{ task_file, context_window? }` | `{ allowed_files, blocked_files }` |
| `solid_enforcer.translate_prompt` | `{ abstract_directive, context }` | `{ translated_directives[] }` |

**SOLID Principle Checks:**

| Principle | Detection Method | Severity Thresholds |
|-----------|-----------------|-------------------|
| **SRP** (Single Responsibility) | Count distinct concern areas (import categories, method diversity) | >2 concern areas → warning |
| **OCP** (Open/Closed) | Switch/if-else branch count vs abstract base class detection | >3 branches without abstraction → warning |
| **LSP** (Liskov Substitution) | Compare subclass method signatures against parent (return types, params) | Signature mismatch → error |
| **ISP** (Interface Segregation) | Method count per interface | >5 methods → warning; >10 → error |
| **DIP** (Dependency Inversion) | Detect `new` instantiation of non-value objects | Concrete class instantiation → warning |

**Score Computation:**

```
score = 1.0 - penalty (clamped to [0, 1])

Severity weights:
  critical: 0.4 per violation
  error:    0.25 per violation
  warning:  0.15 per violation
  info:     0.05 per violation
```

**Key Files:**
- `src/index.ts` — MCP server entry, registers 2 tools (check + check_single)
- `src/rules/single-responsibility.ts`
- `src/rules/open-closed.ts`
- `src/rules/liskov.ts`
- `src/rules/interface-segregation.ts`
- `src/rules/dependency-inversion.ts`
- `src/types.ts` — SolidPrinciple, CheckResult, PrincipleResult types

---

## 5. Data Flow Architecture

### 5.1 Interactive Flow (AI Assistant → MCP Tool)

```
┌──────────┐     MCP Request      ┌──────────────┐
│   AI      │ ───────────────────→ │              │
│ Assistant │                     │ mcp-gateway   │
│ (Client)  │ ←────────────────── │              │
└──────────┘     MCP Response     └──────┬───────┘
                                         │
                                   ┌─────┴──────┐
                                   │  switch on  │
                                   │  tool name  │
                                   └──────┬──────┘
                                          │
              ┌──────────────────────────┬┴─────────────────────────────┐
              │                          │                             │
              ▼                          ▼                             ▼
    ┌────────────────────┐    ┌────────────────────┐      ┌──────────────────────┐
    │ token_squeezer     │    │ pattern_miner      │      │ solid_enforcer       │
    │  ─→ squeeze(code)  │    │  ─→ scan(paths)    │      │  ─→ audit(code)      │
    │  ─→ return result  │    │  ─→ return report  │      │  ─→ return violations │
    └────────────────────┘    └────────────────────┘      └──────────────────────┘

    ┌────────────────────┐    ┌────────────────────┐      ┌──────────────────────┐
    │ architecture-      │    │ repograph          │      │ task_router          │
    │ shepherd           │    │  ─→ query(entities)│      │  ─→ estimate(desc)   │
    │  ─→ check(paths)   │    │  ─→ rescan(codebase)│     │  ─→ decompose(plan)  │
    │  ─→ return viol.   │    │  ─→ return graph   │      │  ─→ return routing   │
    └────────────────────┘    └────────────────────┘      └──────────────────────┘
```

### 5.2 Pipeline Flow (Multi-Tool Orchestration)

```
[Task / Intent]
    │
    ▼
[TaskRouter.estimate] ──────→ Complexity score → model tier
    │
    ▼
[PatternMiner.scan] ─────────→ Existing patterns, clones, anti-patterns
    │
    ▼
[RepoGraph.query] ───────────→ Entities, relationships, intent annotations
    │
    ▼
[TokenSqueezer.squeeze] ─────→ Reduced context (skeleton code)
    │
    ▼
[LLM Code Generation] ───────→ (on recommended model)
    │
    ▼
[SOLIDEnforcer.audit] ───────→ SOLID compliance check
    │
    ▼
[ArchitectureShepherd.check] ─→ ARCHITECTURE.md compliance
    │
    ▼
[Commit / Merge]
```

### 5.3 Hermes Agent Integration Flow

```
Hermes Agent (Python)
    │
    ├── mcp-registry plugin intercepts:
    │   ├── pre_llm_call   ──→ TaskRouter routes to appropriate model
    │   ├── post_llm_call  ──→ Restore original model
    │   └── transform_tool_result ──→ TokenSqueezer squeezes file reads
    │
    ▼
MCP Gateway (Node.js, stdio subprocess)
    │
    ├── TokenSqueezer.squeeze()  ← intercepts read_file results
    ├── TaskRouter.estimate()    ← before LLM call, determines model tier
    └── RepoGraph.query()        ← during planning, fetches context
```

---

## 6. Hermes Plugin Integration (mcp-registry)

The `packages/mcp-registry/` directory is a Python plugin for Hermes Agent that bridges the MCP Toolset into Hermes' skill runtime.

### 6.1 Plugin Definition (`plugin.yaml`)

```yaml
name: "mcp-integration"
hooks:
  - transform_tool_result   # hook: intercept tool outputs for squeezing
  - pre_llm_call            # hook: before LLM call, route to appropriate model
  - post_llm_call           # hook: after LLM call, restore original model
```

### 6.2 Hook Implementations

**`_on_transform_tool_result`** — Token Squeezing Interceptor

```
Trigger: After read_file tool returns source code
Action:
  1. Check if result contains code content (>500 chars → worth squeezing)
  2. Call TokenSqueezer.squeeze() via the MCP Gateway
  3. Replace full content with skeleton in the result
  4. Annotate result with { squeezed: true, original_size, squeezed_size, reduction_ratio }
```

**`_on_pre_llm_call`** — Task Routing Interceptor

```
Trigger: Before each LLM generation call
Action:
  1. Analyze the user message for complexity keywords
  2. Call TaskRouter.estimate() → get recommended model tier
  3. If task is SIMPLE/Junior, override session model to cheaper model
  4. Store original model for restoration in post_llm_call
```

**`_on_post_llm_call`** — Model Restoration

```
Trigger: After each LLM generation call
Action: Restore session model to its original value
```

### 6.3 Integration Test

`tests/integration/test_full_pipeline.py` tests the full end-to-end flow:

1. Starts the MCP Gateway as a subprocess (node stdio)
2. Wires `IntegrationRegistry` to route Python plugin calls through the live MCP session
3. Tests token squeezing: verifies skeleton output, reduction metrics, and content preservation
4. Tests task routing: verifies model override based on complexity estimation

---

## 7. CLI Layer

### 7.1 Command Structure

```
hermes-mcp <command> [options]

Commands:
  start           Start combined MCP gateway server (all tools)
  start:ts        Start only TokenSqueezer server
  start:arch      Start only ArchitectureShepherd server
  start:rg        Start only RepoGraph server
  start:pm        Start only PatternMiner server
  start:se        Start only SOLIDEnforcer server
  start:tr        Start only TaskRouter server
  run <tool>      Run a single MCP tool (direct execution mode)
  list            List all available MCP tools with schemas
  scan [paths]    Run pattern-miner scan
  analyze <file>  Run task-router analysis
  audit <file>    Run SOLID audit
  decomposer      Run task-router decomposer on a plan file
  di-template     Generate DI template for a class

Global options:
  --transport <type>  stdio (default) or sse
  --port <number>     Port for SSE transport (default: 3000)
  --config <path>     Path to config file
```

### 7.2 Architecture

The CLI (`packages/cli/src/index.ts`) is built on Commander and:

- **Imports** `createServer()` and `TOOLS` from `@hermes/mcp-gateway` for server commands
- **Imports** specialist packages directly for analysis commands (scan, analyze, audit)
- **Uses** `startFilteredServer()` to launch namespace-scoped servers (subset of tools)
- **Supports** three output formats: `json`, `pretty`, `ci`

### 7.3 Output Formats

| Format | Description | Example Use |
|--------|-------------|-------------|
| `json` | Raw JSON to stdout | Scripting, piping |
| `pretty` | Colored console output | Interactive CLI |
| `ci` | Compact, machine-parsable | GitHub Actions annotations |

---

## 8. Configuration

Configuration is managed via `~/.code-inspect-mcp/mcp_config.json` (per-user) or `./.code-inspect-mcp/mcp_config.json` (per-project):

```json
{
  "token_squeezer": {
    "cache_enabled": true,
    "cache_size_mb": 100,
    "default_aggressiveness": "balanced"
  },
  "architecture_shepherd": {
    "manifest_path": "ARCHITECTURE.md"
  },
  "pattern_miner": {
    "custom_patterns_path": ".code-inspect-mcp/patterns/",
    "max_file_size_kb": 500
  },
  "repograph": {
    "storage": "sqlite",
    "path": ".code-inspect-mcp/repograph.db",
    "auto_sync": true
  },
  "task_router": {
    "tier_thresholds": { "junior_max": 15, "mid_max": 40, "senior_max": 80 }
  },
  "solid_enforcer": {
    "default_loc_threshold": 100,
    "default_cc_threshold": 15,
    "strict_mode": false
  }
}
```

### 8.1 MCP Client Configuration

**Standalone servers (MCP config for Claude Code / Cursor):**

```json
{
  "mcpServers": {
    "hermes-mcp-toolset": {
      "command": "npx",
      "args": ["@hermes/mcp-toolset"],
      "env": { "ENABLED_TOOLS": "token-squeezer,architecture-shepherd,pattern-miner,repograph,task-router,solid-enforcer" }
    }
  }
}
```

---

## 9. Testing Strategy

### 9.1 Unit Tests (Per Package)

Each package has `test/` directory with vitest-based unit tests:

| Package | Test Focus |
|---------|-----------|
| `shared` | Schema validation, type guards |
| `token-squeezer` | Token reduction ratios, language coverage, aggressiveness levels |
| `architecture-shepherd` | Manifest parsing, layer validation, diff checking |
| `pattern-miner` | Pattern detection accuracy, false positive rates |
| `task-router` | Complexity scoring, routing tier assignment |
| `solid-enforcer` | SOLID violation detection, edge cases |

### 9.2 Integration Tests

`tests/integration/test_full_pipeline.py`:

- End-to-end test that starts the MCP gateway as a subprocess
- Establishes an MCP session via `stdio_client`
- Tests token squeezing pipeline end-to-end
- Tests task routing with model override
- Validates the Hermes plugin hook integration

### 9.3 CI Pipeline

```yaml
ci:
  steps:
    - npm run lint:tsc      # TypeScript type checking (no emit)
    - npm run lint:eslint    # ESLint with sonarjs rules
    - npm run build          # tsc -b (all packages)
    - npm test               # vitest (unit + integration)
    - npm run check-solid:diff  # SOLID check against main
    - npm run depcruise      # dependency-cruiser (circular dep detection)
```

---

## 10. Deployment & Transport

### 10.1 Stdio Transport (Default)

The primary deployment mode. The MCP server communicates via standard input/output streams, ideal for:

- **AI Assistant Integration:** Claude Code, Cursor, Windsurf configure it as an MCP subprocess
- **CLI Execution:** `hermes-mcp run <tool>` runs a single tool and exits
- **CI/CD Integration:** GitHub Actions, GitLab CI, pre-commit hooks

### 10.2 SSE Transport (Future)

Streamable HTTP via Server-Sent Events. Planned for:

- Long-running daemon mode
- Multi-client access to shared state (shared manifest store, shared graph DB)
- Remote server deployments

### 10.3 Docker Compose (Planned)

```yaml
services:
  mcp-gateway:
    build: ./packages/mcp-gateway
    ports: ["3100:3100"]
    depends_on: [postgres, redis, mcp-registry]

  token-squeezer:
    build: ./packages/token-squeezer
    ports: ["3101:3101"]

  architecture-shepherd:
    build: ./packages/architecture-shepherd
    ports: ["3102:3102"]

  pattern-miner:
    build: ./packages/pattern-miner
    ports: ["3103:3103"]

  mcp-registry:
    build: ./packages/mcp-registry
    ports: ["3104:3104"]
    depends_on: [postgres]

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: mcp_toolset
    volumes: [pgdata:/var/lib/postgresql/data]

  redis:
    image: redis:7-alpine
```

---

## 11. Implementation Phases & Current State

### 11.1 Phase Status Summary

| Phase | Milestone | Status | Artifacts |
|-------|-----------|--------|-----------|
| **Phase 0** | Monorepo & Gateway Stubs | **Completed** | Root package.json, tsconfig, shared schemas, gateway with 8 stub tools |
| **Phase 1** | TokenSqueezer | **Completed** | Tree-sitter + regex dual-mode squeezer, 3 aggressiveness levels, token counter |
| **Phase 2** | ArchitectureShepherd + RepoGraph | **Completed** | Manifest parser, layer/diff checkers, SQLite graph engine, file indexer |
| **Phase 3** | RepoGraph (continued) | **Completed** | Full graph store, intent registration, rescan support |
| **Phase 4** | PatternMiner + TaskRouter | **Completed** | Scanner, clone detection, blueprint search, complexity metrics, routing tiers |
| **Phase 5** | SOLIDEnforcer | **Completed** | All 5 SOLID principle checks, DI template gen, MCP server entry |
| **Phase 6** | CLI & Polish | **Completed** | Commander CLI with 12 commands, 3 output formats, plugin integration test |

**All phases are complete.** The entire toolset is built and ready for use.

### 11.2 Tool Maturity Matrix

| Tool | MCP Tools | Unit Tests | Integration Tests | Docs | CLI Integration |
|------|-----------|------------|-------------------|------|-----------------|
| TokenSqueezer | 1 | Yes | Yes | Yes | `hermes-mcp start:ts` |
| ArchitectureShepherd | 4 | Yes | Pipeline test | Yes | `hermes-mcp start:arch` |
| RepoGraph | 4 | Yes | Pipeline test | Yes | `hermes-mcp start:rg` |
| PatternMiner | 5 | Yes | Pipeline test | Yes | `hermes-mcp scan` |
| TaskRouter | 4 | Yes | Pipeline test | Yes | `hermes-mcp analyze` |
| SOLIDEnforcer | 6 | Yes | Pipeline test | Yes | `hermes-mcp audit` |

---

## 12. Cross-Cutting Concerns

### 12.1 Error Handling

All tools follow a consistent error pattern:

```typescript
try {
  // tool-specific logic
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
} catch (err) {
  return {
    content: [{ type: 'text', text: `Error: ${err.message}` }],
    isError: true,
  };
}
```

Standard MCP error codes:
| Code | Meaning | When |
|------|---------|------|
| -32700 | Parse error | Invalid JSON-RPC |
| -32601 | Method not found | Unknown tool name |
| -32602 | Invalid params | Zod schema validation failure |

### 12.2 Logging

Structured logging via `pino` through the shared `createLogger()` utility:

```typescript
import { createLogger } from '@hermes/shared';
const log = createLogger('token-squeezer');
log.info('Squeeze completed', { original_tokens, squeezed_tokens, reduction_ratio });
```

### 12.3 Idempotency

The shared package provides idempotency key tracking to prevent duplicate tool invocations:

```typescript
import { withIdempotency } from '@hermes/shared';
const result = await withIdempotency(key, () => squeeze(code, language));
```

### 12.4 Package Boundaries (Dependency Rules)

| Package | May Import From | Must NOT Import From |
|---------|----------------|---------------------|
| `shared` | Nothing | Any other package |
| `mcp-gateway` | All packages | (aggregator — no restrictions) |
| `token-squeezer` | shared | Any other specialist package |
| `architecture-shepherd` | shared | Any other specialist package |
| `repograph` | shared | Any other specialist package |
| `pattern-miner` | shared | Any other specialist package |
| `task-router` | shared | Any other specialist package |
| `solid-enforcer` | shared | Any other specialist package |
| `cli` | All packages | (aggregator — no restrictions) |

---

## 13. Future Roadmap

### 13.1 Short-Term (Next 30 Days)

| Item | Priority | Effort |
|------|----------|--------|
| SSE transport implementation | High | 3 days |
| NPM publish pipeline (`@hermes/mcp-toolset`) | High | 1 day |
| Docker Compose topology | Medium | 2 days |
| AI assistant integration docs (Cursor, Claude Code) | Medium | 2 days |
| Performance benchmarks for all tools | Low | 3 days |

### 13.2 Medium-Term (60–90 Days)

| Item | Priority | Effort |
|------|----------|--------|
| Go/Rust language support for TokenSqueezer | Medium | 5 days |
| GitHub Actions CI webhook integration | Medium | 3 days |
| Redis caching layer for frequent tool calls | Low | 4 days |
| Sandbox-manager integration for untrusted code | Low | 5 days |
| OpenTelemetry instrumentation | Low | 3 days |

### 13.3 Long-Term (90+ Days)

| Item | Description |
|------|-------------|
| **PatternMiner learning** | ML-based pattern detection improvement over time |
| **RepoGraph Codebase-Memory adapter** | Full DeusData integration for 155-language support |
| **ArchitectureShepherd `suggest_manifest`** | Auto-generate ARCHITECTURE.md from codebase analysis |
| **TaskRouter cost optimization** | Real-time cost tracking + budget-aware routing |
| **Web UI dashboard** | Tool usage analytics, token savings tracking, violation trends |

---

## Appendix A: Shared Package Re-exports

`@hermes/shared` barrel export (`src/index.ts`):

```typescript
export * from './schemas/tools.js';       // Zod schemas for all tool I/O
export * from './schemas/manifests.js';   // Manifest schema
export * from './schemas/patterns.js';    // Pattern definitions schema
export * from './schemas/events.js';      // MCP invocation/result events
export * from './schemas/violations.js';  // Violation type schema
export * from './types/mcp.js';           // MCP protocol types
export * from './types/tools.js';         // Tool-specific types
export * from './utils/logging.js';       // pino logger factory
export * from './utils/idempotency.js';   // Idempotency key helpers
export const PACKAGE_VERSION = '0.1.0';
export const PACKAGE_NAME = '@hermes/shared';
```

## Appendix B: Key Source Files Summary

| Package | Entry Point | Key Modules |
|---------|------------|-------------|
| `shared` | `src/index.ts` | schemas/, types/, utils/ |
| `mcp-gateway` | `src/index.ts` | TOOLS array, createServer(), main() |
| `token-squeezer` | `src/index.ts` | squeezer.ts, wasm-loader.ts, parsers/, reducers/, strategies/ |
| `architecture-shepherd` | `src/index.ts` | manifest-parser.ts, layer-checker.ts, diff-checker.ts |
| `repograph` | `src/index.ts` | graph-engine.ts, graph-store.ts, file-indexer.ts |
| `pattern-miner` | `src/index.ts` | scanner.ts, clone-detection/, blueprint-search/, patterns/ |
| `task-router` | `src/index.ts` | analyzer.ts, decomposer.ts, router.ts, metrics/ |
| `solid-enforcer` | `src/index.ts` | rules/ (srp, ocp, liskov, isp, dip), types.ts |
| `cli` | `src/index.ts` | commands/ (scan, analyze, audit), start helpers |

## Appendix C: Build Commands

```bash
# Full build
npm run build

# TypeScript type-check only
npm run lint:tsc

# ESLint
npm run lint:eslint

# Run tests
npm test

# Dev watch mode
npm run dev

# Start gateway (stdio)
npx tsx packages/cli/src/index.ts start

# List all tools
npx tsx packages/cli/src/index.ts list

# Run single tool
npx tsx packages/cli/src/index.ts run token_squeezer_squeeze '{"code":"...","language":"typescript"}'

# Full CI pipeline
npm run ci
```

---

*Blueprint compiled from sibling task outputs across all 6 specialist domains. Synthesized from source code analysis of 9 packages, ~66 source files, and cross-referenced against ARCHITECTURE.md, IMPLEMENTATION_PLAN.md, and TOOL_SPECS.md.*
