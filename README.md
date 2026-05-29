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
  - [Cursor IDE](#cursor-ide)
- [Detailed Tools Usage & Examples](#detailed-tools-usage--examples)
  - [1. TokenSqueezer](#1-tokensqueezer)
  - [2. ArchitectureShepherd](#2-architectureshepherd)
  - [3. RepoGraph](#3-repograph)
  - [4. PatternMiner](#4-patternminer)
  - [5. TaskRouter](#5-taskrouter)
  - [6. SOLIDEnforcer](#6-solidenforcer)
  - [7. LintFixer](#7-lintfixer)
  - [8. Insights & Refactoring](#8-insights--refactoring)
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
| **TokenSqueezer** | Reduces source code token footprint via AST manipulation and regex fallbacks (supports JavaScript, TypeScript, Python, Go, RPG, COBOL, Bash, PowerShell). |
| **ArchitectureShepherd** | Validates structural layer boundaries using a project `ARCHITECTURE.md` manifest. |
| **RepoGraph** | Indexes codebases to build SQLite-based codebase dependency and call hierarchy graphs. |
| **PatternMiner** | Scans codebases for custom patterns, anti-patterns, code smells, and structural duplicates. |
| **SOLIDEnforcer** | Audits files against SOLID programming principles (SRP, OCP, LSP, ISP, DIP). |
| **TaskRouter** | Estimates programming task complexity and decomposes them into sequential steps. |
| **LintFixer** | Executes formatting and fixing tools dynamically defined in registered language packs. |

All of these tools are accessible through a unified gateway CLI: `code-inspection-mcp-gateway`.

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

### Cursor IDE

1. Open Cursor and navigate to **Settings > Features > MCP**.
2. Click **+ Add New MCP Server**.
3. Fill in the fields:
   - **Name**: `code-inspection-mcp`
   - **Type**: `command`
   - **Command**: `node /absolute/path/to/code-inspection-mcp-server/packages/cli/dist/index.js start`
4. Click **Save**.

---

## Detailed Tools Usage & Examples

Here is a full breakdown of the tools exposed by the `code-inspection-mcp-gateway` server.

### 1. TokenSqueezer

Prunes non-structural elements (comments, import blocks, class private variables, implementation bodies) from target files, converting them into skeletal structural maps to fit into LLM context windows.

#### `get_symbols`
- **Description**: Squeezes code either from a raw string or read directly from disk.
- **Inputs**:
  - `code` (string, optional): The raw code contents to squeeze.
  - `language` (enum, optional: `'javascript'`, `'typescript'`, `'python'`, `'go'`, `'jsx'`, `'tsx'`, `'rpg'`, `'cobol'`, `'bash'`, `'powershell'`): Source language.
  - `filePath` (string, optional): Path to the source file on disk.
  - `options` (object, optional):
    - `preserve_comments` (boolean, default `false`): Keep comments.
    - `preserve_imports` (boolean, default `true`): Keep import statements.
    - `aggressiveness` (enum: `'conservative'`, `'balanced'`, `'aggressive'`, default `'balanced'`).
    - `max_tokens` (integer): Threshold ceiling for output tokens.
    - `include_private` (boolean, default `false`): Include private members.
    - `output_format` (enum: `'text'`, `'json'`, `'both'`, default `'both'`).
    - `outline` (boolean, default `false`): If true, returns a clean hierarchical structural outline format.
- **CLI Example**:
  ```bash
  code-inspection-mcp run get_symbols '{"filePath": "src/processor.ts", "options": {"aggressiveness": "balanced"}}'
  ```

---

### 2. ArchitectureShepherd

Validates layer dependencies and enforces separation of concerns (e.g., domain logic should not import infrastructure database clients).

#### `architecture_shepherd_load_manifest`
- **Description**: Parses an `ARCHITECTURE.md` file or string and registers layout constraints.
- **Inputs**:
  - `path` (string, optional): Local file path to `ARCHITECTURE.md`.
  - `content` (string, optional): Raw manifest markdown text.

#### `architecture_shepherd_check`
- **Description**: Audits list of files for architecture layer-crossings.
- **Inputs**:
  - `paths` (string[]): Files/directories to check.
  - `manifest_id` (string): Registry identifier of a loaded manifest.

#### `architecture_shepherd_check_diff`
- **Description**: Validates only files modified in a git diff to verify PR safety.
- **Inputs**:
  - `diff` (string): Raw output from `git diff`.
  - `manifest_id` (string): Registry identifier.

---

### 3. RepoGraph

Scans project files to construct a relational knowledge index mapping classes, interfaces, function calls, and import statements, supporting direct structural querying.

#### `index_codebase`
- **Description**: Builds a knowledge graph of a path directory.
- **Inputs**:
  - `path` (string): Directory folder to index.

#### `find_indexed_symbol_references`
- **Description**: Query indexed symbols or structures.
- **Inputs**:
  - `query` (string): Natural language or symbol name to query.
  - `file_path` (string, optional): Restricts query to specific scope.
  - `scope` (enum: `'file'`, `'module'`, `'project'`, default `'project'`).

#### `get_indexed_symbol_tree`
- **Description**: Returns incoming and outgoing calls for a function symbol.
- **Inputs**:
  - `symbol` (string): Target function name.
  - `direction` (enum: `'incoming'`, `'outgoing'`, `'both'`).

#### `repograph_get_dependencies`
- **Description**: Analyzes imports to map file-level dependencies and detect circular imports.
- **Inputs**:
  - `project_path` (string, optional).

---

### 4. PatternMiner

Finds code smells, structural clones, duplicate segments, and scans for unused code fragments.

#### `pattern_miner_scan`
- **Description**: Scans paths for anti-patterns and rules.
- **Inputs**:
  - `paths` (string[]): Paths to scan.
  - `patterns` (string[], optional): Filter for specific pattern IDs.

#### `pattern_miner_find_clones`
- **Description**: Matches code blocks for similar clones using Semgrep engine comparisons.
- **Inputs**:
  - `fragment` (string): Reference code snippet.
  - `language` (string): Snippet language.
  - `searchPath` (string): Folder path to search in.
  - `minConfidence` (number, default `0.6`): Minimum match confidence.

---

### 5. TaskRouter

Examines task description prompts to calculate execution complexity and estimate pricing or route requests.

#### `task_router_estimate`
- **Description**: Analyzes complexity metrics and requirements.
- **Inputs**:
  - `task_description` (string): Task summary.

#### `task_router_decompose`
- **Description**: Breaks a task description down into sequential stages.
- **Inputs**:
  - `task_description` (string): Full task specification.

---

### 6. SOLIDEnforcer

Validates codebase adherence to Single Responsibility, Open-Closed, Liskov Substitution, Interface Segregation, and Dependency Inversion guidelines.

#### `solid_enforcer_audit`
- **Description**: Checks target file code blocks against SOLID principles.
- **Inputs**:
  - `code` (string): Raw source code lines.
  - `file_path` (string): File path descriptor.

#### `solid_enforcer_generate_di_template`
- **Description**: Creates dependency-injected class stubs for a list of interface dependencies.
- **Inputs**:
  - `class_name` (string): Target class name.
  - `interfaces` (string[]): Dependencies names.
  - `language` (enum: `'typescript'`, `'javascript'`, default `'typescript'`).

---

### 7. LintFixer

Automates codebase layout and rule adjustments dynamically resolved from registered language pack formatters.

#### `lint_fixer_fix`
- **Description**: Automatically formats and solves linter errors on a file.
- **Inputs**:
  - `filePath` (string): Target source file.
  - `dryRun` (boolean, default `false`): If true, returns the output diff without altering the file on disk.

---

### 8. Insights & Refactoring

Provides atomic batch operations and symbol usage tracking across multiple files.

#### `insight_reference_tracker`
- **Description**: Scans symbols across code definition blocks and markdown documents to track references.
- **Inputs**:
  - `symbol` (string): Symbol to trace.
  - `project_path` (string, optional): Root folder path.

#### `get_insights`
- **Description**: Bundles definitions, usages, and docs tracing queries for multiple symbols into a single request.
- **Inputs**:
  - `symbols` (string[]): List of symbols.
  - `queries` (array): Tracing operations.

#### `refactor_execute_batch`
- **Description**: Atomically runs a transactional sequence of refactor operations (rename, replace, move, create, delete) across files.
- **Inputs**:
  - `operations` (array): Refactoring steps to run in order.

---

## Configuration

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
npm run lint
```

---

## Contributing

See CONTRIBUTING.md for detailed guidelines.

---

## License

MIT © Nous Research
