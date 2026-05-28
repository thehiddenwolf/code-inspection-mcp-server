# Hermes MCP Toolset — Implementation Plan

**Date:** 2026-05-27
**Updated:** 2026-05-27 (Phase 2 files built, SDK corrected to v1.x)
**Status:** Phase 2 — ArchitectureShepherd + RepoGraph — code complete, builds clean
**Tech Stack:** TypeScript, MCP SDK v1.x (`@modelcontextprotocol/sdk@^1.29.0`), Zod v4, Tree-sitter WASM
**Project Root:** `/home/kerwin/code/hermes-mcp-toolset/`

---

## Overview

This plan merges two conceptual tracks into a single, coherent implementation:

| Track A (ARCHITECTURE.md) | Track B (TOOL_SPECS.md / Gemini Notes) | Unified Name |
|---|---|---|
| TokenSqueezer | Context-Slasher | **TokenSqueezer** |
| ArchitectureShepherd | SOLID Enforcer (partial overlap) | **ArchitectureShepherd** |
| PatternMiner | Blueprint Scout (clone detection) | **PatternMiner** |
| — | Task Router | **TaskRouter** |
| — | RepoGraph | **RepoGraph** |
| — | SOLID Enforcer (Tier 1-3) | **SOLIDEnforcer** |

**Priority order:** TokenSqueezer (highest ROI) → ArchitectureShepherd → RepoGraph → PatternMiner + TaskRouter → SOLIDEnforcer

**Key architectural decision:** Standalone MCP server per tool, communicating via MCP protocol. Each package is a separate npm workspace package that exports an MCP server (stdio + SSE). This aligns with the Gemini Notes' standalone-server vision while keeping the ARCHITECTURE.md's microservice topology as a future option.

---

## Phase 0 — Skeleton & Shared Infrastructure (Week 1)

### Goal
Initialize the monorepo, define shared schemas, and stand up the MCP gateway with tool registration.

### Files to create/modify

| File | Purpose |
|------|---------|
| `package.json` | npm workspaces root — `@hermes/mcp-toolset`, `@hermes/shared`, `@hermes/token-squeezer`, `@hermes/architecture-shepherd`, `@hermes/pattern-miner`, `@hermes/repograph`, `@hermes/task-router`, `@hermes/solid-enforcer`, `@hermes/cli` |
| `tsconfig.json` | Shared TypeScript config (strict mode, ESM, `node16` module resolution) |
| `.eslintrc.cjs` | TypeScript-aware linting |
| `.prettierrc` | Formatting |
| `Makefile` | Common commands: `build`, `test`, `lint`, `dev` |
| `packages/shared/package.json` | Shared package — Zod schemas + TypeScript types |
| `packages/shared/src/index.ts` | Barrel export |
| `packages/shared/src/schemas/events.ts` | Zod schemas for MCP invocation/result events |
| `packages/shared/src/schemas/tools.ts` | Zod schemas for all tool inputs/outputs |
| `packages/shared/src/schemas/manifests.ts` | Zod schemas for ARCHITECTURE.md manifests |
| `packages/shared/src/schemas/patterns.ts` | Zod schemas for pattern definitions |
| `packages/shared/src/schemas/violations.ts` | Zod schemas for violation reports |
| `packages/shared/src/types/mcp.ts` | MCP protocol types |
| `packages/shared/src/types/tools.ts` | Tool-specific types |
| `packages/shared/src/utils/logging.ts` | Structured logging (pino) |
| `packages/shared/src/utils/idempotency.ts` | Idempotency key helpers |
| `packages/shared/test/index.test.ts` | Schema validation tests |
| `docker-compose.yml` | Minimal standalone profile (mcp-gateway + postgres + redis) |

### MCP Tool Definitions (Phase 0 — Stubs)

```typescript
// Registered via mcp-gateway, all return "not implemented" until their phase
[
  "token_squeezer_squeeze",
  "architecture_shepherd_load_manifest",
  "architecture_shepherd_check",
  "architecture_shepherd_check_diff",
  "pattern_miner_scan",
  "pattern_miner_find_dead_code",
  "pattern_miner_get_pattern_catalog",
  "pattern_miner_learn_pattern"
]
```

### Exit Criteria
- Monorepo builds with `npm run build`
- Shared schemas pass Zod validation tests
- MCP gateway starts via stdio and announces 8 tools via `tools/list`
- `docker-compose up` starts gateway + postgres + redis

---

