# Execution Layer, Escalation Workflow & Pipeline Orchestration

This document details the architecture of the **Execution Layer**, the **Human Review Escalation Workflow**, the **Notification Service Abstraction**, and the **End-to-End Pipeline Orchestrator** in the Autonomous Revenue Recovery Control Plane.

---

## 1. End-to-End Pipeline Architecture

The recovery pipeline connects all 6 autonomous control layers in strict sequential order:

```
┌─────────────────────────────────────────────────────────────┐
│ [Stage 1] RISK INTELLIGENCE LAYER                           │
│   Computes health score, trajectory, root cause, & ERV      │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│ [Stage 2] AI RECOVERY PLANNER                               │
│   Formulates proposed action (Zero Execution Authority)     │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│ [Stage 3] DETERMINISTIC POLICY ENGINE ("PERMIT")            │
│   Validates rail caps, NPCI limits, & contact quotas        │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│ [Stage 4] COHORT CIRCUIT BREAKER GUARD                      │
│   Detects systemic bank/rail outage & intercepts actions    │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│ [Stage 5] SAFETY & VERIFICATION GATEWAY                     │
│   Reconciles live bank API vs cached DB ("2 AM" Guard)      │
└─────────────────────────────┬───────────────────────────────┘
                              │
             ┌────────────────┴────────────────┐
             │                                 │
      [Verification SAFE]              [BLOCKED / ESCALATED]
             │                                 │
             ▼                                 ▼
┌─────────────────────────────┐ ┌─────────────────────────────┐
│ [Stage 6A] EXECUTION LAYER  │ │ [Stage 6B] ESCALATION QUEUE │
│  - schedule_retry           │ │  - Table: escalation_queue  │
│  - proactive_nudge          │ │  - Status: pending          │
│  - pause subscription       │ │  - Human review REST API    │
│  - NO_ACTION (audit only)   │ │  - Resolve with audit trail │
└─────────────────────────────┘ └─────────────────────────────┘
```

---

## 2. Action Handlers

| Action                     | Execution Handler                    | Downstream Destination          | Audit Event Logged                          |
| :------------------------- | :----------------------------------- | :------------------------------ | :------------------------------------------ |
| `retry` / `schedule_retry` | Razorpay recurring charge API        | Razorpay Billing Engine         | `action_executed` (`status = 'scheduled'`)  |
| `proactive_nudge`          | NotificationService abstraction      | Email / SMS / WhatsApp provider | `action_executed` (`status = 'nudged'`)     |
| `pause`                    | Razorpay pause API with grace period | Razorpay Subscription Engine    | `action_executed` (`status = 'paused'`)     |
| `NO_ACTION`                | No-op handler                        | None (Autonomous inaction)      | `action_noop` (`status = 'no_op'`)          |
| `escalate`                 | EscalationService                    | `escalation_queue` Table        | `action_escalated` (`status = 'escalated'`) |

---

## 3. Human Escalation Workflow & REST APIs

When an automated action is blocked by the Policy Engine, Circuit Breaker, or Verification Gateway, it is routed to the human operator escalation queue:

### List Pending Escalations:

`GET /api/escalations?status=pending`

### Resolve Escalation:

`POST /api/escalations/:id/resolve`

```json
{
  "resolvedBy": "lead_ops_specialist",
  "resolutionNotes": "Bank gateway outage cleared; customer confirmed intent via SMS.",
  "status": "resolved"
}
```

---

## 4. Architectural Decoupling: Script Independence

To ensure batch scripts (`npm run pipeline:batch`, `npm run seed:synthetic`, etc.) never hang or unexpectedly bind network ports:

1. The **Fastify HTTP listener** is isolated in [`server/src/server.ts`](../server/src/server.ts).
2. The core library entrypoint [`server/src/index.ts`](../server/src/index.ts) purely exports classes, functions, and schemas without calling `.listen()`.
3. CLI scripts import only the orchestrator and database connections, and explicitly close resources (`await closePool()`) before executing `process.exit(0)`.
4. Automated architectural regression tests ([`server/test/architecture-boundary.test.ts`](../server/test/architecture-boundary.test.ts)) continuously enforce that scripts have zero HTTP server dependencies.

---

## 5. Run Full Batch Execution

```bash
npm run pipeline:batch
```
