# Hermes MCP Toolset

**A TypeScript monorepo of Model Context Protocol servers for AI-assisted software development.**

[![CI](https://github.com/nousresearch/hermes-mcp-toolset/actions/workflows/ci.yml/badge.svg)](https://github.com/nousresearch/hermes-mcp-toolset/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@hermes/cli)](https://www.npmjs.com/package/@hermes/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)

---

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [MCP Server Setup](#mcp-server-setup)
- [Tools Reference](#tools-reference)
- [Development](#development)
- [Architecture](#architecture)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

The Hermes MCP Toolset is a collection of specialized tools for AI code analysis, packaged as [Model Context Protocol (MCP)](https://modelcontextprotocol.io) servers. Each tool addresses a specific aspect of software analysis:

| Package | Purpose |
|---|---|
| **TokenSqueezer** | Reduce code context via AST manipulation. Three levels of aggressiveness, six languages. |
| **ArchitectureShepherd** | Parse `ARCHITECTURE.md` manifests and validate layer boundaries. |
| **RepoGraph** | Build in-memory code knowledge graphs from regex-based indexing. |
| **PatternMiner** | Detect code patterns, anti-patterns, code smells, and dead code. |
| **SOLIDEnforcer** | Check code against SOLID principles (SRP, OCP, LSP, ISP, DIP). |
| **TaskRouter** | Estimate task complexity and decompose into subtasks. |

All tools are accessible through a single unified CLI (`hermes-mcp`) and can be used with any MCP-compatible client — Claude Desktop, Cursor, VS Code extensions, and more.

---

## Quick Start

### Install

```bash
npm install -g @hermes/cli
```

### Start the MCP Server

```bash
hermes-mcp start
```

This launches the combined gateway with all tools registered via stdio transport.

### List Available Tools

```bash
hermes-mcp list
```

### Run a Single Tool

```bash
hermes-mcp run token_squeezer.squeeze '{"code":"const x = 1","language":"typescript"}'
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port for SSE transport |
| `LOG_LEVEL` | `info` | Logging level (debug, info, warn, error) |
| `NODE_ENV` | `development` | Runtime environment |

### ARCHITECTURE.md

The `architecture_shepherd` tools read `ARCHITECTURE.md` files following the [Hermes Architecture Manifest](https://hermes-agent.nousresearch.com/docs/architecture) format:

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
description: External integrations
allowed_dependencies: [application, domain]
```

### .hermesrc.json

Optional project-level configuration file:

```json
{
  "token_squeezer": {
    "default_aggressiveness": "balanced",
    "preserve_imports": true
  },
  "pattern_miner": {
    "custom_patterns": []
  },
  "solid_enforcer": {
    "loc_threshold": 300,
    "max_interface_methods": 10
  }
}
```

---

## MCP Server Setup

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hermes-mcp": {
      "command": "hermes-mcp",
      "args": ["start"]
    }
  }
}
```

### Cursor

In Cursor settings under **Features > MCP Servers**:

```
Name: hermes-mcp
Type: command
Command: hermes-mcp start
```

### VS Code (via Continue extension)

```json
{
  "experimental": {
    "mcpServers": {
      "hermes-mcp": {
        "command": "hermes-mcp",
        "args": ["start"]
      }
    }
  }
}
```

### SSE Transport

For HTTP-based setups:

```bash
hermes-mcp start --transport sse --port 3000
```

---

## Tools Reference

### TokenSqueezer

| Tool | Description | Inputs | Outputs |
|---|---|---|---|
| `token_squeezer.squeeze` | Reduce code context via AST manipulation | `code` (string), `language` (enum), `options` (object) | `squeezed` (string), `reduction_ratio` (number), `node_counts` (object) |

### ArchitectureShepherd

| Tool | Description | Inputs | Outputs |
|---|---|---|---|
| `architecture_shepherd.load_manifest` | Load and parse an ARCHITECTURE.md manifest | `path` (string), `content` (string) | `valid` (boolean), `violations` (array), `warnings` (array) |
| `architecture_shepherd.check` | Check file paths against manifest layer boundaries | `paths` (string[]), `manifest_id` (string) | Violation results |
| `architecture_shepherd.check_diff` | Check a git diff against manifest boundaries | `diff` (string), `manifest_id` (string) | Violation results |

### PatternMiner

| Tool | Description | Inputs | Outputs |
|---|---|---|---|
| `pattern_miner.scan` | Scan code paths for anti-patterns and issues | `paths` (string[]) | Matches with severity |
| `pattern_miner.find_dead_code` | Detect unused exports and dead code | `paths` (string[]) | Dead code locations |
| `pattern_miner.get_pattern_catalog` | Get all registered patterns | — | Pattern definitions |
| `pattern_miner.learn_pattern` | Register a custom pattern | `definition` (object) | Confirmation |

### RepoGraph

| Tool | Description | Inputs | Outputs |
|---|---|---|---|
| `repograph.query` | Query the code knowledge graph | `query` (string), `file_path` (string), `scope` (enum) | Matched nodes |
| `repograph.index` | Index a codebase into the knowledge graph | `path` (string) | Indexing stats |

### TaskRouter

| Tool | Description | Inputs | Outputs |
|---|---|---|---|
| `task_router.estimate` | Estimate task complexity | `task_description` (string), `constraints` (object) | Complexity, model recommendation, cost |
| `task_router.decompose` | Decompose a task into subtasks | `task_description` (string), `constraints` (object) | Subtask list |

### SOLIDEnforcer

| Tool | Description | Inputs | Outputs |
|---|---|---|---|
| `solid_enforcer.audit` | Run SOLID principle checks | `code` (string), `file_path` (string), `options` (object) | Per-principle results |
| `solid_enforcer.generate_di_template` | Generate DI template | `class_name` (string), `interfaces` (string[]), `language` (string) | Code template |

---

## Development

### Prerequisites

- Node.js 18+
- npm 9+

### Setup

```bash
git clone https://github.com/nousresearch/hermes-mcp-toolset.git
cd hermes-mcp-toolset
npm install
```

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

### Lint

```bash
npm run lint
```

### Package Structure

```
packages/
  shared/          — Shared Zod schemas, types, and utilities
  mcp-gateway/     — Combined MCP server (registeres all tools)
  token-squeezer/  — AST context reduction (3 levels, 6 languages)
  architecture-shepherd/ — ARCHITECTURE.md parser + layer validation
  repograph/       — In-memory code knowledge graph
  pattern-miner/   — Code pattern detection + dead code analysis
  solid-enforcer/  — SOLID principle checking (5 rules)
  task-router/     — Complexity estimation + subtask decomposition
  cli/             — Unified CLI entry point (hermes-mcp)
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    MCP Client                            │
│            (Claude Desktop, Cursor, etc.)                │
└──────────────────────┬──────────────────────────────────┘
                       │ MCP Protocol (stdio/SSE)
                       ▼
┌─────────────────────────────────────────────────────────┐
│                   hermes-mcp CLI                         │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │   start       │  │   run        │  │   list         │ │
│  └──────┬───────┘  └──────┬───────┘  └───────┬────────┘ │
└─────────┼──────────────────┼──────────────────┼──────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────┐
│                  MCP Gateway (@hermes/mcp-gateway)       │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │ TokenSqueezer │  │   Pattern    │  │     SOLID      │ │
│  │   (Phase 1)   │  │   Miner      │  │    Enforcer    │ │
│  │               │  │   (Phase 4)  │  │    (Phase 5)   │ │
│  └──────────────┘  └──────────────┘  └────────────────┘ │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │Architecture  │  │  RepoGraph   │  │   TaskRouter   │ │
│  │  Shepherd    │  │  (Phase 3)   │  │   (Phase 4)    │ │
│  │  (Phase 2)   │  │              │  │                │ │
│  └──────────────┘  └──────────────┘  └────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## Contributing

See CONTRIBUTING.md for detailed guidelines.

Quick summary:
- Fork, branch, PR from `main`
- Tests must pass (100%)
- Follow TypeScript strict mode + ESM conventions
- Keep PRs focused

---

## License

MIT © Nous Research

---

*Hermes MCP Toolset — Part of the [Hermes Agent](https://hermes-agent.nousresearch.com) ecosystem.*
