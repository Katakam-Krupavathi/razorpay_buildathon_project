# Cohort-Level Circuit Breaker & Outage Protection

This document specifies the architecture, rolling-window failure rate tracking, single-trip guarantees, zero-trust pipeline guard, and human operator reset mechanics of the **Cohort-Level Circuit Breaker** in the Autonomous Revenue Recovery Control Plane.

---

## 1. Architectural Role & Placement

The **Circuit Breaker** acts as a dynamic systemic safety net situated directly between the **Policy Engine ("PERMIT")** and the downstream **Verification Gateway / Execution Engine**.

```
┌─────────────────────────────────────────────────────────────┐
│                    POLICY ENGINE ("PERMIT")                 │
│         [Evaluates rail caps, AFA limits, nudges]           │
└─────────────────────────────┬───────────────────────────────┘
                              │
                    Policy Decision (ALLOW)
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                 CIRCUIT BREAKER PIPELINE GUARD              │
│                                                             │
│   Checks cohort health (rail:card, rail:upi_autopay, etc.)  │
│                                                             │
│   ├─ If CLOSED: Passes action to Verification Gateway       │
│   └─ If OPEN  : Intercepts & converts to BLOCK / ESCALATE   │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                    VERIFICATION GATEWAY                     │
│                 (Live Mandate Status Check)                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Rolling-Window Thresholds & Metrics

- **Window Size ($N$):** Last `20` automated recovery outcomes per cohort.
- **Minimum Evaluation Sample Size:** `10` outcomes required before evaluating tripping conditions.
- **Minimum Success Rate Threshold:** `40%` (If success rate $< 0.40$, the breaker trips to `OPEN`).
- **Cooldown Period:** `300 seconds` (5 minutes) before entering `HALF_OPEN` trial state.

### Keyed Cohort Granularity:

- Standard rail cohorts: `rail:card`, `rail:upi_autopay`, `rail:enach`
- Bank-specific sub-cohorts: `rail:enach:bank:SBIN`, `rail:card:bank:HDFC`

---

## 3. Core Safety Invariants

### A. The Single-Trip Invariant

When a systemic outage causes a cohort's success rate to collapse (e.g. from 80% to 15%):

- The breaker transitions to `OPEN` on the exact transaction that breaches the 40% threshold.
- Emits **exactly one** `circuit_breaker_tripped` event into the hash-chained `EventStore` (`actor = 'circuit_breaker'`).
- Subsequent failed transactions while the breaker is already `OPEN` do **NOT** generate duplicate trip events.

### B. Cross-Cohort Isolation

Circuit breakers are isolated per cohort key. A severe outage on `rail:upi_autopay` (NPCI clearing downtime) has zero impact on `rail:card` or `rail:enach` operations.

### C. Zero-Trust Pipeline Interception

When an allowed action targets an `OPEN` cohort:

- The `CircuitBreakerGuard` intercepts the action.
- Converts `result` to `BLOCK` and `finalAction` to `escalate`.
- Logs a `circuit_breaker_intercepted` event into the `EventStore` (`actor = 'circuit_breaker'`).

---

## 4. Human-in-the-Loop Manual Reset

Merchants and SRE operators can manually reset a tripped breaker via the REST API once bank connectivity is restored:

### REST API Endpoint:

`POST /api/circuit-breaker/reset`

```json
{
  "cohortKey": "rail:upi_autopay",
  "resetBy": "senior_sre_operator",
  "reason": "Verified NPCI UPI clearing switch connectivity restoration"
}
```

### EventStore Audit Trail:

Appends a `circuit_breaker_reset` event with `actor = 'human'`:

```json
{
  "eventType": "circuit_breaker_reset",
  "actor": "human",
  "payload": {
    "cohortKey": "rail:upi_autopay",
    "resetBy": "senior_sre_operator",
    "resetAt": "2026-08-30T13:48:00.000Z",
    "reason": "Verified NPCI UPI clearing switch connectivity restoration",
    "previousState": "OPEN"
  }
}
```