## Phase 1 — TokenSqueezer (Weeks 2-3)

### Goal
The highest-ROI tool: AST-based context reduction returning structural skeletons. Achieves 60-95% token reduction on code files.

### Tech Decision
Use **Tree-sitter WASM** grammars (not Babel, not native bindings). This gives zero native dependencies, works across platforms, and aligns with the MCP SDK v2 ecosystem. Use `@tree-sitter-grammars/tree-sitter-*` npm packages or the `web-tree-sitter` package for loading WASM grammars.

### Files to create

| File | Purpose |
|------|---------|
| `packages/token-squeezer/package.json` | Deps: `@modelcontextprotocol/sdk`, `zod`, `web-tree-sitter`, `tree-sitter-typescript`, `tree-sitter-python`, `tree-sitter-go` |
| `packages/token-squeezer/src/index.ts` | MCP server entry — stdio transport, tool registration |
| `packages/token-squeezer/src/squeezer.ts` | Main orchestrator: parse → classify → strip → assemble |
| `packages/token-squeezer/src/wasm-loader.ts` | Lazy-load Tree-sitter WASM grammars per language |
| `packages/token-squeezer/src/parsers/base.ts` | Parser interface (`parse(source: string, lang: string) → AST`) |
| `packages/token-squeezer/src/parsers/typescript.ts` | TypeScript/JSX/TSX Tree-sitter queries |
| `packages/token-squeezer/src/parsers/python.ts` | Python Tree-sitter queries |
| `packages/token-squeezer/src/parsers/javascript.ts` | JavaScript Tree-sitter queries |
| `packages/token-squeezer/src/parsers/go.ts` | Go Tree-sitter queries |
| `packages/token-squeezer/src/reducers/index.ts` | Node reduction pipeline |
| `packages/token-squeezer/src/reducers/comments.ts` | Comment/docstring stripper |
| `packages/token-squeezer/src/reducers/imports.ts` | Import tree-shaking |
| `packages/token-squeezer/src/reducers/branches.ts` | Dead branch elimination |
| `packages/token-squeezer/src/reducers/types.ts` | Type annotation reduction |
| `packages/token-squeezer/src/reducers/whitespace.ts` | Whitespace normalization |
| `packages/token-squeezer/src/strategies/conservative.ts` | Keep imports + all signatures + docstrings |
| `packages/token-squeezer/src/strategies/balanced.ts` | Keep imports + public signatures + docstrings, strip private bodies |
| `packages/token-squeezer/src/strategies/aggressive.ts` | Strip all bodies, comments, non-essential imports |
| `packages/token-squeezer/src/token-counter.ts` | Token estimation via `tiktoken` (cl100k_base) or character-based approximation |
| `packages/token-squeezer/src/types.ts` | `SqueezeOptions`, `SqueezedResult`, language enum |
| `packages/token-squeezer/test/fixtures/` | Sample code files for all supported languages |
| `packages/token-squeezer/test/squeezer.test.ts` | Unit tests — token reduction ratios, language coverage |
| `packages/token-squeezer/bench/benchmark.ts` | Benchmarks against real-world codebases |

### MCP Tool: `token_squeezer_squeeze`

**Input (Zod schema):**
```typescript
z.object({
  code: z.string(),
  language: z.enum(["javascript", "typescript", "python", "go", "jsx", "tsx"]),
  options: z.object({
    preserve_comments: z.boolean().default(false),
    preserve_imports: z.boolean().default(true),
    aggressiveness: z.enum(["conservative", "balanced", "aggressive"]).default("balanced"),
    max_tokens: z.number().int().positive().optional(),
    include_private: z.boolean().default(false),
    output_format: z.enum(["text", "json", "both"]).default("both")
  }).optional().default({})
})
```

**Output:**
```typescript
z.object({
  squeezed_code: z.string(),
  original_tokens: z.number(),
  squeezed_tokens: z.number(),
  reduction_ratio: z.number(),
  stripped_nodes: z.array(z.string()),
  skeleton_json: z.array(z.any()).optional()  // structured metadata
})
```

### Exit Criteria
- JS/TS/Python code squeezes 60%+ on real-world files
- All three aggressiveness levels produce valid syntax
- Token counting matches within 10% of actual LLM tokenizer
- Benchmarks published in `bench/`

---

## Phase 2 — ArchitectureShepherd (Week 4)

### Goal
Load ARCHITECTURE.md manifests, enforce layer boundaries and dependency rules against code diffs. CI-ready.

