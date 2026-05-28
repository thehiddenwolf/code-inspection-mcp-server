# 03 — Proactive Blueprint Search & Clone Detection: Research Synthesis

## 1. Concept Summary

The core insight is simple but powerful: **LLM coding agents have no memory of your codebase.** They retread the same ground — re-implementing helper functions, utility wrappers, data pipelines, and validation logic that already exist elsewhere. This isn't just wasteful; it introduces drift, inconsistency, and silent bugs.

The proposed solution is a **pre-generation interception layer**: before an agent writes or modifies any code, it must submit its *implementation blueprint* (a textual description of what it plans to build) to a clone detection pipeline. The pipeline scans the existing codebase for structurally or functionally similar code. If the overlap density crosses a threshold, the tool interrupts the agent's workflow and points it to the existing implementation, **forcing code reuse over duplication**.

This isn't a post-hoc linting "hey, you have duplicate code" — it's a **proactive guardrail** positioned at the planning stage, before bytes hit disk.

### Key integration points from the source document:

| Component | Role |
|-----------|------|
| **Semgrep** | Static analysis pattern matching — maps functional intent to structurally similar abstractions in the codebase |
| **PMD CPD** | Tokenized/structural string analysis — cross-references code signatures across directories using Rabin-Karp rolling hash |
| **Workflow Interruption** | If pattern density exceeds threshold, interrupt and redirect to existing implementation |

---

## 2. Technical Approach

### 2.1 Pipeline Architecture

```
Agent Blueprint (text)
        │
        ▼
┌──────────────────┐
│ Intent Extraction │  ← NLP/LLM: extract function signatures,
│  (LLM-assisted)   │    data shapes, algorithmic categories
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Query Generation │  ← Translate intent into Semgrep rules,
│                   │    CPD token queries, AST pattern templates
└──────┬───────────┘
       │
       ▼
┌──────────────────┐     ┌──────────────────┐
│  Semgrep Scan    │     │  CPD Token Scan   │
│ (structural)     │     │ (text/token)      │
└──────┬───────────┘     └──────┬───────────┘
       │                        │
       └────────┬───────────────┘
                │
                ▼
     ┌──────────────────────┐
     │  Overlap Density Calc │
     │  (Jaccard, cosine,    │
     │   or custom metric)   │
     └──────┬───────────────┘
            │
            ▼
     ┌──────────────────────┐
     │  Decision Gate        │
     │  overlap > threshold? │
     │  YES → interrupt      │
     │  NO  → allow writing  │
     └──────────────────────┘
```

### 2.2 Blueprint → Query Translation

The trickiest part. How do you go from "I need a function that reads CSV files, filters rows by date range, and aggregates by category" to a Semgrep rule or CPD query?

**Option A — LLM-as-translator**: Feed the blueprint to an LLM with knowledge of the Semgrep rule DSL and ask it to generate candidate rules. This is fragile and can hallucinate.

**Option B — Template-based**: Maintain a library of known functional archetypes (CSV reader, HTTP client wrapper, config parser, rate limiter, etc.) with pre-built Semgrep/CPD rules. Match the blueprint against archetypes and fire the associated rules.

**Option C — Embedding similarity**: Embed both the blueprint and pre-computed embeddings of code chunks from the codebase. Use vector similarity as a fast first-pass filter, then refine with structural matching. This is the most flexible approach.

### 2.3 Agent Integration Pattern

The MCP tool exposes a single endpoint:

```
check_blueprint(blueprint_text, target_files_or_dirs) → {
    overlap_detected: bool,
    matches: [{file, line_range, similarity_score, snippet}],
    recommendation: "use_existing" | "proceed" | "review"
}
```

The agent calls this **before** starting to write. If `overlap_detected` is true, the agent is expected to inspect the matches and either reuse, extend, or consciously override.

---

## 3. Algorithm Options

### 3.1 Code Clone Detection Taxonomy

The field categorizes clones into four types:

