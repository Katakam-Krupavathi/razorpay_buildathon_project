# Autonomous Revenue Recovery Control Plane

[![CI](https://github.com/Katakam-Krupavathi/razorpay_buildathon_project/actions/workflows/ci.yml/badge.svg)](https://github.com/Katakam-Krupavathi/razorpay_buildathon_project/actions/workflows/ci.yml)
[![Node Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **A Razorpay Mandate-Aware Subscription Recovery System engineered with an autonomous control loop: Predict, Permit, Verify, Execute, and Measure.**

---

## 🌟 Project Vision

Recurring revenue in modern SaaS and subscription businesses is vulnerable to silent failures: involuntary churn from expired cards, transient UPI bank downtimes, RBI mandate limit thresholds, and poorly timed retry storms. Traditional dunning systems rely on static, scheduled retry rules that degrade customer trust, trip payment gateways, and incur avoidable fee penalties.

The **Autonomous Revenue Recovery Control Plane** replaces blind retries with an intelligent, closed-loop control system:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              AUTONOMOUS REVENUE RECOVERY CONTROL PLANE                                  │
├──────────────┬──────────────┬──────────────────┬──────────────────┬────────────────────────────────────┤
│ 1. PREDICT   │ 2. PERMIT    │ 3. VERIFY        │ 4. EXECUTE       │ 5. MEASURE                         │
├──────────────┼──────────────┼──────────────────┼──────────────────┼────────────────────────────────────┤
│ • Failure    │ • Autonomous │ • Mandate State  │ • Multi-Rail     │ • Net Value Recovered (NVR)        │
│   Taxonomy   │   Policy     │   Validation     │   Fallback       │ • Cryptographic Audit Log          │
│ • ERV &      │   Engine     │ • RBI Pre-Debit  │   (UPI, Card,    │ • Forensic Replay Engine           │
│   Churn Risk │ • Circuit    │   Rule Check     │   Smart Dunning) │ • Real-Time Operator Dashboard     │
│   Scoring    │   Breakers   │ • Balance Probe  │ • Smart Retries  │                                    │
└──────────────┴──────────────┴──────────────────┴──────────────────┴────────────────────────────────────┘
```

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

## 🗺️ 14-Phase Build Plan

The system is engineered in 14 modular, strictly verified phases:

1. **Phase 0: Project Bootstrap & Infrastructure Scaffolding** _(Current)_
   - Workspace setup, Docker Compose environment, CI workflow, shared types, base server, web dashboard scaffold, and architectural documentation.
2. **Phase 1: Database Schema, Event Store & Migration Engine**
   - PostgreSQL schema, Prisma/migration migrations, event sourcing tables, immutable audit trails, and transactional event bus.
3. **Phase 2: Razorpay Mandate Webhook Ingestion & Verification Gateway**
   - Webhook signature verification, deduplication, idempotency layer, and mandate lifecycle event ingest (`payment.failed`, `subscription.paused`, `mandate.revoked`).
4. **Phase 3: Risk Intelligence & Failure Cause Taxonomy Engine**
   - Root-cause classification for RBI mandate errors, insufficient funds, network failures, and bank-specific outage patterns.
5. **Phase 4: Expected Recovery Value (ERV) & Churn Propensity Scoring**
   - Algorithmic scoring evaluating customer lifetime value (LTV), recovery probability, retry cost, and customer friction index.
6. **Phase 5: Dynamic Recovery Planner & Dunning Strategy Engine**
   - Multi-phase recovery plans, optimal retry window prediction, and dynamic channel routing.
7. **Phase 6: Autonomous Policy Engine (Permit / Deny / Throttle Rules)**
   - Rule evaluation pipeline evaluating volume caps, customer fatigue limits, and mandate authorization boundaries.
8. **Phase 7: Circuit Breaker & Safety Invariants (Rate/Volume Limiters)**
   - Sliding-window error rate detectors, automatic trip switches, half-open state testing, and bank outage shields.
9. **Phase 8: Execution Engine & Multi-Rail Fallback**
   - Execution across UPI AutoPay, recurring card debit, automated WhatsApp payment links, and hosted dunning workflows.
10. **Phase 9: Verification Gateway & State Reconciliation**
    - Two-phase commit verification, pre-debit notifications, Razorpay payment capture confirmation, and dispute shields.
11. **Phase 10: Attribution Engine & Net Value Recovered (NVR) Accounting**
    - Financial attribution tracking gross recovered revenue minus SMS/gateway fees, calculating true recovery ROI.
12. **Phase 11: Real-Time Audit Log & Forensic Replay Engine**
    - Cryptographic SHA-256 hashed event chain, point-in-time replay, and regulatory compliance logging.
13. **Phase 12: Operator Dashboard & Live Control Plane UI**
    - High-density observability UI with live telemetry, manual override triggers, strategy sandbox, and recovery charts.
14. **Phase 13: End-to-End Simulation, Chaos Testing & Demo Playbook**
    - Realistic simulation of 10,000 subscription failures, bank outage injection, circuit breaker trip demo, and recovery benchmarks.

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
- **Live Demo Script & Pitch Walkthrough**: See [`docs/DEMO_SCRIPT.md`](file:///c:/Users/krupa/OneDrive/Desktop/buildathon/docs/DEMO_SCRIPT.md)
- **Evaluation Criteria Traceability Matrix**: See [`docs/EVALUATION_MAPPING.md`](file:///c:/Users/krupa/OneDrive/Desktop/buildathon/docs/EVALUATION_MAPPING.md)

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
# Run unit, component, and end-to-end integration tests across all 4 workspaces
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
├── docs/
│   └── ARCHITECTURE.md          # End-to-End architecture design and diagrams
├── server/                      # Fastify API server, Webhook ingestion & Control Plane
│   ├── src/
│   └── test/
├── web/                         # React + Vite + Tailwind CSS Dashboard UI
│   ├── src/
│   └── test/
├── shared/                      # Shared domain types, contracts & recovery schemas
│   ├── src/
│   └── test/
├── scripts/                     # Operational scripts, migration runners & simulation
│   ├── src/
│   └── test/
├── docker-compose.yml           # Local PostgreSQL 16 & Redis 7 stack
├── .env.example                 # Environment variables specification
├── package.json                 # Monorepo root orchestration
├── tsconfig.base.json           # Base TypeScript compiler settings
└── tsconfig.json                # Project references configuration
```

---

## ⚠️ Known Limitations

1. **Authentication & Access Control (Hackathon Scope)**:
   - User authentication and role-based access control (RBAC) are out of scope for this hackathon-scale prototype and demo artifact.
   - For enterprise production deployments, standard OpenID Connect (OIDC) / SAML 2.0 and fine-grained API Gateway token validation should be placed in front of the Fastify server and React dashboard.
2. **Razorpay Live vs Test Sandbox**:
   - The engine integrates with Razorpay Test Mode with webhook signature validation and simulated live mandate status overrides for signature 2 AM safety demonstrations.
3. **Notification Channels**:
   - Customer dunning notifications (WhatsApp/SMS/Email) currently log through a structured channel abstraction; in production, SMS/WhatsApp gateways (e.g. Gupshup/Twilio) connect directly to this abstraction.

---

## 📜 License

MIT © 2026 Autonomous Revenue Recovery Control Plane Team

