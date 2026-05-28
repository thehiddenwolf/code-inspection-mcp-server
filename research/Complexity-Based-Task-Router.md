# Complexity-Based Task Router — Deep Research

**Date:** 2026-05-27
**Author:** Spectra (research dispatch)
**Source doc:** `/home/kerwin/KerwinsGeminiNotes/MCP Development Tool Ideas/3. Complexity-Based Task Router.md`

---

## 1. Executive Summary

The core proposal is elegant: route code-generation subtasks to different LLMs based on deterministic, pre-execution code complexity metrics (cyclomatic complexity, LOC impact, dependency density). This avoids paying flagship-model prices for boilerplate work while avoiding the "fix-up tax" of using models too weak for hard problems.

The existing ecosystem confirms the direction is viable. RouteLLM, MESS+, LLMRouterBench, cascade routing, and NadirClaw all attack the same fundamental problem from different angles. **What's missing from the open-source landscape is a router that uses static code analysis metrics as its routing signal** — most existing routers use prompt embedding similarity, confidence scores from the weaker model, or learned preference data. That gap is where this project slots in.

---

## 2. Existing Routing Frameworks

### 2.1 RouteLLM (UC Berkeley Sky Computing Lab, 2024)

**Paper:** https://arxiv.org/abs/2406.18665
**Code:** https://github.com/lm-sys/RouteLLM

The most mature open-source LLM router. Routes between a strong (expensive) and weak (cheap) model pair based on the query itself.

**Four router architectures tested:**
1. **Similarity-Weighted Ranking** — Embed the incoming query, find k most similar queries in a labeled preference dataset, then take a weighted Elo vote of which model won those similar queries. No training needed, just embeddings + precomputed Elo scores.
2. **Matrix Factorization** — Factor a query×model preference matrix into latent embeddings. Route by computing query embedding against learned model embeddings. Requires training on preference data.
3. **BERT Classifier** — Fine-tune a BERT model to directly classify whether a query should go to the strong or weak model.
4. **Causal LLM Classifier** — Same idea but with a causal LM (e.g., Llama) as the classifier.

**Key insight:** Simpler IS better. Similarity-weighted ranking (zero training) performed competitively with the trained approaches. The router itself is a small model or embedding matcher — NOT an LLM call.

**Cost threshold mechanism:** A scalar α per-request controls the cost-quality tradeoff. Higher α means more queries go to the cheap model; lower α prioritizes quality. This lets you tune for budget or accuracy per use case.

**Limitations relevant here:**
- Only works with 2-model routing (strong/weak). No n-tier model levels.
- Router signal is based on query text embeddings + historical preference data. No code-level complexity measurement.
- Needs a pre-labeled preference dataset (Chatbot Arena conversations) to bootstrap.

### 2.2 MESS+ (NeurIPS 2025)

**Paper:** https://arxiv.org/abs/2505.19947

Stochastic optimization approach to LLM routing in "model zoos" (many candidate models). Uses Lyapunov optimization to maintain a virtual queue tracking SLA-defined accuracy debt.

**Key properties:**
- Guarantees SLA compliance (minimum request satisfaction rate over time)
- Minimizes operating costs under quality constraints
- Supports n-model zoos, not just 2-model pairs
- Online learning — adapts to changing query distributions

**Relevance:** If the router needs to operate across many models (not just cheap/expensive binary), MESS+ provides the optimization framework for cost-optimal selection with guarantees.

### 2.3 LLMRouterBench (arXiv 2026)

**Paper:** https://arxiv.org/abs/2601.07206

Large-scale benchmark and unified framework. 400K+ instances across 21 datasets and 33 models. 10 representative routing baselines.

**Contributions:**
- Standardized evaluation protocol with both performance-only and cost-performance metrics
- Finds that task-specific routing (fine-tuned per domain) significantly outperforms general-purpose routers
- Best overall: Mixture-of-experts style routers that learn per-domain model rankings

**Takeaway:** Domain-specific routing (code vs chat vs math) matters. A router optimized for code generation will look different from a general-purpose one.

### 2.4 Cascade Routing (Dekoninck et al., ICML 2025)

**Paper:** https://arxiv.org/abs/2410.10347

