# MCP Architecture & Token Optimization — Research Synthesis

**Date:** 2026-05-27
**Author:** Spectra (kanban task t_eaedbc74)
**Source:** `/home/kerwin/KerwinsGeminiNotes/MCP Development Tool Ideas/MCP Code Architecture and Token Optimization Specification.md`
**Existing implementation:** Hermes MCP Toolset at `/home/kerwin/code/hermes-mcp-toolset/`

---

## 1. Source Material: The Gemini Notes Blueprint

The original spec ("MCP Code Architecture and Token Optimization Specification") proposes a **standalone MCP server** with four architectural pillars, all focused on **drastic token reduction** and **architectural enforcement** during agentic code generation:

### Pillar A — Structural Interface Mapping ("Context-Slasher")
- **Problem:** Agents inject 500+ line files just to understand class signatures.
- **Solution:** Tree-sitter AST parsing returns skeletal outlines (class declarations, method signatures, docstrings) at a fraction of token cost.
- **Key insight:** Deterministic, non-LLM static analysis beats LLM summarization for this task.

### Pillar B — Proactive Blueprint Search & Clone Detection
- **Problem:** Models rewrite existing boilerplate because they can't find what's already there.
- **Solution:** Planning-stage code search using Semgrep (structural pattern matching) and PMD CPD (copy-paste detection) to surface existing modules before generation starts.
- **Key insight:** Interception at the planning stage, not post-hoc dedup.

### Pillar C — Complexity-Based Task Router
- **Problem:** Premium models waste tokens on trivial helper functions.
- **Solution:** Programmatic complexity estimation (cyclomatic complexity, LOC, dependency density) routes tasks to appropriate tiers — cheap models for boilerplate, premium models for architecture.
- **Key insight:** Deterministic complexity metrics as a cost-control mechanism.

### Pillar D — In-Repository Knowledge Graph ("RepoGraph")
- **Problem:** Agents repeat global searches across turns with no persistent codebase memory.
- **Solution:** Lightweight file-based knowledge graph within the repo, MCP server as read/write gateway, updated via git hooks.
- **Key insight:** State awareness without external vector databases.

---

## 2. Existing Implementation (Hermes MCP Toolset)

The toolset at `/home/kerwin/code/hermes-mcp-toolset/` already implements a superset of the Gemini blueprint, structured as **three pillars** in `ARCHITECTURE.md`:

### TokenSqueezer — maps to Pillar A (Context-Slasher)
- Actually **broader** than the original blueprint. Uses AST parsing (Babel for JS/TS, Tree-sitter for Python) to strip non-essential nodes (whitespace, comments, unused imports, dead branches).
- Supports configurable aggressiveness levels and token budgets.
- **Gap vs blueprint:** Blueprint's Context-Slasher also includes multi-file batch mode and JSON-structured output — both are in `TOOL_SPECS.md` but not yet implemented.

### ArchitectureShepherd — NEW (no Gemini Notes equivalent)
- Reads `ARCHITECTURE.md` manifest files and enforces structural rules against code diffs.
- Layer boundary enforcement, dependency validation, global rules (no circular deps, max file length).
- **This is a NEW idea** not present in the Gemini Notes. It's the concrete enforcement mechanism that the Notes' "Proactive Blueprint Search" hints at but doesn't specify.

### PatternMiner — maps to Pillar B (Blueprint Scout), expanded
- Code archaeology: dead code detection, anti-pattern scanning, code smells.
- Built-in catalogs for JS/TS and Python anti-patterns, plus user-defined pattern learning.
- **Broader than blueprint:** The blueprint only talks about pre-planning search; PatternMiner also does post-hoc analysis.

---

## 3. TOOL_SPECS.md: The Expansion

The `TOOL_SPECS.md` file (1,259 lines) takes the 4-pillar blueprint and expands it into **16 concrete MCP tools** plus a **5th component** (SOLID Enforcer) not in the original blueprint:

### Tool Inventory

| # | Tool | Category | Status in Blueprint |
|---|------|----------|-------------------|
| 1 | `context_slasher_skeleton` | Context-Slasher | Core pillar A |
| 2 | `context_slasher_multi` | Context-Slasher | Batch variant |
| 3 | `blueprint_scout_search` | Blueprint Scout | Core pillar B |
| 4 | `blueprint_scout_analyze_plan` | Blueprint Scout | Plan-analysis variant |
| 5 | `blueprint_scout_architectural_patterns` | Blueprint Scout | New variant |
| 6 | `task_router_analyze` | Task Router | Core pillar C |
| 7 | `task_router_decompose` | Task Router | Decomposition variant |
| 8 | `task_router_estimate_effort` | Task Router | Cost estimation variant |
| 9 | `repograph_query` | RepoGraph | Core pillar D |
| 10 | `repograph_update` | RepoGraph | Write variant |
| 11 | `repograph_register_intent` | RepoGraph | Intent tagging |
| 12 | `repograph_rescan` | RepoGraph | Full rebuild |
| 13 | `solid_enforcer_scope_context` | SOLID Enforcer | **NEW — not in blueprint** |
| 14 | `solid_enforcer_di_template` | SOLID Enforcer | **NEW** |
| 15 | `solid_enforcer_audit` | SOLID Enforcer | **NEW** |
| 16 | `solid_enforcer_translate_prompt` | SOLID Enforcer | **NEW** |

