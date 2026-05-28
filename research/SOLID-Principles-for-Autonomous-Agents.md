# SOLID Principles for Autonomous Agents — Research Synthesis

**Date:** 2026-05-27
**Author:** Spectra (kanban task t_5feb0e0a)
**Source:** `/home/kerwin/KerwinsGeminiNotes/SOLID Coding Principles for Autonomous Agents.md`
**Existing implementation:** Hermes MCP Toolset at `/home/kerwin/code/hermes-mcp-toolset/`

---

## 1. The Problem: Linguistic Alignment vs. Structural Execution

The source document identifies a fundamental gap:

> LLMs are highly adept at explaining architectural concepts such as the SOLID principles. However, when operating autonomously within a sprawling repository, they frequently fail to maintain these principles due to context window fragmentation, lack of global structural awareness, and an optimization bias toward local completion.

This is not a training problem — it's a *context geometry* problem. An LLM agent sees a slice of files, optimizes for the immediate diff, and has no architectural conscience. The source doc proposes moving from **passive guidelines** to **active, deterministic constraints**.

**Key insight repeated across both the Gemini blueprint and this SOLID doc:** The solution is not to train agents to "understand" SOLID better. The solution is to make bad architecture mechanically impossible or immediately rejected.

---

## 2. Three-Tiered Enforcement Architecture

The source document defines three enforcement tiers. Below, each is mapped against the TOOL_SPECS.md SOLID Enforcer tools and the broader Hermes MCP Toolset.

### Tier A — System-Level Environmental Constraints (Preventive)

*Goal: Restrict the agent's environment so bad architecture is mechanically impossible.*

| Principle | Constraint Strategy | MCP Toolset Mapping |
|-----------|-------------------|-------------------|
| **SRP** | Micro-context isolation — supply only the scoped interface + direct implementation file. Strip global orchestrators from context. | `solid_enforcer.scope_context` — restricts file visibility to context-relevant sub-paths. TokenSqueezer's skeleton mode further strips irrelevant global scope. |
| **DIP** | Mandatory constructor injection templates. Agents cannot instantiate concrete dependencies. | `solid_enforcer.di_template` — provides base templates where components accept dependencies via constructor injection, not `new`/instantiation. |
| **OCP** | Abstract base classes pre-wired. Extension points defined before the agent writes implementation code. | ArchitectureShepherd's manifest rules can enforce abstract base class requirements per module. |
| **ISP** | Interface files pre-selected with ≤3 methods per contract. | Not yet tooled — requires convention in manifest rules. |

**Gap:** The source document assumes the *orchestrator* (Hermes profile, planning layer) does the context restriction before the coding agent sees files. This means the SOLID Enforcer's preventive tools (`scope_context`, `di_template`) need to execute *before* the generation step in the orchestration pipeline. The pipeline in TOOL_SPECS.md has them in the right position, but the current implementation status shows these are Phase 3 features — currently unimplemented.

**Recommendation:** Prioritize `scope_context` implementation. It's the highest-leverage preventive tool: one call clips the agent's view to exactly what it needs, preventing SRP violations at the source rather than catching them in audit.

### Tier B — Multi-Agent Evaluation Loop (Evaluative)

*Goal: A dedicated, adversarial review profile checks code against deterministic SOLID criteria before merge.*

The source document specifies a **"SOLID Auditor" persona** — an independent agent optimized purely for architectural critique. The TOOL_SPECS defines this as `solid_enforcer_audit` with deterministic checks:

| SOLID Check | Deterministic Mechanism | Data Source |
|-------------|------------------------|-------------|
| **SRP** | >1 distinct reason for change? Count class/exports per file, measure LOC, analyze import dependencies | AST analysis |
| **OCP** | New feature requires modifying existing logic instead of adding new code? Detect abstract base classes, check diff for modification vs addition ratio | AST diff analysis |
| **LSP** | Subclass modifies behavioral invariants of parent? Compare method signatures, check `@Override`/inheritance patterns against parent class contract | AST class hierarchy comparison |
| **ISP** | Interface has too many methods for its role? Count methods per interface, flag interfaces >3 methods | AST traversal |
| **DIP** | Code instantiates concrete dependencies instead of accepting abstractions? Detect `new`/constructors for non-value objects, flag violations | AST instantiation detection |