### Files to create

| File | Purpose |
|------|---------|
| `packages/architecture-shepherd/package.json` | Deps: `@modelcontextprotocol/sdk`, `zod`, `ignore` (for glob matching) |
| `packages/architecture-shepherd/src/index.ts` | MCP server entry |
| `packages/architecture-shepherd/src/manifest.ts` | Parse ARCHITECTURE.md → structured manifest (extract JSON from markdown code blocks) |
| `packages/architecture-shepherd/src/checker.ts` | Main rule engine — dispatches to rule implementations |
| `packages/architecture-shepherd/src/graph.ts` | Dependency graph builder (import analysis via regex for now, Tree-sitter later) |
| `packages/architecture-shepherd/src/diff-parser.ts` | Parse git diff → list of changed files with line ranges |
| `packages/architecture-shepherd/src/rules/dependency-rule.ts` | Check allowed/forbidden dependencies per layer |
| `packages/architecture-shepherd/src/rules/layer-boundary.ts` | Verify file belongs to correct layer |
| `packages/architecture-shepherd/src/rules/file-size-rule.ts` | Max line count per file |
| `packages/architecture-shepherd/src/rules/naming-rule.ts` | Naming convention enforcement |
| `packages/architecture-shepherd/src/suggest.ts` | Analyze codebase → suggest ARCHITECTURE.md structure |
| `packages/architecture-shepherd/src/config.ts` | Load `.hermes/mcp_config.json` for thresholds |
| `packages/architecture-shepherd/src/types.ts` | Manifest, Violation, Rule types |
| `packages/architecture-shepherd/test/fixtures/` | Sample manifests + codebases for testing |
| `packages/architecture-shepherd/test/checker.test.ts` | Unit + integration tests |

### MCP Tools

| Tool | Input | Output |
|------|-------|--------|
| `architecture_shepherd_load_manifest` | `{ path?: string }` | `{ manifest_id, project, layers[], global_rules[] }` |
| `architecture_shepherd_check` | `{ paths: string[], manifest_id: string }` | `{ violations: Violation[], summary }` |
| `architecture_shepherd_check_diff` | `{ diff: string, manifest_id: string }` | `{ violations: Violation[], summary }` |
| `architecture_shepherd.suggest_manifest` | `{ path: string }` | `{ suggested_manifest, confidence }` |

### Exit Criteria
- Loads a real ARCHITECTURE.md and catches layer violations
- CI-ready: accepts git diff as stdin
- CLI `init` command generates a starter manifest

---

## Phase 3 — RepoGraph — In-Repository Knowledge Graph (Week 5)

### Goal
Persistent codebase memory via SQLite. Intent annotation layer + entity/relationship graph.

### Architectural Decision: Hybrid

**Adopt Codebase-Memory MCP (DeusData) as the parsing/graph backend**, wrap its 14 tools under the RepoGraph namespace via a thin TypeScript adapter. Add the intent annotation layer as the Hermes-specific value-add.

Rationale: Codebase-Memory is MIT-licensed, production-ready, supports 155 languages, achieves sub-ms queries, and ships as a single binary with zero dependencies. Building this from scratch would take 3-4 months.

### Files to create

| File | Purpose |
|------|---------|
| `packages/repograph/package.json` | Deps: `@modelcontextprotocol/sdk`, `zod`, `better-sqlite3` (for intent DB) |
| `packages/repograph/src/index.ts` | MCP server entry — wraps Codebase-Memory tools + adds intent layer |
| `packages/repograph/src/adapter.ts` | Routes RepoGraph MCP calls to Codebase-Memory MCP client |
| `packages/repograph/src/intent-store.ts` | Companion SQLite DB for intent annotations |
| `packages/repograph/src/intent-store.test.ts` | Intent CRUD tests |
| `packages/repograph/src/types.ts` | RepoGraph-specific types |
| `packages/repograph/test/adapter.test.ts` | Adapter integration tests |
| `scripts/install-codebase-memory.sh` | Download/install Codebase-Memory binary |

### MCP Tools

