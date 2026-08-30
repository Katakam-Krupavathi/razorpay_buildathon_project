# Deterministic Policy Engine Ruleset & Rail Guardrails ("PERMIT")

> [!NOTE]
> **Compliance & Legal Notice**:
> For the final submission, re-verify every numerical compliance rule against current Razorpay/NPCI documentation. This engine enforces the configured rail/network constraints — it does not itself certify legal compliance.

This document provides a plain-English, executive-level summary of the deterministic rules, payment rail ceilings, and safety invariants enforced by the **Policy Engine** in the Autonomous Revenue Recovery Control Plane.

---

## 1. What is the Policy Engine?

The **Policy Engine ("PERMIT")** is the strict permission boundary of the control plane.
While the AI Recovery Planner _proposes_ recovery strategies, it has zero execution authority. Every proposed action must pass through the Policy Engine before downstream execution.

The Policy Engine evaluates four possible outcomes:

- **`ALLOW`**: The proposed action satisfies all rail attempt limits, contact caps, and regulatory constraints.
- **`MODIFY`**: The proposed action breaches a rule or threshold and is automatically transformed into a compliant alternative (e.g., overriding a retry to a bounded grace-period pause, or changing an immediate auto-debit into a customer authorization nudge).
- **`BLOCK`**: The proposed action is rejected due to policy violations (e.g., stale state or hard limit reached).
- **`NO_ACTION`**: The proposal is a non-intervention for a healthy or uneconomical subscription; permitted as a no-op pass-through.

---

## 2. Hard Rail Rules & Published Constraints

All rules are loaded from a versioned configuration file ([`server/src/policy/policy-config.json`](file:///c:/Users/krupa/OneDrive/Desktop/buildathon/server/src/policy/policy-config.json)):

### A. Card Tokenized Auto-Debit (`card`)

- **Maximum Attempt Cap:** `4 total attempts` (1 original + 3 retries)
- **Minimum Interval:** `+1 day offset` (never retries within the same billing hour/day)
- **Hard Rule ID:** `CARD-MAX-ATTEMPTS-001`
- **Enforcement:** If attempt count $\ge 4$, all further retries are blocked and modified to a bounded 3-day grace period pause.

### B. UPI AutoPay (`upi_autopay`)

- **Maximum Attempt Cap:** `4 total attempts` (1 original + 3 retries, strictly conforming to NPCI AutoPay guidelines)
- **Mandated Spacing Windows:** `[24h, 72h, 168h]`
- **Standard AFA Threshold:** `₹15,000` (Transactions exceeding ₹15,000 require Additional Factor of Authentication step-up)
- **Category-Specific AFA Threshold:** `₹1,00,000` for Insurance (MCC `6300`), Mutual Funds (MCC `6211`), Education (MCC `8220`), and Credit Card Bill Payments (MCC `6012`)
- **Hard Rule IDs:** `UPI-NPCI-RETRY-CAP-001`, `UPI-AFA-THRESHOLD-001`
- **Enforcement:** If a transaction exceeds the AFA limit, immediate automated debit is blocked and modified to an interactive customer limit upgrade authorization nudge.

### C. E-NACH Standing Instructions (`enach`)

- **Default Attempt Cap:** `3 attempts`
- **Bank-Specific Overrides:**
  - HDFC Bank (`HDFC`): 3 attempts
  - ICICI Bank (`ICICI`): 3 attempts
  - State Bank of India (`SBIN`): `2 attempts` (lower bank threshold)
  - Axis Bank (`UTIB`): 3 attempts
  - Kotak Mahindra Bank (`KKBK`): 3 attempts
- **Hard Rule ID:** `ENACH-BANK-RETRY-CAP-001`

---

## 3. Global Safety Invariants

| Guardrail                  | Constraint                                                 | Action Upon Breach                                             | Rule ID                      |
| :------------------------- | :--------------------------------------------------------- | :------------------------------------------------------------- | :--------------------------- |
| **Customer Contact Cap**   | Maximum 1 proactive nudge per subscriber per billing cycle | Modifies 2nd nudge to silent scheduled retry                   | `GLOBAL-NUDGE-CAP-001`       |
| **Customer Opt-Out**       | Explicit customer preference to stop automated recovery    | Modifies all active actions to `pause`                         | `CUSTOMER-OPT-OUT-001`       |
| **Terminal Grace Default** | Subscriptions reaching terminal state or exhausted retries | Defaults to 3-day grace period pause, not instant cancellation | `TERMINAL-GRACE-PAUSE-001`   |
| **Pass-Through No-Op**     | Healthy subscriptions with `NO_ACTION` proposal            | Allowed without intervention                                   | `PASS-THROUGH-NO-ACTION-001` |

---

## 4. Zero Bypass Guarantee

> [!CAUTION]
> **No AI Override**: No confidence score, machine learning prediction, or LTV tier can bypass rail attempt limits.
> If an instrument is at attempt `4/4` on Card or UPI, an attempt to force a retry is mathematically intercepted and modified to a grace-period pause.

---

## 5. Audit & Compliance Schema

Every decision generates an immutable database record and an audit event in the hash-chained ledger:

```json
{
  "eventType": "policy_decision",
  "actor": "policy_engine",
  "payload": {
    "decisionId": "dec_7a8b9c0d-1234-4567-89ab-cdef01234567",
    "instrumentId": "inst_card_0045",
    "subscriptionId": "sub_synth_0045",
    "result": "ALLOW",
    "proposedAction": "proactive_nudge",
    "finalAction": "proactive_nudge",
    "ruleIdMatched": "PASS-THROUGH-PERMIT-001",
    "reason": "Proposed action 'proactive_nudge' satisfies all rail attempt caps (0/4), contact frequency limits, and regulatory AFA constraints.",
    "evaluatedAt": "2026-08-30T13:35:00.000Z"
  }
}
```
