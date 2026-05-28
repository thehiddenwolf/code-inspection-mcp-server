# Hermes MCP Toolset — Architecture Blueprint

**Date:** 2026-05-27  
**Status:** Architecture v1 — draft  
**Scope:** Open-source JavaScript MCP Server providing code analysis tools for AI coding assistants. Standalone MCP protocol servers that can optionally integrate into larger agent orchestration systems.

---

## Table of Contents

1. [Overview](#1-overview)
2. [The Three Pillars](#2-the-three-pillars)
4. [Microservice Architecture](#4-microservice-architecture)
5. [Data Flow](#5-data-flow)
6. [Project Directory Structure](#6-project-directory-structure)
7. [Service Contracts](#7-service-contracts)
8. [Phased Delivery](#8-phased-delivery)
9. [Docker Compose Topology](#9-docker-compose-topology)
10. [Integration Points](#10-integration-points)
11. [Open Questions](#11-open-questions)

---

## 1) Overview

The Hermes MCP Toolset is an open-source **Model Context Protocol (MCP)** server that gives AI coding assistants three superpowers:

| Tool | Purpose | Impact |
|------|---------|--------|
| **TokenSqueezer** | AST-based context reduction | 60–90% token savings on code files |
| **ArchitectureShepherd** | ARCHITECTURE.md compliance enforcement | Structural drift detection in CI/IDE |
| **PatternMiner** | Code archaeology / anti-pattern / dead code detection | Technical debt discovery |

These tools are **MCP-native** — they speak the Model Context Protocol so any MCP-compatible AI assistant (Claude Code, Cursor, Windsurf, etc.) can call them directly.


---

## 2) The Three Pillars

### 2.1 TokenSqueezer

**What it does:**  
Parses source code into an AST, then strips non-essential nodes (whitespace, comments, unused imports, dead branches, type annotations in non-TypeScript) while preserving structural integrity. The output is a "skeleton" of the code — enough for an LLM to understand structure but at 10–40% of original token count.

**MCP tool signature:**
```
token_squeezer_squeeze(code: string, language: string, options?: SqueezeOptions) -> SqueezedResult
```

**SqueezeOptions:**
- `preserve_comments: boolean` — keep JSDoc/docstring comments
- `preserve_imports: boolean` — keep import/require statements
- `aggressiveness: 'conservative' | 'balanced' | 'aggressive'` — controls what gets stripped
- `max_tokens: number` — target token budget (squeeze until under this)

**SqueezedResult:**
- `squeezed_code: string` — the reduced code
- `original_tokens: number`
- `squeezed_tokens: number`
- `reduction_ratio: number`
- `stripped_nodes: string[]` — list of what was removed (for transparency)
- `ast_metadata: object`

**Languages supported (v1):** JavaScript, TypeScript, Python, JSX/TSX  
**Languages (roadmap):** Go, Rust, Java, Ruby, C/C++, SQL

**AST strategy per language:**
- **JS/TS/JSX/TSX:** Use `@babel/parser` + custom traversal. Strip whitespace tokens, comments, dead branches (if-else with constant conditions), and type annotations.
- **Python:** Use tree-sitter Python grammar. Strip docstrings (unless preserved), comments, type hints.
- **Go/Rust/Java:** Tree-sitter grammars for each.

### 2.2 ArchitectureShepherd

**What it does:**  
Reads an `ARCHITECTURE.md` (or equivalent) file that defines project structure rules, then analyzes code changes (diffs) against those rules. Flags violations as MCP tool results. Can run in CI (git hooks, GitHub Actions) or interactively in the IDE.

**MCP tool signatures:**
```
architecture_shepherd_load_manifest(path?: string) -> Manifest
  // Parses an ARCHITECTURE.md into a structured manifest of rules

architecture_shepherd_check(paths: string[], manifest_id: string) -> Violation[]
  // Checks listed files against the loaded manifest

architecture_shepherd_check_diff(diff: string, manifest_id: string) -> Violation[]
  // Checks a git diff against the manifest (for CI/PR review)

architecture_shepherd.suggest_manifest(path: string) -> ManifestSuggestion
  // Analyzes a codebase and suggests an ARCHITECTURE.md manifest
```

**Manifest structure (parsed from ARCHITECTURE.md):**
```json
{
  "project": {
    "name": "string",
    "language": "string",
    "framework": "string"
  },
  "layers": [
    {
      "name": "api-gateway",
      "path_glob": "packages/api-gateway/**",
      "allowed_dependencies": ["shared", "types"],
      "forbidden_dependencies": ["orchestrator", "llm-gateway"],
      "rules": [
        "no direct database access",
        "must validate input schema"
      ]
    }
  ],
  "global_rules": [
    "no circular dependencies between packages",
    "no console.log in production code",
    "max file length: 500 lines"
  ]
}
```

**Violation structure:**
```json
{
  "type": "dependency_violation|layer_boundary|rule_break|style_violation",
  "severity": "error|warning|info",
  "file": "packages/orchestrator/src/handler.ts",
  "line": 42,
  "message": "orchestrator imported llm-gateway directly, but orchestrator's allowed_dependencies are: [shared, types]",
  "rule_id": "ARCH-003",
  "suggestion": "Move llm-gateway interaction behind a port/interface in shared/"
}
```

### 2.3 PatternMiner

**What it does:**  
Code archaeology engine. Scans codebases for known anti-patterns, code smells, and architectural drift patterns. Generates a debt report with locations, severity, and remediation suggestions.

**MCP tool signatures:**
```
pattern_miner_scan(paths: string[], patterns?: PatternFilter) -> ScanReport
  // Scan specified files/directories for all known patterns

pattern_miner_get_pattern_catalog() -> PatternCatalog
  // Return all patterns the miner knows about

pattern_miner_learn_pattern(definition: PatternDefinition) -> PatternId
  // Register a custom anti-pattern (user-defined)
```

**Built-in pattern categories:**

| Category | Examples |
|----------|----------|
| **Architecture Smells** | Circular dependencies, god objects, leaky abstractions, layer violations |
| **JS/TS Anti-patterns** | `any` usage, nested callbacks, mutable exports, forgotten debuggers, magic numbers |
| **Python Anti-patterns** | Bare excepts, mutable default args, global mutation, wildcard imports |
| **Structural** | Deeply nested conditionals (N>4), functions > 100 lines, excessive parameters |
| **Security Smells** | Hardcoded secrets, unsafe eval/exec, dangerous regex patterns |

**ScanReport structure:**
```json
{
  "scan_id": "uuid",
  "timestamp": "iso-8601",
  "files_scanned": 142,
  "total_lines": 28400,
  "findings": [
    {
      "pattern_id": "SEC-001",
      "pattern_name": "hardcoded-secrets",
      "severity": "critical",
      "file": "src/utils/helpers.ts",
      "line": 15,
      "symbol": "apiKey",
      "confidence": 0.95,
      "context_snippet": "const apiKey = 'xoxb-1234567890-1234567890';",
      "suggestion": "Move secret key to configuration or environment variable"
    }
  ],
  "summary": {
    "critical": 0,
    "high": 3,
    "medium": 12,
    "low": 28,
    "total": 43
  }
}
```

---



### 3.1 New Microservices (MCP-specific)

|---------|---------|------------------|
| **`token-squeezer`** | AST parsing, tree traversal, code reduction engine | New tool service |
| **`architecture-shepherd`** | ARCHITECTURE.md manifest parsing, dependency graph analysis, compliance checking | New tool service + policy integration |
| **`pattern-miner`** | Static analysis, pattern matching, dead code detection, debt reporting | New tool service |
| **`mcp-registry`** | Tool discovery, schema registry, version management, capability advertisement | New service (tool metadata) |


|-------------------|------------------|-------------|
| **`api-gateway`** | Ingress for non-MCP calls (REST health, admin, CI webhooks) | Same as existing |
| **`orchestrator`** | Coordinates multi-step MCP workflows (e.g., scan → analyze → report) | Enhanced step types for MCP tools |
| **`policy-engine`** | Governs which MCP tools/patterns are allowed, rate limits, access control | New policy rules for MCP operations |
| **`llm-gateway`** | Routes analysis results through LLM for natural-language summaries | Same — TokenSqueezer results feed into cheaper Tier C models |
| **`tool-broker`** | Tool dispatch, schema validation, execution routing | Registers MCP tools as executable tools |
| **`sandbox-manager`** | Isolated containers for running untrusted code analysis | TokenSqueezer/PatternMiner can run in sandboxed containers |
| **`knowledge-service`** | Stores pattern libraries, debt history, architecture snapshots | Long-term storage for scan results |
| **`event-store`** | Immutable audit log of all MCP tool invocations | Same — MCP actions logged as canonical events |
| **`projection-worker`** | Builds dashboards: debt trends, compliance scores, token savings | MCP-specific projections |

### 3.3 Infrastructure Services

| Service | MCP Role |
|---------|----------|
| **Postgres** | Manifests, pattern definitions, scan history, user config |
| **Redis** | Scan result cache, rate limiting, active session state |
| **Queue (NATS/Redis Streams)** | Async scan jobs, CI webhook processing, batch analysis |
| **Vector Index (pgvector)** | Semantic search for code patterns and architecture violations |
| **Object Store (MinIO)** | Large scan artifacts, AST dumps, diff archives |
| **Observability (OTEL/Grafana)** | MCP tool metrics: invocation count, latency, token savings, violation rates |

---

## 4) Microservice Architecture

### 4.1 Service Dependency Graph

```
                        ┌─────────────┐
                        │  AI Assistant│ (Claude Code, Cursor, etc.)
                        └──────┬──────┘
                               │ MCP Protocol
                               ▼
                    ┌──────────────────────┐
                    │     mcp-gateway      │ ← NEW
                    └──────┬──────────┬────┘
                           │          │
              ┌────────────┘          └────────────┐
              ▼                                     ▼
   ┌──────────────────┐                  ┌──────────────────┐
   │    orchestrator   │                  │   mcp-registry   │ ← NEW
   │ (mission control) │                  │ (tool discovery) │
   └──────┬───────────┘                  └──────────────────┘
          │
          ▼
   ┌──────────────────┐
   │   policy-engine   │ ← gates every MCP action
   └──────┬───────────┘
          │
          ▼
   ┌──────────────────┐
   │   tool-broker     │ ← routes to appropriate service
   └──────┬───────────┘
          │
     ┌────┼────┬──────────────┐
     ▼    ▼    ▼              ▼
  ┌────┐ ┌────┐ ┌──────────┐ ┌────────────┐
  │ TS │ │ AS │ │   PM     │ │ LLM Gateway│
  └──┬─┘ └──┬─┘ └────┬─────┘ └──────┬─────┘
     │      │        │               │
     │      │        │        (results fed back
     │      │        │         through orchestrator)
     ▼      ▼        ▼
  ┌──────────────────────┐
  │   sandbox-manager    │ ← isolates code execution
  └──────────────────────┘

  All services log to:
  ┌─────────────┐   ┌──────────────────┐
  │ event-store  │   │ knowledge-service│
  └─────────────┘   └──────────────────┘
```

### 4.2 Core Data Contracts

#### MCP Tool Invocation Event (Canonical MCP Event)
```json
{
  "event_id": "uuid",
  "timestamp": "iso-8601",
  "source": "mcp-gateway",
  "agent_id": "assistant-xyz",
  "correlation_id": "uuid",
  "mcp_tool": {
    "name": "token_squeezer_squeeze",
    "server": "token-squeezer",
    "version": "0.1.0"
  },
  "input_summary": {
    "files": 1,
    "total_chars": 45200,
    "language": "typescript"
  },
  "policy_check": {
    "decision": "allow",
    "policy_id": "mcp-tools-default"
  }
}
```

#### Tool Result Event
```json
{
  "event_id": "uuid",
  "timestamp": "iso-8601",
  "correlation_id": "uuid",
  "mcp_result": {
    "tool": "token_squeezer_squeeze",
    "status": "success|error|violation",
    "execution_ms": 342,
    "output_summary": {
      "original_tokens": 12400,
      "squeezed_tokens": 3200,
      "reduction_ratio": 0.74
    },
    "sandbox_id": "sb-abc-123"
  }
}
```

#### Architecture Violation Event
```json
{
  "event_id": "uuid",
  "correlation_id": "uuid",
  "tool": "architecture_shepherd_check",
  "violations": [
    {
      "type": "dependency_violation",
      "severity": "error",
      "file": "src/orchestrator/llm-caller.ts",
      "line": 12,
      "rule_id": "ARCH-003"
    }
  ],
  "manifest_id": "manifest-001"
}
```

### 4.3 Service Boundaries (Clean Architecture Rules)

1. **mcp-gateway** depends ONLY on the MCP protocol spec and the canonical event schema. No business logic.
3. **architecture-shepherd** loads manifests + diffs, runs rules. No awareness of orchestrator or LLM.
4. **pattern-miner** runs static analysis only. Never calls any other service directly.
5. **mcp-registry** is a flat-file + DB backed catalog. Pure data service.
6. **Orchestrator** talks to MCP tools ONLY through `tool-broker` — never directly.
7. **Policy-engine** gates MCP actions based on: caller identity, tool name, input size, frequency.
8. **Sandbox-manager** isolates each MCP tool execution in a throwaway container with resource limits.

---

## 5) Data Flow

### 5.1 Interactive Flow (IDE / AI Assistant)

```
1. User asks AI assistant: "Can you optimize this file for context?"

2. AI assistant calls MCP tool:
   token_squeezer_squeeze({ code: "..." , language: "typescript" })

3. mcp-gateway receives MCP request, translates to canonical event
   → publishes to queue

4. orchestrator picks up event, asks policy-engine:
   "Can assistant-xyz call token_squeezer_squeeze with 45KB input?"

5. policy-engine returns: allow (with rate limit: 100 calls/hour)

6. orchestrator dispatches to tool-broker:
   → tool-broker routes to token-squeezer service

7. token-squeezer:
   a. Parses code into AST (@babel/parser)
   b. Traverses AST, applies squeeze rules based on aggressiveness
   c. Generates skeleton code
   d. Returns SqueezedResult

8. tool-broker returns result to orchestrator

9. orchestrator:
   a. Logs to event-store
   b. If token savings > threshold, optionally sends to knowledge-service
   c. Returns result to mcp-gateway

10. mcp-gateway translates back to MCP response → AI assistant
```

### 5.2 CI/CD Flow (GitHub Actions / Pre-commit)

```
1. Git push triggers webhook → api-gateway

2. api-gateway emits CIWebhookReceived event

3. orchestrator creates CI check mission:
   a. Checkout code
   b. Run architecture_shepherd_check_diff(diff, manifest)
   c. Run pattern_miner_scan(changed_files)
   d. Run token_squeezer_squeeze() on changed files (report potential savings)

4. Results collected, summarized by llm-gateway (Tier C model)

5. Summary posted as PR comment / check status

6. All events written to event-store for audit trail
```

### 5.3 Batch Analysis Flow (Scheduled / On-Demand)

```
1. Admin triggers "full codebase audit" via REST API → api-gateway

2. orchestrator creates batch mission with subtasks:
   - Full pattern_miner_scan() across codebase
   - architecture_shepherd_check() on all modules
   - Dead code sweep

3. Queue fans out work to parallel worker instances

4. Results stream into event-store + knowledge-service

5. projection-worker builds debt dashboard

6. Dashboard available at /admin/debt-report
```

---

## 6) Project Directory Structure

```
hermes-mcp-toolset/
│
├── ARCHITECTURE.md                    # ← This file
├── README.md                          # Project overview, quick start
├── LICENSE                            # MIT / Apache 2.0
├── package.json                       # Workspace root (npm workspaces)
├── tsconfig.json                      # Shared TypeScript config
├── .eslintrc.cjs                      # Linting
├── .prettierrc                        # Formatting
├── docker-compose.yml                 # Full MCP toolset stack
├── Makefile                           # Common commands
│
├── packages/
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts              # Server entry
│   │   │   ├── mcp-server.ts         # MCP protocol handler
│   │   │   ├── transport.ts          # Stdio/SSE transport
│   │   │   ├── event-adapter.ts      # Canonical event translation
│   │   │   ├── registry-client.ts    # Talks to mcp-registry
│   │   │   └── types.ts
│   │   └── test/
│   │
│   ├── token-squeezer/               # AST reduction engine
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts              # HTTP/gRPC server entry
│   │   │   ├── squeezer.ts           # Main squeeze orchestrator
│   │   │   ├── parsers/             # Language-specific parsers
│   │   │   │   ├── javascript.ts     # @babel/parser
│   │   │   │   ├── typescript.ts     # @typescript-eslint/parser
│   │   │   │   ├── python.ts         # tree-sitter
│   │   │   │   ├── jsx.tsx
│   │   │   │   └── base.ts           # Parser interface
│   │   │   ├── reducers/            # AST node reduction strategies
│   │   │   │   ├── comments.ts
│   │   │   │   ├── imports.ts
│   │   │   │   ├── branches.ts
│   │   │   │   ├── types.ts
│   │   │   │   └── whitespace.ts
│   │   │   ├── strategies/          # Aggressiveness levels
│   │   │   │   ├── conservative.ts
│   │   │   │   ├── balanced.ts
│   │   │   │   └── aggressive.ts
│   │   │   ├── token-counter.ts     # Token estimation
│   │   │   └── types.ts
│   │   ├── test/
│   │   │   ├── fixtures/            # Sample code files for testing
│   │   │   │   ├── javascript/
│   │   │   │   ├── typescript/
│   │   │   │   └── python/
│   │   │   └── squeezer.test.ts
│   │   └── bench/                   # Performance benchmarks
│   │
│   ├── architecture-shepherd/        # Compliance enforcement
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts              # HTTP/gRPC server entry
│   │   │   ├── manifest.ts           # ARCHITECTURE.md parser
│   │   │   ├── checker.ts            # Main rule engine
│   │   │   ├── rules/               # Rule implementations
│   │   │   │   ├── dependency-rule.ts
│   │   │   │   ├── layer-boundary.ts
│   │   │   │   ├── file-size-rule.ts
│   │   │   │   ├── naming-rule.ts
│   │   │   │   └── custom-rule.ts    # User-definable rules
│   │   │   ├── diff-parser.ts        # Git diff analysis
│   │   │   ├── graph.ts              # Dependency graph builder
│   │   │   ├── suggest.ts            # Manifest suggestion engine
│   │   │   └── types.ts
│   │   └── test/
│   │       ├── fixtures/
│   │       └── checker.test.ts
│   │
│   ├── pattern-miner/                # Code archaeology engine
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts              # HTTP/gRPC server entry
│   │   │   ├── scanner.ts            # Main scan orchestrator
│   │   │   ├── patterns/            # Pattern definitions
│   │   │   │   ├── catalog.ts        # Pattern registry
│   │   │   │   ├── dead-code/
│   │   │   │   │   ├── unused-exports.ts
│   │   │   │   │   ├── unreachable-branches.ts
│   │   │   │   │   └── orphaned-functions.ts
│   │   │   │   ├── anti-patterns/
│   │   │   │   │   ├── js-ts/
│   │   │   │   │   │   ├── any-usage.ts
│   │   │   │   │   │   ├── magic-numbers.ts
│   │   │   │   │   │   └── nested-callbacks.ts
│   │   │   │   │   └── python/
│   │   │   │   │       ├── bare-except.ts
│   │   │   │   │       └── mutable-defaults.ts
│   │   │   │   ├── architecture/
│   │   │   │   │   ├── circular-deps.ts
│   │   │   │   │   ├── god-object.ts
│   │   │   │   │   └── leaky-abstraction.ts
│   │   │   │   └── security/
│   │   │   │       ├── hardcoded-secrets.ts
│   │   │   │       └── unsafe-eval.ts
│   │   │   ├── ast-walker.ts         # Generic AST traversal
│   │   │   ├── reporter.ts           # Report generation
│   │   │   └── types.ts
│   │   └── test/
│   │       ├── fixtures/
│   │       └── scanner.test.ts
│   │
│   ├── mcp-registry/                 # Tool registry & discovery
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── registry.ts           # Tool CRUD
│   │   │   ├── discovery.ts          # Tool discovery endpoint
│   │   │   ├── versioning.ts         # Semver for tool schemas
│   │   │   └── types.ts
│   │   └── test/
│   │
│   └── shared/                       # Shared code across services
│       ├── package.json
│       ├── src/
│       │   ├── schemas/              # Zod/JSON schemas
│       │   │   ├── events.ts
│       │   │   ├── mcp-tools.ts
│       │   │   ├── manifests.ts
│       │   │   ├── patterns.ts
│       │   │   └── violations.ts
│       │   ├── types/                # Shared TypeScript types
│       │   │   ├── events.ts
│       │   │   ├── mcp.ts
│       │   │   ├── tools.ts
│       │   ├── utils/
│       │   │   ├── logging.ts
│       │   │   ├── idempotency.ts
│       │   │   └── retry.ts
│       │   └── index.ts
│       └── test/
│
│   ├── tool-broker-adapter/          # Registers MCP tools in tool-broker
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── tool-registration.ts
│   │       └── schema-mapping.ts
│   │
│   ├── event-store-adapter/          # MCP event logging to event-store
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       └── log-writer.ts
│   │
│   └── policy-adapter/              # MCP policy rules for policy-engine
│       ├── package.json
│       └── src/
│           ├── index.ts
│           └── mcp-policies.ts
│
├── cli/                             # CLI for local development
│   ├── package.json
│   └── src/
│       ├── index.ts                  # CLI entry
│       ├── commands/
│       │   ├── squeeze.ts
│       │   ├── check.ts
│       │   ├── scan.ts
│       │   └── init.ts               # Init ARCHITECTURE.md in a project
│       └── utils/
│
├── tests/
│   ├── unit/                         # Unit tests per package
│   ├── integration/                  # Cross-service integration tests
│   │   ├── token-squeezer-flow.test.ts
│   │   ├── architecture-shepherd-flow.test.ts
│   │   ├── pattern-miner-flow.test.ts
│   │   └── mcp-gateway-flow.test.ts
│   ├── e2e/                          # End-to-end (full stack)
│   │   └── mcp-toolset-e2e.test.ts
│   └── fixtures/                     # Shared test fixtures
│       ├── sample-code/
│       ├── manifests/
│       └── diffs/
│
├── docs/
│   ├── api/                          # MCP tool API documentation
│   │   ├── token-squeezer.md
│   │   ├── architecture-shepherd.md
│   │   └── pattern-miner.md
│   ├── architecture/                 # Architecture docs
│   │   ├── data-flow.md
│   │   └── deployment.md
│   ├── examples/                     # Usage examples
│   │   ├── vscode-setup.md
│   │   ├── cursor-setup.md
│   │   ├── ci-integration.md
│   │   └── custom-patterns.md
│   └── contributing.md
│
└── .github/
    ├── workflows/
    │   ├── ci.yml                    # Test + lint
    │   ├── release.yml               # NPM publish
    │   └── architecture-check.yml    # Self-hosted Shepherd check
    └── CODEOWNERS
```

---

## 7) Service Contracts

### 7.1 mcp-gateway

**Port:** 3100 (HTTP SSE), also stdio transport  
**Protocol:** MCP (Model Context Protocol)  
**Endpoints:**
- `GET /mcp` — SSE transport endpoint
- `POST /mcp` — HTTP transport (streaming responses)
- `GET /health` — Health check
- `GET /tools` — Delegates to mcp-registry for tool listing

**Dependencies:**
- mcp-registry (tool schema discovery)
- queue (publish events for orchestrator)

### 7.2 token-squeezer

**Port:** 3101  
**Protocol:** HTTP/gRPC  
**Endpoints:**
- `POST /squeeze` — Squeeze code
- `GET /health`

**Input:** `{ code: string, language: string, options?: SqueezeOptions }`  
**Output:** `SqueezedResult`  

### 7.3 architecture-shepherd

**Port:** 3102  
**Protocol:** HTTP/gRPC  
**Endpoints:**
- `POST /manifest/load` — Parse and load an ARCHITECTURE.md
- `POST /check` — Check files against manifest
- `POST /check-diff` — Check diff against manifest
- `POST /suggest` — Suggest manifest from codebase
- `GET /health`

### 7.4 pattern-miner

**Port:** 3103  
**Protocol:** HTTP/gRPC  
**Endpoints:**
- `POST /scan` — Scan files for patterns
- `POST /dead-code` — Targeted dead code detection
- `GET /patterns` — List available patterns
- `POST /patterns/learn` — Register custom pattern
- `GET /health`

### 7.5 mcp-registry

**Port:** 3104  
**Protocol:** HTTP  
**Endpoints:**
- `GET /tools` — List all registered MCP tools
- `GET /tools/:name` — Get tool schema
- `POST /tools` — Register a new tool
- `PUT /tools/:name` — Update tool schema
- `DELETE /tools/:name` — Deregister tool
- `GET /health`

---

## 8) Phased Delivery

### Phase 0 — Skeleton (Week 1)
**Stories:**
1. Initialize monorepo with npm workspaces + shared TypeScript config
2. Implement shared schemas (Zod validation for all events + tool I/O)
3. Stand up `mcp-gateway` with MCP protocol handler (stdio transport)
4. Stand up `mcp-registry` with static tool definitions
5. Basic `docker-compose.yml` with these two services + postgres + redis

**Exit criteria:**
- `mcp-gateway` starts and announces itself as an MCP server
- `mcp-gateway` lists 3 tools (stubs) via MCP `tools/list`

### Phase 1 — TokenSqueezer Core (Week 2)
**Stories:**
1. Implement JavaScript/TypeScript parser using `@babel/parser`
2. Implement `comments` reducer
3. Implement `whitespace` reducer
4. Implement `imports` reducer (tree-shakable imports only)
5. Implement `branches` reducer (dead branch elimination)
6. Implement token counter
7. Wire into MCP: `token_squeezer_squeeze()` works end-to-end

**Exit criteria:**
- JS/TS code squeezes 60%+ tokens on real-world files
- MCP server handles concurrent squeeze requests
- Token savings reported accurately

### Phase 2 — ArchitectureShepherd (Week 3)
**Stories:**
1. Implement manifest parser (ARCHITECTURE.md → structured rules)
2. Implement dependency graph builder
3. Implement dependency rule checker
4. Implement layer boundary checker
5. Implement diff parser (git diff → structured changes)
6. Wire into MCP: `architecture_shepherd_check()` and `.checkDiff()` work

**Exit criteria:**
- Can load a real ARCHITECTURE.md and catch layer violations
- CI-ready: accepts git diff as input
- CLI `init` command generates a starter manifest

### Phase 3 — PatternMiner (Week 4)
**Stories:**
1. Implement AST walker (reusable across language parsers)
2. Implement dead code patterns: unused exports, unreachable branches, orphaned functions
3. Implement JS/TS anti-patterns: `any` usage, magic numbers, nested callbacks
4. Implement architecture smells: circular deps, god objects
5. Implement report generator with severity scoring and suggestions
6. Wire into MCP: `pattern_miner_scan()` and `.findDeadCode()` work

**Exit criteria:**
- Scans a real project and finds meaningful issues
- Custom pattern learning works via `learn_pattern()`
- Report is actionable (includes line numbers, context, suggestions)

### Phase 4 — Python Language Support (Week 5)
**Stories:**
1. Integrate tree-sitter Python grammar
2. Implement Python squeezer
3. Implement Python anti-pattern detection (bare excepts, mutable defaults, etc.)
4. Update all three tools to support Python

**Exit criteria:**
- Python code squeezes 60%+
- Python anti-patterns detected
- Cross-language architecture checks work

**Stories:**
2. Implement `event-store-adapter` — logs MCP actions to event-store
3. Implement `policy-adapter` — MCP-specific policy rules in policy-engine
5. Wire `orchestrator` to handle MCP tool missions
6. CI webhook integration (GitHub Actions example)

**Exit criteria:**
- All MCP actions logged in event-store
- Policy-engine can deny specific MCP tools or rate-limit callers

### Phase 6 — Hardening & Observability (Week 7)
**Stories:**
1. Sandbox isolation for code analysis (sandbox-manager integration)
2. Rate limiting and caching (Redis)
3. OpenTelemetry instrumentation for all services
4. Grafana dashboards: invocation rate, latency, token savings, violation trends
5. CLI polish: `--json`, `--output-file`, `--ci-mode`
6. Documentation: API docs, examples, contributing guide

**Exit criteria:**
- Performance benchmarks published
- Dashboards show real-time tool usage
- Sandboxed analysis cannot escape containers

---

## 9) Docker Compose Topology

### 9.1 Standalone Profile (Minimal)
```yaml
services:
  mcp-gateway:
    build: ./packages/mcp-gateway
    ports: ["3100:3100"]
    depends_on: [postgres, redis, mcp-registry]

  token-squeezer:
    build: ./packages/token-squeezer
    ports: ["3101:3101"]

  architecture-shepherd:
    build: ./packages/architecture-shepherd
    ports: ["3102:3102"]

  pattern-miner:
    build: ./packages/pattern-miner
    ports: ["3103:3103"]

  mcp-registry:
    build: ./packages/mcp-registry
    ports: ["3104:3104"]
    depends_on: [postgres]

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: mcp_toolset
    volumes: [pgdata:/var/lib/postgresql/data]

  redis:
    image: redis:7-alpine
```

Extends standalone profile with:
```yaml
services:
  queue:          # NATS or Redis Streams
  vector-index:   # pgvector

  # Integration adapters
  tool-broker-adapter:
    depends_on: [tool-broker, mcp-registry]

  event-store-adapter:
    depends_on: [event-store]

  policy-adapter:
    depends_on: [policy-engine]
```

### 9.3 Network Topology
```
control-plane (internal):
  - mcp-gateway, orchestrator, policy-engine, tool-broker, mcp-registry
  - postgres, redis, queue
  - event-store, projection-worker, knowledge-service

sandbox-network (isolated):
  - token-squeezer workers
  - pattern-miner workers
  - Each execution gets a throwaway container

public-facing:
  - mcp-gateway (MCP protocol)
  - api-gateway (REST/WebSocket for CI, admin)
```

---

## 10) Integration Points

### 10.1 With AI Coding Assistants

| Assistant | Integration Method | Status |
|-----------|-------------------|--------|
| **Claude Code** | MCP stdio transport via `claude.json` | v1 target |
| **Cursor** | MCP server config in `.cursor/mcp.json` | v1 target |
| **Windsurf** | MCP server config | v1 target |
| **Continue.dev** | MCP server config | v1 target |
| **Cline** | MCP server config | v1 target |

**Example MCP config (claude.json / .cursor/mcp.json):**
```json
{
  "mcpServers": {
    "hermes-mcp-toolset": {
      "command": "npx",
      "args": ["@hermes/mcp-toolset"],
      "env": {
        "MCP_TOOLSET_MODE": "standalone"
      }
    }
  }
}
```


| Integration Point | Adapter | Transport |
|-------------------|---------|-----------|
| Tool registration | `tool-broker-adapter` | HTTP/Queue |
| Event logging | `event-store-adapter` | Queue |
| Policy enforcement | `policy-adapter` | HTTP/gRPC |
| LLM summarization | Direct call to `llm-gateway` | HTTP |
| Knowledge storage | Direct call to `knowledge-service` | HTTP/Queue |
| Sandbox isolation | Direct call to `sandbox-manager` | HTTP/gRPC |
| CI webhook | Direct to `api-gateway` | HTTP |

### 10.3 With CI/CD Systems

| System | Integration |
|--------|-------------|
| **GitHub Actions** | `architecture-shepherd` action checks PR diffs |
| **GitLab CI** | Custom job using CLI |
| **Pre-commit hooks** | Local hook runs `pattern-miner` on staged files |
| **VS Code tasks** | On-save triggers `architecture-shepherd` check |

---

## 11) Open Questions

1. **MCP protocol version:** Which MCP spec version to target? Latest stable?
2. **Language support priority:** After JS/TS/Python, what's next? Go seems likely.
3. **Token counting:** Use tiktoken (tokenizer-per-model) or a simpler estimate? Tiktoken is more accurate; estimate is faster.
4. **Sandbox strategy:** Docker-in-Docker for sandbox-manager, or Firecracker microVMs? Docker is simpler for v1.
5. **PatternMiner pattern language:** Custom DSL for user-defined patterns, or just regex? DSL is more powerful but more work. Start with regex + AST predicates.
6. **ArchitectureShepherd manifest format:** YAML vs TOML vs embedded JSON in markdown? Embedded JSON in markdown code blocks is most natural for `ARCHITECTURE.md`.
8. **Self-hosted Shepherd:** Should `architecture-shepherd` be able to check its own ARCHITECTURE.md? Yes — dogfooding.
9. **TokenSqueezer aggressiveness:** Should "aggressive" mode ever produce invalid code? No — AST transformations must always produce syntactically valid output, even if semantically incomplete.
10. **MCP tool streaming:** Some scans (PatternMiner full-codebase) could take minutes. Does MCP support streaming partial results? Need to investigate.

---


| Service | Port |
|---------|------|
| api-gateway | 3000 |
| adapter-web | 3001 |
| adapter-discord | 3002 |
| orchestrator | 3003 |
| policy-engine | 3004 |
| llm-gateway | 3005 |
| tool-broker | 3006 |
| sandbox-manager | 3007 |
| knowledge-service | 3008 |
| event-store | 3009 |
| projection-worker | 3010 |
| **mcp-gateway** (new) | **3100** |
| **token-squeezer** (new) | **3101** |
| **architecture-shepherd** (new) | **3102** |
| **pattern-miner** (new) | **3103** |
| **mcp-registry** (new) | **3104** |

## Appendix B: Tool Comparison Matrix

| Feature | TokenSqueezer | ArchitectureShepherd | PatternMiner |
|---------|--------------|---------------------|-------------|
| **Input** | Source code | ARCHITECTURE.md + code/diff | Source code |
| **Output** | Reduced code | Violation list | Scan report |
| **AST required** | Yes (full parse) | Yes (dependency scan) | Yes (pattern matching) |
| **Languages (v1)** | JS, TS, JSX, TSX | Language-agnostic (import analysis) | JS, TS, Python |
| **CI integration** | Optional (savings report) | Primary use case | Optional (quality gate) |
| **IDE integration** | Primary use case | Secondary | Primary use case |
| **Sandbox recommended** | No (pure computation) | No (file analysis only) | Yes (runs user code) |
| **LLM dependency** | No | No (but enhanced by LLM summaries) | No (but enhanced by LLM) |
| **MCP tools count** | 1 | 4 | 4 |

---

