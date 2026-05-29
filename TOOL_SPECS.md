# Code Inspection MCP Server — Complete Tool Specifications

This document defines the complete, production-ready specifications for the Model Context Protocol (MCP) tools provided by the Code Inspection MCP Server. These tools are exposed under a unified gateway CLI: `code-inspection-mcp-gateway`.

---

## Table of Contents

1. [TokenSqueezer: AST Context Reduction](#1-tokensqueezer-ast-context-reduction)
2. [ArchitectureShepherd: Layer Boundary Compliance](#2-architectureshepherd-layer-boundary-compliance)
3. [RepoGraph: Codebase Knowledge Graph & Indexing](#3-repograph-codebase-knowledge-graph--indexing)
4. [PatternMiner: Structural Pattern Mining & Clone Detection](#4-patternminer-structural-pattern-mining--clone-detection)
5. [TaskRouter: Complexity Estimation & Routing](#5-taskrouter-complexity-estimation--routing)
6. [SOLIDEnforcer: 3-Tier SOLID Principle Audit](#6-solidenforcer-3-tier-solid-principle-audit)
7. [LintFixer: Automated Code Remediation](#7-lintfixer-automated-code-remediation)
8. [Insights & Refactoring: Cross-File Queries & Batch Operations](#8-insights--refactoring-cross-file-queries--batch-operations)

---

## 1. TokenSqueezer: AST Context Reduction

Prunes non-structural elements (comments, import blocks, class private variables, implementation bodies) from target files, converting them into skeletal structural maps to fit into LLM context windows.

### 1.1 `get_symbols`

Reads high-level symbol declarations (classes, functions, interfaces, imports) or the full file if it is small enough.

#### Input Schema
```json
{
  "type": "object",
  "properties": {
    "code": { 
      "type": "string", 
      "description": "Source code to squeeze (ignored if filePath is provided)" 
    },
    "language": {
      "type": "string",
      "enum": ["javascript", "typescript", "python", "go", "jsx", "tsx", "rpg", "cobol", "bash", "powershell"],
      "description": "Source language (auto-detected if filePath is provided)"
    },
    "filePath": {
      "type": "string",
      "description": "Absolute path to the file to squeeze directly from disk (alternative to passing code)"
    },
    "options": {
      "type": "object",
      "properties": {
        "preserve_comments": { "type": "boolean", "default": false },
        "preserve_imports": { "type": "boolean", "default": true },
        "aggressiveness": {
          "type": "string",
          "enum": ["conservative", "balanced", "aggressive"],
          "default": "balanced"
        },
        "max_tokens": { "type": "integer", "description": "Maximum token target" },
        "include_private": { "type": "boolean", "default": false },
        "output_format": {
          "type": "string",
          "enum": ["text", "json", "both"],
          "default": "both"
        },
        "outline": {
          "type": "boolean",
          "default": false,
          "description": "Return a clean hierarchical structural outline of the code symbols instead of passive pass placeholders"
        }
      }
    }
  }
}
```

#### Output Example (Balanced Mode)
```typescript
import { x } from "./x";
export class PaymentProcessor {
  public run(): void;
}
```

---

## 2. ArchitectureShepherd: Layer Boundary Compliance

Validates structural layer boundaries using a project `ARCHITECTURE.md` manifest to enforce separation of concerns.

### 2.1 `architecture_shepherd_load_manifest`

Loads and parses an `ARCHITECTURE.md` manifest from a file path or raw markdown content.

#### Input Schema
```json
{
  "type": "object",
  "properties": {
    "path": { 
      "type": "string", 
      "description": "Path to ARCHITECTURE.md (optional)" 
    },
    "content": { 
      "type": "string", 
      "description": "Raw manifest content (alternative to path)" 
    }
  }
}
```

### 2.2 `architecture_shepherd_check`

Checks file paths against a loaded architecture manifest for layer boundary violations.

#### Input Schema
```json
{
  "type": "object",
  "properties": {
    "paths": {
      "type": "array",
      "items": { "type": "string" },
      "description": "File paths to check against the manifest"
    },
    "manifest_id": { 
      "type": "string", 
      "description": "Loaded manifest identifier (often 'default')" 
    }
  },
  "required": ["paths", "manifest_id"]
}
```

### 2.3 `architecture_shepherd_check_diff`

Checks a git diff against an architecture manifest for violations introduced in modified code.

#### Input Schema
```json
{
  "type": "object",
  "properties": {
    "diff": { 
      "type": "string", 
      "description": "Git diff output to analyze" 
    },
    "manifest_id": { 
      "type": "string", 
      "description": "Loaded manifest identifier" 
    }
  },
  "required": ["diff", "manifest_id"]
}
```

---

## 3. RepoGraph: Codebase Knowledge Graph & Indexing

Indexes codebases to build in-memory regex-based code knowledge graphs for querying code structure, dependencies, and calls.

### 3.1 `index_codebase`

Indexes a codebase folder into the knowledge graph.

#### Input Schema
```json
{
  "type": "object",
  "properties": {
    "path": { 
      "type": "string", 
      "description": "Root path of the codebase to index" 
    }
  },
  "required": ["path"]
}
```

### 3.2 `find_indexed_symbol_references`

Query the code knowledge graph for code relationships, declarations, and structures.

#### Input Schema
```json
{
  "type": "object",
  "properties": {
    "query": { 
      "type": "string", 
      "description": "Natural language or structured query" 
    },
    "file_path": { 
      "type": "string", 
      "description": "Optional file path to scope the query" 
    },
    "scope": {
      "type": "string",
      "enum": ["file", "module", "project"],
      "default": "project",
      "description": "Query scope"
    }
  },
  "required": ["query"]
}
```

### 3.3 `get_indexed_symbol_tree`

Traces and constructs incoming and outgoing call hierarchies for a function/method symbol.

#### Input Schema
```json
{
  "type": "object",
  "properties": {
    "symbol": { 
      "type": "string", 
      "description": "Name of the function or method" 
    },
    "direction": { 
      "type": "string", 
      "enum": ["incoming", "outgoing", "both"], 
      "default": "both", 
      "description": "Direction to trace calls" 
    },
    "max_depth": { 
      "type": "integer", 
      "default": 3, 
      "description": "Maximum recursion depth" 
    },
    "project_path": { 
      "type": "string", 
      "description": "Optional project root path" 
    }
  },
  "required": ["symbol"]
}
```

### 3.4 `repograph_get_dependencies`

Analyzes codebase imports to list file dependencies and identify circular dependency cycles.

#### Input Schema
```json
{
  "type": "object",
  "properties": {
    "project_path": { 
      "type": "string", 
      "description": "Optional project root path" 
    }
  }
}
```

---

## 4. PatternMiner: Structural Pattern Mining & Clone Detection

Finds code smells, structural duplicates, and custom rule violations.

### 4.1 `pattern_miner_scan`

Scans paths for code smells, anti-patterns, and custom learned rules.

#### Input Schema
```json
{
  "type": "object",
  "properties": {
    "paths": {
      "type": "array",
      "items": { "type": "string" },
      "description": "File/directory paths to scan"
    },
    "patterns": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Optional pattern filter — only run these pattern IDs"
    }
  },
  "required": ["paths"]
}
```

### 4.2 `pattern_miner_get_pattern_catalog`

Retrieves the catalog of registered patterns and configurations.

#### Input Schema
```json
{
  "type": "object",
  "properties": {}
}
```

### 4.3 `pattern_miner_learn_pattern`

Registers a custom pattern definition dynamically for subsequent scans.

#### Input Schema
```json
{
  "type": "object",
  "properties": {
    "definition": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "name": { "type": "string" },
        "description": { "type": "string" },
        "category": {
          "type": "string",
          "enum": ["security", "performance", "correctness", "style", "complexity", "duplication", "architecture", "best_practice"]
        },
        "severity": {
          "type": "string",
          "enum": ["info", "warning", "error", "critical"]
        },
        "languages": { "type": "array", "items": { "type": "string" } },
        "pattern": { "type": "string" },
        "message_template": { "type": "string" },
        "remediation": { "type": "string" }
      },
      "required": ["id", "name", "description", "category", "languages", "pattern"]
    }
  },
  "required": ["definition"]
}
```

### 4.4 `pattern_miner_find_clones`

Searches files for duplicate fragments using the Semgrep engine.

#### Input Schema
```json
{
  "type": "object",
  "properties": {
    "fragment": { 
      "type": "string", 
      "description": "The code fragment to find clones of" 
    },
    "language": {
      "type": "string",
      "enum": ["typescript", "javascript", "python", "go", "java", "jsx", "tsx"],
      "description": "Programming language of the fragment"
    },
    "searchPath": { 
      "type": "string", 
      "description": "Directory path to search in" 
    },
    "minConfidence": { 
      "type": "number", 
      "default": 0.6, 
      "description": "Minimum confidence threshold (0-1)" 
    },
    "maxResults": { 
      "type": "integer", 
      "default": 20, 
      "description": "Maximum number of results to return" 
    }
  },
  "required": ["fragment", "language", "searchPath"]
}
```

---

## 5. TaskRouter: Complexity Estimation & Routing

Examines task description prompts to calculate execution complexity and estimate model routing costs.

### 5.1 `task_router_estimate`

Estimates task complexity and recommends a model tier along with estimated token usage.

#### Input Schema
```json
{
  "type": "object",
  "properties": {
    "task_description": { 
      "type": "string", 
      "description": "Description of the task to estimate" 
    }
  },
  "required": ["task_description"]
}
```

### 5.2 `task_router_decompose`

Decomposes a task description down into sequential, individually routable micro-tasks.

#### Input Schema
```json
{
  "type": "object",
  "properties": {
    "task_description": { 
      "type": "string", 
      "description": "Description of the task to decompose" 
    }
  },
  "required": ["task_description"]
}
```

---

## 6. SOLIDEnforcer: 3-Tier SOLID Principle Audit

Checks codebase compliance against SOLID programming design principles.

### 6.1 `solid_enforcer_audit`

Audits source code against SRP, OCP, LSP, ISP, and DIP.

#### Input Schema
```json
{
  "type": "object",
  "properties": {
    "code": { 
      "type": "string", 
      "description": "Source code to audit" 
    },
    "file_path": { 
      "type": "string", 
      "description": "File path for context" 
    }
  },
  "required": ["code", "file_path"]
}
```

### 6.2 `solid_enforcer_generate_di_template`

Generates class constructor stubs using Dependency Injection patterns.

#### Input Schema
```json
{
  "type": "object",
  "properties": {
    "class_name": { 
      "type": "string", 
      "description": "Name of the class" 
    },
    "interfaces": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Dependency interface names"
    },
    "language": {
      "type": "string",
      "enum": ["typescript", "javascript"],
      "default": "typescript",
      "description": "Target language"
    }
  },
  "required": ["class_name", "interfaces"]
}
```

---

## 7. LintFixer: Automated Code Remediation

Hooks into registered formatters/linters dynamically from language packs to repair code layout.

### 7.1 `lint_fixer_fix`

Auto-fixes formatting and lint errors on the specified file.

#### Input Schema
```json
{
  "type": "object",
  "properties": {
    "filePath": { 
      "type": "string", 
      "description": "Absolute path to the file to lint/fix" 
    },
    "dryRun": { 
      "type": "boolean", 
      "default": false, 
      "description": "If true, only returns the diff and does not modify the file on disk" 
    }
  },
  "required": ["filePath"]
}
```

---

## 8. Insights & Refactoring: Cross-File Queries & Batch Operations

Enables batch queries and multi-file code modifications atomically.

### 8.1 `insight_reference_tracker`

Tracks class/method definitions, usages, and markdown documentation references for a symbol.

#### Input Schema
```json
{
  "type": "object",
  "properties": {
    "symbol": { 
      "type": "string", 
      "description": "Symbol name to track (class, function, variable, etc.)" 
    },
    "project_path": { 
      "type": "string", 
      "description": "Optional project root path" 
    },
    "include_docs": { 
      "type": "boolean", 
      "default": true, 
      "description": "Whether to scan markdown documentation for occurrences" 
    }
  },
  "required": ["symbol"]
}
```

### 8.2 `get_insights`

Combines definitions, usages, references, or docs queries for multiple symbols into a single request.

#### Input Schema
```json
{
  "type": "object",
  "properties": {
    "symbols": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Optional list of symbols to track"
    },
    "queries": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": { "type": "string", "enum": ["definitions", "usages", "references", "docs"] },
          "symbol": { "type": "string" }
        },
        "required": ["type", "symbol"]
      },
      "description": "Optional list of specific queries to execute"
    },
    "project_path": { "type": "string", "description": "Optional project root path" },
    "include_docs": { "type": "boolean", "default": true, "description": "Whether to scan markdown documentation" }
  }
}
```

### 8.3 `refactor_execute_batch`

Atomically executes multiple refactoring operations (rename, replace, move, create, delete) sequentially in a single transaction.

#### Input Schema
```json
{
  "type": "object",
  "properties": {
    "operations": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": { "type": "string", "enum": ["rename", "replace", "move", "create", "delete"] },
          "filePath": { "type": "string", "description": "Target file path" },
          "fromPath": { "type": "string", "description": "Source file path (for move)" },
          "toPath": { "type": "string", "description": "Destination file path (for move)" },
          "oldName": { "type": "string", "description": "Old name for rename" },
          "newName": { "type": "string", "description": "New name for rename" },
          "find": { "type": "string", "description": "Text block to find for replace" },
          "replace": { "type": "string", "description": "Text block to replace with" },
          "content": { "type": "string", "description": "Content for create" }
        },
        "required": ["type"]
      },
      "description": "Ordered array of refactoring operations to execute sequentially"
    },
    "project_path": { "type": "string", "description": "Optional project root path" }
  },
  "required": ["operations"]
}
```
