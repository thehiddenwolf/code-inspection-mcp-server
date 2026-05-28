# Structural Interface Mapping (Context-Slasher) — Deep Dive Research

**Date:** 2026-05-27  
**Author:** Spectra  
**Source:** `/home/kerwin/KerwinsGeminiNotes/MCP Development Tool Ideas/1. Structural Interface Mapping (Context-Slasher Tool).md`  
**Existing partial implementation:** TokenSqueezer in Hermes MCP Toolset  
**Tool spec:** `context_slasher_skeleton` + `context_slasher_multi` in TOOL_SPECS.md

---

## 1. Concept Summary

### The Core Problem

The primary vector for token waste in agentic software engineering is the ingestion of **massive source files**. An LLM often needs to understand a file's public interface, signatures, or structural layout but is forced to consume hundreds of lines of implementation logic it has no intention of modifying. This is particularly acute in:

- **Heavily implemented modules** (500+ line files where the LLM only needs to know "what methods exist and what they take")
- **Multi-file architectural tasks** (understanding a module's public surface area without drowning in bodies)
- **Planning-stage context gathering** (before any code is actually being modified)

### The Solution

A deterministic, non-LLM structural mapping tool that uses **Abstract Syntax Tree (AST) parsing** to strip function/loop/conditional bodies from source files, returning only the **structural skeleton**:

```
Input:  500-line Python module with 12 methods
Output: ~25-line skeleton — class name, method signatures, type hints, docstrings
Result: 90-95% token reduction for heavily implemented modules
```

### Why Deterministic, Not LLM-Based

The design explicitly rejects LLM-driven summarization. AST parsing is:
- **Deterministic** — same input always yields same output, no hallucination risk
- **Fast** — milliseconds per file with Tree-sitter
- **Cheap** — no API cost, runs locally
- **Cachable** — keyed on file hash, only re-parse on change

This is a **pre-processing middleware** — it sits between the codebase and the LLM's context window, transforming files before they enter the context.

---

## 2. Technical Approach

### 2.1 AST Engine: Tree-sitter vs LSP

| Criterion | Tree-sitter | Language Server Protocol (LSP) |
|-----------|------------|-------------------------------|
| Speed | Microseconds per parse | Milliseconds (IPC overhead) |
| Dependencies | Grammar files or WASM binaries | Running language server process per language |
| Determinism | Yes (incremental, concrete syntax tree) | Yes (AST via server) |
| Language coverage | 66+ languages | Per-language server |
| Distribution | WASM = zero native deps | Complex — requires spawn management |
| Error recovery | Built-in (designed for editors) | Varies by server |
| Body stripping | Query-based node removal | Semantic token + document symbol APIs |

**Decision: Tree-sitter is the clear winner.** It's faster, simpler to distribute, and its query system is purpose-built for extracting specific node types. LSP is a fallback at most. The Gemini Notes mention LSP as an alternative, but the ecosystem research confirms Tree-sitter is the standard choice for this problem:

- **mcp-code-context** uses Tree-sitter WASM parsers exclusively ("100% AST accuracy, zero native dependencies")
- **Repomix** uses Tree-sitter for its `--compress` flag (~70% token reduction)
- **code-review-graph** builds persistent knowledge graphs via Tree-sitter + SQLite
- **Aider** relies on Tree-sitter for its code retrieval (shows only signatures/declarations)
- **Claude Code** uses "AST-based chunking" with Tree-sitter as its primary strategy
- **SynthCoder** (arXiv 2508.15495) uses Tree-sitter to extract class definitions and method signatures
- **Codebase-Memory** (arXiv 2603.27277) uses Tree-sitter via MCP, parsing 66 languages

### 2.2 The Body-Stripping Pipeline

```
Source File
    │
    ▼
┌─────────────────────────┐
│ Tree-sitter Parse       │  → Concrete Syntax Tree (CST)
│ (language-specific      │
│  grammar)               │
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│ Node Classification     │  Identify: functions, methods, classes,
│                         │  conditionals, loops, try/except blocks
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│ Body Stripping          │  For each identified node:
│                         │  - Preserve: signature, name, params,
│                         │    return type, decorators, docstrings
│                         │  - Replace body with: `{ ... }` or `pass`
│                         │  - Preserve: class hierarchy, imports
│                         │    (used by signatures)
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│ Skeleton Assembly       │  Reconstruct file as structural skeleton
│                         │  with preserved imports + stripped definitions
└─────────┬───────────────┘
          │
          ▼
    Skeleton Output
```

### 2.3 Language-Specific Query Patterns

Tree-sitter uses S-expression queries to match node types. Each language grammar has different node names:

**Python:**
```scheme
(function_definition
  name: (identifier) @func_name
  parameters: (parameters) @params
  return_type: (type)? @return_type
  body: (block) @body)  ; ← strip this
```

**TypeScript/JavaScript:**
```scheme
(method_definition
  name: (property_identifier) @method_name
  parameters: (formal_parameters) @params
  return_type: (type_annotation)? @return_type
  body: (statement_block) @body)  ; ← strip this
```

**Go:**
```scheme
(function_declaration
  name: (identifier) @func_name
  parameters: (parameter_list) @params
  result: (parameter_list)? @return_type
  body: (block) @body)  ; ← strip this
```

### 2.4 What Gets Preserved

- **Class declarations** — name, base classes, decorators
- **Method/function signatures** — name, parameters, type hints, return types
- **Docstrings** — extracted from immediately following string literals in bodies
- **Import statements** — necessary for understanding type references
- **Type aliases, interfaces, constants** — top-level structural declarations
- **Module-level docstrings** — file-level documentation

### 2.5 What Gets Stripped

- **Function/method bodies** — replaced with `{ ... }` or equivalent placeholder
- **Loop bodies** — `for`/`while` internals
- **Conditional branches** — `if`/`elif`/`else` internals
- **Try/except bodies** — error handling internals
- **Comments outside docstrings** — inline and block comments
- **Assertions, logging, print statements** — runtime-only code

### 2.6 Token Efficiency Math

From the Gemini Notes and corroborated by ecosystem data:

| File Type | Original Tokens | Skeleton Tokens | Reduction |
|-----------|----------------|-----------------|-----------|
| Heavy implementation (500 LOC) | ~3,500 | ~175-350 | 90-95% |
| Mixed interface/impl | ~2,000 | ~300-500 | 75-85% |
| Thin interface file | ~500 | ~200-300 | 40-60% |

Ecosystem benchmarks confirm:
- Repomix: ~70% average compression
- mcp-code-context: claims "fraction of the token cost"
- SWE-Pruner: 23-54% on agent tasks, up to 14.8× on single-turn
- code-review-graph: 6.8× average, up to 49× on monorepos

---

## 3. Implementation Options

### 3.1 Option A: Python with tree-sitter Bindings (Recommended)

**Stack:** `tree-sitter` PyPI package + language grammar repos

```python
# pip install tree-sitter tree-sitter-python tree-sitter-typescript
import tree_sitter_python as tspython
from tree_sitter import Language, Parser

PY_LANGUAGE = Language(tspython.language())
parser = Parser(PY_LANGUAGE)

def skeletonize(filepath: str, language: str) -> str:
    tree = parser.parse(source_bytes)
    # Walk CST, strip bodies, reconstruct
```

**Pros:**
- Natural fit with Hermes toolset (Python-based)
- Rich ecosystem of Python AST tools as fallback (ast, libcst)
- Easy to integrate with MCP Python SDK

**Cons:**
- Must compile/install per-language grammars
- Python tree-sitter bindings have occasional version churn

### 3.2 Option B: TypeScript/Node with WASM Grammars (Alternative)

**Stack:** `tree-sitter` npm + WASM grammar files

Used by **mcp-code-context** — the closest existing implementation to Context-Slasher. They achieve "zero native dependencies" by bundling Tree-sitter as WASM.

**Pros:**
- WASM = single binary per language, no native compilation
- mcp-code-context is open source, can be studied/forked
- MCP TypeScript SDK is mature

**Cons:**
- Different stack from existing Hermes toolset
- WASM parsing can be slower than native for very large files
- Would need JS bridge if integrated into Python toolset

### 3.3 Option C: Hybrid — Python MCP Server + WASM Tree-sitter via subprocess

**Stack:** Python MCP server, spawn Node process for parsing or use `tree-sitter-wasms` Python package

**Pros:**
- Keeps Python server architecture
- WASM grammars are portable

**Cons:**
- Added complexity of subprocess/IPC
- Performance overhead

### 3.4 Option D: AST-grep as CLI Backend

**Stack:** Use `ast-grep` CLI (Rust binary) as a child process

`ast-grep` supports structural search with pattern matching across 20+ languages. It could be used to define body-stripping patterns declaratively.

**Pros:**
- Single binary, no per-language setup
- Declarative YAML rules for body stripping
- Very fast (Rust)

**Cons:**
- Less control over output formatting
- CLI dependency, not a library
- Might not expose fine-grained enough control over body-vs-signature split

### 3.5 Recommendation

**Option A (Python + tree-sitter)** is the best fit for the Hermes toolset. It keeps the stack uniform, gives maximum control, and aligns with the existing TokenSqueezer implementation which already uses Babel for JS/TS and Tree-sitter for Python.

---

## 4. Related Research & Existing Work

### 4.1 Academic

| Paper | Key Finding | Relevance |
|-------|------------|-----------|
| **SWE-Pruner** (Wang et al., Jan 2026) arxiv:2601.16746 | Self-adaptive context pruning for coding agents. Task-aware line-level pruning. 23-54% token reduction on agent tasks, 14.8× on single-turn. | **Critical:** "Removing AST-aware structure especially hurts under the 8× constraint" — structural support becomes MORE important as budget tightens. Confirms the core thesis. |
| **SynthCoder** (Sep 2025) arxiv:2508.15495 | Uses Tree-sitter to parse code files and extract class definitions, method signatures, functional structure for LLM fine-tuning. | Validates Tree-sitter as the standard extraction tool. |
| **Codebase-Memory** (2026) arxiv:2603.27277 | Tree-sitter knowledge graph via MCP, parsing 66 languages. Multi-phase pipeline with call-graph traversal. | Demonstrates the broader ecosystem of MCP + Tree-sitter tools. |
| **Context Pruning for Coding Agents via Multi-Rubric Latent Reasoning** (May 2026) arxiv:2605.15315 | "Context-based objectives are not consistently robust under stronger compression. Removing AST-aware structure especially hurts" | Reinforces that structural preservation during compression is non-negotiable. |

### 4.2 Open-Source Tools

| Tool | Approach | Token Reduction | Notes |
|------|----------|----------------|-------|
| **mcp-code-context** | Tree-sitter WASM MCP server | "Fraction of token cost" | Closest existing sibling to Context-Slasher. Extracts function signatures, class declarations, interfaces, type aliases, constants, docblocks. Zero native deps. TypeScript-based. |
| **Repomix** | Tree-sitter `--compress` flag | ~70% | Packs entire codebase into AI-friendly format. Also has MCP server integration. |
| **code-review-graph** | Tree-sitter + SQLite knowledge graph | 6.8× average, up to 49× | Persistent incremental graph. 739K → 15K tokens on one monorepo. |
| **RTK (Rust Token Killer)** | CLI proxy, text-level compression | 60-90% on shell output | Different approach — text-level not structural. Intercepts Bash output and strips redundant comments, whitespace, duplicate lines. Complementary to Context-Slasher but solves a different problem. |
| **AST MCP Server** (angrysky56) | AST + Abstract Semantic Graphs via MCP | Not quantified | Provides code structure and semantic analysis. More general-purpose than Context-Slasher's focused body-stripping. |
| **Aider** | Tree-sitter retrieval | Not quantified | Shows only function signatures and class declarations, not full implementations. Similar philosophy. |
| **cocoindex-code** | AST-based semantic code search | 70% | Parses code into ASTs with tree-sitter, creates semantic embeddings. |
| **Claude Code (built-in)** | AST-based chunking + Merkle tree change detection | Not quantified | Primary strategy is AST chunking, with fallback text splitter. |

### 4.3 Adjacent Approaches

**RTK's proxy model** is worth understanding even though it's a different technique: it sits as a middleware between the terminal and Claude Code, intercepting stdout and compressing it. The key insight is that **compression should happen at the tool boundary**, not inside the LLM. Context-Slasher applies this same principle but at the **code file boundary** — it transforms files before they enter context, not after.

**SWE-Pruner's task-aware pruning** introduces a nuance: not all bodies should be stripped. If the task is "fix the bug in the error handler," the error handler's body is critical context. Context-Slasher could potentially support a "keep bodies for these specific symbols" mode — this is an open question.

---

## 5. Design Decisions

### 5.1 Tree-sitter Over LSP — Settled

The Gemini Notes mention LSP as an alternative. Research confirms Tree-sitter is the standard. LSP would require spawning and managing language server processes, adds IPC overhead, and each server has different capabilities for structural extraction. Tree-sitter is deterministic, fast, and easy to distribute.

### 5.2 Single-File vs Batch Mode

The Gemini Notes and TOOL_SPECS define two tools:
- `context_slasher_skeleton` — single file
- `context_slasher_multi` — batch (multiple files or directory glob)

Both are necessary. Single-file for surgical context injection during code generation. Batch for planning-stage architecture overview.

### 5.3 Output Format: Skeleton Text vs Structured JSON

The skeleton text is the primary output (human-readable, directly injectable into LLM context). But structured JSON enables programmatic consumption:

```json
{
  "file": "src/auth/handlers.py",
  "language": "python",
  "original_tokens": 2147,
  "skeleton_tokens": 189,
  "reduction_pct": 91.2,
  "classes": [
    {
      "name": "AuthHandler",
      "bases": ["BaseHandler"],
      "methods": [
        {"name": "authenticate", "params": ["username: str", "password: str"], "returns": "Token | None"},
        {"name": "refresh", "params": ["token: str"], "returns": "Token"}
      ]
    }
  ],
  "functions": [...],
  "imports": ["from typing import Optional", "from .base import BaseHandler"]
}
```

**Decision: Return both.** The text representation goes to the LLM. The JSON metadata enables the orchestrator to make decisions about what to keep/strip.

### 5.4 Docstring Handling

Docstrings are preserved because they are **structural documentation** that the LLM needs. A method signature tells you parameter types; the docstring tells you what the method does. Stripping docstrings would defeat the purpose.

Implementation approach: When a function body is stripped, scan the first statement in the body block. If it's a string literal expression, extract it and preserve it above the stripped body placeholder.

### 5.5 Body Placeholder Format

The stripped body needs a visible marker so the LLM knows something was removed:

**Option 1 — Language-native:**
```python
def authenticate(username: str, password: str) -> Token | None:
    """Authenticate a user and return a token."""
    ...  # body stripped
```

**Option 2 — Explicit marker:**
```python
def authenticate(username: str, password: str) -> Token | None:
    """Authenticate a user and return a token."""
    # [CONTEXT-SLASHER: implementation body removed — 47 lines]
```

**Decision: Option 2.** The LLM needs to know not just that something was removed, but roughly how much. This prevents the model from assuming a trivial implementation.

### 5.6 Cache Strategy

Parse results should be cached by `(filepath, file_hash)` to avoid re-parsing unchanged files. The Gemini Notes specify this. Cache location: `.hermes/cache/ast/` within the workspace.

Invalidation: On file write (detected via mtime or git hook), invalidate the cache entry for that file.

### 5.7 Configurable Aggressiveness

Not all context-slasher operations need the same aggressiveness. Design should support levels:

| Level | Behavior | Use Case |
|-------|----------|----------|
| `signatures_only` | Only method/function signatures + class names. No docstrings. | Quick architecture scan |
| `with_docs` (default) | Signatures + docstrings + type hints. | Standard planning context |
| `keep_public_bodies` | Strip private methods, keep public method bodies. | Focused implementation work |
| `targeted` | Keep bodies for specified symbols, strip everything else. | Bug-fix mode |

### 5.8 Language Support Priority

Based on the ecosystem research and likely use cases:

1. **Python** — Highest priority (Hermes toolset is Python, most common in MCP ecosystem)
2. **TypeScript/JavaScript** — Second priority (web dev, existing TokenSqueezer uses Babel)
3. **Go** — Third (increasingly common in infra tools, MCP servers written in Go)
4. **Rust** — Fourth (growing in systems programming, RTK is in Rust)
5. **Java, C#, Ruby, PHP** — Supported via Tree-sitter grammars on demand

---

## 6. Open Questions

### Q1: Should Context-Slasher be a standalone MCP tool or integrated into TokenSqueezer?

TokenSqueezer already does AST-based token reduction but with a different approach (compression, dead code removal, whitespace stripping). Context-Slasher is a focused tool with a specific output format. They're complementary but distinct.

**Lean: Standalone.** TokenSqueezer reduces tokens within what's being sent. Context-Slasher transforms WHAT gets sent. Different layers of the pipeline.

### Q2: How does Context-Slasher interact with the RepoGraph?

The RepoGraph stores persistent knowledge about the codebase. Could Context-Slasher's skeleton output be an input to RepoGraph indexing? A slashed file gives the RepoGraph exactly what it needs (structural information) without the noise.

**Lean: Yes, make them composable.** `context_slasher_multi` output → `repograph_update` input.

### Q3: What about non-code files that are structurally dense?

JSON schemas, OpenAPI specs, Protocol Buffer definitions, database schemas — these have the same problem (massive files where only the structure matters). Tree-sitter supports JSON and some schema formats.

**Needs investigation.** Could expand Context-Slasher's scope to non-code structured files.

### Q4: How to handle files that are almost entirely interface (e.g., abstract base classes, protocol definitions)?

If a file is 90% signatures already, Context-Slasher provides little benefit. Should the tool detect this and return the file as-is to avoid overhead?

**Lean: Yes, add a "skip if already lean" threshold.** If estimated token reduction < 20%, return original.

### Q5: What's the interaction with token budgets?

TOOL_SPECS mentions a token budget configuration. How does Context-Slasher respect it? If the budget is 500 tokens and the skeleton is 600, does it drop docstrings? Shorten type hints?

**Needs specification.** A tiered fallback: with_docs → signatures_only → class_names_only.

### Q6: Should it strip private methods entirely from the skeleton?

A class with 5 public methods and 20 private helpers has a lot of "interface noise" from private methods. But private helpers often reveal structural patterns useful for understanding the class.

**Lean: Strip by default, keep with `--include-private` flag.**

### Q7: How to handle decorator-heavy code (Python)?

A Python function with 5 decorators (@authenticate, @rate_limit, @cache, etc.) has more decorator tokens than signature tokens. Keep all? Collapse?

**Lean: Keep all decorators.** They define cross-cutting behavior and are part of the interface contract.

### Q8: MCP Tool Registration Pattern

Following the existing TOOL_SPECS pattern, the tool should be registered as:

```json
{
  "name": "context_slasher_skeleton",
  "description": "Strip implementation bodies from a source file, returning structural skeleton (class declarations, method signatures, type hints, docstrings). Reduces token usage by up to 90-95% for heavily implemented modules.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "filepath": {"type": "string", "description": "Absolute or workspace-relative path to source file"},
      "language": {"type": "string", "description": "Language override (auto-detected from extension if omitted)"},
      "level": {"type": "string", "enum": ["signatures_only", "with_docs", "keep_public_bodies", "targeted"], "default": "with_docs"},
      "target_symbols": {"type": "array", "items": {"type": "string"}, "description": "Symbol names to preserve bodies for (only when level=targeted)"},
      "include_private": {"type": "boolean", "default": false},
      "output_format": {"type": "string", "enum": ["text", "json", "both"], "default": "both"}
    },
    "required": ["filepath"]
  }
}
```

---

## 7. Summary & Path Forward

The Context-Slasher concept is well-grounded. The ecosystem has independently converged on the same solution — Tree-sitter AST body-stripping — across multiple tools (mcp-code-context, Repomix, code-review-graph, Aider, Claude Code itself). This validates the Gemini Notes' design instincts.

The implementation path is clear:

1. **Phase 1:** Build `context_slasher_skeleton` with Python tree-sitter bindings, supporting Python and TypeScript initially
2. **Phase 2:** Add `context_slasher_multi` for batch mode, integrate with RepoGraph for persistent skeleton caching
3. **Phase 3:** Add configurable aggressiveness levels, token budget awareness, and targeted symbol preservation

**The key insight from research:** The SWE-Pruner paper's finding that "removing AST-aware structure especially hurts under tighter compression" is the strongest academic validation of this approach. The more you need to compress, the more important structural preservation becomes. Context-Slasher preserves exactly the structure that matters.

---

*End of research synthesis.*
