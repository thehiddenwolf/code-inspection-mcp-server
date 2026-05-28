.PHONY: build rebuild test lint clean dev install format ci check-solid lint-eslint lint-tsc depcruise

# ── Variables ───────────────────────────────────────────────────────────────
NPM ?= npm
TSC ?= npx tsc
PYTHON ?= /home/kerwin/.code-inspect-mcp/hermes-agent/venv/bin/python

TS_FILES ?= 'packages/*/src/**/*.ts'
TEST_FILES ?= 'packages/*/test/**/*.ts'

# ── Install ──────────────────────────────────────────────────────────────────
install:
	$(NPM) install

# ── Build ────────────────────────────────────────────────────────────────────
build:
	$(NPM) run build

rebuild:
	$(NPM) run rebuild

# ── Test ─────────────────────────────────────────────────────────────────────
test-js:
	$(NPM) test -- --run

test-python:
	$(PYTHON) -m unittest packages/mcp-registry/test_plugin.py
	$(PYTHON) -m unittest tests/integration/test_full_pipeline.py

test: test-js test-python

test-watch:
	$(NPM) test -- --watch

test-coverage:
	$(NPM) test -- --coverage

# ── Lint ─────────────────────────────────────────────────────────────────────
lint: lint-tsc lint-eslint

lint-tsc:
	$(TSC) --noEmit

lint-eslint:
	$(NPM) run lint:eslint

lint-fix:
	$(TSC) --noEmit && $(NPM) run lint:eslint -- --fix


# ── SOLID Checks ─────────────────────────────────────────────────────────────
check-solid:
	$(NPM) run check-solid

check-solid-diff:
	$(NPM) run check-solid -- --compare-branch origin/main

depcruise:
	npx depcruise packages/ --ts-config tsconfig.json

# ── Dev ──────────────────────────────────────────────────────────────────────
dev:
	$(NPM) run dev

# ── Clean ────────────────────────────────────────────────────────────────────
clean:
	$(NPM) run clean

clean-all:
	$(NPM) run clean:all

# ── Format ───────────────────────────────────────────────────────────────────
format:
	npx prettier --write $(TS_FILES) $(TEST_FILES)

format-check:
	npx prettier --check $(TS_FILES) $(TEST_FILES)

# ── CI Pipeline ──────────────────────────────────────────────────────────────
ci: install lint build test check-solid-diff depcruise

# ── Gateway ──────────────────────────────────────────────────────────────────
gateway-start:
	node packages/mcp-gateway/dist/index.js

gateway-dev:
	npx tsx packages/mcp-gateway/src/index.ts

# ── Shared ───────────────────────────────────────────────────────────────────
shared-build:
	cd packages/shared && $(TSC)

shared-test:
	cd packages/shared && $(NPM) test

# ── Docker ───────────────────────────────────────────────────────────────────
docker-up:
	docker compose up -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

# ── Help ─────────────────────────────────────────────────────────────────────
help:
	@echo "Hermes MCP Toolset — Makefile"
	@echo ""
	@echo "Targets:"
	@echo "  install          Install all dependencies"
	@echo "  build            Build all packages"
	@echo "  test             Run all tests"
	@echo "  lint             Type-check + ESLint (includes SonarJS code smells)"
	@echo "  lint-tsc         Type-check only"
	@echo "  lint-eslint      ESLint only (includes SonarJS)"
	@echo "  check-solid      Run SOLID enforcer (full scan)"
	@echo "  check-solid-diff Run SOLID enforcer (diff-mode for CI)"
	@echo "  depcruise        Run dependency-cruiser architectural checks (DIP focus)"
	@echo "  format           Format source code"
	@echo "  clean            Remove build artifacts"
	@echo "  ci               Full CI pipeline (install → lint → build → test → solid → arch)"
	@echo "  gateway-dev      Run MCP gateway in dev mode (tsx)"
	@echo "  docker-up        Start docker compose environment"