Unified framework treating routing (select one model upfront) and cascading (try cheap, escalate if confidence low) as two ends of a spectrum.

**Architecture:**
1. Send query to cheapest model first
2. Extract confidence score from the weak model's output (logprobs, self-consistency, or a learned verifier)
3. If confidence < threshold, escalate to the next tier model
4. Repeat until either confidence >= threshold or the strongest model is reached

**Key finding:** Cascading beats pure routing on the cost-quality Pareto frontier for most setups. The "try cheap first, escalate on need" pattern captures more of the easy cases than upfront routing decisions.

**For our use case:** A code-generation cascade could: try a local 7B model first → if it fails tests or has low confidence → escalate to a mid-tier model → then to frontier. Each escalation is triggered by a concrete signal (test failure, code review rejection, complexity mismatch).

### 2.5 "RouterBench" — kNN Beats Complex Routers (arXiv 2026)

**Paper:** https://arxiv.org/abs/2505.12601

Provocative finding: a well-tuned k-Nearest Neighbors approach (embed query, lookup nearest labeled queries in a reference dataset) matches or outperforms deep learned routers while being far simpler.

**Why it matters:** Supports RouteLLM's finding that similarity-weighted approaches are surprisingly effective. The complexity isn't in the router architecture but in the quality of the embedding space and the reference dataset.

### 2.6 NadirClaw (2026)

**Code:** https://github.com/RashdAssad/Save-money-LLM-NadirClaw

Practical open-source proxy that routes between Gemini Flash (cheap) and Gemini Pro (expensive). Uses centroid vectors in embedding space — classifies prompts as "simple" or "complex" based on distance to precomputed centroids.

**Key details:**
- Runs as an OpenAI-compatible local proxy (port 8856)
- ~10ms classification latency per request
- Auto-fallback: if primary model hits 429, retries once then falls back to other tier
- Zero-config for simple use cases

**Relevance:** Proves the pattern works in production. NadirClaw's approach of local embedding classification is a good baseline to compare against a code-metric-based router.

---

## 3. Complexity Estimation Approaches

### 3.1 Static Code Metrics (The Source Doc's Proposal)

The source document proposes using deterministic code metrics assessed BEFORE the code is written — predicting complexity based on the task description rather than measuring existing code.

**Challenges:**
- Cyclomatic complexity, LOC, and dependency density are measured on EXISTING code. Predicting them before code exists requires either:
  - **(a) Estimation via task description analysis** — embedding the task spec and regressing against historical complexity scores of similar tasks (akin to story point estimation in agile)
  - **(b) Plan-first decomposition** — architect model produces a high-level plan with estimated file touches, import chains, and branching factors. These become the complexity features.
  - **(c) Template matching** — classify the task type (e.g., "add unit test for existing function" vs "design new API endpoint") against a predefined complexity map. Each template has a known complexity profile.

### 3.2 Agentic Task Complexity Estimation (Tianpan, 2026)

**Blog:** https://tianpan.co/blog/2026-04-16-agentic-task-complexity-estimation

A production-oriented approach with four components:

1. **Tiered routing** — Predefine model tiers (local/mid/frontier) with cost ceilings per tier
2. **Budget-tracker injection** — Inject a token budget into the agent's context that it can see and manage, with a hard cut-off
3. **Plan template caching** — Store complexity profiles of previously completed tasks; new tasks are matched against known profiles
4. **DAG-based decomposition** — Break the task into a dependency graph; complexity = sum of sub-task complexities with coordination overhead

**Key insight:** "Budget tokens before you execute." The complexity estimation happens at plan time, not at code-analysis time. This aligns perfectly with the source doc's intent.

### 3.3 CodePlan (Microsoft Research, 2024)

Repository-level coding with planning. Each task is decomposed into a dependency graph of file-level edits (2–97 files per task in their eval). The planning step naturally produces a complexity estimate: number of files affected, number of dependencies, number of independent paths through the edit plan.

