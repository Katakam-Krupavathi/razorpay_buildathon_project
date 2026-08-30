# ==============================================================================
# Autonomous Revenue Recovery Control Plane — Makefile
# ==============================================================================

.PHONY: all demo bootstrap test build lint clean help

all: build test

## demo: One-command demo bootstrap & run (resets DB, seeds synthetic data, runs recovery pipeline batch, starts API & UI)
demo:
	npm run demo

## bootstrap: Resets DB, seeds deterministic dataset (seed=42), and runs recovery pipeline once
bootstrap:
	npm run demo:bootstrap

## test: Runs unit, component, and end-to-end integration tests across all workspaces
test:
	npm test

## build: TypeScript compiles all packages and builds Vite production web bundle
build:
	npm run build

## lint: Runs ESLint across the entire monorepo
lint:
	npm run lint

## clean: Removes dist, build, and node_modules artifacts
clean:
	npm run clean

## help: Displays available Makefile targets
help:
	@echo "Available commands:"
	@echo "  make demo       - Bootstrap and launch the complete control plane demo"
	@echo "  make bootstrap  - Reset database and initialize synthetic recovery data"
	@echo "  make test       - Run full test suite across all 4 workspaces"
	@echo "  make build      - Build all packages (TypeScript + Vite)"
	@echo "  make lint       - Run strict ESLint checks"
	@echo "  make clean      - Clean build artifacts"
