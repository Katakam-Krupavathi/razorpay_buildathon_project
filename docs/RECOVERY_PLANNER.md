# AI Recovery Planner (Zero Execution Authority)

This document specifies the architecture, heuristic strategy matrix, explainable reasoning formulation, and architectural safety boundaries of the **AI Recovery Planner** in the Autonomous Revenue Recovery Control Plane.

---

## 1. Zero Execution Authority Structural Invariant

> [!CAUTION]
> **Strict Execution Boundary**: The Recovery Planner is purely advisory. It produces structured `ProposedActionRecord` recommendations. It has **zero execution authority** and no capability to trigger payments, modify gateway state, or dispatch notifications.

```
┌─────────────────────────────────────────────────────────────┐
│                    AI RECOVERY PLANNER                      │
│                                                             │
│  [Input: HealthScore + RootCause + ERV + Features + LTV]    │
│                             │                               │
│                             ▼                               │
│  Deterministic Strategy Formulator & Reasoning Engine       │
│                             │                               │
│                             ▼                               │
│  [Output: ProposedActionRecord (Advisory Only)]              │
│                             │                               │
│                             ▼                               │
│  Immutable Audit Event Ingestion into Hash-Chained Store    │
│  (Actor: 'recovery_planner', EventType: 'proposed_action')   │
└─────────────────────────────┬───────────────────────────────┘
                              │
                    STRUCTURAL AIR GAP
                              │
┌─────────────────────────────▼───────────────────────────────┐
│               DOWNSTREAM VERIFICATION & POLICY              │
│  - Phase 6: Policy Engine (Permit / Deny / Throttle)        │
│  - Phase 7: Circuit Breaker & Safety Invariants             │
│  - Phase 8: Verification Gateway (Live Token Check)         │
│  - Phase 9: Execution Engine (Razorpay Invocations)         │
└─────────────────────────────────────────────────────────────┘
```

### Architectural Guard:

An automated architectural test ([`server/test/planner-boundary.test.ts`](../server/test/planner-boundary.test.ts)) statically inspects the codebase to guarantee that no files in `server/src/planner/` import or depend upon:

- Razorpay client wrappers or payment gateways
- HTTP client libraries (`fetch`, `axios`, `http`)
- Downstream execution or notification modules

---

## 2. Proposed Action Types

| Action Type       | Operational Purpose                                                                | Downstream Target Rail        |
| :---------------- | :--------------------------------------------------------------------------------- | :---------------------------- |
| `NO_ACTION`       | No intervention required (HEALTHY cohort or uneconomical low LTV terminal decline) | None                          |
| `schedule_retry`  | Enqueue automated retry in optimal recovery window (e.g. next morning 09:00 AM)    | Direct debit / mandate charge |
| `proactive_nudge` | Send customer proactive card update link or UPI AFA limit upgrade link             | Email / WhatsApp Pay link     |
| `grace_period`    | Extend subscription access by 3 days while backoff retry is scheduled              | Subscription billing status   |
| `pause`           | Temporarily suspend auto-debit to avoid repeated gateway failure fees              | Subscription status           |
| `escalate`        | Flag for VIP customer success specialist or manual outreach                        | Support ticketing / CRM       |
| `retry`           | Immediate automated retry (used in transient clearing switch errors)               | Gateway retry                 |

---

## 3. Heuristic Decision Matrix

The planner evaluates the instrument context against transparent, deterministic rules:

| Condition / Root Cause          | LTV Tier        | Recovery Probability | Proposed Action   | Rationale / Parameters                                                             |
| :------------------------------ | :-------------- | :------------------- | :---------------- | :--------------------------------------------------------------------------------- |
| **HEALTHY (0 Failures)**        | Any             | 98%                  | `NO_ACTION`       | Healthy operational state; no recovery intervention needed.                        |
| **Low Value Terminal**          | Low             | < 20% (ERV < ₹500)   | `NO_ACTION`       | Intervention cost exceeds expected recovery value.                                 |
| **CARD_EXPIRY_RISK (0–20d)**    | Critical / High | 60–85%               | `proactive_nudge` | Send proactive card token migration link (`template: card_expiry_update_request`). |
| **CARD_EXPIRY_RISK (Expired)**  | Critical / High | 25%                  | `escalate`        | High-value account with expired card; manual account manager intervention.         |
| **CARD_EXPIRY_RISK (Expired)**  | Medium / Low    | 25%                  | `pause`           | Pause automated debits to prevent bank rejection penalties.                        |
| **AFA_PENDING (> ₹15k)**        | Critical / High | 70%                  | `proactive_nudge` | Send UPI mandate limit increase authorization link.                                |
| **AFA_PENDING (> ₹15k)**        | Medium / Low    | 70%                  | `schedule_retry`  | Schedule retry with customer UPI in-app approval notification.                     |
| **REPEATED_SOFT_DECLINE (1x)**  | Any             | 58–85%               | `schedule_retry`  | Initial soft decline; schedule smart retry in 24h optimal window.                  |
| **REPEATED_SOFT_DECLINE (2x)**  | Critical / High | 40–60%               | `grace_period`    | 3-day grace period granted to protect customer access.                             |
| **REPEATED_SOFT_DECLINE (2x)**  | Medium / Low    | 40–60%               | `schedule_retry`  | Secondary retry window scheduled before service pause.                             |
| **REPEATED_SOFT_DECLINE (3x+)** | Critical / High | 30%                  | `escalate`        | Retry attempts exhausted for VIP; manual outreach.                                 |
| **HARD_DECLINE_PATTERN**        | Critical / High | 20%                  | `escalate`        | Hard decline (blocked account / user revoked); escalate for alternate payment.     |
| **MANDATE_INACTIVE**            | Critical        | 10%                  | `escalate`        | Critical account mandate revoked; manual re-authentication outreach.               |
| **MANDATE_INACTIVE**            | Low / Medium    | 10%                  | `NO_ACTION`       | Mandate inactive on low tier; automated recovery halted.                           |

---

## 4. Explainable Audit Trail Event Schema

Every formulated plan is logged to the hash-chained `events` table with `actor = 'recovery_planner'`:

```json
{
  "eventType": "proposed_action",
  "actor": "recovery_planner",
  "payload": {
    "proposalId": "prop_98a7c2e1-45b6-4f12-89cd-0123456789ab",
    "instrumentId": "inst_card_0045",
    "subscriptionId": "sub_synth_0045",
    "proposedAction": "proactive_nudge",
    "rootCause": "CARD_EXPIRY_RISK",
    "expectedRecoveryValue": 4987400,
    "expectedRecoveryValueRupees": 49874,
    "confidence": 0.92,
    "reasoning": "Card instrument is 10 days from expiry (norm: 0.11). Proactive card update nudge recommended to prevent upcoming debit failure on next cycle.",
    "parameters": {
      "template": "card_expiry_update_request",
      "channel": "whatsapp_and_email",
      "daysToExpiry": 10
    },
    "evaluatedAt": "2026-08-30T13:20:00.000Z"
  }
}
```