**Relevance:** If the architect model already produces a plan (as proposed in the source doc's Routing Logic section), that plan IS the complexity signal. No separate estimation step needed.

### 3.4 Complexity-Aware Code Generation (arXiv 2025)

**Paper:** https://arxiv.org/abs/2505.23953

Uses cyclomatic complexity as a feedback signal in a Reflexion-style loop. Key finding: **LLM-generated code has higher cyclomatic complexity per line than human-written code** — LLMs tend to produce more convoluted branching even for simple tasks.

**Implication for routing:** If the weak model generates code that scores high on complexity metrics, that's a signal to escalate (either ask the strong model for a rewrite or route the task there next time). The metrics act as both a routing signal AND a quality gate.

---

## 4. Agent Dispatch Logic Patterns

### 4.1 Static Tier Assignment

Simple: map task types to fixed model tiers.

```
Task type                  → Model tier
Unit test generation       → Local 7B (e.g., DeepSeek Coder 6.7B)
Simple CRUD endpoint       → Local 7B
Data schema definition     → Mid (e.g., Qwen 32B / Yi 34B)
Complex business logic     → Frontier (e.g., Claude Sonnet / GPT-4o)
Architecture/planning      → Frontier
```

**Pros:** Simple, deterministic, no runtime overhead.
**Cons:** Inflexible — doesn't adapt to actual task difficulty, wastes frontier on simple tasks that happen to be in a "complex" category.

### 4.2 Embedding-Based Routing (RouteLLM-style)

Embed the task description and route based on similarity to known tasks with measured complexity. No code metrics needed, just task text.

**Router function:** `route(task_text) = model_tier[argmin(distance(embed(task_text), embed(exemplar_tasks)))]`

**Pros:** Captures semantic complexity. No static analysis required.
**Cons:** Requires a labeled exemplar dataset. Doesn't use any actual code structure signal.

### 4.3 Cascade Deferral (Code Awareness)

Try the weakest model first. If its output fails code review (test failure, high cyclomatic complexity, lint errors, or a learned verifier rejects it), escalate to the next tier.

```
Cheap model generates code
  → Run tests + static analysis
  → If tests pass AND complexity metrics in acceptable range → DONE
  → Else → escalate to mid-tier model for fix-up
    → Same gates
    → If still failing → escalate to frontier
```

**Pros:** Self-correcting. Wastes only cheap-model tokens on the first attempt.
**Cons:** Latency on failures (sequential). If the cheap model fails often on simple tasks, the retry tax eats the savings.

### 3.4 Metric-Gated Routing (The Hybrid)

Combines plan-time estimation with execution-time verification.

1. **Plan phase:** Architect model decomposes feature into subtasks. Each subtask gets a complexity score based on plan properties (files touched, import chains, branch count).
2. **Dispatch phase:** Complexity score → initial model tier assignment via lookup table or learned regression.
3. **Execution phase:** After generation, verify outputs against complexity metrics. If actual complexity significantly exceeds prediction, escalate the FIX-UP to a higher tier.
4. **Feedback phase:** Store (task_embedding, predicted_complexity, actual_complexity, model_tier_used, pass/fail) to improve future routing decisions.

This matches the source document's intuition about "screw ups cost tokens" — the verification loop catches underestimation without paying frontier prices upfront.

---

## 5. Model Cost Data (API.Navy Multipliers)

From the source document:

| Model | Multiplier | Relative to DeepSeek V4 Pro |
|---|---|---|
| Ernie 5.1 | 1.5 | 0.71× |
| DeepSeek V4 Pro | 2.1 | 1.00× (baseline) |
| Kimi K2.6 | 2.8 | 1.33× |
| Claude Sonnet 4.6 | 12.0 | 5.71× |
| Claude Opus | 20.0 | 9.52× |

The spread is enormous — **13× between the cheapest and most expensive models listed.** If a router can push even 30% of code-generation tasks to the cheap end without quality loss, the savings are substantial.

For local inference (no API cost), the tradeoff shifts to: latency vs quality vs context window. Local 7B models are essentially free to run but have limited reasoning ability and context size.

---

## 6. Recommended Architecture

Based on the research, here's the architecture that makes sense for an MCP-native Complexity-Based Task Router:

### Components

1. **Task Analyzer** (small model or embedding classifier)
   - Takes a subtask description + code context
   - Outputs: task type (boilerplate/new-feature/refactor/architecture), estimated files touched, estimated dependency count, estimated cyclomatic complexity range
   - Uses a lightweight classifier (BERT-size or even a decision tree over hand-crafted features)

2. **Router Decision Engine**
   - Takes complexity estimates + current cost threshold
   - Outputs: initial model tier assignment (local / mid / frontier)
   - Simple threshold-based with hysteresis (to avoid thrashing between tiers)
   - Optionally learns from feedback to adjust thresholds

3. **Code Metric Verifier**
   - After generation, runs static analysis on the output
   - Compares actual vs predicted complexity
   - Flags for escalation if metrics exceed thresholds
   - Uses tools like `radon` (Python), `lizard` (multi-language), or language-specific linters

4. **Feedback Loop**
   - Logs (task, predicted_complexity, model_tier, actual_complexity, pass/fail, token_cost)
   - Periodically retrains the routing thresholds
   - Detects model drift (a model that used to handle X complexity but no longer does)

### Integration into Hermes/MCP

The router would sit in the **orchestration layer** — after the planner decomposes a task but before dispatching to a code generation agent:

```
User request
  → Planner (frontier model) decomposes into subtasks
    → Task Router assigns model tiers per subtask
      → Executors (assigned models) generate code per tier
        → Verifier checks outputs
          → Escalation loop if needed
            → Assembler merges results
```

Each "executor" is just an MCP tool call with a `model` parameter override. The router doesn't need to be a separate server — it's a decision function called between the planner and the executors.

### Key Design Decisions

1. **Pre-deployment estimation vs post-generation measurement:** Do both. Estimate upfront for initial routing, measure post-generation for verification and feedback. The estimation doesn't need to be perfect — it just needs to be "close enough" to pick the right tier for the first attempt.

2. **n-tier vs binary routing:** Start with 3 tiers (local/mid/frontier). The API.Navy data shows enough price granularity to justify more than 2. MESS+ provides the mathematical framework for optimal n-tier routing with SLA guarantees.

3. **Cold start problem:** Without historical data, use template matching (classify task type → assign predetermined tier). The feedback loop populates the database over time.

4. **Escalation strategy:** Use cascade deferral — try weak first, escalate on failure. This is mathematically guaranteed to be cost-optimal (Dekoninck et al., 2024) because the weak model's attempt is never wasted if it succeeds.

---

## 7. Gaps & Open Questions

1. **How to estimate cyclomatic complexity before code exists?** The strongest approach is plan-based: the architect's decomposition plan already implies branching, file touches, and dependencies. A linear regression over these plan features might work well enough.

2. **What signals should trigger escalation?** Test pass/fail? Static analysis scores? A learned verifier? The cascade routing literature suggests confidence scores from the generating model (logprobs), but for code generation, **concrete signals (tests pass, lint passes, complexity scores)** are more reliable than the model's own confidence estimate.

3. **How does this compose with existing model routing (Hermes' provider selection)?** The Hermes config already has provider routing per model. This router would be a higher-level decision — which model to use at all — before Hermes' provider-level routing kicks in.

4. **Token budget integration:** The router should communicate the token budget to the executor model so it can self-regulate (Tianpan's budget tracker). A model that knows it has only 2K output tokens will behave differently than one expecting 16K.

5. **Open-source baseline comparison:** NadirClaw is the closest existing implementation (local embedding classification → binary tier routing). A code-metric-based router should be benchmarked against it on a code-generation task set to validate the approach.

---

## 8. References

1. RouteLLM — https://arxiv.org/abs/2406.18665 (2024)
2. MESS+ — https://arxiv.org/abs/2505.19947 (NeurIPS 2025)
3. LLMRouterBench — https://arxiv.org/abs/2601.07206 (2026)
4. Unified Routing & Cascading — https://arxiv.org/abs/2410.10347 (ICML 2025)
5. kNN Beats Complex Routers — https://arxiv.org/abs/2505.12601 (2026)
6. NadirClaw — https://github.com/RashdAssad/Save-money-LLM-NadirClaw (2026)
7. Complexity-Aware Code Generation — https://arxiv.org/abs/2505.23953 (2025)
8. Agentic Task Complexity Estimation — https://tianpan.co/blog/2026-04-16-agentic-task-complexity-estimation
9. CodePlan — Microsoft Research, 2024
10. Dynamic Model Routing & Cascading Survey — https://arxiv.org/html/2603.04445v1 (2026)
