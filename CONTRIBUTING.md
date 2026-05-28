# Contributing to Hermes MCP Toolset

Thanks for your interest in contributing! Here's how to get started.

## Setup

```bash
git clone https://github.com/nousresearch/hermes-mcp-toolset.git
cd hermes-mcp-toolset
npm install
npm run build
```

## Code Style

- **TypeScript strict mode**: All packages use `strict: true` in their tsconfig.
- **ESM only**: All code is written as ES modules (`type: "module"` in package.json).
- **SOLID principles**: We practice what we preach — code should be testable, composable, and single-responsibility.
- **Naming**: Use `camelCase` for variables/functions, `PascalCase` for classes/types, `UPPER_SNAKE_CASE` for constants.

## Package Naming

All packages live under `packages/` and follow the `@hermes/<name>` naming convention:

- `@hermes/shared` — shared schemas, types, utilities
- `@hermes/mcp-gateway` — combined MCP server registration
- `@hermes/token-squeezer` — AST context reduction
- `@hermes/architecture-shepherd` — architecture manifest validation
- `@hermes/repograph` — code knowledge graph
- `@hermes/pattern-miner` — code pattern detection
- `@hermes/solid-enforcer` — SOLID principle checking
- `@hermes/task-router` — complexity estimation + decomposition
- `@hermes/cli` — unified CLI entry point

## Testing

- Tests are written with **vitest** and live in `packages/<name>/test/`.
- Every PR must have **100% of existing tests passing** before review.
- Run tests: `npm test` or `npx vitest run`
- Run a single package: `npx vitest run packages/<name>`
- Coverage: `npx vitest run --coverage`

## Pull Request Process

1. Fork the repo and create a feature branch from `main`.
2. Make your changes, following the code style above.
3. Add or update tests as needed.
4. Run `npm run build` and `npm test` to verify everything works.
5. Open a PR with a clear title and description of the change.
6. Keep PRs focused — one feature or fix per PR.

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat: add token-squeezer inline comments support`
- `fix: correct edge case in pattern miner regex`
- `docs: update README with new tool reference`
- `chore: update dependencies`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
