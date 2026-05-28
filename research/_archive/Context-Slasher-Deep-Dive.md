# Structural Interface Mapping (Context-Slasher) — Deep Dive

**Date:** 2026-05-27
**Author:** Spectra (kanban task t_da83d67d)
**Source:** `/home/kerwin/KerwinsGeminiNotes/MCP Development Tool Ideas/1. Structural Interface Mapping (Context-Slasher Tool).md`
**Existing implementation:** Hermes MCP Toolset at `/home/kerwin/code/hermes-mcp-toolset/`

---

## 0. TL;DR

The Context-Slasher concept — strip implementation bodies, leave skeletons — is **sound, battle-tested, and already has a thriving ecosystem**. The closest thing to a drop-in answer is `ast-outline`, a Rust CLI that does exactly what the Gemini Notes envision, built on Tree-sitter, supporting 19+ languages, with `outline`/`digest`/`show`/`grep` commands that map 1:1 to the tool specs. There's also `codebeacon` (Python, knowledge graph oriented) and `mcp-code-context` (pure MCP server).

The Hermes toolset's TokenSqueezer already implements the concept (Babel for JS/TS, Tree-sitter for Python). The gap is: (a) multi-language coverage beyond JS/TS/Python, (b) the `context_slasher_multi` batch mode isn't implemented, and (c) there's no JSON-structured output for programmatic consumption.

**Recommendation:** Don't rebuild what ast-outline does well — either integrate it as the backend parser, or if rolling own, crib its adapter architecture (one file per language, per-language Tree-sitter queries).

---

## 1. Core Concept: The "Why"

The primary insight is correct and backed by real-world data:

**Problem:** An agent reads a 1200-line file to understand what methods are on a class. Of those 1200 lines, maybe 30 are signatures + docstrings. The other 1170 lines are implementation details the agent doesn't need for that query — but they still consume context tokens and introduce noise that degrades comprehension.

**Solution:** Deterministic AST parsing (Tree-sitter) extracts structural skeletons:

```
class PaymentProcessor:
    def __init__(self, gateway: PaymentGateway, logger: Logger) -> None: ...
    def process_payment(self, amount: Decimal, currency: str, source: PaymentSource) -> PaymentResult: ...
    def refund(self, transaction_id: str, amount: Optional[Decimal] = None) -> RefundResult: ...
    def get_transaction_history(self, user_id: str, limit: int = 50) -> List[Transaction]: ...
```

**Claimed savings:** 90-95% token reduction for heavily implemented modules. This checks out against real-world measurements — ast-outline's documentation reports "2-10x smaller" for single-file outlines, and the [agentpatterns.ai analysis](https://agentpatterns.ai/context-engineering/token-efficient-code-generation/) confirms structural context beats naive file-injection for comprehension.

---

## 2. The Ecosystem — What Already Exists

### 2.1 ast-outline (Direct Competitor/Inspiration)

**Repository:** https://github.com/ast-outline/ast-outline
**Install:** `uv tool install ast-outline`
**Tech:** Rust, Tree-sitter via ast-grep bindings, rayon for parallel parsing

This is the single most relevant existing tool. It's a **stateless CLI** (not an MCP server, not a daemon, no index) designed specifically for the "agent pre-reads structure before reading files" use case. Commands:

| Command | What it does | Maps to TOOL_SPECS |
|---------|-------------|-------------------|
| `ast-outline <path>` | Signatures with line ranges, no bodies | `context_slasher_skeleton` (compact text output) |
| `ast-outline digest <dir>` | One-page module map, size labels, token estimates | `context_slasher_multi` (recursive directory mode) |
| `ast-outline show <file> <symbol>` | Extract a single symbol's body by name | No exact match, but useful companion |
| `ast-outline grep <pattern> <paths>` | AST-aware structural search with kind tags | No exact match, overlaps with Blueprint Scout |
| `--json` on any command | Machine-readable JSON envelope | `output_format: "json"` in TOOL_SPECS |

