# Counterfactual Attribution & Net Value Recovered (NVR) Methodology

This document outlines the methodology, mathematical heuristics, baseline models, and documented limitations of the **Counterfactual Financial Attribution Engine** in the Autonomous Revenue Recovery Control Plane.

---

## 1. Why Counterfactual Attribution Matters

A common pitfall in revenue recovery platforms is claiming 100% of recovered revenue as "AI uplift". In reality:
- A fraction of customers with expiring cards voluntarily update payment details without intervention.
- A fraction of soft declines (e.g. temporary network hiccups) resolve on naive retries.

To provide defensible, board-level financial integrity, our **Counterfactual Engine** computes an estimated baseline outcome ("what would have happened without the autonomous control plane") and isolates the true **Net Revenue Saved**.

---

## 2. Attribution Taxonomy

Every monitored instrument is classified into one of three outcome channels:

| Recovery Type | Definition | Example Scenario |
| :--- | :--- | :--- |
| **`proactive`** | Interventions executed **before** any billing failure occurred in the current cycle. | Automated proactive card expiry notice sent 14 days before card expiry. |
| **`reactive`** | Recoveries achieved **after** $\ge 1$ payment failure occurred this cycle. | Smart retry scheduled within optimal rail window after a soft bank decline. |
| **`none`** | Terminal failures, cancellations, or intentionally untouched healthy subscriptions. | Healthy active mandates (`NO_ACTION`) or unrecoverable hard bank declines. |

---

## 3. Mathematical Heuristics & Baseline Models

### A. Proactive Intervention Uplift (Card Expiry)

Without proactive intervention, an expired card inevitably triggers a hard bank decline on the next billing date.

$$\text{Baseline Outcome} = \text{Card Expiry Hard Decline} \longrightarrow \text{Retry Exhaustion} \longrightarrow \text{Customer Churn}$$

- **Organic Baseline Recovery ($P_{\text{organic}}$)**: $15\%$ (proportion of customers who self-serve update cards post-failure).
- **Attributed Revenue Saved**:
  $$\text{Revenue Saved}_{\text{proactive}} = \text{Recovered Amount} - (0.15 \times \text{At-Risk Amount}) = 85\% \times \text{MRR}$$

---

### B. Reactive Smart Recovery Uplift (Timed Retries)

Naive payment systems retry immediately (e.g. within seconds) or at rigid cadences, frequently exhausting attempts during bank outages or before customer balance replenishment.

$$\text{Baseline Outcome} = \text{Immediate Naive Retry} \longrightarrow \text{Rapid NPCI/Card Attempt Exhaustion}$$

- **Naive Baseline Recovery ($P_{\text{naive}}$)**: $30\%$ (empirical recovery rate of unoptimized retries on soft declines).
- **Attributed Revenue Saved**:
  $$\text{Revenue Saved}_{\text{reactive}} = \text{Recovered Amount} - (0.30 \times \text{At-Risk Amount}) = 70\% \times \text{MRR}$$

---

### C. Intentionally Untouched Subscriptions (`NO_ACTION`)

For healthy instruments with active mandates and high health scores:
- **Attributed Revenue Saved**: ₹0 (the system does not claim credit for healthy subscription renewals that required zero intervention).
- **Categorization**: Tracked separately as **Intentionally Untouched MRR**.

---

## 4. Net Value Recovered (NVR) Formula

Net Value Recovered accounts for operational transaction costs:

$$\text{NVR} = \sum_{i=1}^{N} \left( \text{Recovered Amount}_i - \text{Execution Cost}_i \right)$$

Where:
- **Notification Cost**: ₹0.25 per proactive SMS/email nudge.
- **Payment Trigger Cost**: ₹0.50 per programmatic Razorpay recurring charge.

---

## 5. Audit Logging & Ledger Integrity

For every terminal or evaluated outcome, an immutable event is appended to the hash-chained Event Store:

```json
{
  "eventType": "recovery_recorded",
  "actor": "execution_engine",
  "payload": {
    "outcomeId": "out_f4b7a2...",
    "instrumentId": "inst_synth_042",
    "recoveryType": "proactive",
    "status": "recovered",
    "atRiskAmountPaise": 299900,
    "recoveredAmountPaise": 299900,
    "revenueSavedPaise": 254915,
    "estimatedBaselineOutcome": "card_expiry_exhaustion_churn",
    "baselineRecoveredEstimatePaise": 44985
  }
}
```

---

## 6. Documented Limitations & Assumptions

1. **Static Baseline Priors**: The $15\%$ proactive and $30\%$ reactive baselines are conservative industry benchmark priors. When deployed in production with historical merchant data, these priors can be dynamically calibrated via randomized control trials (A/B holdout groups).
2. **Single-Cycle Scope**: Baseline revenue saved calculates the immediate billing cycle MRR preserved. Compounded Lifetime Value (LTV) benefits across future subscription cycles are reported separately.
3. **No Overstatement Guarantee**: The engine explicitly zeroes out revenue saved for healthy renewals and caps prevented loss attribution strictly at the verified recovered invoice value.
