# Hermes MCP Toolset — Project Roadmap

**Date:** 2026-05-29
**Status:** Completed & Production-Ready (V1 Release)
**Target:** v1.0.0

---

## Package Overview

### 1. `@hermes/shared` — Foundation
**What it does:** Shared schemas, TypeScript types, utility functions, and language pack registries. No heavy external dependencies.

**Dependencies:** None (zero-dependency package, uses `zod` for schemas)

**Key contents:**
- Zod schemas for all MCP tool inputs/outputs
- Canonical event schemas (invocation, result, violation)
- Manifest schema (ARCHITECTURE.md parser)
- Pattern definition schema
- Shared TypeScript enums (languages, severity levels, aggressiveness modes)
- Modular Language Pack registry loader and dynamic parser lookup

**Status:** Completed.

---

### 2. `@hermes/token-squeezer` — AST Context Reduction Engine
**What it does:** Parses source code into skeletons using AST nodes or fallback regex patterns to strip bodies, comments, and imports based on aggressiveness level.

**MCP tools provided:** `get_symbols`

**Key design decisions:**
- Three aggressiveness levels (conservative, balanced, aggressive)
- Hierarchical symbols outline mode support
- Core languages supported: JavaScript, TypeScript, JSX, TSX, Python, Go
- Dynamic/Extension languages supported: RPG, COBOL, Bash, PowerShell
- Token counting via tiktoken (cl100k_base) for consistency

**Status:** Completed.

---

### 3. `@hermes/architecture-shepherd` — Compliance Enforcement
**What it does:** Parses ARCHITECTURE.md into a structured manifest, then checks code against layer boundaries, dependency rules, and forbidden paths.

**MCP tools provided:** `architecture_shepherd_load_manifest`, `architecture_shepherd_check`, `architecture_shepherd_check_diff`

**Key design decisions:**
- Manifest parsed from markdown code blocks (JSON embedded in ARCHITECTURE.md)
- Glob-based layer matching (supports `**` patterns)
- Git diff parser handles unified diff format from `git diff` or PR API to validate pull requests incrementally.

**Status:** Completed.

---

### 4. `@hermes/repograph` — In-Repository Knowledge Graph
**What it does:** Persistent codebase memory via SQLite-backed entity-relationship graph. Exposes call hierarchy tracing and module import dependency mapping.

**MCP tools provided:** `index_codebase`, `find_indexed_symbol_references`, `get_indexed_symbol_tree`, `get_indexed_symbol_dependencies`

**Status:** Completed.

---

### 5. `@hermes/pattern-miner` — Code Archaeology Engine
**What it does:** Scans codebases for anti-patterns, code smells, and structural issues. Supports built-in patterns and user-defined custom patterns.

**MCP tools provided:** `pattern_miner_scan`, `pattern_miner_get_pattern_catalog`, `pattern_miner_learn_pattern`, `pattern_miner_find_clones`

**Status:** Completed.

---

### 6. `@hermes/task-router` — Complexity-Based Model Router
**What it does:** Analyzes planned code changes or existing code, computes cyclomatic complexity, lines of affected code, and novelty score to recommend model routing.

**MCP tools provided:** `task_router_estimate`, `task_router_decompose`

**Complexity tiers:**
- **Junior** (0–15): DeepSeek V4 Pro, Ernie 5.1
- **Mid** (16–40): Kimi K2.6
- **Senior** (41–80): Claude Sonnet 4.6
- **Architect** (81+): Claude Opus

**Status:** Completed.

---

### 7. `@hermes/solid-enforcer` — SOLID Compliance System
**What it does:** Audits code blocks against Single Responsibility, Open-Closed, Liskov Substitution, Interface Segregation, and Dependency Inversion.

**MCP tools provided:** `solid_enforcer_audit`, `solid_enforcer_generate_di_template`

**Status:** Completed.

---

### 8. `@hermes/lint-fixer` — Automated Remediator
**What it does:** Dynamically resolves formatter/linter commands from registered language packs and applies them to correct source code formatting.

**MCP tools provided:** `lint_fixer_fix`

**Status:** Completed.

---

### 9. `@hermes/cli` — Unified Command-Line Interface
**What it does:** Single CLI wrapper exposing all workspace commands and acting as the launch gateway for stdio/SSE MCP servers.

**Status:** Completed.

---

## Release Milestones & History

- **Phase 0-2 (Completed)**: Core workspaces setup, TokenSqueezer, and ArchitectureShepherd.
- **Phase 3-4 (Completed)**: SQLite RepoGraph database indexing, PatternMiner AST scanner, and TaskRouter.
- **Phase 5-6 (Completed)**: SOLIDEnforcer, LintFixer addition, and batch refactoring tool integrations.
- **Phase 7 (Completed)**: Extension of modular language packs to support RPG, COBOL, Bash, and PowerShell.

---

## Success Criteria for v1.0.0

- [x] All packages build and test green
- [x] 20 MCP tools registered and callable via stdio transport
- [x] TokenSqueezer achieves 60%+ reduction ratios on TypeScript/Python/Go/etc.
- [x] ArchitectureShepherd checks git diffs successfully
- [x] PatternMiner registers and detects custom learned rules
- [x] RepoGraph queries caller/callee trees and circular imports in sub-100ms
- [x] TaskRouter estimates task complexity tiers accurately
- [x] SOLIDEnforcer flags design violations correctly
- [x] CLI gateway operates smoothly
- [x] Monorepo passes unified CI pipeline validation
