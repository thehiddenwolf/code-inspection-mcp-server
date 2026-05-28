# MCP Code Architecture & Token Optimization — Deep Research Synthesis

**Date:** 2026-05-27  
**Author:** Spectra  
**Source Documents:**
- `MCP Code Architecture and Token Optimization Specification.md` (Gemini Notes blueprint)
- Companion tool-idea docs: Structural Interface Mapping, Proactive Blueprint Search, Complexity-Based Task Router, In-Repository Knowledge Graph
- `Agentic Workflows and Token Optimization Guide.md` (multi-platform token strategies)
- Existing Hermes MCP Toolset `ARCHITECTURE.md` and `TOOL_SPECS.md`
- Web research: MCP protocol specs, Tree-sitter ecosystem, token optimization patterns, Semgrep

---

## 1. Overview

The MCP Code Architecture and Token Optimization Specification defines a **standalone Model Context Protocol (MCP) server** purpose-built for agentic software engineering within the Agent Hermes ecosystem. Its driving thesis is simple and aggressive:

> **Deterministic static code analysis should replace LLM-driven summarization wherever possible.**

Instead of having a frontier model re-read 500-line source files to understand class signatures, or run repeated global searches across turns, or waste tokens generating boilerplate that already exists — the blueprint proposes a set of non-LLM, AST-based, event-triggered tools that intercept the agent's workflow at critical pre-generation stages and inject precisely what the agent needs, exactly when it needs it, at a fraction of the token cost.

The architecture targets three sub-agents (Spectra, Eclypsia, Aura) operating under Agent Hermes, with tooling implemented in Python/TypeScript using Tree-sitter, Semgrep, and repository-native file stores.

---

## 2. Key Concepts

### 2.1 Determinism Over Summarization

Every tool in the blueprint is **deterministic** — it uses Abstract Syntax Trees (ASTs), complexity metrics, structural pattern matching, or graph queries. No LLM calls are invoked for analysis tasks. This is the core philosophy: LLMs generate code and reason about intent; everything else should be a fast, repeatable, verifiable computation.

### 2.2 Stage Interception

The tools don't run after-the-fact. They intercept the agentic workflow at **specific decision points**:

- **Planning stage** — Before code is written (blueprint search, clone detection)
- **Context injection** — When the agent reads files (structural skeletons)
- **Task assignment** — When work is decomposed (complexity routing)
- **State synchronization** — After code changes (knowledge graph updates)
- **Validation gate** — Before merge (SOLID compliance, architectural rules)

### 2.3 Standalone MCP Server

The blueprint specifies a **single standalone MCP server process** that registers tools via JSON-RPC. It lives alongside the code repository, reads configuration from `.code-inspect-mcp/mcp_config.json`, and communicates with the agent via the standard MCP protocol (tools/list, tools/call). No external vector databases, no separate service mesh, no cloud dependencies.

### 2.4 Token-as-Cost Mental Model

Token usage is treated as the primary cost currency. Every architectural decision is evaluated through the lens of: *does this reduce the number of tokens the agent consumes per task?* The four pillars each target a specific token-waste vector:

| Pillar | Token Waste Vector | Reduction Mechanism |
|--------|-------------------|---------------------|
| Context-Slasher | Ingesting full files for signatures | Skeletal AST output (90-95% smaller) |
| Blueprint Scout | Rewriting existing boilerplate | Pre-generation reuse detection |
| Task Router | Premium models on trivial tasks | Complexity-based model tiering |
| RepoGraph | Repeated global searches | Persistent local knowledge graph |

---

## 3. Architecture Analysis

### 3.1 Pillar A — Structural Interface Mapping (Context-Slasher)

**The Problem:** Agents inject entire source files (500+ lines) into context just to understand what classes and methods exist. The implementation logic is noise for architectural reasoning.

**The Solution:** A Tree-sitter AST parser that strips function bodies, loop bodies, and conditional blocks, returning a skeletal outline containing only:
- Class declarations
- Method signatures (name, parameters, return type hints)
- Docstrings
- Decorators/annotations
- Import statements (optionally)