| Tool | Input | Output | Backend |
|------|-------|--------|---------|
| `repograph_query` | `{ query_type, file_path?, entity_name?, entity_id?, query?, relationship_type?, intent_filter?, depth?, limit? }` | `{ results, graph_summary }` | Codebase-Memory + intent DB |
| `repograph_update` | `{ changes: Change[], full_rescan?: boolean }` | `{ entities_added, ... }` | Codebase-Memory |
| `repograph_register_intent` | `{ intent: string, file_paths: string[], confidence?: number }` | `{ success, intent_id }` | Companion intent DB |
| `repograph_rescan` | `{ codebase_path?: string, include_patterns?, exclude_patterns? }` | `{ entities_count, relationships_count }` | Codebase-Memory |

### Exit Criteria
- `repograph_query` returns entities and relationships for any file in a codebase
- `repograph_register_intent` persists and retrieves intent tags
- Companion DB merges with Codebase-Memory results in query responses

---

## Phase 4 — PatternMiner + TaskRouter (Week 6)

### Goal A — PatternMiner
Code archaeology engine: dead code detection, anti-pattern scanning, code smells.

### Files to create

| File | Purpose |
|------|---------|
| `packages/pattern-miner/package.json` | Deps: `@modelcontextprotocol/sdk`, `zod`, `web-tree-sitter` |
| `packages/pattern-miner/src/index.ts` | MCP server entry |
| `packages/pattern-miner/src/scanner.ts` | Scan orchestrator — walks files, runs pattern matchers |
| `packages/pattern-miner/src/patterns/catalog.ts` | Pattern registry — all built-in patterns |
| `packages/pattern-miner/src/patterns/dead-code/unused-exports.ts` | Detect unused exports |
| `packages/pattern-miner/src/patterns/dead-code/unreachable-branches.ts` | Dead branch detection |
| `packages/pattern-miner/src/patterns/dead-code/orphaned-functions.ts` | Orphaned function detection |
| `packages/pattern-miner/src/patterns/anti-patterns/js-ts/any-usage.ts` | `any` type detection |
| `packages/pattern-miner/src/patterns/anti-patterns/js-ts/magic-numbers.ts` | Magic number detection |
| `packages/pattern-miner/src/patterns/anti-patterns/js-ts/nested-callbacks.ts` | Callback nesting > N |
| `packages/pattern-miner/src/patterns/anti-patterns/python/bare-except.ts` | Bare `except:` detection |
| `packages/pattern-miner/src/patterns/anti-patterns/python/mutable-defaults.ts` | Mutable default args |
| `packages/pattern-miner/src/patterns/architecture/circular-deps.ts` | Circular dependency detection |
| `packages/pattern-miner/src/patterns/architecture/god-object.ts` | God object detection (methods > threshold) |
| `packages/pattern-miner/src/patterns/security/hardcoded-secrets.ts` | Secret scanning |
| `packages/pattern-miner/src/patterns/security/unsafe-eval.ts` | `eval()`/`exec()` detection |
| `packages/pattern-miner/src/reporter.ts` | Report generation + severity scoring |
| `packages/pattern-miner/src/types.ts` | PatternDefinition, ScanReport, Finding types |
| `packages/pattern-miner/test/fixtures/` | Sample code with known patterns |
| `packages/pattern-miner/test/scanner.test.ts` | Pattern detection tests |

### MCP Tools

| Tool | Input | Output |
|------|-------|--------|
| `pattern_miner_scan` | `{ paths: string[], patterns?: PatternFilter }` | `{ scan_id, findings[], summary }` |
| `pattern_miner_find_dead_code` | `{ paths: string[], options?: DeadCodeOptions }` | `{ dead_functions[], unused_exports[], orphaned_modules[] }` |
| `pattern_miner_get_pattern_catalog` | `{}` | `{ patterns: PatternDefinition[] }` |
| `pattern_miner_learn_pattern` | `{ definition: PatternDefinition }` | `{ pattern_id }` |

### Goal B — TaskRouter
Complexity-based model routing for agentic code generation.

### Files to create

| File | Purpose |
|------|---------|
| `packages/task-router/package.json` | Deps: `@modelcontextprotocol/sdk`, `zod` |
| `packages/task-router/src/index.ts` | MCP server entry |
| `packages/task-router/src/analyzer.ts` | Compute complexity from existing code or plan |
| `packages/task-router/src/metrics/cyclomatic.ts` | Cyclomatic complexity (AST-based McCabe) |
| `packages/task-router/src/metrics/dependencies.ts` | Import/require chain analysis |
| `packages/task-router/src/metrics/interface-surface.ts` | Public method count + param count |
| `packages/task-router/src/routing-table.ts` | Tier thresholds → model recommendations |
| `packages/task-router/src/decomposer.ts` | Plan → micro-task decomposition |
| `packages/task-router/src/types.ts` | ComplexityScore, Task, Routing types |