**Key design decisions that are worth adopting:**
- **Stateless, no daemon.** Parse on demand, print, exit. Simpler than an MCP server for the same task.
- **Per-language adapter files.** One file per language under `src/ast_outline/adapters/`. New language = one new file. Clean separation.
- **`digest` as a module-level view.** Not just per-file outlines, but a consolidated module map with size heuristics — `[tiny]` / `[medium]` / `[large]` / `[huge]` labels. `[huge]` files (≥100k tokens) collapse to header-only to avoid blowing context.
- **Exit code 0 for user-facing failures.** Non-zero exits kill `bash` batches in agent harnesses. File not found? Print a `# note:` line and exit 0.
- **19 languages supported** — C#, C++, Python, TypeScript, JavaScript, Java, Kotlin, Scala, Go, Rust, PHP, Ruby, Lua, Swift, CSS, SCSS, SQL, HTML, Markdown, YAML.

**The "No MCP server" choice is worth debating.** Ast-outline's authors argue that for a stateless CLI, agents get more leverage piping and parallelizing it in bash than through an MCP shim. For the Hermes toolset which IS MCP-native, the question is: does the tool need to be an MCP tool, or can it shell out to ast-outline as a subprocess? The TOOL_SPECS defines MCP tool signatures — but those could be thin wrappers around ast-outline calls.

### 2.2 codebeacon

**Repository:** https://github.com/Wandererer/codebeacon
**Install:** `pip install codebeacon`
**Tech:** Python, Tree-sitter native grammar bindings

A Python-native alternative. Takes a different approach — instead of just skeletons, it builds a **multi-framework knowledge graph** with two-pass DI resolution (Pass 1: local AST nodes; Pass 2: global symbol table resolving Interface→Implementation mappings). Supports 27 frameworks across 9 languages.

**Key differentiators:**
- Framework-aware (Spring Boot, NestJS, FastAPI, etc.) — knows what a "controller" vs "service" vs "repository" is
- Knowledge graph output (not just structural text)
- Auto-sync via `codebeacon scan . --update`
- Generates `CLAUDE.md` per sub-project

**Tradeoff:** Heavier, more opinionated, slower. Better for persistent project understanding than ad-hoc file queries. The two-pass DI resolution is genuinely useful for complex frameworks but adds complexity that's overkill for "just show me the method signatures."

### 2.3 mcp-code-context

**Repository:** https://mcprepository.com/achatainga/mcp-code-context
**Tech:** Tree-sitter WASM parsers, MCP server

If the goal is specifically an MCP server tool, this is the closest existing implementation. 13 tools at the symbol level — 6 for reading, 2 for cleanup, 5 for writing. Uses Tree-sitter WASM so zero native dependencies. Limited language support compared to ast-outline.

### 2.4 Other Adjacent Tools

| Tool | Approach | Relevance |
|------|----------|-----------|
| **code2prompt** | File-tree + content bundling, no AST | Packing tool, not structural — opposite approach |
| **repomix** | File concatenation with token counting | Same — bundles content, doesn't strip |
| **ast-grep** | Structural code pattern matching/rewriting | Complementary — ast-outline is built ON ast-grep |
| **Graphify** | Tree-sitter AST extraction (classes, functions, call graphs) | 19 languages, knowledge graph oriented |
| **Structurizr** | C4 model as-code | Architecture modeling, not code understanding |

None of these are direct competitors to a Context-Slasher MCP tool — they solve adjacent problems. The gap in the market isn't "can you extract a skeleton from a file" (ast-outline does that trivially) but "can you serve that as an MCP tool integrated into a multi-tool agentic pipeline."

---

## 3. Tree-Sitter Technical Deep Dive

### 3.1 Why Tree-sitter (not LSP)

The Gemini Notes correctly identify Tree-sitter as primary. Specific advantages:

| Factor | Tree-sitter | LSP |
|--------|------------|-----|
| Startup time | ~5ms (native lib, no process) | 200-2000ms (language server process) |
| Determinism | Always identical output | Varies by server implementation |
| Distribution | Single pip/npm package | Requires LS binary per language |
| Incremental parse | Yes (efficient re-parse on edit) | No (full reparse) |
| Error tolerance | Yields partial tree on syntax errors | Often fails/returns empty |
| Multi-file scope | No (single-file by design) | Yes (cross-file type resolution) |