**Technical Design:**
- **Primary engine:** Tree-sitter (Python bindings via `tree-sitter` package, or Node bindings)
- **Fallback:** Language Server Protocol (LSP) — slower, requires running language servers, but handles languages without Tree-sitter grammars
- **Caching:** AST parse results cached by file hash to avoid re-parsing unchanged files
- **Output format:** Markdown or structured JSON designed for minimal token count

**Token Efficiency:** Payload size drops by 90-95% for implementation-heavy modules. A 500-line TypeScript service class might produce a 15-line skeleton.

**Existing Precedent (from web research):**
- **DarkEden-coding/CodeStructureMCP** — An existing MCP server on GitHub that does exactly this: Tree-sitter AST parsing, error-resilient, markdown output optimized for LLM consumption, supports nested elements.
- **anatolykoptev/go-code** — Code intelligence MCP server with Tree-sitter AST parsing that analyzes repositories, traces call chains, and searches symbols.
- **rag-semantic-chunker** (PyPI) — AST-based code chunking for LLM processing using policy-based splitting.

**Companion Doc Notes:** The Context-Slasher specification emphasizes that the tool is an "IntelliSense map provider" — it gives the agent immediate situational awareness of file architecture without the agent needing to parse implementation details. Output focuses on *public interfaces* specifically.

### 3.2 Pillar B — Proactive Blueprint Search & Clone Detection

**The Problem:** LLMs keep generating code that already exists in the codebase. They write new utility functions that duplicate existing ones, create boilerplate that matches untouched patterns, or violate established architectural patterns. Traditional clone detection runs *after* code is written — by then, tokens are already spent.

**The Solution:** A planning-stage code search tool that fires when the agent produces an implementation plan. It:
1. Extracts keywords, functional interfaces, and structural descriptors from the plan
2. Queries the codebase for structural matches using Semgrep rules and PMD CPD
3. Returns: *"This logic already exists over here; reuse it."*

**Technical Design:**
- **Semgrep** for structural pattern matching — searches for AST patterns, not just text
- **PMD's CPD (Copy-Paste Detector)** for token-based duplication detection — Java runtime dependency, so a pure-Python fallback using token-hash comparison is specified
- **Semgrep rule caching** at `.code-inspect-mcp/semgrep_rules/` for performance
- **Novelty scoring** — compares the plan against existing code to produce a reuse-vs-new score

**Companion Doc Notes:** The Blueprint Scout spec frames this as a *predictive* tool. It doesn't wait for code to be written and then check for duplication — it intervenes at the plan stage and says "don't write this, use the existing thing." This is the key differentiator from standard linting/CI tools.

### 3.3 Pillar C — Complexity-Based Task Router

**The Problem:** Using Claude Opus (20× multiplier) or Sonnet (12×) to write a 10-line utility function or a boilerplate unit test is like using a flamethrower to light a candle.

**The Solution:** A programmatic task decomposer that:
1. Breaks an architectural plan into independent micro-tasks
2. Scores each task on deterministic metrics (cyclomatic complexity, LOC impact, dependency density)
3. Routes high-complexity tasks to premium models and low-complexity tasks to cheap micro-models

**Complexity Metrics:**
- **Cyclomatic Complexity:** Number of linearly independent paths through the target code block (via radon/lizard)
- **Lines of Code (LOC) Impact:** Predicted scope of file modification
- **Dependency Density:** Number of imports and package chains tied to the execution target
- **Novelty Score:** From Pillar B — how much of this exists already vs. is genuinely new

**Routing Logic:**
- Above threshold → "Senior Architect" workload → premium model (Sonnet, Opus, DeepSeek)
- Below threshold → "Junior Engineer" workload → micro-model (Haiku, Flash, local models)
- Specialized routing: math-heavy tasks → Ernie 5.1 (1.5× multiplier, strong math); data piping → basic models with review/fix loop

**Companion Doc Notes:** The Task Router doc emphasizes that *planning* needs good models, but *execution* can use cheaper ones. It also suggests finer-grained routing beyond a binary "best model / barely functions" split — match models to topic strengths. The doc specifically calls out model multipliers: Ernie 5.1 at 1.5×, DeepSeek V4 Pro at 2.1×, Kimi K2.6 at 2.8×, Claude Sonnet 4.6 at 12×, Claude Opus at 20×. The balance: too-small models cause errors that cost tokens to fix; too-large models waste tokens on trivial work.