| Type | Description | Example |
|------|-------------|---------|
| **Type-1** | Exact copy (whitespace/comment changes only) | Copied verbatim |
| **Type-2** | Renamed identifiers, types, literals | Same logic, different variable names |
| **Type-3** | Near-miss: statements added/removed/modified | ~70-90% syntactic overlap |
| **Type-4** | Semantic clones: different syntax, same behavior | Iterative vs. recursive implementation of same algorithm |

For blueprint detection, **Types 3 and 4 are the most important** — the agent is unlikely to produce exact copies, but it will frequently re-implement the same *functionality* with different variable names and structure.

### 3.2 Detection Algorithms

#### Token-based (PMD CPD, CCFinder, SourcererCC)

**How it works:**
1. Lex the source code into a token stream (stripping whitespace and comments)
2. Apply a fingerprinting/hashing strategy to sliding windows of tokens
3. Match identical or near-identical token sequences

**PMD CPD** uses the **Rabin-Karp algorithm** with a rolling hash:
- Hash a window of N tokens at each position
- The rolling hash property means you can compute `hash(tokens[i+1:i+1+N])` from `hash(tokens[i:i+N])` in O(1) time
- Identical hashes indicate potential clones
- CPD then does a secondary check to confirm

**CCFinder** uses a **suffix-tree matching** algorithm:
- Transform source into a token sequence
- Build a suffix tree over the entire sequence
- Clone pairs are found as identical substrings in the suffix tree
- More memory-intensive but finds all exact token-sequence clones

**SourcererCC** uses a **bag-of-tokens partial matching**:
- Index code blocks by token multisets
- Use sub-block overlap filtering to find near-miss clones at scale
- Optimized for inter-project repository-scale detection
- Handles Type-3 clones via partial overlap thresholds

**Pros:** Fast, language-agnostic (only needs a lexer), mature tools available.  
**Cons:** Misses Type-4 (semantic) clones entirely. Sensitive to token ordering and renaming.

#### AST-based (DECKARD, ast-grep, Semgrep)

**How it works:**
1. Parse source into an Abstract Syntax Tree (AST)
2. Apply tree matching algorithms — subtree isomorphism, edit distance, or characteristic vector comparison

**DECKARD** approach:
- Extract characteristic vectors from AST subtrees
- Map subtrees to points in Euclidean space (ℝⁿ)
- Use Locality Sensitive Hashing (LSH) to cluster similar subtrees
- Clusters represent clone groups

**Semgrep** approach:
- Parse code using tree-sitter into a generic AST
- Match user-defined pattern templates against the AST
- Uses **metavariables** (placeholders that bind to any subtree) for flexible matching
- The **ellipsis operator** (`...`) matches any sequence of statements — critical for finding structurally similar but not identical code
- Pattern matching is fast because it operates at the AST level, not raw text

**ast-grep** (similar to Semgrep but focused on structural search):
- Uses tree-sitter for parsing
- Pattern-as-code: you write patterns that look like the code you're searching for
- Supports structural find-and-replace (codemods)