### The SOLID Enforcer: A Notable Addition

The TOOL_SPECS adds a **three-tier SOLID compliance system** that the original blueprint doesn't mention:

- **Tier 1 (Preventive):** `scope_context` and `di_template` — restrict file visibility and inject DI patterns before code is written.
- **Tier 2 (Evaluative):** `solid_enforcer_audit` — deterministic SOLID checks (SRP via LOC/import analysis, OCP via abstract base detection, LSP via AST comparison, ISP via method-count analysis, DIP via instantiation analysis).
- **Tier 3 (Operational):** `solid_enforcer_translate_prompt` — converts abstract SOLID directives ("follow SRP") into concrete mechanical instructions ("create DataFetcher class exclusively for HTTP fetching").

### Full Orchestration Flow

The TOOL_SPECS defines a complete multi-agent pipeline:

```
Hermes (planner)
  → repograph_query ("what exists?")
  → blueprint_scout_analyze_plan ("is this duplicated?")
  → task_router_decompose ("break into micro-tasks, estimate complexity")
  → solid_enforcer_translate_prompt ("translate SOLID directives")
  → context_slasher_skeleton ("inject skeletal context")
  → Code Generation (target model)
  → solid_enforcer_audit ("did it pass?")
  → If PASS: repograph_update + merge
  → If FAIL: error log → back to planner
```

---

## 4. Gaps & Observations

### What's in the Gemini blueprint but not in TOOL_SPECS

| Blueprint Element | Status | Notes |
|-------------------|--------|-------|
| PMD CPD integration | Listed as optional | Java runtime dependency — fallback to pure-Python token comparison suggested |
| Semgrep rule caching | Specified | Use `.code-inspect-mcp/semgrep_rules/` path in config |
| AST cache by file hash | Specified | In Context-Slasher implementation notes |
| Novelty scoring via Blueprint Scout comparison | Specified | In Task Router impl notes |

These are documented but **not yet implemented** — they're in the "Implementation Notes" sections as design decisions.

### What's in the toolset but NOT in the Gemini blueprint

| Toolset Feature | Origin |
|----------------|--------|
| ArchitectureShepherd (ARCHITECTURE.md compliance) | Independent design |
| PatternMiner (code archaeology + anti-patterns) | Expansion of Blueprint Scout concept |
| SOLID Enforcer (3-tier system) | Independent design |
| Microservice architecture (gateway, orchestrator, policy engine, etc.) | Independent design |

### Architecture Divergence

The Gemini Notes describe a **standalone MCP server** — a single process that registers MCP tools. The existing `ARCHITECTURE.md` describes a **microservice topology** with 9+ services (mcp-gateway, orchestrator, policy-engine, tool-broker, sandbox-manager, etc.) plus infrastructure (Postgres, Redis, NATS, MinIO, pgvector).

This is a **different scope**. The toolset's architecture is built for scale and enterprise deployment, while the Gemini Notes focus on the MCP protocol layer itself. The TOOL_SPECS bridges this by defining MCP tool signatures that could be implemented either as a single server or as the microservice topology.

---

## 5. Recommended Implementation Path

Based on bridging the sources:

### Phase 1 — Core MCP Server (single process)
1. Implement `context_slasher_skeleton` using Tree-sitter Python bindings — this is the highest-impact, lowest-effort tool
2. Implement `repograph_query` + `repograph_update` with SQLite — enables persistent memory with zero infra
3. Implement `solid_enforcer_audit` — deterministic checks, no external deps beyond AST parsing

### Phase 2 — Planning-Stage Tools
4. Implement `blueprint_scout_search` with Semgrep integration
5. Implement `task_router_analyze` with radon/lizard for complexity metrics
6. Implement `blueprint_scout_analyze_plan` — structured plan parsing

### Phase 3 — Advanced Features
7. Implement `task_router_decompose` — plan decomposition into micro-tasks
8. Implement all SOLID Enforcer tools (Tier 1 and Tier 3)
9. Git hook integration for auto-sync

---

## 6. Key Design Decisions (from source analysis)

1. **Tree-sitter over LSP as primary parser** — LSP is a fallback; Tree-sitter is faster, deterministic, and easier to distribute without language server processes.

2. **SQLite over external vector DB** — The RepoGraph intentionally avoids pgvector/Pinecone/etc. SQLite with intent tags + relationship traversal covers the use case without infrastructure dependencies.

3. **Deterministic over LLM-based** — The entire architecture rejects LLM-driven summarization in favor of AST-based structural analysis. LLMs are used only where they're irreplaceable (code generation, natural language intent parsing).

4. **Config in `.code-inspect-mcp/mcp_config.json`** — All tool config lives in the repo for portability and CI compatibility.

5. **JSON-RPC error codes** — Standardized error structure with -32000 to -32003 range, matching MCP protocol conventions.

---

*End of synthesis — covers source blueprint, existing implementation at ARCHITECTURE.md + TOOL_SPECS.md, gaps between them, and recommended implementation order.*