### MCP Tools

| Tool | Input | Output |
|------|-------|--------|
| `task_router.analyze` | `{ analysis_target, custom_thresholds? }` | `{ complexity_score, metrics[], recommended_tier, reasoning }` |
| `task_router_decompose` | `{ architectural_plan, codebase_path?, auto_route? }` | `{ tasks[], execution_plan }` |
| `task_router_estimate_effort` | `{ file_path, change_description, model_tiers? }` | `{ estimated_tokens, cost_range }` |

### Exit Criteria
- PatternMiner scans a real project and finds meaningful issues
- Custom pattern learning works
- TaskRouter correctly scores and routes a known-complexity codebase
- All MCP tools registered and callable

---

## Phase 5 — SOLIDEnforcer (Week 7)

### Goal
Three-tier SOLID compliance system: preventive (scope context, DI templates), evaluative (audit), operational (prompt translation).

### Files to create

| File | Purpose |
|------|---------|
| `packages/solid-enforcer/package.json` | Deps: `@modelcontextprotocol/sdk`, `zod`, `web-tree-sitter` |
| `packages/solid-enforcer/src/index.ts` | MCP server entry |
| `packages/solid-enforcer/src/audit.ts` | Five SOLID checks (SRP, OCP, LSP, ISP, DIP) |
| `packages/solid-enforcer/src/checks/srp.ts` | LOC + import category diversity + method concern analysis |
| `packages/solid-enforcer/src/checks/ocp.ts` | Abstract base detection, modification-vs-extension ratio |
| `packages/solid-enforcer/src/checks/lsp.ts` | Subclass signature comparison against parent |
| `packages/solid-enforcer/src/checks/isp.ts` | Method count per interface, flag > N methods |
| `packages/solid-enforcer/src/checks/dip.ts` | `new`/instantiation detection for non-value objects |
| `packages/solid-enforcer/src/scope-context.ts` | File visibility restrictor (Tier 1 preventive) |
| `packages/solid-enforcer/src/di-template.ts` | Dependency injection template generator (Tier 1) |
| `packages/solid-enforcer/src/prompt-translator.ts` | Abstract → mechanical instruction mapper (Tier 3) |
| `packages/solid-enforcer/src/prompt-translator.test.ts` | Translation table coverage tests |
| `packages/solid-enforcer/src/types.ts` | SOLID check + violation types |

### MCP Tools

| Tool | Input | Output |
|------|-------|--------|
| `solid_enforcer.scope_context` | `{ task_file, context_window?, strip_globals?, force_di_template? }` | `{ allowed_files, blocked_files, injected_template? }` |
| `solid_enforcer.di_template` | `{ class_name, dependencies, language?, include_interface? }` | `{ template_code, interface_code }` |
| `solid_enforcer_audit` | `{ code, language, checks?, complexity_threshold?, loc_threshold? }` | `{ overall_pass, checks[], summary }` |
| `solid_enforcer.translate_prompt` | `{ abstract_directive, context }` | `{ translated_directives[], translation_strategy }` |

### Exit Criteria
- `solid_enforcer_audit` correctly detects SRP, DIP, and ISP violations in test code
- `scope_context` restricts file visibility correctly
- `translate_prompt` covers all 5 SOLID principles
- All tools pass integration tests

---

## Phase 6 — CLI + Polish (Week 8)

### Goal
Developer-friendly CLI, comprehensive docs, CI/CD integration examples, performance benchmarks.

### Files to create

