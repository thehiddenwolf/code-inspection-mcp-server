# Hermes MCP Toolset — Project Roadmap

**Date:** 2026-05-27
**Status:** Active Planning
**Target:** v1.0.0 — 8-week implementation cycle

---

## Package Overview

### 1. `@hermes/shared` — Foundation
**What it does:** Shared Zod schemas, TypeScript types, utility functions, and event data models used by all other packages. No business logic — pure definitions.

**Dependencies:** None (zero-dependency package, only `zod` runtime dep)

**Key contents:**
- Zod schemas for all MCP tool inputs/outputs
- Canonical event schemas (invocation, result, violation)
- Manifest schema (ARCHITECTURE.md parser)
- Pattern definition schema
- Shared TypeScript enums (languages, severity levels, aggressiveness modes)

**Size estimate:** ~500 lines of Zod + type definitions

---

### 2. `@hermes/token-squeezer` — AST Context Reduction Engine
**What it does:** Parses source code into a Tree-sitter AST, strips non-essential nodes (function bodies, comments, type annotations, dead branches), returns a structural skeleton at 60-95% token reduction.

**Dependencies:** `@hermes/shared`, `web-tree-sitter`, per-language WASM grammar packages

**MCP tools provided:** `token_squeezer.squeeze`

**Why this is Phase 1:** Highest ROI of any tool. The ecosystem has independently validated the approach (mcp-code-context, Repomix, code-review-graph, Aider, Claude Code itself — all use Tree-sitter body-stripping). A single call saves 60-90% of file token cost with zero LLM overhead. The SWE-Pruner paper (arxiv:2601.16746) explicitly validates that structural preservation is *more* important under tighter compression budgets.

**Language support v1:** JavaScript, TypeScript, JSX, TSX, Python, Go
**Language support roadmap:** Rust, Java, Ruby, C/C++, SQL

**Key design decisions:**
- Tree-sitter WASM > Babel (zero native deps, cross-platform, matches MCP ecosystem standard)
- Three aggressiveness levels (conservative, balanced, aggressive)
- Both text skeleton and structured JSON output
- Token counting via tiktoken (cl100k_base) for consistency
- Cache by file hash to avoid re-parsing

**Benchmark targets:**
| Language | File Type | Original Tokens | Skeleton Tokens | Target Reduction |
|----------|-----------|----------------|-----------------|-----------------|
| TypeScript | 500-line service class | ~3,500 | ~175-350 | 90-95% |
| Python | 300-line data pipeline | ~2,100 | ~315-525 | 75-85% |
| Go | 200-line handler | ~1,400 | ~280-420 | 70-80% |

---

### 3. `@hermes/architecture-shepherd` — Compliance Enforcement
**What it does:** Parses ARCHITECTURE.md into a structured manifest, then checks code against layer boundaries, dependency rules, naming conventions, and file-size limits. Runs in CI (git diff) or interactively (IDE).

**Dependencies:** `@hermes/shared`, `ignore` (glob matching), `@hermes/pattern-miner` (optional, for import analysis)

**MCP tools provided:** `load_manifest`, `check`, `check_diff`, `suggest_manifest`

**Why Phase 2:** Provides immediate value for teams with existing ARCHITECTURE.md files. CI-ready — plug it into GitHub Actions and get PR comments on violation. The `suggest_manifest` tool bootstraps new projects.

**Key design decisions:**
- Manifest parsed from markdown code blocks (JSON embedded in ARCHITECTURE.md)
- Glob-based layer matching (supports `**` patterns)
- Dependency rule engine checks imports/exports against allowed/forbidden lists
- Git diff parser handles unified diff format from `git diff` or PR API

**CI integration pattern:**
```yaml
# .github/workflows/architecture-check.yml
- name: Check architecture compliance
  run: npx @hermes/architecture-shepherd check-diff
  env:
    DIFF: ${{ github.event.pull_request.body }}
    MANIFEST: ARCHITECTURE.md
```

---

