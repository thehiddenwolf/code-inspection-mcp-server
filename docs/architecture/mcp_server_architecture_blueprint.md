# MCP Server Architecture & Hermes Skill Integration Blueprint

**Date:** 2026-05-28  
**Author:** Spectra  
**Status:** Approved / Under Implementation  
**Project:** Hermes MCP Toolset (`/home/kerwin/code/hermes-mcp-toolset/`)

---

## 1. Executive Summary

This document specifies the Model Context Protocol (MCP) server architecture and the Hermes skill integration layer for the **Hermes MCP Toolset**. 

The goal of this toolset is to optimize token efficiency and improve code generation quality through deterministic, AST-based, and relational static analysis tools. By replacing LLM-driven summarization and planning with fast, local, and reproducible computations, we target a **60–95% reduction in context window bloat** and prevent redundant code implementation cycles.

---

## 2. MCP Server Structure

The toolset is organized as a monorepo containing multiple npm workspace packages, building to a single cohesive CLI and a standalone MCP gateway server.

```mermaid
graph TD
    subgraph Client Space
        Hermes["Agent Hermes (Core CLIs/Agent)"]
    end

    subgraph Gateway & Registry
        Gateway["@hermes/mcp-gateway (Stdio/SSE Server)"]
    end

    subgraph Specialist Servers
        Squeezer["@hermes/token-squeezer (Tree-sitter AST Slasher)"]
        RepoGraph["@hermes/repograph (SQLite Entity KB)"]
        Miner["@hermes/pattern-miner (Semgrep Clone Detection)"]
        Router["@hermes/task-router (Complexity Estimation/Routing)"]
    end

    Hermes <-->|MCP Protocol (JSON-RPC 2.0)| Gateway
    Gateway <-->|Local Invocation / Modules| Squeezer
    Gateway <-->|Local Invocation / Modules| RepoGraph
    Gateway <-->|Local Invocation / Modules| Miner
    Gateway <-->|Local Invocation / Modules| Router
```

### 2.1 Transport Options
- **Stdio Transport (Default):** Communicates via standard input/output streams. Ideal for direct local CLI integrations and tool pipelines spawned as sub-processes by Hermes.
- **SSE Transport (Optional):** Streamable HTTP transport using Server-Sent Events (SSE). Enables long-running service topologies and remote integrations where multiple agent client instances access a centralized context server.

### 2.2 Shared Package Configuration
All packages inherit from `@hermes/shared`, which provides:
- Zod schemas for all tool inputs and outputs.
- Logging utilities using `pino`.
- Idempotency key tracking.
- Type definitions for MCP client-server communication.

---

## 3. The 4 Core Tools to be Exposed

Each tool is exposed through standard MCP endpoints under its namespace. The definitions are structured using `@modelcontextprotocol/sdk` v1.x or v2.x and Zod schema validations.

### 3.1 TokenSqueezer (`token_squeezer_squeeze`)
AST-based context reduction returning structural class/method skeletons.
- **Input Schema:**
  - `code` (string, required): Source code to reduce.
  - `language` (enum: `javascript`, `typescript`, `python`, `go`, `jsx`, `tsx`, required).
  - `options` (object, optional):
    - `preserve_comments` (boolean, default: `false`).
    - `preserve_imports` (boolean, default: `true`).
    - `aggressiveness` (enum: `conservative`, `balanced`, `aggressive`, default: `balanced`).
    - `max_tokens` (integer, optional).
- **Output:**
  - `squeezed_code` (string): Reduced code skeleton.
  - `original_tokens` (number).
  - `squeezed_tokens` (number).
  - `reduction_ratio` (number).

### 3.2 PatternMiner (`pattern_miner_scan` / `pattern_miner_find_clones`)
Scans codebases for structural duplicates and anti-patterns.
- **Input Schema (`find_clones`):**
  - `fragment` (string, required): The target code snippet.
  - `language` (enum, required): `javascript`, `typescript`, `python`, etc.
  - `searchPath` (string, required): Directory path.
  - `minConfidence` (number, default: `0.6`).
- **Output:**
  - `clones` (array): List of matching code blocks, locations, and similarity/confidence metrics.

