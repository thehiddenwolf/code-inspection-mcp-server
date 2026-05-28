# Code Inspection MCP Server

**A TypeScript monorepo of Model Context Protocol (MCP) servers for AI-assisted code analysis, linting, architectural enforcement, and optimization.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)

---

## Table of Contents

- [Overview](#overview)
- [How it Works & Tools](#how-it-works--tools)
- [Building the Server](#building-the-server)
- [Running the Server](#running-the-server)
- [Setup Guides for Platforms](#setup-guides-for-platforms)
  - [Antigravity](#antigravity)
  - [Hermes-Agent](#hermes-agent)
  - [Claude Desktop](#claude-desktop)
  - [GitHub Copilot & Cursor / VS Code](#github-copilot--cursor--vs-code)
- [Detailed Tools Usage & Examples](#detailed-tools-usage--examples)
  - [1. TokenSqueezer](#1-tokensqueezer)
  - [2. ArchitectureShepherd](#2-architectureshepherd)
  - [3. PatternMiner](#3-patternminer)
  - [4. RepoGraph](#4-repograph)
  - [5. TaskRouter](#5-taskrouter)
  - [6. SOLIDEnforcer](#6-solidenforcer)
- [Configuration](#configuration)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

The **Code Inspection MCP Server** provides a collection of robust, language-agnostic code inspection and analysis utilities to LLMs and AI coding assistants via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io). 

It empowers AI assistants to parse codebases dynamically, index symbols, squeeze context to fit token limits, audit code against SOLID principles, enforce layer-based boundaries, and decompose complex programming tasks.

---

## How it Works & Tools

The server is structured as a monorepo containing multiple specialized analysis packages:

| Package | Purpose |
|---|---|
| **TokenSqueezer** | Reduces source code token footprint via AST manipulation (3 aggressiveness levels, 6 languages). |
| **ArchitectureShepherd** | Validates structural layer boundaries using a project `ARCHITECTURE.md` manifest. |
| **RepoGraph** | Indexes codebases to build in-memory regex-based code knowledge graphs for querying code structure. |
| **PatternMiner** | Scans codebases for custom patterns, anti-patterns, code smells, and dead code. |
| **SOLIDEnforcer** | Audits files against SOLID programming principles (SRP, OCP, LSP, ISP, DIP). |
| **TaskRouter** | Estimates programming task complexity and decomposes them into sequential steps. |

All of these tools are accessible through a unified gateway CLI: `code-inspection-mcp`.

---

## Building the Server

### Prerequisites

- **Node.js**: Version 18 or higher
- **npm**: Version 9 or higher

### Build Steps

Clone the repository and compile the TypeScript packages:

```bash
git clone https://github.com/thehiddenwolf/code-inspection-mcp-server.git
cd code-inspection-mcp-server
npm install
npm run build
```

This compiles the TypeScript files into executable JavaScript under each package's `dist/` folder. The primary entry point for the CLI is `/absolute/path/to/code-inspection-mcp-server/packages/cli/dist/index.js`.

---

## Running the Server

You can run the server directly via node or use the compiled CLI binary.

### Start the Gateway Server (Stdio Transport)

```bash
node packages/cli/dist/index.js start
```

This starts the combined gateway server using `stdio` transport, exposing all code inspection tools to the calling MCP client.

### Run tests to verify setup

To ensure everything is working correctly, run the Vitest suite:

```bash
npm test
```

---

## Setup Guides for Platforms

Integrating the Code Inspection MCP Server with your AI assistant environment.

### Antigravity

For **Antigravity**, add the server configuration inside your `mcp_config.json` file (typically located at `~/.gemini/antigravity-cli/mcp_config.json`):

```json
{
  "mcpServers": {
    "code-inspection-mcp": {
      "command": "node",
      "args": [
        "/home/kerwin/code/code-inspection-mcp-server/packages/cli/dist/index.js",
        "start"
      ],
      "env": {},
      "disabled": false
    }
  }
}
```

### Hermes-Agent

For **Hermes-Agent**, add the server key definition in your core `mcp_config.json` configuration block:

```json
{
  "mcpServers": {
    "code-inspection-mcp": {
      "command": "node",
      "args": [
        "/absolute/path/to/code-inspection-mcp-server/packages/cli/dist/index.js",
        "start"
      ]
    }
  }
}
```

### Claude Desktop

For **Claude Desktop**, open your configuration file (`claude_desktop_config.json`):
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add the following block to the `mcpServers` object:

```json
{
  "mcpServers": {
    "code-inspection-mcp": {
      "command": "node",
      "args": [
        "/absolute/path/to/code-inspection-mcp-server/packages/cli/dist/index.js",
        "start"
      ]
    }
  }
}
```

### GitHub Copilot & Cursor / VS Code

For developers using **GitHub Copilot**, **Cursor**, or **VS Code**, you can interface with the server using compatible MCP extensions/clients.

#### Cursor IDE
1. Open Cursor and navigate to **Settings > Features > MCP**.
2. Click **+ Add New MCP Server**.
3. Fill in the fields:
   - **Name**: `code-inspection-mcp`
   - **Type**: `command`
   - **Command**: `node /absolute/path/to/code-inspection-mcp-server/packages/cli/dist/index.js start`
4. Click **Save**.

#### VS Code (via Continue extension)
Add the configuration to your `~/.continue/config.json` file:

```json
{
  "experimental": {
    "servers": {
      "code-inspection-mcp": {
        "command": "node",
        "args": [
          "/absolute/path/to/code-inspection-mcp-server/packages/cli/dist/index.js",
          "start"
        ]
      }
    }
  }
}
```

---

## Detailed Tools Usage & Examples

Here is a full breakdown of the tools exposed by the `code-inspection-mcp` server.

### 1. TokenSqueezer

Prunes non-structural elements (comments, import blocks, class private variables, implementation bodies) from target files, converting them into skeletal structural maps to fit into LLM context windows.

#### `token_squeezer_squeeze`
- **Description**: Squeezes code either from a raw string or read directly from disk.
- **Inputs**:
  - `code` (string, optional): The raw code contents to squeeze.
  - `language` (enum, optional: `'javascript'`, `'typescript'`, `'python'`, `'go'`, `'jsx'`, `'tsx'`): Source language.
  - `filePath` (string, optional): Path to the source file on disk.
  - `options` (object, optional):
    - `preserve_comments` (boolean, default `false`): Keep comments.
    - `preserve_imports` (boolean, default `true`): Keep import statements.
    - `aggressiveness` (enum: `'conservative'`, `'balanced'`, `'aggressive'`, default `'balanced'`).
    - `max_tokens` (integer): Threshold ceiling for output tokens.
    - `include_private` (boolean, default `false`): Include private members.
    - `output_format` (enum: `'text'`, `'json'`, `'both'`, default `'both'`).
- **CLI Example**:
  ```bash
  code-inspection-mcp run token_squeezer_squeeze '{"code": "import { x } from \"./x\";\n// Comment\nexport class A {\n  private key = 1;\n  public run() { console.log(this.key); }\n}", "language": "typescript"}'
  ```
- **Response Format**:
  ```json
  {
    "original": "...",
    "squeezed": "import { x } from \"./x\";\nexport class A {\n  public run(): void;\n}",
    "original_tokens": 42,
    "squeezed_tokens": 15,
    "reduction_ratio": 0.642,
    "aggressiveness": "balanced",
    "language": "typescript",
    "node_counts": { "original": 12, "removed": 5 }
  }
  ```

---

### 2. ArchitectureShepherd

Validates layer dependencies and enforces separation of concerns (e.g., domain logic should not import infrastructure database clients).

#### `architecture_shepherd_load_manifest`
- **Description**: Parses an `ARCHITECTURE.md` file or string and registers layout constraints.
- **Inputs**:
  - `path` (string, optional): Local file path to `ARCHITECTURE.md`.
  - `content` (string, optional): Raw manifest markdown text.
- **CLI Example**:
  ```bash
  code-inspection-mcp run architecture_shepherd_load_manifest '{"path": "ARCHITECTURE.md"}'
  ```
- **Response Format**:
  ```json
  {
    "valid": true,
    "violations": [],
    "warnings": []
  }
  ```

#### `architecture_shepherd_check`
- **Description**: Audits list of files for architecture layer-crossings.
- **Inputs**:
  - `paths` (string[]): Files/directories to check.
  - `manifest_id` (string): Registry identifier of a loaded manifest.
- **CLI Example**:
  ```bash
  code-inspection-mcp run architecture_shepherd_check '{"paths": ["packages/shared/src/index.ts"], "manifest_id": "default"}'
  ```
- **Response Format**:
  ```json
  {
    "scan_id": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2026-05-28T10:33:00.000Z",
    "target": "files",
    "violations": [
      {
        "rule_id": "layer_boundary",
        "rule_name": "Strict Dependency Violation",
        "severity": "error",
        "message": "File in 'domain' imports '@hermes/infrastructure' but dependencies are prohibited.",
        "locations": [{ "file": "packages/cli/src/index.ts", "line": 15 }],
        "category": "layer_boundary"
      }
    ],
    "summary": {
      "total_violations": 1,
      "by_severity": { "critical": 0, "error": 1, "warning": 0, "info": 0 },
      "passed": false
    }
  }
  ```

#### `architecture_shepherd_check_diff`
- **Description**: Validates only files modified in a git diff to verify PR safety.
- **Inputs**:
  - `diff` (string): Raw output from `git diff`.
  - `manifest_id` (string): Registry identifier.
- **CLI Example**:
  ```bash
  code-inspection-mcp run architecture_shepherd_check_diff '{"diff": "diff --git a/src/core.ts b/src/core.ts ...", "manifest_id": "default"}'
  ```

---

### 3. PatternMiner

Finds code smells, structural clones, duplicate segments, and scans for unused code fragments.

#### `pattern_miner_scan`
- **Description**: Scans paths for anti-patterns and rules.
- **Inputs**:
  - `paths` (string[]): Paths to scan.
  - `patterns` (string[], optional): Filter for specific pattern IDs.
- **CLI Example**:
  ```bash
  code-inspection-mcp run pattern_miner_scan '{"paths": ["packages/cli/src"]}'
  ```
- **Response Format**:
  ```json
  {
    "matches": [
      {
        "pattern": "nested-callbacks",
        "line": 42,
        "column": 4,
        "message": "Found deeply nested callback layers. Prefer using async/await.",
        "severity": "warning"
      }
    ],
    "duration_ms": 28
  }
  ```

#### `pattern_miner_find_clones`
- **Description**: Matches code blocks for similar clones using Semgrep engine comparisons.
- **Inputs**:
  - `fragment` (string): Reference code snippet.
  - `language` (enum): Snippet language.
  - `searchPath` (string): Folder path to search in.
  - `minConfidence` (number, default `0.6`): Minimum match confidence.

---

### 4. RepoGraph

Scans project files to construct an in-memory knowledge index mapping classes, interfaces, function calls, and import statements, supporting direct structural querying.

#### `repograph_index`
- **Description**: Builds an index of a path directory.
- **Inputs**:
  - `path` (string): Directory folder to index.
- **CLI Example**:
  ```bash
  code-inspection-mcp run repograph_index '{"path": "/absolute/path/to/project"}'
  ```

#### `repograph_query`
- **Description**: Query indexed symbols or structures.
- **Inputs**:
  - `query` (string): Natural language or symbol name to query.
  - `file_path` (string, optional): Restricts query to specific scope.
  - `scope` (enum: `'file'`, `'module'`, `'project'`, default `'project'`).
- **CLI Example**:
  ```bash
  code-inspection-mcp run repograph_query '{"query": "find callers of runCli", "scope": "project"}'
  ```
- **Response Format**:
  ```json
  {
    "results": [
      {
        "content": "const res = runCli('--version');",
        "file_path": "packages/cli/test/cli.test.ts",
        "relevance_score": 0.98
      }
    ]
  }
  ```

---

### 5. TaskRouter

Examines task description prompts to calculate execution complexity and estimate pricing or route requests.

#### `task_router_estimate`
- **Description**: Analyzes complexity metrics and requirements.
- **Inputs**:
  - `task_description` (string): Task summary.
- **CLI Example**:
  ```bash
  code-inspection-mcp run task_router_estimate '{"task_description": "Fix typo in README"}'
  ```
- **Response Format**:
  ```json
  {
    "complexity": "simple",
    "recommended_model": "gpt-4o-mini",
    "estimated_cost": 0.0015,
    "estimated_tokens": 150
  }
  ```

#### `task_router_decompose`
- **Description**: Breaks a task description down into sequential stages.
- **Inputs**:
  - `task_description` (string): Full task specification.
- **CLI Example**:
  ```bash
  code-inspection-mcp run task_router_decompose '{"task_description": "Create a user registration endpoint with JWT"}'
  ```
- **Response Format**:
  ```json
  {
    "complexity": "medium",
    "recommended_model": "claude-3-5-sonnet",
    "estimated_cost": 0.045,
    "estimated_tokens": 9000,
    "subtasks": [
      { "name": "Define user model schema", "description": "Construct migrations and user DB fields.", "estimated_tokens": 1500 },
      { "name": "Implement registration controller", "description": "Validate payloads and hash passwords.", "estimated_tokens": 3000 }
    ]
  }
  ```

---

### 6. SOLIDEnforcer

Validates codebase adherence to Single Responsibility, Open-Closed, Liskov Substitution, Interface Segregation, and Dependency Inversion guidelines.

#### `solid_enforcer_audit`
- **Description**: Checks target file code blocks against SOLID principles.
- **Inputs**:
  - `code` (string): Raw source code lines.
  - `file_path` (string): File path descriptor.
- **CLI Example**:
  ```bash
  code-inspection-mcp run solid_enforcer_audit '{"code": "class DB { saveUser() {} sendMail() {} }", "file_path": "db.ts"}'
  ```
- **Response Format**:
  ```json
  {
    "scan_id": "762c95e1-8f5c-42b7-84bc-263aef8c1303",
    "timestamp": "2026-05-28T10:33:00.000Z",
    "target": "db.ts",
    "violations": [
      {
        "rule_id": "solid_srp",
        "rule_name": "Single Responsibility Violation",
        "severity": "warning",
        "message": "Class DB handles user persistence and mail dispatch. Consider separating concerns.",
        "locations": [{ "file": "db.ts", "line": 1 }],
        "category": "solid_srp"
      }
    ],
    "summary": {
      "total_violations": 1,
      "by_severity": { "critical": 0, "error": 0, "warning": 1, "info": 0 },
      "passed": false
    }
  }
  ```

#### `solid_enforcer_generate_di_template`
- **Description**: Creates dependency-injected class stubs for a list of interface dependencies.
- **Inputs**:
  - `class_name` (string): Target class name.
  - `interfaces` (string[]): Dependencies names.
  - `language` (enum: `'typescript'`, `'javascript'`, default `'typescript'`).
- **CLI Example**:
  ```bash
  code-inspection-mcp run solid_enforcer_generate_di_template '{"class_name": "ProductManager", "interfaces": ["Repository", "Notifier"]}'
  ```
- **Response Format**: (Standard text output template)
  ```typescript
  export class ProductManager {
    constructor(
      private readonly repository: IRepository,
      private readonly notifier: INotifier
    ) {}
  }
  ```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port used if executing via SSE transport |
| `LOG_LEVEL` | `info` | Logger verbosity (`debug`, `info`, `warn`, `error`) |
| `NODE_ENV` | `development` | Environment mode |

### ARCHITECTURE.md Manifest

The `architecture_shepherd` tool validates file dependency rules using an `ARCHITECTURE.md` file in your project root:

```markdown
# Architecture

## Layer: domain
path: src/domain/
description: Core business logic
allowed_dependencies: []

## Layer: application
path: src/application/
description: Application services
allowed_dependencies: [domain]

## Layer: infrastructure
path: src/infrastructure/
description: External database/HTTP integrations
allowed_dependencies: [application, domain]
```

---

## Development

Run development watcher mode:

```bash
npm run dev
```

Run test suite:

```bash
npm test
```

Format and lint:

```bash
npm run lint:eslint
npm run lint:tsc
```

---

## Contributing

See CONTRIBUTING.md for detailed guidelines.

---

## License

MIT © Nous Research
