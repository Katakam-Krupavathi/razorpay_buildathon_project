# Autonomous Revenue Recovery Control Plane

[![CI](https://github.com/Katakam-Krupavathi/razorpay_buildathon_project/actions/workflows/ci.yml/badge.svg)](https://github.com/Katakam-Krupavathi/razorpay_buildathon_project/actions/workflows/ci.yml)
[![Node Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **A Razorpay Mandate-Aware Subscription Recovery System engineered with an autonomous control loop: Predict, Permit, Guard, Verify, Execute, and Measure.**

---

## 🌟 Project Vision

Recurring revenue in modern SaaS and subscription businesses is vulnerable to silent failures: involuntary churn from expired cards, transient UPI bank downtimes, RBI mandate limit thresholds, and poorly timed retry storms. Traditional dunning systems rely on static, scheduled retry rules that degrade customer trust, trip payment gateways, and incur avoidable fee penalties.

The **Autonomous Revenue Recovery Control Plane** replaces blind retries with an intelligent, closed-loop control system:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              AUTONOMOUS REVENUE RECOVERY CONTROL PLANE                                  │
├──────────────┬──────────────┬──────────────────┬──────────────────┬──────────────────┬─────────────────┤
│ 1. PREDICT   │ 2. PERMIT    │ 3. GUARD         │ 4. VERIFY        │ 5. EXECUTE       │ 6. MEASURE      │
├──────────────┼──────────────┼──────────────────┼──────────────────┼──────────────────┼─────────────────┤
│ • Failure    │ • Autonomous │ • Rolling-Window │ • Mandate State  │ • Multi-Rail     │ • NVR Accounting│
│   Taxonomy   │   Policy     │   Circuit        │   Validation     │   Fallback       │ • Cryptographic │
│ • ERV &      │   Engine     │   Breakers       │ • RBI Pre-Debit  │   (UPI, Card,    │   SHA-256 Ledger│
│   Churn Risk │ • NPCI / RBI │ • Auto-Trip &    │   Rule Check     │   Smart Dunning) │ • Explainable   │
│   Scoring    │   Limits     │   Manual Reset   │ • 2 AM Stale-    │ • Human Queue    │   Decision Trace│
│ • Advisory   │ • Bounded    │ • Error Spike    │   State Guard    │   Escalation     │ • Live Operator │
│   Planner    │   Overrides  │   Shield         │                  │                  │   Dashboard     │
└──────────────┴──────────────┴──────────────────┴──────────────────┴──────────────────┴─────────────────┘
```

---

## 🏗️ Build Status & Subsystem Architecture

The codebase is fully integrated, typechecked, and tested across all core layers. Below is the real operational status of each subsystem:

| Subsystem / Layer | Implementation Status | Implementation Details | Key Source Files | Test Coverage |
| :--- | :--- | :--- | :--- | :--- |
| **Monorepo & Infrastructure** | **Implemented** | Strict TypeScript, npm workspaces (`shared`, `server`, `web`, `scripts`), Docker Compose (Postgres 16 + Redis 7), GitHub Actions CI. | `package.json`<br>`docker-compose.yml`<br>`.github/workflows/ci.yml` | Full workspace build & lint pass |
| **Event Store & Ledger** | **Implemented** | SHA-256 canonical hash chaining with genesis hash `000000...`, PostgreSQL immutability trigger (`prevent_event_mutation`). | `server/src/event-store/event-store.ts`<br>`server/src/event-store/hasher.ts`<br>`server/src/db/migrator.ts` | `server/test/event-store.test.ts` (10 tests) |
| **Razorpay Ingestion & Client** | **Implemented** | HMAC-SHA256 signature verification, 9-event webhook state projection (`payment.failed`, `subscription.pending`, etc.), SDK client wrapper. | `server/src/razorpay/webhook-verifier.ts`<br>`server/src/razorpay/webhook-processor.ts`<br>`server/src/razorpay/client.ts` | `server/test/webhook.test.ts`<br>`server/test/razorpay-client.test.ts` |
| **Synthetic Dataset Engine** | **Implemented** | Mulberry32 PRNG (seed=42), 100 subscriptions, 528 chained events, realistic Card/UPI/eNACH failure lifecycles, ₹1.04 Cr ARR. | `scripts/src/synthetic/generator.ts`<br>`scripts/src/synthetic/seeder.ts` | `scripts/test/synthetic-generator.test.ts` (10 tests) |
| **Risk Intelligence & ERV** | **Implemented** | Weighted-sum scoring function ($S \in [0, 1]$), 7-cause failure taxonomy, Expected Recovery Value ($P(\text{recovery}) \times \text{LTV}$), Opportunity Queue. | `server/src/risk/scorer.ts`<br>`server/src/risk/erv-engine.ts`<br>`server/src/risk/health-service.ts` | `server/test/risk-scorer.test.ts`<br>`server/test/health-service.test.ts` |
| **AI Recovery Planner** | **Implemented** | Pure advisory planner with **Zero Execution Authority** structurally enforced; generates `ProposedActionRecord` and `NO_ACTION` outcomes. | `server/src/planner/planner.ts`<br>`server/src/planner/planner-service.ts` | `server/test/planner.test.ts`<br>`server/test/planner-boundary.test.ts` |
| **Deterministic Policy Engine** | **Implemented** | Literal versioned config (`policy-config.json`), NPCI UPI 1+3 retry cap, RBI AFA ₹15k step-up threshold, 1-nudge cap, grace period pauses. | `server/src/policy/engine.ts`<br>`server/src/policy/policy-service.ts`<br>`server/src/policy/policy-config.json` | `server/test/policy-engine.test.ts` (9 tests) |
| **Cohort Circuit Breaker** | **Implemented** | Rolling window ($N=20$), 40% success rate threshold, single-trip invariant guarantee, fail-closed pipeline guard, human manual reset API. | `server/src/circuit-breaker/circuit-breaker.ts`<br>`server/src/circuit-breaker/circuit-breaker-guard.ts` | `server/test/circuit-breaker.test.ts` (9 tests) |
| **Verification Gateway** | **Implemented** | Pre-action zero-trust check (Live state API vs local DB cache), idempotency validation, circuit breaker re-check, signature 2 AM stale-state demo. | `server/src/verification/gateway.ts`<br>`server/src/routes/dev-hooks.ts` | `server/test/verification-gateway.test.ts` (7 tests) |
| **Execution Layer & Escalation** | **Implemented** | Multi-rail action dispatchers (`schedule_retry`, `proactive_nudge`, `pause`, `NO_ACTION`), human ops review queue (`escalation_queue`). | `server/src/execution/execution-service.ts`<br>`server/src/escalation/escalation-service.ts` | `server/test/execution-layer.test.ts`<br>`server/test/escalation.test.ts` |
| **Outcome Attribution & Counterfactual** | **Implemented** | Realized financial tracking with 15% proactive and 30% reactive baseline discounts, Net Value Recovered (NVR), Top-line Scorecard rollup. | `server/src/attribution/attribution-service.ts`<br>`server/src/attribution/counterfactual-engine.ts` | `server/test/attribution.test.ts` (7 tests) |
| **Decision Trace & Compliance Service** | **Implemented** | Chronological 8-stage decision trace assembly directly from event store, natural language explainability narrative, pre-canned regulatory queries. | `server/src/audit/decision-trace-service.ts`<br>`server/src/audit/compliance-service.ts` | `server/test/audit-compliance.test.ts` (10 tests) |
| **Revenue Command Center UI** | **Implemented** | React 18 + Tailwind dashboard: Scorecard Banner, Opportunity Queue, Sparkline Instrument List, Decision Trace Modal, Presenter Bar. | `web/src/App.tsx`<br>`web/src/components/*` | `web/test/dashboard.test.tsx`<br>`web/test/app.test.ts` |
| **End-to-End Control Loop** | **Implemented** | Autonomous pipeline orchestrator exercising full control loop from webhook ingestion through to dashboard outcome. | `server/src/pipeline/orchestrator.ts`<br>`scripts/src/run-demo-bootstrap.ts` | `server/test/e2e-pipeline.test.ts` (6 tests) |
| **Notification Provider Gateway** | *Stubbed / Abstracted* | Structured channel abstraction logging simulated email/SMS/WhatsApp deliveries with idempotency keys. (Twilio/Gupshup ready). | `server/src/notifications/notification-service.ts` | Covered in execution layer tests |

---

## 🛠️ Technology Stack & Engineering Justification

| Layer                       | Technology                     | Engineering Rationale                                                                                                                                 |
| :-------------------------- | :----------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Monorepo**                | npm Workspaces                 | Native, zero-overhead workspace management across shared types, server, web UI, and scripts without complex build tooling dependencies.               |
| **Language**                | TypeScript (Strict Mode)       | End-to-end type safety, unified domain contracts shared across ingestion, policy evaluation, execution, and presentation tiers.                       |
| **Backend Framework**       | Fastify (Node.js 20+ LTS)      | High-throughput, low-latency asynchronous processing essential for processing bursty Razorpay webhook streams and real-time policy evaluation.        |
| **Event Store & Database**  | PostgreSQL 16                  | Relational consistency, JSONB support for immutable event sourcing and complex state audit trails, ACID transactions for financial ledger operations. |
| **Cache & Circuit Breaker** | Redis 7                        | Sub-millisecond atomic counters, sliding window rate limiters, distributed state locks, and instant circuit-breaker trip states.                      |
| **Frontend Dashboard**      | React 18 + Vite + Tailwind CSS | Ultra-fast client build and instant feedback dashboard with real-time metrics, live event stream visualization, and policy overrides.                 |
| **Containerization**        | Docker Compose                 | Reproducible local development infrastructure for PostgreSQL and Redis with healthchecks and persistent volumes.                                      |
| **CI / CD Pipeline**        | GitHub Actions                 | Automated dependency caching, multi-package linting, typechecking, and unit test validation on every push and pull request.                           |

---

## 🚀 One-Command Quickstart & Demo

For evaluators and judges to launch the complete system cold with zero manual setup:

```bash
# 1. Start local PostgreSQL & Redis containers
docker compose up -d

# 2. Run one-command demo bootstrap (resets DB, seeds synthetic batch, runs recovery pipeline, starts API & UI)
make demo
# OR: npm run demo
```

- **Web Command Center Dashboard**: [http://localhost:5173](http://localhost:5173)
- **Fastify Control Plane API**: [http://localhost:4000](http://localhost:4000) (Health: [http://localhost:4000/health](http://localhost:4000/health))
- **Live Demo Script & Pitch Walkthrough**: See [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md)
- **Evaluation Criteria Traceability Matrix**: See [`docs/EVALUATION_MAPPING.md`](docs/EVALUATION_MAPPING.md)
- **Detailed Subsystem Documentation**:
  - [Architecture Specification](docs/ARCHITECTURE.md)
  - [Deterministic Policy Engine Ruleset](docs/POLICY.md)
  - [Safety & Verification Gateway ("2 AM" Guard)](docs/VERIFICATION_GATEWAY.md)
  - [Cohort Circuit Breakers & Outage Protection](docs/CIRCUIT_BREAKER.md)
  - [AI Recovery Planner (Zero Execution Authority)](docs/RECOVERY_PLANNER.md)
  - [Expected Recovery Value (ERV) Formulation](docs/ERV_CONFIG.md)
  - [Risk Intelligence Scoring Function](docs/RISK_SCORING.md)
  - [Counterfactual Financial Attribution Method](docs/COUNTERFACTUAL_METHOD.md)
  - [Razorpay Webhook & Integration Reference](docs/RAZORPAY_INTEGRATION.md)
  - [Execution Layer & Orchestration](docs/EXECUTION_LAYER.md)
  - [Synthetic Dataset Summary Report](docs/SAMPLE_BATCH_SUMMARY.md)

---

## 🛠️ Step-by-Step Manual Setup

### Prerequisites
- **Node.js**: `v20.0.0` or higher (Node 22 LTS recommended)
- **npm**: `v10.0.0` or higher
- **Docker & Docker Compose**: Installed and running

### 1. Install Dependencies & Configure Environment
```bash
git clone https://github.com/Katakam-Krupavathi/razorpay_buildathon_project.git
cd razorpay_buildathon_project
npm install
cp .env.example .env
```

### 2. Database Migrations & Synthetic Data Seeding
```bash
docker compose up -d

# Reset database & apply schema
npm run db:reset

# Seed deterministic 100-subscription synthetic dataset (seed=42)
npm run seed:synthetic

# Execute autonomous recovery pipeline batch across dataset
npm run pipeline:batch

# Run regulatory compliance audit query engine
npm run audit:compliance
```

### 3. Start Development Servers
```bash
npm run dev
```

---

## 🧪 Comprehensive Automated Testing & Quality Pass

```bash
# Run unit, component, and end-to-end integration tests across all 4 workspaces (145 tests)
npm test

# Run strict ESLint checks across entire repository (zero errors, zero warnings)
npm run lint

# Compile all TypeScript workspaces and build production Vite web bundle
npm run build
```

---

## 📁 Monorepo Layout

```
.
├── .github/
│   └── workflows/
│       └── ci.yml               # GitHub Actions CI workflow
├── docs/                        # Subsystem design docs, pitch script, and evaluation mapping
├── server/                      # Fastify API server, Webhook ingestion, Pipeline & Control Plane
│   ├── src/
│   │   ├── attribution/         # Outcome attribution & counterfactual engine
│   │   ├── audit/               # Decision trace assembly & compliance query service
│   │   ├── circuit-breaker/     # Rolling window cohort circuit breaker & pipeline guard
│   │   ├── db/                  # PostgreSQL connection pool & migration runner
│   │   ├── escalation/          # Human-in-the-loop escalation queue service
│   │   ├── event-store/         # Append-only SHA-256 hash-chained event store
│   │   ├── execution/           # Multi-rail action dispatchers & handlers
│   │   ├── notifications/       # Notification delivery abstraction
│   │   ├── pipeline/            # End-to-end autonomous recovery orchestrator
│   │   ├── planner/             # AI Recovery Planner (zero execution authority)
│   │   ├── policy/              # Deterministic Policy Engine ("PERMIT")
│   │   ├── razorpay/            # Webhook signature verifier & Razorpay client SDK
│   │   ├── risk/                # Risk Intelligence scoring & ERV engine
│   │   ├── routes/              # Fastify REST endpoints & dev simulation hooks
│   │   └── verification/        # Safety & Verification Gateway ("2 AM" guard)
│   └── test/                    # 126 unit, component, boundary, and e2e test suites
├── web/                         # React 18 + Vite + Tailwind CSS Dashboard UI
│   ├── src/
│   │   └── components/          # Scorecard, Opportunity Queue, Sparklines, Trace Modal
│   └── test/                    # React component tests
├── shared/                      # Shared domain types, contracts & recovery schemas
│   ├── src/
│   └── test/
├── scripts/                     # Operational scripts, migration runners & synthetic generator
│   ├── src/
│   │   └── synthetic/           # Deterministic PRNG lifecycle generator & seeder
│   └── test/
├── docker-compose.yml           # Local PostgreSQL 16 & Redis 7 stack
├── Makefile                     # Root one-command demo, test, build, lint targets
├── .env.example                 # Environment variables specification
├── package.json                 # Monorepo root orchestration
├── tsconfig.base.json           # Base TypeScript compiler settings
└── tsconfig.json                # Project references configuration
```

---

## ⚠️ Known Limitations

1. **Razorpay Live API Integration & Test Execution Simulation**:
   - When active Razorpay API keys (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`) are provided, live REST API calls and webhooks are ingested.
   - With default placeholder keys, money-moving execution actions (`chargeSubscription`, `pauseSubscription`) run through a clearly labeled local simulation path so evaluators can run the demo cold without credentials.
   - However, pre-action **Verification Gateway** checks strictly fail closed: any failure to positively verify live mandate/subscription state returns `BLOCK / INTERNAL_VERIFICATION_ERROR` (zero silent passes).
2. **Redis-Backed Circuit Breakers & Distributed State**:
   - Cohort circuit breaker states and execution idempotency tracking are backed by real Redis (`ioredis`) and PostgreSQL, with in-process fast memory caching for ultra-low latency.
3. **AI Narrative Reasoning & Zero Execution Authority**:
   - Clinical diagnostic reasoning strings are synthesized via `AiReasoningEngine`, grounded strictly in the 11-dimension `RiskFeatureVector` (with optional LLM integration when `GEMINI_API_KEY` / `OPENAI_API_KEY` is present and deterministic local synthesis fallback).
   - In accordance with the project's core safety thesis (*"AI predicts, Policy permits, Verification checks, Execution acts"*), the AI possesses structural Zero Execution Authority and cannot directly trigger charges, pause mandates, or bypass policy rules.
4. **Authentication & Notification Delivery**:
   - User authentication (RBAC) and external SMS/WhatsApp delivery (Twilio/Gupshup) use structured abstractions suitable for prototype evaluation, ready to be wired to enterprise IdPs and SMS aggregators in production.

---

## 📜 License

MIT © 2026 Autonomous Revenue Recovery Control Plane Team