### 4. `@hermes/repograph` — In-Repository Knowledge Graph
**What it does:** Persistent codebase memory via SQLite-backed entity-relationship graph. Provides symbol query, call graph traversal, and unique intent annotation layer.

**Dependencies:** `@hermes/shared`, `better-sqlite3` (companion intent DB), **Codebase-Memory MCP binary** (parsing + graph backend)

**MCP tools provided:** `repograph_query`, `repograph_update`, `repograph_register_intent`, `repograph_rescan`

**Why Phase 3:** RepoGraph is the memory layer that makes other tools state-aware. TokenSqueezer needs it for caching, PatternMiner needs it for cross-file analysis, TaskRouter needs it for dependency analysis. Build it after the core analysis tools so it can be the "backend" rather than an additional dependency.

**Architecture — Hybrid Adapter Pattern:**
```
┌──────────────────────┐
│   Hermes RepoGraph   │  ← MCP server (this package)
│   MCP Tools          │
├──────────────────────┤
│  Intent Annotation   │  ← Companion SQLite DB
│  Layer               │    Schema: intents(id, file_path, intent_text,
│                      │             confidence, created_at, updated_at)
├──────────────────────┤
│  Codebase-Memory     │  ← External binary (MIT, C, single binary)
│  Adapter             │    Routes to codebase-memory-mcp
├──────────────────────┤
│  Codebase-Memory     │  ← External process (installed by script)
│  (155 languages)     │    Tree-sitter parsing, graph construction,
│                      │    sub-ms queries, auto-sync
└──────────────────────┘
```

**Why Codebase-Memory and not build from scratch:**
| Factor | Build from Scratch | Adopt Codebase-Memory |
|--------|-------------------|----------------------|
| Language coverage | 5-6 (v1) → 20+ (v2) | 155 (immediate) |
| Query performance | Unknown | Sub-ms (proven on 28M LOC Linux kernel) |
| Call graph resolution | Basic regex | 6-strategy (import-aware, type-inferred) |
| Engineering effort | 3-4 months | ~1 week (adapter + intent layer) |
| Token efficiency | Unknown | 99.2% reduction vs grep exploration |
| License | MIT (ours) | MIT (theirs) — compatible |

**Intent annotation layer (unique value-add):**
The `repograph_register_intent` tool is what differentiates Hermes RepoGraph from Codebase-Memory alone. It lets agents tag files with persistent semantic intent (e.g., "handles Stripe payment routing"), which future agents can query instead of re-analyzing the file.

---

### 5. `@hermes/pattern-miner` — Code Archaeology Engine
**What it does:** Scans codebases for dead code, anti-patterns, code smells, and structural issues. Supports built-in patterns and user-defined custom patterns.

**Dependencies:** `@hermes/shared`, `web-tree-sitter` (for AST-based pattern detection)

**MCP tools provided:** `scan`, `find_dead_code`, `get_pattern_catalog`, `learn_pattern`

**Why Phase 4:** Builds on TokenSqueezer's AST infrastructure. Needs Tree-sitter grammars already loaded (shared from token-squeezer). The `learn_pattern` tool creates a feedback loop: agent learns what patterns matter, registers them, and future scans catch them.

**Built-in pattern catalog (v1):**

| Category | Patterns | Detection Method |
|----------|----------|-----------------|
| **Dead Code** | Unused exports, unreachable branches, orphaned functions | AST traversal + export reference counting |
| **Architecture** | Circular dependencies, god objects (>15 methods), leaky abstractions | Import graph traversal + class analysis |
| **JS/TS** | `any` usage, nested callbacks (>4 deep), magic numbers, mutable exports, forgotten `debugger` | AST pattern matching |
| **Python** | Bare `except:`, mutable default args, global mutation, wildcard imports | AST pattern matching |
| **Structural** | Deep nesting (>4 levels), functions >100 lines, excessive params (>5) | AST metrics |
| **Security** | Hardcoded secrets (regex patterns), unsafe `eval`/`exec`, dangerous regex (ReDoS) | Regex + AST |