| File | Purpose |
|------|---------|
| `packages/cli/package.json` | Deps: `commander`, `chalk`, all service packages |
| `packages/cli/src/index.ts` | CLI entry — `hermes-mcp` command |
| `packages/cli/src/commands/squeeze.ts` | `hermes-mcp squeeze <file>` |
| `packages/cli/src/commands/check.ts` | `hermes-mcp check [paths]` |
| `packages/cli/src/commands/scan.ts` | `hermes-mcp scan [paths]` |
| `packages/cli/src/commands/init.ts` | `hermes-mcp init` — scaffold ARCHITECTURE.md |
| `packages/cli/src/commands/query.ts` | `hermes-mcp query` — RepoGraph query |
| `packages/cli/src/commands/audit.ts` | `hermes-mcp audit` — SOLID audit |
| `packages/cli/src/commands/analyze.ts` | `hermes-mcp analyze` — TaskRouter analyze |
| `packages/cli/src/utils/output.ts` | JSON, pretty-print, CI-mode output formatters |
| `docs/api/token-squeezer.md` | TokenSqueezer API docs with examples |
| `docs/api/architecture-shepherd.md` | ArchitectureShepherd API docs |
| `docs/api/pattern-miner.md` | PatternMiner API docs |
| `docs/api/repograph.md` | RepoGraph API docs |
| `docs/api/task-router.md` | TaskRouter API docs |
| `docs/api/solid-enforcer.md` | SOLIDEnforcer API docs |
| `docs/examples/vscode-setup.md` | VS Code + Cursor MCP config |
| `docs/examples/ci-integration.md` | GitHub Actions + GitLab CI examples |
| `docs/examples/custom-patterns.md` | Writing custom PatternMiner patterns |
| `docs/contributing.md` | Contributing guide |
| `.github/workflows/ci.yml` | CI: lint + test + build |
| `.github/workflows/release.yml` | NPM publish on tag |
| `tests/integration/` | Cross-service integration tests |
| `tests/e2e/mcp-toolset-e2e.test.ts` | End-to-end full stack test |

### Exit Criteria
- CLI commands work for all tools
- Docs cover setup, configuration, and usage
- CI pipeline green
- Published to npm as `@hermes/mcp-toolset`

---

## Package Dependency Graph

```
@hermes/shared (no deps — foundation)
  ├── @hermes/token-squeezer  (depends on shared + tree-sitter-wasm)
  ├── @hermes/architecture-shepherd  (depends on shared)
  ├── @hermes/pattern-miner  (depends on shared + tree-sitter-wasm)
  ├── @hermes/repograph  (depends on shared + codebase-memory binary)
  ├── @hermes/task-router  (depends on shared)
  ├── @hermes/solid-enforcer  (depends on shared + tree-sitter-wasm)
  └── @hermes/cli  (depends on all packages)
```

---

## MCP Server Configuration

Each package exposes its own MCP server. Users configure which tools they want via their MCP client config:

```json
{
  "mcpServers": {
    "hermes-token-squeezer": {
      "command": "npx",
      "args": ["@hermes/token-squeezer"],
      "env": { "LOG_LEVEL": "info" }
    },
    "hermes-architecture-shepherd": {
      "command": "npx",
      "args": ["@hermes/architecture-shepherd"],
      "env": { "PROJECT_ROOT": "." }
    },
    "hermes-pattern-miner": {
      "command": "npx",
      "args": ["@hermes/pattern-miner"]
    },
    "hermes-repograph": {
      "command": "npx",
      "args": ["@hermes/repograph"]
    },
    "hermes-task-router": {
      "command": "npx",
      "args": ["@hermes/task-router"]
    },
    "hermes-solid-enforcer": {
      "command": "npx",
      "args": ["@hermes/solid-enforcer"]
    }
  }
}
```

Or use the unified CLI:
```json
{
  "mcpServers": {
    "hermes-mcp-toolset": {
      "command": "npx",
      "args": ["@hermes/mcp-toolset"],
      "env": { "ENABLED_TOOLS": "token-squeezer,architecture-shepherd,pattern-miner" }
    }
  }
}
```

---

## Configuration File

`~/.hermes/mcp_config.json` (per-user) or `./.hermes/mcp_config.json` (per-project):

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
    "custom_patterns_path": ".hermes/patterns/",
    "max_file_size_kb": 500
  },
  "repograph": {
    "storage": "sqlite",
    "path": ".hermes/repograph.db",
    "auto_sync": true,
    "json_sidecar": true
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

---

## Open Questions (Carried Forward)

1. **MCP protocol version:** Target latest stable (2025-03-26 or newer). Investigate Streamable HTTP transport.
2. **Language priority after v1:** Go, Rust, Java, Ruby, C/C++, SQL — in that order.
3. **Token counting:** Use `tiktoken` (cl100k_base) for accuracy. Fall back to character/4 estimation when tokenizer unavailable.
4. **Sandboxing for PatternMiner:** Not needed for v1. Pattern matching is pure analysis, not execution.
5. **PatternMiner DSL vs. regex:** Start with regex + AST predicates. DSL later if demand warrants.
6. **Streaming partial results:** MCP supports notifications. Explore for long-running scans.
7. **Codebase-Memory integration maturity:** Test adapter with real codebases before committing to it in v1.