### 3.4 Pillar D — In-Repository Knowledge Graph (RepoGraph)

**The Problem:** Agents lack persistent, state-aware memory of the codebase. Each turn starts fresh, triggering repeated global searches and re-indexing. The agent doesn't "remember" where things are between turns.

**The Solution:** A lightweight, file-based knowledge graph stored *inside* the repository itself (in `.code-inspect-mcp/`). The MCP server is the exclusive read/write gateway. Git hooks or file watchers update the graph incrementally when files change.

**Storage Design:**
- **Format:** SQLite database and/or structured Markdown definitions in `.code-inspect-mcp/`
- **Schema:** Entities (files, classes, functions, modules), relations (imports, calls, inherits, implements), intents (tags mapping concepts to code locations)
- **Sync mechanism:** Incremental diff tracking — only changed branches of the graph are updated on file edits, not full re-indexing

**Agent Integration:**
- `repograph_query` — Query entities, relations, intents, symbol locations
- `repograph_update` — Write new or updated graph entries
- `repograph_register_intent` — Tag code with semantic intent (e.g., "this module handles authentication")
- `repograph_rescan` — Full rebuild of the graph from current codebase state

**Why SQLite and not pgvector/Pinecone/etc.:** The blueprint explicitly rejects external vector databases. The knowledge graph is a *relational structure*, not a semantic embedding store. Entities have explicit relationships (imports, calls, inherits from) rather than cosine-similarity proximity. This keeps the toolset dependency-free and repository-portable.

**Web Research — Existing Precedent:**
- **Anthropic's Memory MCP Server** — LibSQL-based persistent memory with knowledge graph entities and relations
- **SourceSage MCP Server** — Persistent knowledge graph of code entities, relationships, patterns, and style conventions with hierarchical compression
- **Neo Cortex Memory MCP Server** — SQLite-based knowledge graph storing entities and observations
- **mindretriever (PyPI)** — "Knowledge graph builder for code and product assets with token optimization" — tracks measurable token and cost savings

### 3.5 The SOLID Enforcer — A Notable Addition

Not in the original Gemini Notes blueprint, but added in the `TOOL_SPECS.md` expansion: a three-tier SOLID compliance system.

**Tier 1 (Preventive):** Restrict file visibility (`scope_context`) and inject dependency injection patterns (`di_template`) before code is written.

**Tier 2 (Evaluative):** Deterministic SOLID checks:
- SRP via LOC/import analysis
- OCP via abstract base class detection
- LSP via AST signature comparison
- ISP via method-count analysis
- DIP via instantiation pattern analysis

**Tier 3 (Operational):** Translates abstract SOLID directives ("follow SRP") into concrete mechanical instructions ("create DataFetcher class exclusively for HTTP fetching").

### 3.6 Full Orchestration Flow

The tools form a pipeline that wraps the code generation step:

```
Agent Hermes (Planner)
  │
  ├─ repograph_query()           → "What already exists?"
  ├─ blueprint_scout_analyze()   → "Is anything duplicated?"
  ├─ task_router_decompose()     → "Break into micro-tasks, estimate complexity"
  ├─ solid_enforcer_translate()  → "Translate SOLID directives to mechanical steps"
  ├─ context_slasher_skeleton()  → "Inject skeletal context for target files"
  │
  ▼
  Code Generation (target model, routed by complexity)
  │
  ├─ solid_enforcer_audit()      → "Did the code pass SOLID checks?"
  ├─ ArchitectureShepherd        → "Does the code comply with ARCHITECTURE.md rules?"
  │
  ├─ IF PASS → repograph_update() → merge
  └─ IF FAIL → error log → back to planner
```

### 3.7 Implementation State

The Hermes MCP Toolset at `/home/kerwin/code/hermes-mcp-toolset/` currently maps the blueprint to three pillars:

