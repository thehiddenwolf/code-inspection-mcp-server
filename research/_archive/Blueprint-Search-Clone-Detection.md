# Proactive Blueprint Search & Clone Detection — Research Deep-Dive

**Date:** 2026-05-27
**Author:** Spectra (kanban task t_cef02638)
**Source:** `/home/kerwin/KerwinsGeminiNotes/MCP Development Tool Ideas/2. Proactive Blueprint Search & Clone Detection.md`
**Existing spec:** `/home/kerwin/code/hermes-mcp-toolset/TOOL_SPECS.md` §2 (Blueprint Scout)
**Existing implementation:** Hermes MCP Toolset at `/home/kerwin/code/hermes-mcp-toolset/`

---

## 1. The Problem — Precisely

AI coding agents re-implement the same helpers, utilities, and pipelines because they have no temporal anchoring in the workspace. They don't know what exists until they read it, and they don't read what they don't know to look for. The result: duplicated logic, inconsistent implementations, wasted tokens, and subtle behavioral drift between "identical" functions.

**The fix:** Intercept before generation. Make the agent submit its implementation intent, scan the codebase for structurally similar code, and force reuse. Not post-hoc dedup — pre-hoc interception.

---

## 2. Code Clone Classification (The Four Types)

Understanding what you're detecting matters for choosing the right engine.

| Type | Name | Description | Detected By |
|------|------|-------------|-------------|
| Type-1 | Exact Clone | Identical code, maybe whitespace/comments differ | Token-based (any) |
| Type-2 | Renamed Clone | Identical structure, identifiers/variables renamed | Token-based (normalized), Semgrep |
| Type-3 | Near-Miss Clone | Copied with modifications — added/removed/reordered statements | AST-based (CloneDR), advanced token matching |
| Type-4 | Semantic Clone | Different syntax, same functionality | ML/LLM-based, not reliably detected by static tools |

**Implication for Blueprint Scout:** The spec targets Type-2 and Type-3 primarily. Semantic clones (Type-4) require the LLM itself — static tools won't catch them reliably. The existing output schema's `match_type` enum (`exact_clone`, `structural_clone`, `functional_match`, `pattern_match`) maps roughly to these tiers.

---

## 3. Tool Landscape — Head-to-Head

### 3.1 jscpd (npm) — Strongest Contender for the MCP Layer

**URL:** https://github.com/kucherenko/jscpd
**Downloads:** 20M+ on npm
**Languages:** 223+ (JavaScript, Python, Java, Go, Rust, C++, TypeScript, Ruby, and more)

**Why this matters:**
- Has a **native MCP server** (`jscpd-server`) — exposes clone detection as MCP tools directly callable by AI assistants
- Token-based with Rabin-Karp algorithm for sliding-window detection
- Supports Vue SFC, Svelte, Astro, Markdown — tokenizes per-block so `.vue` can match `.ts`
- CLI mode with JSON reporter output for programmatic consumption
- Configurable thresholds (min lines, min tokens, max duplicates)

**Relevance to Blueprint Scout:** Could be an integration target or reference architecture. The existing MCP server means we don't need to build the detection engine from scratch — wrap or extend it.

### 3.2 PMD CPD (Java) — The Spec's Reference Engine

**URL:** https://pmd.github.io/
**Languages:** Java, C++, C, Python, Ruby, JavaScript, TypeScript, Swift, Go, PL/SQL, Apex

**Characteristics:**
- Token-based clone detector with language-aware tokenizers
- Uses normalized token streams + sliding windows
- Catches Type-1 and Type-2 clones well
- **Requires Java runtime** — deployment headache for a Node/Python toolset
- Better at syntactic noise handling than jscpd for Java/C-family

**Fallback strategy (from spec):** Provide pure-Python token comparison when Java is unavailable. jscpd (npm) is actually the better fallback since it's already MCP-aware and language-agnostic.

### 3.3 Semgrep (Python) — Structural Pattern Matcher

**URL:** https://github.com/semgrep/semgrep
**Install:** `pip install semgrep`
**Languages:** 30+ (Python, JS, TS, Go, Java, C, Rust, OCaml, etc.)

**Characteristics:**
- AST-aware pattern matching — understands code structure, not just text
- Can write rules like `$FUNC(...)` to match any function call with target structure
- NOT a clone detector by design — it's a SAST tool. But its pattern engine can be repurposed for structural similarity search
- Pro engine costs money; OSS engine is free and sufficient for this use case
- **Key limitation:** Semgrep does not track code duplication or code smells natively. Using it for clone detection requires writing custom rules for each pattern type you want to catch. This is labor-intensive at scale.

**Place in Blueprint Scout:** Best used for the `search_mode: "semgrep"` path where the user has a specific structural pattern. Not suitable as the default clone-detection engine.

### 3.4 CloneDR (Semantic Designs) — Gold Standard for Type-3

**URL:** https://www.semanticdesigns.com/products/clone/
**Characteristics:**
- Full AST-based clone detection — parses to AST, compares subtrees
- Catches Type-3 (near-miss) clones and some Type-4 (semantic)
- Commercial product, not OSS
- Requires language-specific grammar modules