**Automated Static Metrics (from source doc):**
- Cyclomatic complexity bounds (reject if exceeded)
- LOC thresholds per file/class
- AST-based structural violation detection

**Key architectural decision:** The SOLID Auditor should be a **separate agent profile** (not the same agent that wrote the code) to avoid confirmation bias. The Hermes Kanban system with `kanban_create` → child task for `solid-auditor` profile → `kanban_block(reason="review-required")` on parent is the natural implementation path for this.

**Gap:** The source doc mentions "rerouting failure patterns into the agent's long-term vector memory." The TOOL_SPECS has `repograph_update` for codebase-level knowledge, but there's no mechanism for *agent-level learning* — i.e., the auditor catches an SRP violation, and the next time the same agent writes code, it produces SRP-compliant code without needing the audit step. This is a **memory feedback loop** that neither doc fully specifies.

**Recommendation:** Add a `solid_enforcer.record_feedback` tool (or extend `repograph_update`) that stores architectural violation patterns keyed by agent profile, so future runs of the same agent can query "what did I get wrong last time?" before writing code.

### Tier C — Operational Translation Layer (Prompt Transformation)

*Goal: Convert abstract SOLID directives into concrete mechanical instructions.*

The source document provides a translation table:

| Abstract Directive | Mechanical Prompt |
|-------------------|------------------|
| "Follow SRP" | "Isolate the logic into two distinct classes in separate files: one for fetching the remote payload, one for mapping payload into schema." |
| "Open for extension, closed for modification" | "Draft an abstract base class specifying the interface contract. Implement default strategy as concrete subclass. Ensure zero changes to orchestration engine when new strategy variant is introduced." |
| "Apply ISP" | "Construct lean interfaces with ≤3 methods. Separate read hooks from mutation sinks. Implement only explicit contracts required for the task." |

The TOOL_SPECS maps this to `solid_enforcer.translate_prompt` — an MCP tool that takes a natural language directive like "make this SOLID-compliant" and returns a structured prompt template with concrete mechanical instructions.

**Implementation approach:** This is essentially a **prompt template engine** backed by a table of known SOLID violation patterns + remedial instructions. It doesn't need an LLM — it can be a deterministic mapping:

```
Input:  {principle: "SRP", context: "class DataService handles both HTTP fetching and data mapping"}
Output: {
  principle: "SRP",
  violation: "class has 2+ responsibilities",
  remediation: [
    "Extract HTTP fetching into separate class (e.g. RemoteDataFetcher)",
    "Extract data mapping into separate class (e.g. DataMapper)",
    "Original DataService becomes orchestration facade or is removed"
  ],
  mechanical_prompt: "Create three files: ...",
  verification: "Run solid_enforcer_audit on the resulting code"
}
```

**Gap:** The source doc's translation table is limited to SRP, OCP, and ISP. There's no coverage for LSP or DIP prompt transformations in the doc. These should be added to `translate_prompt`'s rule table.

---

## 3. SOLID × Agent Autonomy: Beyond Code Quality

The source document is written in the context of *code production* — ensuring LLMs write SOLID-compliant code. But SOLID principles map surprisingly well to *agent architecture and behavior* themselves. This is a dimension neither the source doc nor the TOOL_SPECS addresses.

### SRP for Agents
An agent should have one reason to change its behavior. A "code-reviewer" agent that also does deployment, monitoring, and documentation is an SRP violation waiting to happen. The Hermes Kanban model (specialist profiles per task type) is the correct solution — each profile has a single responsibility.

### OCP for Agent Pipelines
The orchestration pipeline should be extensible without modifying the orchestrator. Adding a new audit tool (e.g., adding Semgrep checking to the SOLID Auditor pipeline) should mean adding a new profile + wiring — not modifying the orchestrator's dispatch logic. The Kanban system's `parents[]` dependency model supports this naturally.

### LSP for Agent Profiles
If you swap in a more powerful agent profile (e.g., GPT-5 where GPT-4 was), the system should behave identically in terms of contracts — same tool signatures, same output format, same state transitions. A "superior" model that breaks the established tool-calling contract is violating LSP.

### ISP for Tool Interfaces
MCP tool definitions should be lean. `solid_enforcer_audit` should expose exactly one method (`audit(code, config) -> Violation[]`) — not a sprawling interface with audit, recommend, explain, visualize, export, and report. Each tool does one thing.