| Toolset Pillar | Maps To | Status |
|---------------|---------|--------|
| **TokenSqueezer** | Pillar A (Context-Slasher) | Implemented — uses Babel (JS/TS) and Tree-sitter (Python) to strip non-essential nodes |
| **ArchitectureShepherd** | NEW — not in blueprint | Implemented — enforces ARCHITECTURE.md manifest rules on diffs |
| **PatternMiner** | Pillar B (Blueprint Scout), expanded | Implemented — dead code detection, anti-pattern scanning, code smells |

The `TOOL_SPECS.md` expands to **16 concrete MCP tools** across all pillars plus the SOLID Enforcer. Not all are implemented yet.

---

## 4. Token Optimization Strategies

### 4.1 Context Reduction via Structural Filtering

**Strategy:** Replace full file reads with AST-extracted skeletons.

**Mechanism:** Tree-sitter parses the source, walks the CST/AST, emits only class/method/interface declarations with signatures and docstrings. Bodies are stripped.

**Expected Savings:** 90-95% reduction in per-file token cost for implementation-heavy modules.

**Precedent:** CodeStructureMCP (DarkEden-coding), rag-semantic-chunker, and multiple production MCP servers already implement this pattern successfully.

### 4.2 Pre-Generation Duplicate Prevention

**Strategy:** Intercept the planning stage, not the code-review stage.

**Mechanism:** When the agent produces an implementation plan (YAML/Markdown), extract functional descriptors, run Semgrep structural pattern matching and PMD CPD token-hash comparison against the codebase, and surface existing implementations.

**Expected Savings:** Eliminates entire code-generation-and-review cycles for redundant work. A single avoided duplicate implementation saves thousands of tokens.

**Key Insight:** This is fundamentally different from CI-based linting or post-hoc code review. The intervention point is *before tokens are spent generating code*.

### 4.3 Model Tiering by Complexity

**Strategy:** Route tasks to appropriately-sized models based on deterministic complexity metrics.

**Mechanism:** 
- Low complexity (boilerplate, simple transforms, data mapping) → Haiku/Flash class models (cheap, fast)
- Medium complexity (standard feature implementation) → Mid-tier models
- High complexity (architecture, novel algorithms, complex refactors) → Premium models (Sonnet, Opus)

**Expected Savings:** Even a 50/50 split between cheap and premium models can cut model costs by 3-10× depending on the multiplier difference.

**Risk:** Too-small models produce errors that cost more tokens to fix than the savings. The companion doc explicitly calls this out: *"screw ups cost tokens because stuff has to get fixed."* The router needs a review/fix loop for cheap-model outputs.

### 4.4 Persistent Memory to Eliminate Re-Search

**Strategy:** Maintain a codebase knowledge graph that persists across agent turns.

**Mechanism:** SQLite-based entity-relation graph stored in `.code-inspect-mcp/`, updated by git hooks, queried by the agent instead of running repeated `grep`/`find`/`search_files` operations.

**Expected Savings:** Eliminates the per-turn "where is X?" search overhead. In a multi-turn session, global file searches can consume 500-2,000 tokens per query. Eliminating 5-10 such queries per session saves significant context.

### 4.5 Tool Definition Trimming

**Strategy (from Agentic Workflows Guide):** Disable unused MCP tools to prevent system prompt bloat.

**Mechanism:** Every active tool definition adds hidden systemic tokens to the system prompt of every message exchange. The Agentic Workflows Guide recommends auditing and disabling irrelevant MCP tools.

**Web Research — Anthropic Tool Search:** In January 2026, Anthropic introduced Tool Search — dynamic tool discovery that loads only the tools needed for a given task instead of all of them upfront. Results:
- **85% reduction** in token usage from tool definitions
- **95% preservation** of context window (191,300 tokens saved vs. loading all tools)
- Java/Spring implementations achieving **34-64% token savings** with similar patterns

### 4.6 Context Window Management

**Strategy (from Agentic Workflows Guide):** Proactive `/clear` between unrelated tasks.

**Mechanism:** When transitioning between unrelated work (database bug → UI refactor), the agent should flush the conversation history. Without this, the agent pays to re-process irrelevant context on every subsequent turn.

### 4.7 Plan-First Architecture

**Strategy (cross-platform pattern):** Force the agent to produce an architectural plan before writing any code.

