# Hermes MCP Toolset — Complete Tool Specifications

> **Source Material:** Kerwin's Gemini Notes (MCP Code Architecture and Token Optimization Specification, files 1–4, SOLID Coding Principles for Autonomous Agents, Modular Agentic Architecture Workflow, Agentic Workflows and Token Optimization Guide)
> **Target:** Python/TypeScript standalone MCP server implementing JSON-RPC tools for Agent Hermes ecosystem
> **Date:** 2026-05-27
> **Status:** Draft Specification — Ready for Implementation

---

## Table of Contents

1. [Context-Slasher: Structural Interface Mapping](#1-context-slasher-structural-interface-mapping)
2. [Blueprint Scout: Proactive Clone Detection & Pattern Search](#2-blueprint-scout-proactive-clone-detection--pattern-search)
3. [Task Router: Complexity-Based Model Routing & Task Decomposition](#3-task-router-complexity-based-model-routing--task-decomposition)
4. [RepoGraph: In-Repository Knowledge Graph & Persistent Codebase Memory](#4-repograph-in-repository-knowledge-graph--persistent-codebase-memory)
5. [SOLID Enforcer: 3-Tier Architecture Constraint System](#5-solid-enforcer-3-tier-architecture-constraint-system)
6. [Cross-Cutting Concerns & Integration Patterns](#6-cross-cutting-concerns--integration-patterns)

---

## 1. Context-Slasher: Structural Interface Mapping

### 1.1 Purpose

Dramatically reduce token consumption by returning only structural skeletons of source files (class declarations, method signatures, type hints, docstrings) instead of full file contents. Achieves **90–95% token reduction** for heavily implemented modules.

### 1.2 Engine

- **Primary:** Tree-sitter (Python/Node bindings) for multi-language AST parsing
- **Fallback:** Language Server Protocol (LSP) via pyright/typescript-language-server for languages without Tree-sitter grammars
- **Languages supported initially:** Python, TypeScript/JavaScript, Rust, Go, Java, C++, C#

### 1.3 MCP Tool: `context_slasher_skeleton`

#### Input Schema (JSON-RPC)

```json
{
  "type": "object",
  "required": ["file_path"],
  "properties": {
    "file_path": {
      "type": "string",
      "description": "Absolute or relative path to the target source file"
    },
    "include_docstrings": {
      "type": "boolean",
      "default": true,
      "description": "Include docstrings/comments in the skeleton output"
    },
    "include_type_hints": {
      "type": "boolean",
      "default": true,
      "description": "Include type annotations in method signatures"
    },
    "include_private_members": {
      "type": "boolean",
      "default": false,
      "description": "Include private/protected methods in output"
    },
    "max_depth": {
      "type": "integer",
      "default": 10,
      "description": "Maximum nesting depth for inner classes/functions"
    },
    "output_format": {
      "type": "string",
      "enum": ["compact", "indented", "json"],
      "default": "compact",
      "description": "Output format for the skeleton"
    }
  }
}
```

#### Output Schema

```json
{
  "type": "object",
  "properties": {
    "file_path": {"type": "string"},
    "language": {"type": "string"},
    "token_count": {"type": "integer", "description": "Estimated token count of this skeleton"},
    "original_token_count": {"type": "integer", "description": "Estimated token count of the full file"},
    "reduction_percentage": {"type": "number", "description": "Percentage of token reduction achieved"},
    "skeleton": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": {"type": "string", "enum": ["class", "interface", "function", "method", "enum", "struct"]},
          "name": {"type": "string"},
          "signature": {"type": "string", "description": "Full signature with type hints"},
          "docstring": {"type": "string"},
          "visibility": {"type": "string", "enum": ["public", "private", "protected"]},
          "children": {"type": "array", "items": {"$ref": "#"}},
          "line_start": {"type": "integer"},
          "line_end": {"type": "integer"},
          "decorators": {"type": "array", "items": {"type": "string"}},
          "base_classes": {"type": "array", "items": {"type": "string"}}
        }
      }
    },
    "raw_skeleton_text": {
      "type": "string",
      "description": "Compact text representation for direct injection into LLM context"
    }
  }
}
```

#### Compact Text Format Example

```python
# src/services/payment_processor.py — Skeleton (92% reduction, ~240 tokens vs ~3000)
class PaymentProcessor:
    """Orchestrates payment flow across multiple gateways."""
    def __init__(self, gateway: PaymentGateway, logger: Logger) -> None: ...
    def process_payment(self, amount: Decimal, currency: str, source: PaymentSource) -> PaymentResult: ...
    def refund(self, transaction_id: str, amount: Optional[Decimal] = None) -> RefundResult: ...
    def get_transaction_history(self, user_id: str, limit: int = 50) -> List[Transaction]: ...
    # — class PaymentGateway: ...
    # — class PaymentResult: ...
```

### 1.4 MCP Tool: `context_slasher_multi`

Batch version — processes multiple files in a single call for workspace-level awareness.

#### Input Schema (additional fields)

```json
{
  "type": "object",
  "required": ["paths"],
  "properties": {
    "paths": {
      "type": "array",
      "items": {"type": "string"},
      "description": "List of file paths to skeletonize"
    },
    "recursive": {
      "type": "boolean",
      "default": false,
      "description": "If true, treat paths as directories to recursively scan"
    },
    "glob_pattern": {
      "type": "string",
      "description": "Glob pattern to filter files (e.g., '**/*.py')"
    },
    "max_files": {
      "type": "integer",
      "default": 50,
      "description": "Maximum files to process in one batch"
    }
  }
}
```

### 1.5 Implementation Notes

- Use `tree-sitter` Python bindings (`pip install tree-sitter tree-sitter-[lang]`)
- Cache parsed ASTs per file (keyed by file modification timestamp + path)
- Token estimation: use tiktoken (cl100k_base) for consistent counting
- When Tree-sitter grammar unavailable, fall back to regex-based signature extraction (less accurate but functional)
- Output `raw_skeleton_text` should be formatted for direct injection into system prompts

---

## 2. Blueprint Scout: Proactive Clone Detection & Pattern Search

### 2.1 Purpose

Intercept code duplication **during the planning stage** — before any model generates code. When an agent defines its implementation plan, this tool scans the existing codebase for structurally similar abstractions and surfaces existing code paths, forcing reuse over duplication.

### 2.2 Engine

- **Semgrep** — Structural pattern matching (rules-based and AST-aware)
- **PMD CPD (Copy-Paste Detector)** — Tokenized string analysis across directories
- **AST fingerprinting** — Custom hash-based signature matching for function/class skeletons
- **Optional:** IDE-level static analysis protocols (LSP) for real-time suggestions

### 2.3 MCP Tool: `blueprint_scout_search`

#### Input Schema

```json
{
  "type": "object",
  "required": ["intent_description"],
  "properties": {
    "intent_description": {
      "type": "string",
      "description": "Natural language description of what the agent plans to implement"
    },
    "search_mode": {
      "type": "string",
      "enum": ["semgrep", "cpd", "ast_fingerprint", "all"],
      "default": "all",
      "description": "Detection engine to use"
    },
    "codebase_path": {
      "type": "string",
      "default": ".",
      "description": "Root path of the codebase to scan"
    },
    "include_patterns": {
      "type": "array",
      "items": {"type": "string"},
      "description": "Glob patterns to include (e.g., ['**/*.py', '**/*.ts'])"
    },
    "exclude_patterns": {
      "type": "array",
      "items": {"type": "string"},
      "description": "Glob patterns to exclude (e.g., ['**/node_modules/**', '**/venv/**'])"
    },
    "min_similarity": {
      "type": "number",
      "default": 0.7,
      "minimum": 0.0,
      "maximum": 1.0,
      "description": "Minimum similarity threshold for clone detection"
    },
    "max_results": {
      "type": "integer",
      "default": 10,
      "description": "Maximum matches to return"
    }
  }
}
```

#### Output Schema

```json
{
  "type": "object",
  "properties": {
    "query_summary": {"type": "string"},
    "search_mode_used": {"type": "string"},
    "matches": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "file_path": {"type": "string"},
          "similarity_score": {"type": "number"},
          "match_type": {"type": "string", "enum": ["exact_clone", "structural_clone", "functional_match", "pattern_match"]},
          "matched_lines": {"type": "string", "description": "Line range (e.g., '45-78')"},
          "snippet": {"type": "string", "description": "Preview of the existing code"},
          "signature": {"type": "string", "description": "Function/class signature if applicable"},
          "reason": {"type": "string", "description": "Why this match was found (e.g., 'same method signature + similar body')"}
        }
      }
    },
    "recommendation": {
      "type": "string",
      "description": "Actionable advice: which existing code to reuse and how"
    },
    "has_high_confidence_duplicates": {
      "type": "boolean"
    }
  }
}
```

### 2.4 MCP Tool: `blueprint_scout_analyze_plan`

Takes a step-by-step implementation plan (markdown or structured JSON) and cross-references each step against the codebase.

#### Input Schema

```json
{
  "type": "object",
  "required": ["plan"],
  "properties": {
    "plan": {
      "type": "object",
      "properties": {
        "title": {"type": "string"},
        "steps": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "action": {"type": "string", "description": "What will be implemented"},
              "target_files": {"type": "array", "items": {"type": "string"}},
              "functions_to_create": {"type": "array", "items": {"type": "string"}},
              "key_terms": {"type": "array", "items": {"type": "string"}}
            }
          }
        }
      },
      "description": "Structured implementation plan from the orchestrator agent"
    },
    "codebase_path": {"type": "string", "default": "."}
  }
}
```

#### Output Schema

```json
{
  "type": "object",
  "properties": {
    "plan_steps": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "step_index": {"type": "integer"},
          "action": {"type": "string"},
          "duplication_risk": {"type": "string", "enum": ["high", "medium", "low", "none"]},
          "blocking_matches": {"type": "array", "items": {"type": "object"}},
          "suggested_action": {"type": "string", "enum": ["proceed", "reuse_existing", "refactor_plan"]}
        }
      }
    },
    "overall_duplication_risk": {"type": "string", "enum": ["high", "medium", "low"]},
    "interrupt": {
      "type": "boolean",
      "description": "If true, the orchestrator should halt and handle existing code paths"
    }
  }
}
```

### 2.5 MCP Tool: `blueprint_scout_architectural_patterns`

Scans for high-level architectural patterns, data structures, and design patterns to inform agent decisions.

#### Input Schema

```json
{
  "type": "object",
  "properties": {
    "codebase_path": {"type": "string", "default": "."},
    "pattern_type": {
      "type": "string",
      "enum": ["architectural", "design_pattern", "data_structure", "all"],
      "default": "all"
    },
    "include_patterns": {"type": "array", "items": {"type": "string"}}
  }
}
```

### 2.6 Implementation Notes

- Requires `semgrep` CLI installed (`pip install semgrep`)
- PMD CPD requires Java runtime — provide fallback to pure-Python token comparison
- AST fingerprinting: hash the skeleton output from Context-Slasher, compare via MinHash/LSH for fuzzy matching
- Maintain a local cache of fingerprints keyed by file hash to avoid re-scanning unchanged files
- Semgrep rules: bundle a default set of generic duplicate-detection rules; allow custom rule paths

---

## 3. Task Router: Complexity-Based Model Routing & Task Decomposition

### 3.1 Purpose

Programmatically decompose architectural plans into micro-tasks, estimate each task's complexity using deterministic code metrics, and route tasks to the most cost-effective model. Prevents expensive frontier models from wasting tokens on trivial boilerplate.

### 3.2 Complexity Evaluation Parameters

| Metric | Description | Measurement Method |
|--------|-------------|-------------------|
| **Cyclomatic Complexity** | # of linearly independent paths through code | AST-based counting (McCabe) |
| **Lines of Code (LOC)** | Physical lines affected | Diff-based estimation + file stats |
| **Dependency Density** | # of import chains / external dependencies | AST import analysis |
| **Interface Surface Area** | # of public methods, parameters, return types | From Context-Slasher skeleton |
| **Novelty Score** | How different this is from existing code | Blueprint Scout similarity check |
| **Risk Multiplier** | Whether it touches critical paths (auth, payment, data) | Tag-based from RepoGraph |

### 3.3 Model Cost Multipliers (from source notes)

| Model | Cost Multiplier | Recommended Tier |
|-------|----------------|-----------------|
| Ernie 5.1 | 1.5× | Junior — math/calc tasks |
| DeepSeek V4 Pro | 2.1× | Junior+ — boilerplate, data piping, tests |
| Kimi K2.6 | 2.8× | Mid — standard business logic |
| Claude Sonnet 4.6 | 12× | Senior — complex architecture, multi-file refactors |
| Claude Opus | 20× | Architect — foundational design, novel algorithms |

### 3.4 Complexity Tiers & Routing Rules

| Tier | Complexity Score | Models | Task Types |
|------|-----------------|--------|------------|
| **Junior** | 0–15 | Ernie 5.1, DeepSeek V4 Pro | Boilerplate, unit tests, simple CRUD, config files, data mappings, schema definitions |
| **Mid** | 16–40 | Kimi K2.6 | Standard business logic, API handlers, service layer, basic state machines |
| **Senior** | 41–80 | Claude Sonnet 4.6 | Multi-file refactors, complex algorithms, async orchestration, security-critical code |
| **Architect** | 81+ | Claude Opus | System design, novel architecture, cross-cutting concerns, foundational abstractions |

### 3.5 MCP Tool: `task_router_analyze`

Analyzes a target code area or planned change and returns complexity metrics with a routing recommendation.

#### Input Schema

```json
{
  "type": "object",
  "properties": {
    "analysis_target": {
      "type": "object",
      "description": "What to analyze — either existing code or a plan for new code",
      "oneOf": [
        {
          "type": "object",
          "properties": {
            "mode": {"type": "string", "enum": ["existing_file"]},
            "file_path": {"type": "string"}
          }
        },
        {
          "type": "object",
          "properties": {
            "mode": {"type": "string", "enum": ["planned_code"]},
            "description": {"type": "string", "description": "Description of the code to be written"},
            "estimated_loc": {"type": "integer"},
            "language": {"type": "string"},
            "imports_count": {"type": "integer"},
            "public_methods_count": {"type": "integer"}
          }
        },
        {
          "type": "object",
          "properties": {
            "mode": {"type": "string", "enum": ["plan_section"]},
            "plan_section": {"type": "string", "description": "Section of the architect's plan to analyze"}
          }
        }
      ]
    },
    "custom_thresholds": {
      "type": "object",
      "properties": {
        "junior_max": {"type": "integer", "default": 15},
        "mid_max": {"type": "integer", "default": 40},
        "senior_max": {"type": "integer", "default": 80}
      },
      "description": "Override default complexity tier thresholds"
    }
  }
}
```

#### Output Schema

```json
{
  "type": "object",
  "properties": {
    "complexity_score": {"type": "number", "description": "Weighted composite complexity score"},
    "metrics": {
      "type": "object",
      "properties": {
        "cyclomatic_complexity": {"type": "number"},
        "loc_affected": {"type": "integer"},
        "dependency_density": {"type": "number", "description": "0.0 to 1.0"},
        "interface_surface_area": {"type": "integer"},
        "novelty_score": {"type": "number", "description": "0.0 to 1.0 (lower = more novel)"},
        "risk_multiplier": {"type": "number", "default": 1.0}
      }
    },
    "recommended_tier": {
      "type": "string",
      "enum": ["junior", "mid", "senior", "architect"]
    },
    "recommended_models": {
      "type": "array",
      "items": {"type": "string"},
      "description": "Recommended model names sorted by cost efficiency"
    },
    "estimated_cost": {
      "type": "object",
      "properties": {
        "min_tokens_estimate": {"type": "integer"},
        "max_tokens_estimate": {"type": "integer"},
        "cost_range": {"type": "string", "description": "Estimated cost in USD"}
      }
    },
    "reasoning": {"type": "string", "description": "Explanation of the routing decision"}
  }
}
```

### 3.6 MCP Tool: `task_router_decompose`

Decomposes a high-level architectural plan into individually routable micro-tasks.

#### Input Schema

```json
{
  "type": "object",
  "required": ["architectural_plan"],
  "properties": {
    "architectural_plan": {
      "type": "string",
      "description": "High-level plan from the architect model (markdown)"
    },
    "codebase_path": {"type": "string", "default": "."},
    "auto_route": {
      "type": "boolean",
      "default": true,
      "description": "If true, immediately analyze and recommend routing for each subtask"
    }
  }
}
```

#### Output Schema

```json
{
  "type": "object",
  "properties": {
    "tasks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "task_id": {"type": "string"},
          "description": {"type": "string"},
          "target_files": {"type": "array", "items": {"type": "string"}},
          "language": {"type": "string"},
          "complexity_score": {"type": "number"},
          "recommended_tier": {"type": "string"},
          "recommended_model": {"type": "string"},
          "dependencies": {"type": "array", "items": {"type": "string", "description": "task_ids this depends on"}},
          "estimated_tokens": {"type": "integer"}
        }
      }
    },
    "execution_plan": {
      "type": "object",
      "properties": {
        "optimal_order": {"type": "array", "items": {"type": "string", "description": "task_ids in execution order"}},
        "parallel_batches": {
          "type": "array",
          "items": {
            "type": "array",
            "items": {"type": "string", "description": "task_ids that can run in parallel"}
          }
        },
        "total_estimated_tokens": {"type": "integer"},
        "total_estimated_cost": {"type": "string"}
      }
    }
  }
}
```

### 3.7 MCP Tool: `task_router_estimate_effort`

Quick estimation of how many tokens a given change will cost across different model tiers.

#### Input Schema

```json
{
  "type": "object",
  "required": ["file_path", "change_description"],
  "properties": {
    "file_path": {"type": "string"},
    "change_description": {"type": "string"},
    "model_tiers": {
      "type": "array",
      "items": {"type": "string", "enum": ["junior", "mid", "senior", "architect"]},
      "default": ["junior", "mid", "senior", "architect"]
    }
  }
}
```

### 3.8 Implementation Notes

- Cyclomatic complexity via `radon` (Python) or `lizard` (multi-language)
- LOC via `pygount` or `cloc`
- Dependency analysis via AST import/require parsing
- Novelty score via comparing planned function signatures against Blueprint Scout results
- Token estimation uses `tiktoken` with model-specific encodings
- The model multipliers should be configurable via a JSON config file

---

## 4. RepoGraph: In-Repository Knowledge Graph & Persistent Codebase Memory

### 4.1 Purpose

Eliminate repeated global searches across agent turns by maintaining a lightweight, file-based state ledger inside the repository. The MCP server serves as the exclusive read/write gateway, tracking code file intents, dependencies, and relationships via incremental diffs.

### 4.2 Storage

- **Primary format:** SQLite (`.code-inspect-mcp/repograph.db`) — fast relational queries, no external deps
- **Secondary format:** JSON sidecar (`.code-inspect-mcp/repograph.json`) — for git diff visibility and manual inspection
- **Location:** Repository root inside a `.code-inspect-mcp/` directory (git-ignorable via `.gitignore`)
- **Schema:** Entity → Relationship → Property graph model

### 4.3 Database Schema (SQLite)

```sql
-- Core entities (files, modules, classes, functions)
CREATE TABLE entities (
    id TEXT PRIMARY KEY,                       -- UUID
    type TEXT NOT NULL,                        -- 'file', 'class', 'function', 'module', 'interface', 'variable'
    name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    language TEXT,
    line_start INTEGER,
    line_end INTEGER,
    hash TEXT,                                 -- SHA256 of entity content
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    metadata TEXT                              -- JSON blob for extensible properties
);

-- Named relationships between entities
CREATE TABLE relationships (
    id TEXT PRIMARY KEY,
    source_entity_id TEXT NOT NULL REFERENCES entities(id),
    target_entity_id TEXT NOT NULL REFERENCES entities(id),
    relationship_type TEXT NOT NULL,            -- 'imports', 'extends', 'implements', 'calls', 'contains', 'depends_on', 'references'
    weight REAL DEFAULT 1.0,
    metadata TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Intent tags — semantic labels linking natural language to code
CREATE TABLE intents (
    id TEXT PRIMARY KEY,
    intent TEXT NOT NULL,                       -- e.g., "user authentication", "payment processing"
    entity_id TEXT NOT NULL REFERENCES entities(id),
    confidence REAL DEFAULT 1.0,
    source TEXT DEFAULT 'agent',               -- 'agent', 'manual', 'scan'
    created_at TEXT DEFAULT (datetime('now'))
);

-- Commit/change log for incremental diff tracking
CREATE TABLE change_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT (datetime('now')),
    change_type TEXT NOT NULL,                  -- 'add', 'modify', 'delete', 'move'
    entity_id TEXT,
    file_path TEXT,
    previous_hash TEXT,
    new_hash TEXT,
    description TEXT
);

CREATE INDEX idx_entities_path ON entities(file_path);
CREATE INDEX idx_entities_name ON entities(name);
CREATE INDEX idx_relationships_source ON relationships(source_entity_id);
CREATE INDEX idx_intents_tag ON intents(intent);
```

### 4.4 MCP Tool: `repograph_query`

Query the knowledge graph for relationships, intents, and entity information.

#### Input Schema

```json
{
  "type": "object",
  "properties": {
    "query_type": {
      "type": "string",
      "enum": ["entity_by_path", "entity_by_name", "relationships", "intents", "all_entities", "subgraph", "search"],
      "description": "Type of query to perform"
    },
    "file_path": {"type": "string", "description": "File path for entity_by_path query"},
    "entity_name": {"type": "string", "description": "Name for entity_by_name query (supports partial match)"},
    "entity_id": {"type": "string", "description": "UUID for relationships/subgraph queries"},
    "query": {"type": "string", "description": "Free-text search for 'search' query type"},
    "relationship_type": {"type": "string", "description": "Filter by relationship type"},
    "intent_filter": {"type": "string", "description": "Filter by intent tag"},
    "depth": {
      "type": "integer",
      "default": 2,
      "description": "Relationship traversal depth for subgraph query"
    },
    "limit": {"type": "integer", "default": 50}
  }
}
```

#### Output Schema

```json
{
  "type": "object",
  "properties": {
    "query_type": {"type": "string"},
    "results": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "entity": {"type": "object"},
          "relationships": {"type": "array"},
          "intents": {"type": "array"}
        }
      }
    },
    "graph_summary": {
      "type": "object",
      "properties": {
        "total_entities": {"type": "integer"},
        "total_relationships": {"type": "integer"},
        "entity_types": {"type": "object"},
        "relationship_counts": {"type": "object"}
      }
    }
  }
}
```

### 4.5 MCP Tool: `repograph_update`

Update the graph with new or changed file information (called by orchestrator after code changes, or by git hooks).

#### Input Schema

```json
{
  "type": "object",
  "required": ["changes"],
  "properties": {
    "changes": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "change_type": {"type": "string", "enum": ["add", "modify", "delete", "move"]},
          "file_path": {"type": "string"},
          "previous_path": {"type": "string", "description": "For 'move' operations"},
          "content": {"type": "string", "description": "File content (omit for deletions)"},
          "intent_tags": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Semantic intent tags for this file"
          }
        }
      }
    },
    "full_rescan": {
      "type": "boolean",
      "default": false,
      "description": "If true, do a full rescan of all files instead of incremental update"
    }
  }
}
```

#### Output Schema

```json
{
  "type": "object",
  "properties": {
    "entities_added": {"type": "integer"},
    "entities_modified": {"type": "integer"},
    "entities_deleted": {"type": "integer"},
    "relationships_added": {"type": "integer"},
    "intents_added": {"type": "integer"},
    "errors": {"type": "array", "items": {"type": "string"}},
    "current_graph_summary": {
      "type": "object",
      "properties": {
        "total_entities": {"type": "integer"},
        "total_relationships": {"type": "integer"},
        "last_updated": {"type": "string"}
      }
    }
  }
}
```

### 4.6 MCP Tool: `repograph_register_intent`

Explicitly register a semantic intent mapping (e.g., "This is the payment processing module") — enables intent-to-file navigation.

#### Input Schema

```json
{
  "type": "object",
  "required": ["intent", "file_paths"],
  "properties": {
    "intent": {"type": "string", "description": "Semantic label (e.g., 'user authentication flow')"},
    "file_paths": {
      "type": "array",
      "items": {"type": "string"},
      "description": "File paths that implement this intent"
    },
    "confidence": {"type": "number", "default": 1.0, "minimum": 0.0, "maximum": 1.0}
  }
}
```

### 4.7 MCP Tool: `repograph_rescan`

Full rescan of the repository — re-parses all files and rebuilds the graph from scratch. Useful after large merges or initial setup.

#### Input Schema

```json
{
  "type": "object",
  "properties": {
    "codebase_path": {"type": "string", "default": "."},
    "include_patterns": {"type": "array", "items": {"type": "string"}, "default": ["**/*.py", "**/*.ts", "**/*.js", "**/*.rs", "**/*.go", "**/*.java", "**/*.cpp", "**/*.c"]},
    "exclude_patterns": {"type": "array", "items": {"type": "string"}, "default": ["**/node_modules/**", "**/venv/**", "**/.git/**", "**/__pycache__/**"]}
  }
}
```

### 4.8 Git Hook Integration

For incremental diff tracking, the MCP server should also expose:

```
repograph_install_hooks
```

Installs a post-commit / pre-push git hook that calls `repograph_update` with the diff between HEAD~1 and HEAD, keeping the graph automatically in sync.

### 4.9 Implementation Notes

- Use Python's `sqlite3` stdlib — zero external dependencies for storage
- Entity extraction via Tree-sitter (same engine as Context-Slasher) for consistent results
- Intent tagging can be semi-automated: when an agent submits a plan, extract intent keywords and auto-register them
- JSON sidecar is written atomically (write to tmp file, rename) to prevent corruption
- Graph queries should include shortest-path between two entities for dependency analysis

---

## 5. SOLID Enforcer: 3-Tier Architecture Constraint System

### 5.1 Purpose

Bridge the gap between an LLM's abstract understanding of SOLID principles and its actual code output. Three tiers of enforcement: preventive (system constraints), evaluative (multi-agent review loop), and operational (prompt transformation).

### 5.2 Tier 1: System-Level Environmental Constraints (Preventive)

#### MCP Tool: `solid_enforcer_scope_context`

Restricts which files an agent can see during a modification task, forcing Single Responsibility Principle (SRP) adherence by environmental limitation.

```json
{
  "type": "object",
  "required": ["task_file", "context_window"],
  "properties": {
    "task_file": {"type": "string", "description": "The file being modified"},
    "context_window": {
      "type": "array",
      "items": {"type": "string"},
      "description": "Explicit list of files the agent is allowed to reference"
    },
    "strip_globals": {
      "type": "boolean",
      "default": true,
      "description": "Strip global orchestrator files from context"
    },
    "force_di_template": {
      "type": "boolean",
      "default": false,
      "description": "Inject a constructor-based DI template if applicable"
    }
  }
}
```

#### MCP Tool: `solid_enforcer_di_template`

Generates a dependency injection template for a class, enforcing Dependency Inversion Principle (DIP).

```json
{
  "type": "object",
  "required": ["class_name", "dependencies"],
  "properties": {
    "class_name": {"type": "string"},
    "dependencies": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type_name": {"type": "string"},
          "role": {"type": "string", "description": "What this dependency does"}
        }
      },
      "description": "Dependencies to inject via constructor"
    },
    "language": {"type": "string", "default": "python"},
    "include_interface": {
      "type": "boolean",
      "default": true,
      "description": "Generate an abstract interface/ABC for the class"
    }
  }
}
```

### 5.3 Tier 2: Multi-Agent Evaluation Loop (Evaluative)

#### MCP Tool: `solid_enforcer_audit`

Performs a deterministic SOLID compliance audit on generated code. Returns binary pass/fail for each principle with actionable feedback.

```json
{
  "type": "object",
  "required": ["code", "language"],
  "properties": {
    "code": {"type": "string", "description": "Generated source code to audit"},
    "language": {"type": "string", "description": "Programming language"},
    "checks": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": ["srp", "ocp", "lsp", "isp", "dip"]
      },
      "default": ["srp", "ocp", "lsp", "isp", "dip"],
      "description": "Which SOLID checks to perform"
    },
    "complexity_threshold": {
      "type": "integer",
      "default": 15,
      "description": "Max cyclomatic complexity per function/method (SRP check)"
    },
    "loc_threshold": {
      "type": "integer",
      "default": 100,
      "description": "Max lines per class/file (SRP check)"
    }
  }
}
```

#### Output Schema

```json
{
  "type": "object",
  "properties": {
    "overall_pass": {"type": "boolean"},
    "checks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "principle": {"type": "string"},
          "check_name": {"type": "string"},
          "passed": {"type": "boolean"},
          "score": {"type": "number", "description": "0.0 to 1.0 compliance score"},
          "violations": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "line": {"type": "integer"},
                "description": {"type": "string"},
                "severity": {"type": "string", "enum": ["error", "warning", "info"]}
              }
            }
          },
          "rejection": {
            "type": "boolean",
            "description": "If true, code generation should be automatically rejected"
          }
        }
      }
    },
    "summary": {"type": "string", "description": "Human-readable summary for the agent's review loop"},
    "error_log": {"type": "string", "description": "Structured error log to feed back into agent context"}
  }
}
```

#### SOLID Check Implementations

| Principle | Check | Method |
|-----------|-------|--------|
| **SRP** | Single reason to change | Count distinct import categories + method concern diversity + class LOC |
| **OCP** | Open for extension, closed for modification | Check for abstract base classes, strategy pattern, plugin architecture |
| **LSP** | Substitutability | AST comparison of subclass vs parent: method signatures, return types, exception specs |
| **ISP** | Interface segregation | Count methods per interface; flag interfaces with >3-5 unrelated methods |
| **DIP** | Dependency inversion | Check for concrete instantiation of dependencies vs constructor injection |

### 5.4 Tier 3: Operational Translation Layer (Prompt Transformation)

#### MCP Tool: `solid_enforcer_translate_prompt`

Translates abstract SOLID directives into concrete, mechanical code instructions that LLMs execute more reliably.

```json
{
  "type": "object",
  "required": ["abstract_directive", "context"],
  "properties": {
    "abstract_directive": {
      "type": "string",
      "description": "Abstract SOLID directive (e.g., 'Ensure this code adheres strictly to the Single Responsibility Principle')"
    },
    "context": {
      "type": "object",
      "description": "Context about the code being generated",
      "properties": {
        "file_path": {"type": "string"},
        "language": {"type": "string"},
        "existing_classes": {"type": "array", "items": {"type": "string"}},
        "task_description": {"type": "string"}
      }
    }
  }
}
```

#### Output Schema

```json
{
  "type": "object",
  "properties": {
    "original_directive": {"type": "string"},
    "translated_directives": {
      "type": "array",
      "items": {
        "type": "string",
        "description": "Concrete, mechanical instructions"
      }
    },
    "translation_strategy": {"type": "string", "description": "How the abstract directive was decomposed"}
  }
}
```

#### Translation Examples

| Abstract Directive | Translated Directives |
|-------------------|----------------------|
| "Follow SRP" | 1. Create `DataFetcher` class exclusively for HTTP payload fetching<br>2. Create `DataMapper` class exclusively for schema transformation<br>3. Place each in separate files |
| "Open for extension, closed for modification" | 1. Define abstract base class `PaymentGateway` with interface contract<br>2. Implement `StripeGateway` as concrete subclass<br>3. Ensure orchestration engine requires zero changes for new gateway variants |
| "Apply Interface Segregation" | 1. Create `Readable` interface (2 methods: `get`, `list`)<br>2. Create `Writable` interface (2 methods: `create`, `update`)<br>3. Implement only the interfaces required by each consumer |

### 5.5 Multi-Agent Evaluation Loop Integration

The SOLID Enforcer tools integrate with the Modular Agentic Architecture as follows:

```
[Agent Hermes] --produces--> [Blueprint]
    |
    v
[solid_enforcer_translate_prompt] --translates--> [Mechanical Instructions]
    |
    v
[GitHub Copilot / Code Model] --generates--> [Code]
    |
    v
[solid_enforcer_audit] --evaluates-->
    |-- PASS --> [Merge / Proceed]
    |-- FAIL --> [Error Log] --> [Agent Hermes refactors]
```

---

## 6. Cross-Cutting Concerns & Integration Patterns

### 6.1 Multi-Agent Orchestration Flow

The complete workflow combining all four tools plus SOLID enforcement:

```
┌─────────────────────────────────────────────────────────┐
│                    AGENT HERMES                          │
│              (Strategic Planner & Architect)             │
│  Deconstructs request → Generates blueprint.md           │
│  Defines file barriers → Identifies duplication risk     │
└─────────────────────────────────┬───────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────┐
│             1. repograph_query                           │
│     "What exists already? What intents are registered?"  │
└─────────────────────────────────┬───────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────┐
│             2. blueprint_scout_analyze_plan              │
│     "Is any of this already implemented?"                │
│     Returns: existing paths to reuse                     │
└─────────────────────────────────┬───────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────┐
│             3. task_router_decompose                      │
│     "Break plan into micro-tasks, estimate complexity"   │
│     Returns: tiered task list with model recommendations │
└─────────────────────────────────┬───────────────────────┘
                                  │
                    ┌─────────────┴──────────────┐
                    ▼                            ▼
        ┌────────────────────┐      ┌────────────────────┐
        │  Junior Tasks      │      │  Senior Tasks      │
        │  (DeepSeek/Ernie)  │      │  (Sonnet/Opus)     │
        │  Boilerplate,      │      │  Architecture,     │
        │  tests, schemas    │      │  complex logic     │
        └────────┬───────────┘      └────────┬───────────┘
                 │                           │
                 ▼                           ▼
        ┌────────────────────┐      ┌────────────────────┐
        │  solid_enforcer_   │      │  solid_enforcer_   │
        │  translate_prompt  │      │  translate_prompt  │
        └────────┬───────────┘      └────────┬───────────┘
                 │                           │
                 ▼                           ▼
        ┌────────────────────┐      ┌────────────────────┐
        │  context_slasher_  │      │  context_slasher_  │
        │  skeleton (for     │      │  skeleton (for     │
        │  context injection)│      │  context injection)│
        └────────┬───────────┘      └────────┬───────────┘
                 │                           │
                 ▼                           ▼
        ┌────────────────────┐      ┌────────────────────┐
        │  Code Generation   │      │  Code Generation   │
        │  (target model)    │      │  (target model)    │
        └────────┬───────────┘      └────────┬───────────┘
                 │                           │
                 └─────────────┬─────────────┘
                               ▼
        ┌────────────────────────────────────────┐
        │         solid_enforcer_audit            │
        │  "Does the code violate SOLID?"         │
        │  If PASS → repograph_update + merge     │
        │  If FAIL → error log → back to Hermes   │
        └────────────────────────────────────────┘
```

### 6.2 Common JSON-RPC Error Responses

All tools should return standardized error structures:

```json
{
  "error": {
    "code": -32000,
    "message": "Descriptive error message",
    "data": {
      "tool": "context_slasher_skeleton",
      "file_path": "/path/to/file",
      "details": "Tree-sitter grammar not found for language: Scala"
    }
  }
}
```

| Error Code | Meaning |
|-----------|---------|
| -32000 | Tool execution error (file not found, parse failure, etc.) |
| -32001 | Rate limit / resource exhaustion |
| -32002 | Configuration error (missing API keys, missing dependencies) |
| -32003 | Timeout (analysis took too long) |

### 6.3 Configuration File

The MCP server should read from `.code-inspect-mcp/mcp_config.json`:

```json
{
  "repograph": {
    "storage": "sqlite",
    "path": ".code-inspect-mcp/repograph.db",
    "auto_sync": true,
    "json_sidecar": true
  },
  "context_slasher": {
    "cache_enabled": true,
    "cache_size_mb": 100,
    "default_max_depth": 10
  },
  "blueprint_scout": {
    "semgrep_rules_path": ".code-inspect-mcp/semgrep_rules/",
    "min_similarity": 0.7,
    "cache_fingerprints": true
  },
  "task_router": {
    "model_multipliers": {
      "ernie-5.1": 1.5,
      "deepseek-v4-pro": 2.1,
      "kimi-k2.6": 2.8,
      "claude-sonnet-4.6": 12.0,
      "claude-opus": 20.0
    },
    "tier_thresholds": {
      "junior_max": 15,
      "mid_max": 40,
      "senior_max": 80
    }
  },
  "solid_enforcer": {
    "default_loc_threshold": 100,
    "default_cc_threshold": 15,
    "strict_mode": false
  }
}
```

### 6.4 Required Dependencies

| Dependency | Purpose | Tool |
|-----------|---------|------|
| `tree-sitter` + language grammars | AST parsing | Context-Slasher, RepoGraph |
| `semgrep` | Structural pattern matching | Blueprint Scout |
| Java Runtime (for PMD CPD) | Tokenized clone detection | Blueprint Scout (optional) |
| `radon` or `lizard` | Cyclomatic complexity | Task Router |
| `tiktoken` | Token estimation | Task Router, Context-Slasher |
| `sqlite3` (stdlib) | Knowledge graph storage | RepoGraph |

### 6.5 MCP Server Registration

The MCP server should register all tools with a Hermes-compatible manifest:

```json
{
  "name": "hermes-mcp-toolset",
  "version": "0.1.0",
  "description": "MCP toolset for token-optimized, architecturally-enforced agentic coding",
  "tools": [
    "context_slasher_skeleton",
    "context_slasher_multi",
    "blueprint_scout_search",
    "blueprint_scout_analyze_plan",
    "blueprint_scout_architectural_patterns",
    "task_router_analyze",
    "task_router_decompose",
    "task_router_estimate_effort",
    "repograph_query",
    "repograph_update",
    "repograph_register_intent",
    "repograph_rescan",
    "solid_enforcer_scope_context",
    "solid_enforcer_di_template",
    "solid_enforcer_audit",
    "solid_enforcer_translate_prompt"
  ]
}
```

---

*End of Tool Specifications — Ready for MCP server implementation*