### DIP for Agent Dependencies
Agents should depend on abstractions (MCP tool interfaces), not concrete implementations. The entire Hermes MCP Toolset architecture follows this — tools are defined as MCP protocol interfaces, and any backend can implement them.

---

## 4. Implementation Status: What Exists vs. What's Missing

| Component | Source Document | TOOL_SPECS.md | Implemented | Notes |
|-----------|----------------|---------------|-------------|-------|
| Context restriction (SRP prevention) | Tier A — Micro-context isolation | `solid_enforcer.scope_context` | ❌ Phase 3 | Highest priority — prevents violations at source |
| DI templates (DIP prevention) | Tier A — Mandatory DI layouts | `solid_enforcer.di_template` | ❌ Phase 3 | Requires template engine per language |
| SOLID Auditor (evaluative) | Tier B — Dedicated auditor profile | `solid_enforcer.audit` | ❌ Phase 3 | 5 deterministic checks defined; needs AST backend |
| Prompt translation (operational) | Tier C — Mechanical prompting | `solid_enforcer.translate_prompt` | ❌ Phase 3 | Rule table defined but incomplete (missing LSP/DIP) |
| Automated static metrics | Tier B — Cyclomatic complexity, LOC | Not in TOOL_SPECS | ❌ | Referenced in source doc but not tooled |
| Memory feedback loop | Tier B — "Capture failure patterns into vector memory" | Not in TOOL_SPECS | ❌ | No mechanism for agent-level learning from audits |
| Agent-level SOLID mapping | Not in source doc | Not in TOOL_SPECS | ❌ | New: SRP/OCP/LSP/ISP/DIP map to agent architecture |

---

## 5. Recommendations

### Immediate (Phase 1 Compatible)
1. **Implement `solid_enforcer_audit` first** — it's the evaluative check that closes the loop. Deterministic AST-based checks (SRP via LOC/import count, DIP via `new` detection) can be implemented without external dependencies beyond Tree-sitter.
2. **Expand `translate_prompt` rule table** — add LSP and DIP entries to match the source doc's coverage. The current TOOL_SPECS only implies these; they need explicit prompt templates.

### Short-term (Phase 2)
3. **Implement `scope_context`** — the file-visibility restrictor. It's the highest-leverage preventive tool because it makes SRP violations structurally impossible rather than catching them after the fact.
4. **Implement `di_template`** — per-language DI template engine. Start with TypeScript/JavaScript (constructor injection patterns), then Python (protocol classes), then expand.

### Medium-term (Phase 3)
5. **Add `solid_enforcer.record_feedback`** — or extend `repograph_update` to support architectural violation storage keyed by agent profile. This closes the memory feedback loop.
6. **Add static metrics integration** — radon (cyclomatic complexity) or lizard for JS/TS complexity checking as a pre-audit gate.
7. **Formalize agent-level SOLID mapping** — add a section to ARCHITECTURE.md or TOOL_SPECS.md documenting how SOLID applies to agent profile design, orchestration, and tool interfaces. This is an original insight not present in any source material.

### Architectural
8. **Kanban-native SOLID Auditor pipeline** — define a standard kanban workflow where code-generation tasks automatically spawn a child task assigned to a `solid-auditor` profile. The auditor runs `solid_enforcer_audit`, and if violations are found, blocks the parent with `reason="review-required: SRP violation in src/data/... (score 2.3)"`. This makes the multi-agent evaluation loop self-documenting in the kanban event log.

---

## 6. Cross-References

- Source doc: `/home/kerwin/KerwinsGeminiNotes/SOLID Coding Principles for Autonomous Agents.md`
- TOOL_SPECS.md: `/home/kerwin/code/hermes-mcp-toolset/TOOL_SPECS.md` (lines ~900-1050 for SOLID Enforcer section)
- ARCHITECTURE.md: `/home/kerwin/code/hermes-mcp-toolset/ARCHITECTURE.md`
- Prior synthesis: `/home/kerwin/code/hermes-mcp-toolset/research/MCP-Architecture-Synthesis.md`

---

*End of synthesis — maps the SOLID Principles source document against the existing Hermes MCP Toolset architecture, identifies gaps, and provides prioritized implementation recommendations. Includes original analysis of SOLID × agent autonomy not present in any source material.*
