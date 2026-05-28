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
- [Configuration](#configuration)
- [Tools Reference](#tools-reference)
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

## Tools Reference

### TokenSqueezer

| Tool | Description | Inputs | Outputs |
|---|---|---|---|
| `token_squeezer.squeeze` | Compress code context via AST tree pruning | `code` (string), `language` (enum), `options` (object) | `squeezed` (string), `reduction_ratio` (number) |

### ArchitectureShepherd

| Tool | Description | Inputs | Outputs |
|---|---|---|---|
| `architecture_shepherd.load_manifest` | Load and parse layout restrictions | `path` (string), `content` (string) | Parse validation status |
| `architecture_shepherd.check` | Check target files for boundary violations | `paths` (string[]), `manifest_id` (string) | Boundary check results |
| `architecture_shepherd.check_diff` | Validate a Git diff against active constraints | `diff` (string), `manifest_id` (string) | Violation details |

### PatternMiner

| Tool | Description | Inputs | Outputs |
|---|---|---|---|
| `pattern_miner.scan` | Search files for registered anti-patterns | `paths` (string[]) | Array of pattern violations |
| `pattern_miner.find_dead_code` | Find unused functions and orphan exports | `paths` (string[]) | Dead code file segments |
| `pattern_miner.get_pattern_catalog`| Retrieve definitions of all scan patterns | — | List of patterns |
| `pattern_miner.learn_pattern` | Register dynamic structural search patterns | `definition` (object) | Registration status |

### RepoGraph

| Tool | Description | Inputs | Outputs |
|---|---|---|---|
| `repograph.query` | Query symbols and dependencies in the index | `query` (string), `file_path` (string) | Matching symbols |
| `repograph.index` | Build a regex-based graph index of a project directory | `path` (string) | Index metrics |

### TaskRouter

| Tool | Description | Inputs | Outputs |
|---|---|---|---|
| `task_router.estimate` | Estimate complexity and recommend LLMs | `task_description` (string) | Complexity, cost, tokens |
| `task_router.decompose` | Decompose a task into a series of steps | `task_description` (string) | Array of subtasks |

### SOLIDEnforcer

| Tool | Description | Inputs | Outputs |
|---|---|---|---|
| `solid_enforcer.audit` | Verify code meets SOLID architecture rules | `code` (string), `file_path` (string) | Score & violations |
| `solid_enforcer.generate_di_template`| Generate boilerplate interfaces for DI | `class_name` (string), `interfaces` (string[])| Code output |

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

## License

MIT © Nous Research