**Custom pattern DSL (v1):**
```typescript
interface PatternDefinition {
  id: string;
  name: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  category: string;
  languages: string[];
  matcher: {
    type: "ast_query" | "regex" | "ast_metric";
    // For AST queries: Tree-sitter S-expression
    query?: string;
    // For regex: PCRE pattern
    regex?: string;
    // For metrics: threshold configuration
    metric?: { name: string; operator: ">" | ">=" | "<" | "<="; value: number };
  };
  suggestion: string;
}
```

---

### 6. `@hermes/task-router` — Complexity-Based Model Router
**What it does:** Analyzes planned code changes or existing code, computes deterministic complexity metrics (cyclomatic complexity, LOC impact, dependency density, interface surface area), and recommends cost-optimal model routing.

**Dependencies:** `@hermes/shared`, `@hermes/token-squeezer` (for AST analysis)

**MCP tools provided:** `task_router.analyze`, `task_router.decompose`, `task_router.estimate_effort`

**Why Phase 4:** Same phase as PatternMiner. Builds on TokenSqueezer's AST infrastructure. The complexity metrics (cyclomatic, dependency analysis) use the same Tree-sitter queries.

**Complexity tiers (default thresholds):**

| Tier | Score Range | Recommended Models | Task Types |
|------|-------------|-------------------|------------|
| **Junior** | 0-15 | DeepSeek V4 Pro (2.1×), Ernie 5.1 (1.5×) | Boilerplate, unit tests, simple CRUD, config files |
| **Mid** | 16-40 | Kimi K2.6 (2.8×) | Business logic, API handlers, service layer |
| **Senior** | 41-80 | Claude Sonnet 4.6 (12×) | Multi-file refactors, complex algorithms, async |
| **Architect** | 81+ | Claude Opus (20×) | System design, novel architecture, foundational abstractions |

**Potential cost savings:** Even routing 30% of tasks to Junior tier instead of Senior tier saves ~4× on those tasks (2.1× vs 12×). At 80/20 split (80% simple, 20% complex), average cost multiplier drops from 12× to ~4× — a **3× overall reduction**.

**Open research question:** Model cost multipliers are from Gemini Notes (API.Navy data). Actual prices vary by provider. The router should accept custom pricing configs.

---

### 7. `@hermes/solid-enforcer` — SOLID Compliance System
**What it does:** Three-tier SOLID enforcement — preventive (context restriction + DI templates), evaluative (5 deterministic checks), operational (abstract → mechanical prompt translation).

**Dependencies:** `@hermes/shared`, `web-tree-sitter` (for AST-based audit checks)

**MCP tools provided:** `scope_context`, `di_template`, `audit`, `translate_prompt`

