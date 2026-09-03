# Risk Intelligence Scoring & Root Cause Taxonomy

This document specifies the transparent, explainable, deterministic scoring function and failure cause taxonomy used by the **Risk Intelligence Layer** in the Autonomous Revenue Recovery Control Plane.

---

## 1. Overview & Non-Black-Box Principles

The Risk Intelligence Layer evaluates an instrument's historical payment performance, mandate status, and expiry timelines to produce:

1. **Health Score** $\in [0.0000, 1.0000]$
2. **Trajectory Classification**: `HEALTHY`, `DEGRADING`, or `TERMINAL`
3. **Root Cause Category**: Identified failure mode taxonomy
4. **Recovery Probability** $\in [0.0000, 1.0000]$
5. **Feature Vector**: Explicit, queryable parameters explaining the exact score

> [!IMPORTANT]
> **No Black-Box ML**: In Phase 4, all scoring is computed via a transparent, weighted-sum algorithmic function. Every score is mathematically verifiable and explainable via a single database query.

---

## 2. Transparent Weighted-Sum Scoring Formula

$$S = S_0 - \sum \text{Penalties} + \text{Bonuses}$$

$$\text{Health Score} = \text{clamp}(S, 0.0000, 1.0000)$$

### Base Score:

- $S_0 = 1.00$

### Penalties:

| Signal / Condition                | Mathematical Penalty                                   | Description                                                                                     |
| :-------------------------------- | :----------------------------------------------------- | :---------------------------------------------------------------------------------------------- |
| **Mandate Inactive**              | $-0.85$                                                | Mandate status is `revoked` or `expired`                                                        |
| **Mandate Paused**                | $-0.40$                                                | Mandate status is `paused`                                                                      |
| **Hard Decline Encountered**      | $-0.50$                                                | `USER_CANCELLED_MANDATE`, `HARD_DECLINE_FRAUD_BLOCK`, `ACCOUNT_BLOCKED`, `MAX_RETRIES_EXCEEDED` |
| **Consecutive Trailing Failures** | $-0.20 \times \min(F_{\text{trailing}}, 3)$            | Penalty scales with 1, 2, or 3+ consecutive failed charges                                      |
| **Recent 3-Cycle Failure Rate**   | $-0.15 \times \min(F_{\text{recent}}, 3)$              | Soft failures within the last 3 billing cycles                                                  |
| **Card Expired**                  | $-0.70$                                                | Card expiry date is in the past ($\text{days} < 0$)                                             |
| **Card Near Expiry (0–20 Days)**  | $-0.35 \times \left(1 - \frac{\text{days}}{20}\right)$ | Linear penalty as card approaches expiry date                                                   |
| **UPI AFA Limit Over Threshold**  | $-0.30$                                                | Transaction amount exceeds RBI limit (₹15,000 / ₹1,00,000) without step-up auth                 |

### Reliability Bonus:

| Condition              | Bonus   | Description                                                 |
| :--------------------- | :------ | :---------------------------------------------------------- |
| **Historical Loyalty** | $+0.05$ | $\ge 3$ consecutive successful debits and 0 recent failures |

---

## 3. Trajectory Thresholds

```
     0.00                   0.30                    0.70                   1.00
       ├──────────────────────┼───────────────────────┼──────────────────────┤
       │       TERMINAL       │       DEGRADING       │       HEALTHY        │
       │     (Score < 0.30)   │  (0.30 <= Score < 0.70)│   (Score >= 0.70)    │
```

- **HEALTHY ($\ge 0.70$):** Normal operational state; active auto-debit continues.
- **DEGRADING ($0.30 \le \text{Score} < 0.70$):** Soft failures or approaching expiry; primary target for autonomous smart retry or proactive dunning.
- **TERMINAL ($< 0.30$):** Revoked mandate, expired card, or hard decline; requires high-friction step-up or manual escalation.

---

## 4. Root Cause Taxonomy Classification

The classification follows a deterministic priority hierarchy:

1. `MANDATE_INACTIVE`: Mandate status is `revoked` or `expired`.
2. `CARD_EXPIRY_RISK`: Card is expired ($\text{days} < 0$) or within 0–20 days of expiry.
3. `HARD_DECLINE_PATTERN`: Terminal error codes (`USER_CANCELLED_MANDATE`, `ACCOUNT_BLOCKED`, `FRAUD_BLOCK`).
4. `AFA_PENDING`: Payment failed due to `MANDATE_LIMIT_EXCEEDED` on UPI AutoPay.
5. `REPEATED_SOFT_DECLINE`: Recent failures due to `INSUFFICIENT_FUNDS`, `TEMPORARY_BANK_DOWNTIME`, or `NETWORK_TIMEOUT`.
6. `NONE`: Health score $\ge 0.70$ with 0 active failures.
7. `UNKNOWN`: Unclassified failure mode.

---

## 5. Explainable Feature Vector (JSON Schema)

Every score persists an explicit `feature_vector` in `health_snapshots`:

```json
{
  "failure_count_last_3_cycles": 1,
  "success_count_total": 5,
  "consecutive_failures": 1,
  "days_to_expiry": 14,
  "days_to_expiry_normalized": 0.1555,
  "is_near_card_expiry": true,
  "decline_code_distribution": {
    "INSUFFICIENT_FUNDS": 1
  },
  "is_over_afa_threshold": false,
  "mandate_status": "active",
  "last_event_type": "subscription.pending",
  "issuer_prior": 0.82
}
```

### Feature Definitions & Assumed Baseline Priors:
- `issuer_prior`: Assumed industry baseline recovery priors per payment rail (UPI AutoPay: 88%, Cards: 82%, eNACH: 75%).
- `AiReasoningEngine`: Clinical diagnostic narratives are generated dynamically from this 11-dimension feature vector (with optional LLM synthesis when API keys are configured and deterministic grounded fallback), ensuring 100% explainability without granting execution authority to the AI.