**Relevance:** Proof that AST-based detection catches things token-based tools miss. The spec's AST fingerprinting approach (via Context-Slasher output + MinHash) is a reasonable OSS approximation of what CloneDR does.

### 3.5 Simian (Commercial) — Legacy Reference

**URL:** https://simian.quandarypeak.com/
Line-based similarity thresholds, multi-language. Commercial and largely superseded by open-source tools. Not worth integrating.

---

## 4. AST Fingerprinting with MinHash/LSH — The Custom Approach

The spec mentions "hash the skeleton output from Context-Slasher, compare via MinHash/LSH for fuzzy matching." Here's how that works:

### 4.1 Pipeline

```
Source code → Tree-sitter AST → Normalize (strip identifiers, types, comments)
→ Generate shingles (n-gram subsequences of the normalized skeleton)
→ MinHash to create compact signature (fixed-size hash vector)
→ LSH to bucket similar signatures into candidate pairs
→ Jaccard similarity on candidates to score matches
```

### 4.2 Why MinHash/LSH and Not Embeddings

| Approach | Pros | Cons |
|----------|------|------|
| MinHash/LSH | Deterministic, fast, no model dependency, tunable threshold | Misses semantic similarity, needs shingle tuning per language |
| Code embeddings (ML) | Catches Type-4, understands semantics | Slow, model dependency, needs GPU for scale, nondeterministic |
| Token-based (jscpd/CPD) | Battle-tested, fast, 223 languages | Type-2 ceiling, misses near-miss clones |

**Recommendation:** Use jscpd/CPD as the primary engine (battle-tested), AST fingerprinting via MinHash/LSH as the secondary pass for near-miss detection, and **don't bother with embeddings** — that's what the LLM itself is for. Let the LLM decide on semantic overlap after the static tools surface structural candidates.

### 4.3 Implementation Sketch (Python)

```python
from tree_sitter import Language, Parser
import hashlib, mmh3  # mmh3 for 32-bit hashes in MinHash

def extract_skeleton(code: str, language: str) -> str:
    """Strip to normalized AST skeleton: function/class signatures + control flow"""
    parser = Parser(Language(language_grammar, language))
    tree = parser.parse(code.encode())
    # Walk AST, collect: func def/class decl/loop/condition nodes
    # Normalize: replace identifiers with placeholders
    # Return normalized skeleton string
    ...

def minhash_signature(skeleton: str, num_hashes: int = 128):
    """Generate MinHash signature from shingled skeleton"""
    shingles = set()
    for i in range(len(skeleton) - 4):
        shingle = skeleton[i:i+4]
        shingles.add(mmh3.hash(shingle, signed=False))
    # MinHash: take min of each hash band
    signatures = []
    for band in range(num_hashes):
        signatures.append(min(shingles))
    return signatures

def lsh_bucket(signature, bands=16, rows=8):
    """LSH: hash each band into a bucket. Candidates share buckets."""
    buckets = {}
    for i in range(bands):
        band_hash = hash(tuple(signature[i*rows:(i+1)*rows]))
        buckets.setdefault(band_hash, []).append(signature)
    return buckets
```

Key dependency: **Tree-sitter** (already a dependency of Context-Slasher), **mmh3** or **datasketch** for MinHash.

---

## 5. Semantic Gap — Where Static Tools Fail and the LLM Must Step In

The biggest risk in Blueprint Scout is **false negatives on Type-4 clones** — code that looks completely different but does the same thing. Examples:

- A Python comprehension `[x*2 for x in items]` vs a `for` loop that builds the same list
- Using `functools.lru_cache` vs implementing manual memoization
- A function that calls a library API vs reimplementing that API logic inline

**Mitigation:** After static tools return results (or return empty), run an optional LLM pass that compares the intent description against the top-N structural candidates. The LLM can catch functional overlap that token/AST tools miss. This should be:
1. **Off by default** (token cost)
2. Gated behind a flag like `enable_semantic_check: bool`
3. Limited to top-K candidate pairs to cap token usage

---

## 6. jscpd MCP Server — Analysis and Integration Path

jscpd ships a standalone MCP server (`jscpd-server`) that:
- Runs against a target codebase
- Exposes tools like `check_duplication(snippet)` and `scan_codebase()`
- Returns structured JSON (file paths, line ranges, similarity scores)
- Works with Claude Desktop, Cursor, and any MCP host

**Integration options for Blueprint Scout:**

| Path | Effort | Pros | Cons |
|------|--------|------|------|
| **Wrap** jscpd MCP server as a subprocess tool | Low | Already works, battle-tested, 223 languages | Dependency on npm, external process management |
| **Reimplement** jscpd logic in Python | High | Zero external dep, unified codebase | Reinventing the wheel, will be worse |
| **Emit** `unknown` result and fall through to AST fingerprinting | Medium | No extra deps, pure Python | Loses token-based detection strength |

**Recommendation:** Wrap jscpd. It's npm-based, 20M+ downloads, actively maintained, already MCP-aware. The hermes-mcp-toolset already has a Node.js runtime if it supports any JS packages. If not, use jscpd's CLI mode with JSON output as a subprocess.