### 3.3 TaskRouter (`task_router_decompose` / `task_router_estimate`)
Calculates cyclomatic complexity, lines of code (LOC) impact, and routes subtasks to appropriate models.
- **Input Schema (`decompose`):**
  - `task_description` (string, required): Prompt/spec of the parent task.
  - `constraints` (object, optional): Cost/time budgets.
- **Output:**
  - `subtasks` (array): Broken down subtasks, each labeled with a recommended LLM tier (`premium` vs. `cheap`) and complexity score.

### 3.4 RepoGraph (`repograph_query` / `repograph_index`)
Relational codebase knowledge graph backed by SQLite (using Codebase-Memory / DeusData parsing backend).
- **Input Schema (`query`):**
  - `query` (string, required): Structured/natural language query.
  - `file_path` (string, optional): Scoping path.
- **Output:**
  - `entities` and `relationships` matching the query scope (e.g. classes, imports, call chains).

---

## 4. Data Flow & Hermes Skill Integration

```
 [LLM Plan / Intent]
         │
         ▼
 [Hermes Skill Runner] ───────────────┐
         │                            │
         │ (1) task_router_decompose()│
         ▼                            ▼
 [Microtasks Graph] ──────────► [Route to cheap / premium models]
         │
         ├─► (2) pattern_miner_find_clones()   --> Detect and prevent duplicates
         ├─► (3) repograph_query()             --> Fetch relational context
         ├─► (4) token_squeezer_squeeze()      --> Compress context file reads
         │
         ▼
 [LLM Code Execution]
         │
         ▼
 [Validation Gate]
         │
         ├─► (5) solid_enforcer_audit()        --> SRP, DIP, LSP checks
         ├─► (6) architecture_shepherd_check() --> Manifest compliance
         │
         ▼
    [Merge / Commit]
```

### 4.1 Hermes Skill Runtime Integration
Hermes runs specialized **Skills** (defined in Python/JS runtime plugins). The integration bridges these skills to the MCP Server:
1. **Interceptor Hooks:** Hermes triggers hook scripts on target events (`before-plan`, `before-read`, `after-edit`).
2. **Context Decoration:** The `token_squeezer` hook intercepts file-read requests initiated by the agent and replaces the payload with the compressed AST skeleton, saving up to 95% of tokens.
3. **Task Orchestration:** The `task_router` runs to determine if the next sub-step can be executed by a fast, local model (e.g., Gemini Flash or Ollama local) rather than the parent premium model.

---

## 5. Error Handling & Protocol Compliance

Strict JSON-RPC 2.0 error handling is implemented across the gateway:
- **Protocol Violations:** Workers must complete executions by calling `kanban_complete` or `kanban_block`. Crashing without calling these results in a critical protocol violation.
- **Standard Error Codes:**
  - `-32700`: Parse error (invalid JSON-RPC).
  - `-32601`: Method not found (invalid tool name).
  - `-32602`: Invalid params (failed Zod validation).
- **Graceful Fallbacks:** If a backend-specific executable fails (e.g., Semgrep binary missing), the server falls back to lighter AST parser checks or regex matching rather than crashing the gateway process.

---

## 6. Deployment Considerations

- **Configuration:** Managed via `.code-inspect-mcp/mcp_config.json` containing default paths, model routing tables, complexity thresholds, and exclusions.
- **Service Management:** The gateway is designed to run either as a user-level background daemon (`systemd --user`) or under `pm2`.
- **Docker Compose:** Provided for team developer deployments to bundle Postgres, Redis, and the MCP Gateway for shared caching.

---

## 7. Proposed Implementation Timeline

| Phase | Milestone | Est. Duration | Status / Tasks |
|-------|-----------|---------------|----------------|
| **Phase 0** | Monorepo and Gateway Stubs | Completed | `mcp-gateway` registered with stubs |
| **Phase 1** | TokenSqueezer Implementation | Completed | AST squeezing operational |
| **Phase 2** | ArchitectureShepherd & RepoGraph | Completed | SQLite adapter and git diff validations |
| **Phase 4** | PatternMiner & TaskRouter | Completed | Semgrep/CPD clone finder + lizards complexity router |
| **Phase 5** | SOLIDEnforcer Implementation | **Current** | Implementation of SRP, DIP, LSP audits |
| **Phase 6** | CLI & Polish | Upcoming | Final developer CLI integration |

---
*Blueprint reviewed and declared ready for core integration.*