**Mechanism:** 
- Claude Code: Plan Mode (Shift+Tab toggle)
- GitHub Copilot: YAML frontmatter with model/path scoping
- Agent Hermes: SOUL.md or project context file with micro-task decomposition instructions

**Benefit:** Prevents the agent from generating large chunks of incorrect code that must later be discarded and regenerated.

---

## 5. Research References

### 5.1 MCP Protocol & Architecture

- **Official MCP Architecture Spec** — `modelcontextprotocol.io/specification/2025-03-26/architecture` — Client-host-server architecture, protocol layers, transport mechanisms
- **MCP Best Practices** — `modelcontextprotocol.info/docs/best-practices/` — Server design, security, reliability, enterprise patterns
- **DeepWiki MCP Architecture** — `deepwiki.com/modelcontextprotocol/docs/2-mcp-architecture` — Core client-server model, communication patterns
- **Complete MCP Guide 2026** — Streamable HTTP transport, OAuth 2.1 auth, FastMCP server implementation

### 5.2 Tree-sitter & AST-Based Code Analysis

- **Tree-sitter Official** — `tree-sitter.github.io/` — Parser generator, incremental parsing, multi-language support
- **tree-sitter-language-pack** — `github.com/kreuzberg-dev/tree-sitter-language-pack` — On-demand parser downloads, native bindings for Python, Node, Rust, Go, Java
- **CodeStructureMCP** — `github.com/DarkEden-coding/CodeStructureMCP` — Production MCP server doing exactly what Pillar A specifies: Tree-sitter AST → markdown skeleton → LLM-optimized output
- **go-code MCP** — `github.com/anatolykoptev/go-code` — Tree-sitter powered code intelligence MCP server with call chain tracing and symbol search
- **rag-semantic-chunker (PyPI)** — AST-based code chunking for LLM processing with policy-based splitting

### 5.3 Pattern Matching & Clone Detection

- **Semgrep** — `semgrep.dev` — Structural pattern matching on ASTs, community rules, CI integration
- **PMD CPD** — Token-based copy-paste detection, Java runtime (fallback to pure-Python token hashing per blueprint notes)
- **Contrary Research on Semgrep** — Business analysis of Semgrep's approach to AST-free pattern matching

### 5.4 Token Optimization & Context Management

- **Anthropic Tool Search** — 85% token reduction, dynamic tool loading, January 2026 launch
- **Spring AI Tool Search** — 34-64% token savings via Recursive Advisors implementing the same pattern
- **Stacklok MCP Optimizer** — Competitive tool vs. Anthropic Tool Search, up to 80% token reduction
- **mindretriever (PyPI)** — Knowledge graph builder for code assets with token optimization, tracking measurable savings
- **RTK (Reduce Token waste for ai-Koding)** — Context optimization layer between terminal output and AI agents, filtering and compressing noisy output

### 5.5 Code Knowledge Graphs

- **Anthropic Memory MCP Server** — LibSQL-based persistent memory with knowledge graph entities
- **SourceSage MCP Server** — Code knowledge graph with hierarchical compression
- **Neo Cortex Memory MCP** — SQLite-based knowledge graph with entities and observations
- **Graphiti Pro MCP** — Neo4j-based knowledge graphs with episode-based storage and semantic search

### 5.6 Complexity Metrics

- **Radon** — Python cyclomatic complexity, raw metrics, Halstead metrics, maintainability index
- **Lizard** — Multi-language cyclomatic complexity analyzer (C/C++, Java, Python, JS, etc.)

---

## 6. Open Questions

### 6.1 Scope & Scale

1. **Standalone server vs. microservice topology:** The Gemini blueprint specifies a single standalone MCP server. The existing `ARCHITECTURE.md` describes a 9-service microservice topology (gateway, orchestrator, policy engine, tool broker, sandbox manager, etc. plus Postgres, Redis, NATS, MinIO). Are these compatible visions, or are they two different projects? The `TOOL_SPECS.md` bridges this by defining tool signatures that could work either way — but the implementation effort is vastly different.

2. **Which target should the initial implementation use?** The standalone MCP server (lower effort, faster to validate) or the microservice topology (more scalable, but heavier)?