**Pros:** Handles Type-2 clones naturally (renamed identifiers don't matter — the AST structure is what matters). Can find Type-3 clones with flexible matching. More robust to formatting differences.  
**Cons:** Language-specific parsers required. More CPU-intensive than token-based. Still misses most Type-4 clones.

#### PDG-based (Program Dependency Graph)

- Build a graph of data and control dependencies
- Compare subgraphs for isomorphism
- Can detect semantic clones (Type-4) — different structures that compute the same thing
- **Extremely expensive** computationally; not practical for proactive interception in an agent workflow

#### ML/Embedding-based (modern approaches)

- CodeBERT, GraphCodeBERT, and other transformer models pre-trained on code
- Generate embeddings for code snippets
- Use cosine similarity to find semantically similar code
- **Toma** (ICSE 2024): token-based ML approach outperforming tree-based detectors
- **SSCD**: BERT-based, targets high recall of Type-3 and Type-4 clones at scale
- **LLM-based clone detection**: GPT-4 few-shot prompting for clone detection — works surprisingly well for Types 1-4 but is slow and expensive per query

**Pros:** Can find Type-4 clones. Language-agnostic if using multilingual models.  
**Cons:** Computationally expensive for pre-indexing large codebases. Embedding models can miss fine-grained structural differences. Not deterministic.

### 3.3 Algorithm Comparison Matrix

| Algorithm | Types Detected | Speed | Language Support | Maturity |
|-----------|---------------|-------|-----------------|----------|
| PMD CPD (Rabin-Karp) | 1, some 2, some 3 | ★★★★★ | 40+ (lexer-based) | Very high |
| CCFinder (suffix tree) | 1, 2 | ★★★★ | 5+ | Moderate |
| SourcererCC (bag-of-tokens) | 1, 2, 3 | ★★★★ | Tokenizer-dependent | High |
| DECKARD (AST vectors + LSH) | 1, 2, 3 | ★★★ | Parser-dependent | Moderate |
| Semgrep (AST patterns) | 2, 3 (with rules) | ★★★★ | 30+ | Very high |
| PDG-based | 1, 2, 3, 4 | ★ | Parser-dependent | Low |
| Embedding (CodeBERT) | 1, 2, 3, 4 | ★★ (index slow, query fast) | Pre-trained languages | Growing |
| LLM few-shot | 1, 2, 3, 4 | ★ (per query) | Any | Experimental |

---

## 4. Implementation Options

### 4.1 Tiered Approach (Recommended)

For a practical, low-latency proactive interception system:

```
Tier 1: Token-based fast filter (PMD CPD)
  └─ Scan changed files + cross-reference the whole repo
  └─ Catch exact/near-exact duplicates in <1s
  └─ If match: short-circuit and return

Tier 2: AST-based structural (Semgrep rules)
  └─ Run targeted rules derived from the blueprint's intent
  └─ Catch structurally similar but renamed code
  └─ ~3-10s depending on codebase size

Tier 3: Embedding similarity (optional, offline pre-indexed)
  └─ Pre-compute embeddings for all code chunks in the repo
  └─ At query time: compute blueprint embedding, cosine search
  └─ Catch semantically similar code
  └─ ~100ms query after offline indexing
```

### 4.2 Semgrep Integration Details

Semgrep is the most practical structural matcher because:

1. **Rich pattern DSL**: Metavariables and ellipsis make it flexible for near-miss matching
2. **30+ language support**: Covers most common stack languages
3. **YAML rule format**: Easy to generate programmatically
4. **Fast**: Benchmarked at 10-100 files/second typically
5. **CI-native**: Already designed for pipeline integration

Example Semgrep rule that matches "function that opens a file and iterates lines":

```yaml
rules:
  - id: file-line-iterator
    pattern: |
      with open($FILE, ...) as $FH:
        for $LINE in $FH:
          ...
    message: "Found existing file line iteration pattern"
    languages: [python]
    severity: INFO
```

The challenge is generating these rules from natural language blueprints. See "Open Questions" below.

### 4.3 PMD CPD Integration

PMD CPD is straightforward to integrate:
- Run as CLI: `pmd cpd --minimum-tokens 75 --files /path/to/codebase`
- Outputs XML with file paths, line ranges, and token counts
- The `--minimum-tokens` flag is critical — sets the floor for what counts as a clone. For blueprint interception, you'd likely want a lower threshold (50 tokens) to catch smaller utility functions

### 4.4 MCP Tool Interface Design

```typescript
interface BlueprintCheckRequest {
  blueprint: string;            // Agent's implementation plan
  target_paths: string[];       // Files/dirs the agent intends to modify
  codebase_root: string;        // Root of the project
  threshold?: {                 // Optional sensitivity controls
    token_similarity?: number;  // 0.0-1.0, default 0.8
    structural_similarity?: number;
    max_results?: number;
  };
}

interface BlueprintCheckResult {
  overlap_detected: boolean;
  matches: Array<{
    file: string;
    line_start: number;
    line_end: number;
    snippet: string;
    match_type: "token" | "structural" | "semantic";
    similarity_score: number;
    recommendation: "reuse" | "extend" | "review";
  }>;
  summary: string;  // Human-readable for the agent
}
```

### 4.5 Archetype Library Strategy

Rather than generating Semgrep rules on-the-fly (brittle), build a library of common functional archetypes and their detection rules:

| Archetype | Semgrep Pattern Signature | CPD Token Signature |
|-----------|--------------------------|---------------------|
| File reader (line-by-line) | `open()` + `for...in` pattern | token stream with open-for-in |
| HTTP GET wrapper | `requests.get()` + error handling | try-except-get pattern |
| Config file parser | `configparser`/`yaml.load` + dict access | parse-to-dict pattern |
| CSV processor | `csv.reader`/`pandas.read_csv` + filter | reader-filter-write pattern |
| Rate limiter | sleep + time tracking + counter | sleep-increment-check pattern |
| Logger setup | `logging.getLogger` + handler config | logger-handler-format pattern |
| CLI arg parser | `argparse.ArgumentParser` + `add_argument` | argparse-add-help pattern |

When an agent submits a blueprint, the LLM maps it to the closest archetype, and the system fires the pre-built detection rules for that archetype family.

---

## 5. Related Research

### 5.1 Foundational Papers

| Paper | Year | Key Contribution |
|-------|------|-----------------|
| Roy & Cordy, "NICAD: Accurate Detection of Near-Miss Intentional Clones" | 2008 | Flexible pretty-printing + code normalization for Type-3 clone detection. Uses TXL source transformation. Two-stage: normalization then text-line comparison. |
| Kamiya et al., "CCFinder: A Multi-Linguistic Token-based Code Clone Detection System" | 2002 | Pioneering token-based clone detection. Suffix-tree matching on lexed token streams. Handles Types 1-2. |
| Jiang et al., "DECKARD: Scalable and Accurate Tree-based Detection of Code Clones" | 2007 | AST subtree characterization vectors + LSH clustering. First scalable AST-based approach. |
| Sajnani et al., "SourcererCC: Scaling Code Clone Detection to Big-Code" | 2016 | Bag-of-tokens partial matching. Index-based for inter-project scale. Handles Type-3 via sub-block overlap. |
| Yueming Wu et al., "Toma" (ICSE 2024) | 2024 | ML token-based clone detector outperforming tree-based approaches. Demonstrates that simple representations + ML can beat complex AST approaches. |

### 5.2 Tools Landscape

| Tool | Algorithm Family | Open Source | Best For |
|------|-----------------|-------------|----------|
| **PMD CPD** | Token-based (Rabin-Karp) | Yes (BSD) | Fast, broad language support, CI integration |
| **Semgrep** | AST pattern matching | Yes (LGPL) | Flexible rule-based structural search, security |
| **ast-grep** | AST structural search | Yes (MIT) | Code-aware grep, codemods, refactoring |
| **CCFinderX** | Token-based (suffix tree) | Yes | Academic clone research, multi-language |
| **NiCad** | Text-based (pretty-printing + normalization) | Yes | High-precision Type-3 clone research |
| **SourcererCC** | Token-based (bag-of-tokens) | Yes | Large-scale inter-project clone detection |
| **DECKARD** | AST-based (vector + LSH) | Yes (research) | AST-based clone clustering |
| **CloneDR** | AST-based | Commercial | Industrial clone detection and management |
| **SonarQube** | Multi-technique | Yes (Community) | Code quality platform with duplication detection |

### 5.3 Design Pattern Detection (adjacent field)

Design pattern detection is related but distinct — it looks for known *named* patterns (Singleton, Factory, Observer) rather than arbitrary clones. Approaches include:
- Graph-based matching on class diagrams
- Machine learning classifiers on code metrics
- Ontology-based pattern recognition
- Supervised learning on AST features

These techniques could be adapted for blueprint matching: instead of matching against "Gang of Four patterns," match against "codebase-specific reuse patterns."

---

## 6. Open Questions

### 6.1 Blueprint-to-Query Translation

This is the hardest unsolved problem. How do you reliably go from natural language intent ("I need a function that batches API calls with exponential backoff") to a structural query that finds existing implementations? Options:

- **LLM translation**: Easy to prototype but unreliable for production. Semgrep rule syntax is precise and LLMs will hallucinate invalid rules.
- **Archetype mapping**: Practical but limited to known patterns. Won't catch novel implementations.
- **Embedding search**: Most flexible but requires pre-indexing and may miss structural nuances.
- **Hybrid**: Embedding for first-pass filtering → Semgrep for structural verification. This is the most promising direction.

### 6.2 Performance Budget

Proactive interception means the check runs **before every agent action**. That's a tight latency budget:

- Target: **<2 seconds** for the entire pipeline
- PMD CPD on a medium codebase (10K files): ~3-10 seconds for a full scan
  - **Mitigation**: Incremental scan — only check files related to the agent's target paths + pre-indexed global signature database
- Embedding search: ~100ms if pre-indexed
  - **Mitigation**: Background re-indexing on file changes

### 6.3 False Positive / False Negative Tradeoffs

- **False positive** (flagging non-duplicate code as duplicate): Annoying, slows the agent down, erodes trust in the tool
- **False negative** (missing actual duplicates): The whole reason the tool exists. The agent duplicates code and no one catches it.
- This tool should be **biased toward false positives**. It's better to annoy the agent occasionally than to silently let duplication through. The agent can always say "no, this is different" and proceed.

### 6.4 Language Generalizability

- PMD CPD supports 40+ languages through language-specific tokenizers
- Semgrep supports 30+ languages but requires grammar support
- For a practical MCP tool: start with Python, JavaScript/TypeScript, Go, and Rust. Expand from there.

### 6.5 Codebase Size Scaling

| Codebase Size | Token-based (CPD) | AST-based (Semgrep) | Embedding (pre-indexed) |
|---------------|-------------------|---------------------|------------------------|
| Small (<1K files) | <1s | <3s | <20ms query |
| Medium (1-10K files) | 3-10s | 10-30s | <100ms query |
| Large (10-100K files) | 30s-2min | 1-5min | <500ms query |
| Monorepo (100K+) | 5min+ | 10min+ | <2s query |

For large codebases, **incremental scanning** and **pre-indexing** are mandatory. A full scan on every agent action won't work.

### 6.6 What Counts as "Too Similar"?

The threshold for interrupting the agent needs careful calibration. Options:

- **Token overlap ratio** (Jaccard similarity of token multisets): >70% → interrupt
- **AST subtree similarity** (tree edit distance): <30% edit distance → interrupt
- **Embedding cosine similarity**: >0.85 → interrupt
- **Multi-factor**: Weighted combination of all three

This should be tunable per project. A tightly controlled codebase may want 60% threshold; a prototype may want 90%.

### 6.7 Agent Compliance / UX

The tool can *detect* overlap, but can it *enforce* reuse? In an MCP context, the tool returns a signal. But the calling agent (Claude, GPT, etc.) decides whether to honor it. The tool's influence depends on:
- How well the result is presented (clear file paths, snippets, "use this instead" language)
- Whether the agent system prompt includes instructions to obey the tool
- The agent's own judgment about whether the match is genuinely relevant

This is an **architectural trust problem**, not a pure engineering one.

---

## 7. Key Takeaways for Implementation

1. **Start with the tiered approach**: PMD CPD (fast token filter) + Semgrep (structural) + optional embedding index
2. **Build the archetype library first**: Before tackling generalized blueprint-to-query translation, build a solid set of pre-baked detection rules for common patterns
3. **Bias toward false positives**: The cost of a missed duplicate is higher than the cost of an unnecessary interruption
4. **Pre-index the embedding space offline**: Don't try to compute embeddings at query time
5. **Expose a simple MCP interface**: `check_blueprint(text, paths)` → `{overlap, matches}`
6. **Make the threshold configurable**: Different projects, different tolerances
7. **The hardest part is blueprint-to-query, not clone detection itself**: Clone detection is a mature field. Translating natural language intent into structural queries is the open research problem.