**Why Phase 5:** The most complex tool, depends on lessons from all preceding phases. The audit checks use Tree-sitter patterns (learned from TokenSqueezer), the context scoping uses file path patterns (from ArchitectureShepherd), and the prompt translation is a deterministic rule engine (pattern from PatternMiner's catalog system).

**Three-tier architecture:**

| Tier | Name | Tool | Mechanism | Target |
|------|------|------|-----------|--------|
| 1 | Preventive | `scope_context`, `di_template` | Restrict file visibility, inject DI patterns | Stop violations before code is written |
| 2 | Evaluative | `audit` | 5 deterministic AST checks (SRP/OCP/LSP/ISP/DIP) | Catch violations after code is generated |
| 3 | Operational | `translate_prompt` | Abstract→mechanical instruction mapping | Help agents follow SOLID without understanding it |

**Deterministic audit checks:**

| Principle | Check | Scoring |
|-----------|-------|---------|
| **SRP** | Count distinct import categories + method concern clustering | LOC > threshold AND import categories > 2 → flag |
| **OCP** | Detect abstract base classes, measure modification-vs-addition ratio in diff | No abstract base + modification > 50% → flag |
| **LSP** | Compare subclass signatures against parent | Signature mismatch on override → flag |
| **ISP** | Count methods per interface/contract | Methods > 3 → flag |
| **DIP** | Detect `new`/direct instantiation of non-value objects | Non-value instantiation → flag |

---

### 8. `@hermes/cli` — Unified Command-Line Interface
**What it does:** Single `hermes-mcp` command that wraps all tools. Provides direct CLI access (for non-MCP environments like CI) and can also start MCP servers.

**Dependencies:** All packages, `commander`, `chalk`

**Commands:**
```bash
hermes-mcp squeeze <file>          # TokenSqueezer: squeeze a file
hermes-mcp check [paths]           # ArchitectureShepherd: check compliance
hermes-mcp scan [paths]            # PatternMiner: scan for patterns
hermes-mcp init                    # Scaffold ARCHITECTURE.md manifest
hermes-mcp query                   # RepoGraph: query the knowledge graph
hermes-mcp audit                   # SOLIDEnforcer: audit code
hermes-mcp analyze                 # TaskRouter: analyze complexity
hermes-mcp serve                   # Start MCP server (stdio or http)
```

---

## Dependency Graph (Build Order)

```
Phase 0: shared (no deps)
              │
Phase 1:      ├── token-squeezer (shared + tree-sitter-wasm)
              │
Phase 2:      ├── architecture-shepherd (shared)
              │
Phase 3:      ├── repograph (shared + codebase-memory binary)
              │
Phase 4:      ├── pattern-miner (shared + tree-sitter-wasm)
              ├── task-router (shared + token-squeezer)
              │
Phase 5:      ├── solid-enforcer (shared + tree-sitter-wasm)
              │
Phase 6:      └── cli (all packages)
```

Phases 2, 3, and 4 can be parallelized after Phase 1 is complete.

---

## Test Strategy

| Layer | Tooling | Coverage Target | Runs In |
|-------|---------|-----------------|---------|
| **Unit tests** | Vitest | 90%+ per package | CI per commit |
| **Schema validation** | Zod runtime checks | 100% of schemas | CI per commit |
| **Integration tests** | Vitest + supertest | All MCP tool paths | CI per PR |
| **End-to-end** | Custom test harness | Full pipeline (squeeze → check → scan → query → audit) | CI nightly |
| **Benchmarks** | vitest bench | Token reduction ratios, latency P50/P95 | CI on release branches |
| **Fuzz testing** | Tree-sitter grammar fuzzing | Parse resilience on malformed code | CI weekly |

**Key test scenarios:**
1. TokenSqueezer: Verify 60%+ reduction on real-world JS/TS/Python/Go files
2. ArchitectureShepherd: Catch intentional violations in test fixtures
3. PatternMiner: Detect 100% of planted patterns in test code
4. RepoGraph: Sub-100ms query time on medium-sized codebase (10K files)
5. TaskRouter: Correct tier classification for known-complexity test code
6. SOLIDEnforcer: Zero false positives on SOLID-compliant code, detect 90%+ of violations

---

## Release Timeline

| Week | Phase | Deliverable | Milestone |
|------|-------|------------|-----------|
| 1 | 0 | Monorepo + shared schemas + MCP gateway stub | `npm run build` green |
| 2-3 | 1 | TokenSqueezer v1 (JS/TS/Python/Go) | 60%+ reduction, all levels |
| 4 | 2 | ArchitectureShepherd v1 | CI-ready manifest checking |
| 5 | 3 | RepoGraph v1 (adapter + intent layer) | Sub-ms queries, intent CRUD |
| 6 | 4 | PatternMiner + TaskRouter v1 | Full pattern catalog, tier routing |
| 7 | 5 | SOLIDEnforcer v1 | All 3 tiers, 5 SOLID checks |
| 8 | 6 | CLI + docs + CI/CD + npm publish | v1.0.0 release |

**Parallel tracks after Week 3:**
- Track A: ArchitectureShepherd (Week 4)
- Track B: RepoGraph adapter (Week 5)
- Track C: PatternMiner + TaskRouter (Week 6)

These can be developed independently after Phase 1.

---

## Open Questions

### Technical
1. **Tree-sitter WASM loading strategy:** `web-tree-sitter` vs individual `@tree-sitter-grammars/*` packages. The former gives more control; the latter is simpler. Need to benchmark cold-start time.
2. **Token counting accuracy:** `tiktoken` (cl100k_base) vs simple character/4 estimation. Accuracy matters for token budget enforcement but adds a dependency. Consider optional `tiktoken` with fallback.
3. **Codebase-Memory adapter reliability:** The adapter must handle Codebase-Memory process crashes, version mismatches, and missing binary gracefully. Need heartbeat + auto-restart + version check.
4. **PatternMiner performance on large codebases:** Full scan of 10K+ files could take minutes. Need incremental scanning, file-level caching, and streaming results via MCP notifications.

### Design
5. **TaskRouter complexity estimation before code exists:** How do you compute cyclomatic complexity of code that hasn't been written? Options: (a) plan-based estimation from architect's decomposition, (b) template matching against known archetypes, (c) embedding similarity against historical tasks. Research suggests cascade deferral (try cheap model first, escalate on failure) is the most robust approach.
6. **SOLIDEnforcer false positive rates:** SRP via LOC analysis is a heuristic, not a proof. A 200-line class might legitimately have a single responsibility. Need configurable thresholds and a "silence violation" mechanism for known exceptions.
7. **MCP protocol version:** Target 2025-03-26 (latest stable). Investigate Streamable HTTP transport for SSE support.

### Integration
8. **Hermes Agent integration:** Should MCP tools register as Hermes Skills, or as lower-level MCP protocol tools? Skills have model-override support; MCP tools don't. The TOOL_SPECS defines them as MCP tools, but Hermes's skill system could wrap them for model-aware routing.
9. **Package publishing:** Individual packages per tool vs single `@hermes/mcp-toolset` umbrella package? Individual gives users choice (only install what they need). Umbrella is simpler for setup. **Decision: Both.** Umbrella for standard setup, individual for advanced users.
10. **License:** MIT — matches Codebase-Memory's license and is the standard for open-source MCP tools.

### Measurement
11. **Token savings validation:** Need a standardized benchmark suite to measure before/after token savings across all tools. Each tool should report its own metrics, and the CLI should aggregate them.
12. **Cost tracking for TaskRouter:** Without real pricing data, the router's cost estimates are relative multipliers. Need a pricing config interface that accepts per-model per-token costs.

---

## Risk Matrix

| Risk | Probability | Impact | Mitigation |
|------|-----------|--------|------------|
| Tree-sitter WASM cold start too slow | Medium | High | Pre-warm + cache compiled WASM; lazy-load per language |
| Codebase-Memory binary incompatible with target OS | Low | High | Fallback to regex-based analysis for RepoGraph queries; auto-detect OS-specific binary URL |
| PatternMiner false positives erode trust | Medium | Medium | Bias toward false negatives in v1; add confidence scoring; make all findings configurable thresholds |
| TaskRouter thresholds don't match real model capabilities | High | Medium | Make thresholds fully configurable; add feedback loop for automatic adjustment |
| SOLIDEnforcer too strict for practical use | Medium | Medium | Add `--relaxed` mode that only flags critical violations; allow per-rule suppression |
| MCP protocol version drift | Low | High | Pin SDK version in package.json; test against latest spec before release |
| TokenSqueezer output breaks LLM comprehension | Medium | Medium | Validate output maintains parseable structure; add `raw_skeleton_text` format optimized for LLM context injection |

---

## Success Criteria for v1.0.0

- [ ] All 8 packages build and test green
- [ ] 16+ MCP tools registered and callable via stdio transport
- [ ] TokenSqueezer achieves documented reduction ratios on all v1 languages
- [ ] ArchitectureShepherd catches intentional violations in CI test fixture
- [ ] PatternMiner detects all planted patterns in test fixture codebase
- [ ] RepoGraph queries respond in <100ms for medium codebase (10K files)
- [ ] TaskRouter correctly classifies tasks into 4 complexity tiers
- [ ] SOLIDEnforcer passes both preventive and evaluative tests
- [ ] CLI handles all commands with help output and error messages
- [ ] CI pipeline green, docs published, npm package released