### 6.2 Tree-sitter Language Coverage

3. **How robust is Tree-sitter's language coverage for the target repos?** The blueprint specifies Python and JavaScript/TypeScript as primary targets. Tree-sitter has mature grammars for both. But what about C++, Rust, or Go? The `tree-sitter-language-pack` project provides on-demand downloads, but grammar quality varies.

4. **Can LSP serve as a reliable fallback?** The blueprint mentions LSP as a fallback, but running language servers adds process management complexity. Is the fallback worth implementing, or should unsupported languages simply be excluded?

### 6.3 Complexity Routing

5. **What are the actual complexity thresholds?** The blueprint defines the concept but not the specific thresholds. At what cyclomatic complexity does a task graduate from Haiku to Sonnet? This needs empirical tuning — running test tasks through different models and measuring both output quality and token cost.

6. **How to handle the review/fix loop for cheap-model outputs?** The companion doc correctly notes that too-small models produce errors that cost tokens to fix. What's the calibration process? How many review cycles before escalating to a bigger model?

7. **Are there enough granular model options?** The blueprint mentions Ernie 5.1 (math-specialized, 1.5×), DeepSeek V4 Pro (2.1×), Kimi K2.6 (2.8×), Claude Sonnet (12×), Opus (20×). This is a good spread, but the gap between 2.8× and 12× is significant. Are there solid models in the 3-8× range for medium-complexity tasks?

### 6.4 RepoGraph Performance

8. **How does the knowledge graph scale with large repos?** SQLite handles millions of rows fine, but the entity-relation model for a 100,000+ file monorepo is a different beast. What's the performance profile? Does incremental diff tracking hold up at scale?

9. **Git hook vs. file watcher — which sync mechanism?** Git hooks fire on commit, but the agent may need graph updates between commits during a multi-file session. File watchers (inotify, watchdog) provide real-time updates but add process overhead.

### 6.5 Semgrep & Pattern Matching

10. **How to maintain and curate the Semgrep rule set?** The blueprint specifies caching rules at `.code-inspect-mcp/semgrep_rules/`, but who writes and maintains these rules? Community Semgrep rules cover security patterns, not "this is boilerplate the agent shouldn't rewrite." Custom rules are needed — what's the maintenance burden?

11. **Is PMD CPD necessary, or is pure-Python token-hash comparison sufficient?** The blueprint suggests PMD CPD as primary with Python fallback. If the Python fallback is good enough, removing the Java dependency simplifies deployment significantly.

### 6.6 SOLID Enforcer Specifics

12. **How do deterministic SOLID checks handle false positives?** SRP via LOC analysis is a heuristic, not a proof. A 200-line class might legitimately have a single responsibility. What's the error-handling strategy? Are violations flagged as warnings or errors?

13. **Is Tier 1 (preventive) actually feasible?** Restricting file visibility and injecting DI patterns *before* code is written sounds like it requires the agent to follow constraints it might not understand or respect. Does this work in practice, or is it aspirational?

### 6.7 Agent Hermes Integration

14. **How do the MCP tool definitions align with Hermes' skill-building mechanics?** The blueprint states tools should "align naturally with Hermes' system prompts." Hermes uses a Skills system with model overrides for auxiliary tasks. Do the MCP tools register as skills, or as lower-level protocol tools?

15. **Cross-agent compatibility:** The blueprint targets three sub-agents (Spectra, Eclypsia, Aura). Do they each need the same tools, or should tool availability be scoped per agent? The blueprint doesn't address this.

### 6.8 Token Measurement

16. **How will token savings be measured and validated?** The blueprint proposes token optimization as the primary goal, but doesn't specify a measurement methodology. Without concrete before/after metrics, it's hard to validate that the tools are working. Should the MCP server itself track and report token savings? The `mindretriever` PyPI package does this — "tracking measurable token and cost savings over time" — suggesting it's feasible.

---

*End of synthesis. This document bridges the Gemini Notes blueprint, companion tool-idea specifications, existing Hermes MCP Toolset implementation at `/home/kerwin/code/hermes-mcp-toolset/`, and broader ecosystem research on MCP server patterns, Tree-sitter AST tooling, and token optimization strategies.*