jscpd CLI invocation:
```
jscpd --min-lines 5 --min-tokens 50 --mode strict --output json --path .
```

---

## 7. The Three Engines — When Each Wins

### 7.1 Intent → Engine Mapping

| Agent Intent Signal | Best Engine | Why |
|--------------------|-------------|-----|
| "Implement function to validate email addresses" | jscpd/CPD | Token-based catches exact/renamed validators across files |
| "Add retry logic with exponential backoff" | Semgrep | Structural pattern: any function using try/except+sleep in a loop |
| "Create a data pipeline that filters and transforms" | AST fingerprinting | Near-miss: similar pipeline structures with different column names |
| "Build a dropdown component with search filtering" | All three | Different engines catch different facets |
| "Write a binary search implementation" | jscpd/CPD | Classic Type-2 clone — everyone names variables differently |

### 7.2 Recommended Default Pipeline

```
Receive intent_description
  → jscpd/CPD fast scan (token-based, < 1s per 10K LOC)
    → hits found? → return matches, interrupt plan
  → AST fingerprinting (near-miss, < 2s per 10K LOC)
    → hits found? → return matches, interrupt plan
  → Semgrep (structural patterns, only if rules match intent category)
    → hits found? → return matches, interrupt plan
  → (optional) LLM semantic pass
    → return "no duplicates found"
```

---

## 8. Cache Strategy

Full scans are expensive. The spec mentions maintaining "a local cache of fingerprints keyed by file hash." That means:

- **Key:** `sha256(file_path) + sha256(file_contents)` — invalidate on content change
- **Cache entries:** List of normalized AST skeletons per file, MinHash signatures per function/class
- **Invalidation:** On file modification, recompute only that file's entries
- **Storage:** SQLite is fine for this (single table, < 10K rows for most repos)
- **Trade-off:** Cache hit avoids full re-scan but partial scans (single file) still need MinHash comparisons against the full index

---

## 9. Recommendations for Implementation

### Short-term (v0.1)

1. **Implement `blueprint_scout_search`** as the primary entry point
2. Start with **jscpd CLI** as the detection backend — it's the most bang for buck
3. Add Semgrep as an optional second engine (configurable per-instance)
4. Output format per the existing TOOL_SPECS.md schema

### Medium-term (v0.2)

1. Implement **AST fingerprinting** via Tree-sitter + MinHash/LSH (pure Python, no extra deps beyond Tree-sitter which Context-Slasher already needs)
2. Add **file-hash caching** to avoid rescanning unchanged files
3. Implement `blueprint_scout_analyze_plan` — structured plan decomposition with per-step risk assessment

### Long-term (v0.3)

1. Optional **LLM semantic pass** for Type-4 (semantic clone) detection
2. Implement `blueprint_scout_architectural_patterns` — design pattern recognition
3. Bundle default Semgrep rules for common duplicate-detection patterns
4. Consider wrapping jscpd's MCP server instead of CLI subprocess for cleaner integration

### Key Dependencies

| Dependency | Purpose | Priority |
|-----------|---------|----------|
| `tree-sitter` (Python) | AST parsing for fingerprinting | v0.2 |
| `jscpd` (npm) | Token-based clone detection | v0.1 |
| `semgrep` (pip) | Structural pattern matching | v0.1 (optional) |
| `mmh3` or `datasketch` | MinHash signatures | v0.2 |

---

## 10. Comparison: What Gemini Notes Says vs What Actually Exists

| Gemini Notes (Source) | TOOL_SPECS.md (Spec) | Actual Code | Gap |
|----------------------|---------------------|-------------|-----|
| "Integrates Semgrep trigger" | `blueprint_scout_search` with `search_mode: "semgrep"` | Nothing yet | Full implementation |
| "PMD CPD tokenized analysis" | `blueprint_scout_search` with `search_mode: "cpd"` | Nothing yet | Full implementation |
| "AST fingerprinting" | Hash skeleton via Context-Slasher + MinHash/LSH | Nothing yet | Full implementation |
| Not mentioned | `blueprint_scout_analyze_plan` | Nothing yet | New spec addition (good one) |
| Not mentioned | `blueprint_scout_architectural_patterns` | Nothing yet | New spec addition |
| "Before generation, submit blueprint" | Pipeline described in §2 workflow | Nothing yet | Full implementation |

The pattern-miner package exists but is empty — that's the natural home for Blueprint Scout.

---

## 11. Files

- Source document: `/home/kerwin/KerwinsGeminiNotes/MCP Development Tool Ideas/2. Proactive Blueprint Search & Clone Detection.md`
- Existing spec: `/home/kerwin/code/hermes-mcp-toolset/TOOL_SPECS.md` (lines 171-359)
- Empty package: `/home/kerwin/code/hermes-mcp-toolset/packages/pattern-miner/` — natural home for Blueprint Scout implementation
- This research: `/home/kerwin/code/hermes-mcp-toolset/research/Blueprint-Search-Clone-Detection.md`