**Recommendation:** Tree-sitter primary, LSP fallback for cross-file resolution (import tracing, type lookup) where absolutely needed. LSP shouldn't be in the hot path for skeleton extraction.

### 3.2 Query Patterns for Structural Extraction

Tree-sitter uses S-expression queries to match structural nodes. For a Context-Slasher, the critical queries per language look like:

**Python:**
```scheme
; Top-level classes and functions
(class_definition
  name: (identifier) @class.name
  body: (block) @class.body) @class

(function_definition
  name: (identifier) @function.name
  body: (block) @function.body) @function

; Method definitions inside classes
(decorated_definition
  definition: (function_definition) @method)

; Decorated definitions
(decorator) @decorator
```

**TypeScript/JavaScript:**
```scheme
; Class declarations
(class_declaration
  name: (type_identifier) @class.name
  body: (class_body) @class.body) @class

; Method definitions within class bodies
(method_definition
  name: (property_identifier) @method.name
  body: (statement_block) @method.body) @method

; Interface declarations
(interface_declaration
  name: (type_identifier) @interface.name
  body: (object_type) @interface.body) @interface

; Arrow functions, function declarations
(function_declaration
  name: (identifier) @func.name
  body: (statement_block) @func.body) @func
```

**The structural stripping algorithm is straightforward:**
1. Parse file → get CST
2. Walk tree, identify structural nodes (class/function/interface/struct/enum declarations)
3. For each structural node: emit signature + docstring, skip implementation body
4. Render as either compact text (for agent injection) or structured JSON (for programmatic use)

### 3.3 Token Counting

The TOOL_SPECS correctly specifies `tiktoken` (cl100k_base) for estimation. This gives consistent counting regardless of which LLM eventually consumes the output. Important detail: token estimation should count the **rendered skeleton**, not the AST nodes — the skeleton is what enters context.

### 3.4 AST Caching

The blueprint mentions caching parsed ASTs keyed by file modification timestamp. This is cheap and effective. Tree-sitter parses a 1000-line file in ~1-5ms, so caching is a nice-to-have, not critical. Worth implementing as a simple LRU dict with filesystem mtime check.

---

## 4. TOOL_SPECS Gap Analysis

### 4.1 What's Spec'd But Not Implemented

| Feature | TOOL_SPECS Section | Current Status |
|---------|-------------------|----------------|
| `context_slasher_skeleton` | §1.3 | Defined in TOOL_SPECS, architecture mentions TokenSqueezer exists but unclear how far along the implementation is |
| `context_slasher_multi` | §1.4 | Defined but not implemented (batch mode + recursive directory scan) |
| JSON output format | §1.3 output schema | `output_format: "json"` in input schema, output schema defined, but not implemented |
| Token estimation (tiktoken) | §1.5 | Spec'd as cl100k_base, not implemented |
| AST cache by file hash | §1.5 | Spec'd, not implemented |
| LSP fallback | §1.2 | Spec'd as fallback, not implemented |
| Language coverage beyond JS/TS/Python | §1.2 | Spec'd for Rust, Go, Java, C++, C# — only JS/TS (Babel) and Python (Tree-sitter) exist |

### 4.2 What's Implemented But Could Be Better

| Existing | Issue |
|----------|-------|
| TokenSqueezer uses Babel for JS/TS | Works but adds a JS dependency to a Python toolchain. ast-outline proves Tree-sitter handles TypeScript/JavaScript natively — no Babel needed. |
| `aggressiveness` levels | Clever but maybe over-engineered. ast-outline's approach (one mode: strip bodies, preserve signatures + docstrings) covers 95% of use cases. Configurability adds testing surface. |
| `stripped_nodes` list for transparency | Nice UX touch. ast-outline doesn't do this and nobody seems to miss it. |

### 4.3 Architecture Divergence

The ARCHITECTURE.md describes TokenSqueezer as taking `code: string` input — operating on code strings passed by the agent. The TOOL_SPECS defines `context_slasher_skeleton` as taking `file_path` — operating on files. These are subtly different:

- **Code-string mode** (ARCHITECTURE.md): Agent pastes code, tool squeezes it. Useful when the agent already has code in context.
- **File-path mode** (TOOL_SPECS): Tool reads the file, parses it, returns skeleton. Cleaner separation; tool owns file I/O.

**Recommendation:** Support both. File-path is primary (tool manages file reads, caches ASTs). Code-string as a `source_text` parameter override for when the agent has modified code it hasn't yet written to disk.

---

## 5. Implementation Recommendations

### 5.1 Option A: Integrate ast-outline as Backend (Recommended for Speed)

The tool already exists, is battle-tested, supports 19 languages, and is fast (Rust + rayon). The Hermes MCP server would:

1. Shell out to `ast-outline <file>` or `ast-outline digest <dir>` 
2. Parse the JSON output
3. Add token estimation on top
4. Package it as MCP tools `context_slasher_skeleton` and `context_slasher_multi`

**Pros:** Zero new parser code. 19 languages. Proven CLI. JSON output built-in.
**Cons:** Rust binary dependency. `uv tool install ast-outline` required. No fine-grained control over stripping behavior.

**Estimated effort:** 1-2 days for the MCP wrapper.

### 5.2 Option B: Native Python Tree-sitter Implementation (Recommended for Control)

Use `tree-sitter` Python bindings directly. Build per-language adapter files (modelled on ast-outline's architecture). Advantages:

| Aspect | Native | ast-outline wrapper |
|--------|--------|-------------------|
| Dependency surface | pip only (`tree-sitter` + grammars) | Requires Rust binary installation |
| Control | Full AST node granularity | Limited to ast-outline's output schema |
| Custom renderers | Trivial | Must post-process |
| SOLID Enforcer integration | Shares AST parsing code | Separate code paths |
| Maintenance | Own code to maintain | Upstream changes may break |

**Recommended language order:** Python → TypeScript/JavaScript → Go → Rust → Java → C# → C++ → (others from ast-outline's adapter list as needed)

### 5.3 Critical Design Decisions

1. **File-path vs code-string input.** Support both. File-path is the hot path. Code-string is for agent-internal transformations.

2. **Output formats: two, not three.** The spec lists `compact`, `indented`, `json`. Drop `indented` — it's between `compact` and `json` in value, and maintaining three renderers is dead weight. `compact` for agent injection, `json` for programmatic consumers.

3. **Token counting as a post-processing layer.** Don't couple it to the parser. Parse → render → count. This keeps the counting strategy swappable (tiktoken, tokenizers, model-specific counters).

4. **Multi-file (`context_slasher_multi`) should be the default mental model, not an afterthought.** Agents rarely care about one file in isolation. The `digest` approach (ast-outline's module map) is more useful than a pile of individual file skeletons. Default to processing the workspace scope, let single-file be the exception.

5. **Export import/use/using lines.** The skeleton is incomplete without showing what the file imports. ast-outline's `--imports` flag surfaces these. This is critical for agents to understand dependency flow.

6. **Consider `context_slasher_skeleton` → `[outline]` and `context_slasher_multi` → `[digest]` naming.** The current names are descriptive but verbose. Short names reduce prompt tokens when the agent calls them.

---

## 6. Integration with Other Pillars

The Context-Slasher doesn't exist in isolation. Key integration points:

### With Blueprint Scout
- After skeletonization, Blueprint Scout can AST-fingerprint the stripped skeletons to find structural duplicates
- Skeleton + fingerprint is cheaper than skeleton + full-file comparison

### With Task Router
- Skeleton token counts feed directly into complexity estimation
- A 5000-token skeleton from a 50000-token file → the file is dense with implementation → complexity is likely high

### With RepoGraph
- Skeleton nodes (classes, interfaces, functions) are natural graph nodes
- Imports between files = edges
- The skeleton is effectively a pre-built RepoGraph view of a file

### With SOLID Enforcer
- Skeleton makes SOLID checks cheaper:
  - SRP: count public methods in the skeleton (no need to read bodies)
  - LSP: compare base class signatures against subclass overrides (in skeleton form)
  - ISP: count methods per interface (from skeleton)

---

## 7. Token Efficiency: Reality Check

Claimed 90-95% reduction is achievable for **heavily implemented modules** (business logic, data processing). For **thin layers** (facades, routing, configuration), savings are lower — 30-60%.

| File Type | Full Size (tokens) | Skeleton Size (tokens) | Reduction |
|-----------|-------------------|----------------------|-----------|
| Business logic class (500 lines) | ~6,250 | ~300 | 95% |
| Data repository (200 lines) | ~2,500 | ~200 | 92% |
| API controller (150 lines) | ~1,875 | ~350 | 81% |
| Config/DTO file (50 lines) | ~625 | ~400 | 36% |
| Facade/Proxy (80 lines) | ~1,000 | ~250 | 75% |
| **Average across codebase** | | | **~70-85%** |

ast-outline's `digest` command reports per-file token estimates with size labels, which matches this analysis.

**The real win isn't just token savings — it's comprehension improvement.** Ast-outline's README puts it well: "less noise to filter through means the agent locks onto the relevant code faster and answers with less drift." This is harder to measure but likely matters more than raw token counts.

---

## 8. Key Decisions (from Cross-Source Analysis)

1. **Tree-sitter > LSP for skeleton extraction** — LSP is too slow for the hot path. Use Tree-sitter for skeletons, reserve LSP for cross-file resolution (import tracing, type hierarchy).

2. **Stateless > daemon** — ast-outline proves stateless is fast enough (Tree-sitter parsing is ~1-5ms per file). No need for a persistent daemon or index for skeleton extraction.

3. **Deterministic > LLM-based** — The entire architecture rejects LLM-driven summarization for this task. AST-based structural analysis is faster, cheaper, and more predictable. LLMs add value only where synthesis/interpretation is needed (e.g., "summarize what this module does").

4. **File-path primary > code-string primary** — Let the tool manage file I/O and caching. Code-string as an override, not the default.

5. **Adapter pattern per language** — One file per language, one set of Tree-sitter queries per file. New language = new adapter. This scales better than a monolithic parser.

6. **Multi-file (digest) is more useful than single-file** — The batch mode should be the primary use case. A workspace-aware output (ast-outline `digest`) gives the agent more leverage than individual file skeletons.

---

## 9. Open Questions

1. **Should the Context-Slasher be its own MCP server, or a module inside a larger server?** The TOOL_SPECS implies a unified MCP server, but a dedicated microservice would be simpler to deploy and test independently.

2. **Should we use ast-outline (Rust) as the backend or build native Python Tree-sitter?** The tradeoff is development speed (1-2 days wrapping ast-outline) vs long-term control (building native adapters). Ast-outline already handles the hard parts (multi-language Tree-sitter queries, parallel parsing, JSON output). The question is whether you want a Rust dependency in the toolchain.

3. **How do we handle languages without Tree-sitter grammars?** The spec says LSP fallback, but which languages are common enough to warrant it? COBOL? Fortran? Erlang? ESLANG? Recommend drawing a hard line: if there's no Tree-sitter grammar, the skeleton defaults to a basic header comment + file-size estimate.

4. **Token counting — cl100k_base or model-aware?** cl100k_base is the simplest cross-model standard, but it over-counts for models with larger vocabularies (Llama, Gemini). Recommend cl100k_base for consistency and speed, with an optional model-specific override.

---

## 10. Summary

The Context-Slasher concept is validated by the existence of ast-outline, which solves 80% of the same problem. The Hermes toolset's TokenSqueezer already does AST-based stripping for JS/TS and Python. The gaps are language coverage, batch mode, JSON output, and token estimation.

**If I were building this right now:** I'd prototype by wrapping ast-outline as a subprocess in the MCP server, get the full 19-language coverage immediately, then incrementally replace backends with native Tree-sitter bindings for the languages that matter most (Python and TS/JS first, since they're the Hermes toolset's primary targets).

The real differentiator isn't the skeleton extraction itself (that's a solved problem) — it's the **integration**: feeding skeletons into Blueprint Scout for structural clone detection, into Task Router for complexity estimation, and into RepoGraph for persistent codebase memory. The Context-Slasher is the cheapest, highest-ROI component of the 4-pillar architecture to implement, and the one with the most immediate agent workflow impact.
