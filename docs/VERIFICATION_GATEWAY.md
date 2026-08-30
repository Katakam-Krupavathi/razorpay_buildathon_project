# Safety & Verification Gateway ("2 AM" Pre-Action Guard)

This document specifies the architectural invariants, the 4-point pre-action verification checks, the zero-trust cache philosophy, and the signature "2 AM" stale-state demo sequence implemented in the **Safety & Verification Gateway** of the Autonomous Revenue Recovery Control Plane.

---

## 1. Zero-Trust Cache Philosophy & Execution Boundary

> [!CAUTION]
> **Pre-Action Air Gap**:
> The Verification Gateway runs **immediately before execution** — never at decision time.
> The local database and cache are treated as **strictly advisory**. Only the live bank/gateway state from Razorpay's API is authoritative.

```
┌─────────────────────────────────────────────────────────────┐
│                    POLICY ENGINE ("PERMIT")                 │
│                 Formulates recovery decision                │
└─────────────────────────────┬───────────────────────────────┘
                              │
                    Policy Decision Record
                              │
┌─────────────────────────────▼───────────────────────────────┐
│              SAFETY & VERIFICATION GATEWAY                  │
│             Runs immediately before execution               │
│                                                             │
│  [1] Live State Check       : Live API vs Local DB Cache    │
│  [2] Idempotency Check      : Duplicate Action Conflict     │
│  [3] Circuit Breaker Check  : Cohort Outage Re-Check        │
│  [4] Policy Freshness Check : Decision Age <= 15 min TTL    │
└─────────────────────────────┬───────────────────────────────┘
                              │
             ┌────────────────┴────────────────┐
             │                                 │
      [All 4 Pass]                      [Any Check Fails]
             │                                 │
             ▼                                 ▼
   VERIFIED_SAFE (Proceed)             BLOCKED (Abort Action)
             │                                 │
             ▼                                 ├─ Emit 'stale_state_detected'
      EXECUTION LAYER                          ├─ Emit 'action_blocked'
  (Razorpay / Notifications)                   └─ Route to Human Review Queue
```

---

## 2. The 4 Pre-Action Safety Checks

| Check                         | Objective                                         | Failure Condition                                  | Blocked Reason Code        |
| :---------------------------- | :------------------------------------------------ | :------------------------------------------------- | :------------------------- |
| **1. LIVE_STATE_CHECK**       | Query Razorpay/bank live token API                | Cached `active`, live `revoked`/`paused`/`expired` | `STALE_STATE_DISAGREEMENT` |
| **2. IDEMPOTENCY_CHECK**      | Ensure unique execution key                       | Key was already processed                          | `IDEMPOTENCY_CONFLICT`     |
| **3. CIRCUIT_BREAKER_CHECK**  | Verify cohort has not tripped since decision time | Cohort breaker is `OPEN`                           | `CIRCUIT_BREAKER_OPEN`     |
| **4. POLICY_FRESHNESS_CHECK** | Ensure decision is recent                         | Decision age $> 900\text{s}$ (15 mins)             | `POLICY_DECISION_STALE`    |

---

## 3. The Signature 2 AM Stale-State Demo

### Scenario:

A high-value subscriber revokes their UPI/card mandate directly in their mobile banking app at 02:00 AM. No webhook has arrived yet, so the local database still records `mandate_status = 'active'`.

When the scheduled recovery retry fires:

1. The **Policy Engine** permits the retry because local DB says `active`.
2. The **Verification Gateway** queries the live Razorpay API pre-execution and discovers the mandate is `revoked`.
3. The Gateway **immediately aborts** execution.
4. Emits `stale_state_detected` and `action_blocked` events into the hash-chained `EventStore`.
5. Routes the subscription to the customer success team for alternate payment method outreach.

### Run Signature Demo:

```bash
npm run demo:stale-cache
```

---

## 4. Dev Test Hooks for Live Demonstration

To simulate silent bank revocation without webhook latency during live demonstrations:

### Endpoints:

- `POST /api/dev/simulate-mandate-revocation`
  ```json
  {
    "instrumentId": "inst_card_0045",
    "mandateStatus": "revoked"
  }
  ```
- `POST /api/dev/clear-overrides`
  ```json
  {}
  ```
