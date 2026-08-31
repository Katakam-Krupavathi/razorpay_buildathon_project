# Expected Recovery Value (ERV) Engine & Action Matrix

This document defines the mathematical formulation of Expected Recovery Value (ERV) and the benchmark action success rate lookup matrix across payment rails.

---

## 1. Mathematical Formulation

$$\text{ERV} = \text{Amount At Risk} \times \text{Recovery Probability} \times \text{Expected Action Success Rate}$$

Where:

- **$\text{Amount At Risk}$**: The monthly invoice value at risk of churn ($\text{Annualized Value} / 12$), measured in minor units (paise).
- **$\text{Recovery Probability}$**: Estimated recoverability computed from the Risk Intelligence layer ($0.00$ to $1.00$).
- **$\text{Expected Action Success Rate}$**: Empirically benchmarked historical success rate for the recommended recovery action on the specified payment rail ($0.00$ to $1.00$).

---

## 2. Action Success Rate Benchmark Matrix

The engine looks up action success rates from a structured configuration table ([`server/src/risk/erv-config.ts`](../server/src/risk/erv-config.ts)):

| Payment Rail    | Recovery Action Type          | Benchmark Success Rate | Target Root Cause               |
| :-------------- | :---------------------------- | :--------------------- | :------------------------------ |
| **Card**        | `smart_retry_optimal_window`  | **72%** (0.72)         | `REPEATED_SOFT_DECLINE`         |
| **Card**        | `pre_expiry_card_update_link` | **88%** (0.88)         | `CARD_EXPIRY_RISK` (0–20 days)  |
| **Card**        | `dunning_step_up_auth`        | **55%** (0.55)         | `HARD_DECLINE_PATTERN`          |
| **Card**        | `manual_escalation`           | **30%** (0.30)         | `MANDATE_INACTIVE`              |
| **UPI AutoPay** | `smart_retry_optimal_window`  | **80%** (0.80)         | `REPEATED_SOFT_DECLINE`         |
| **UPI AutoPay** | `mandate_limit_upgrade_link`  | **68%** (0.68)         | `AFA_PENDING` (Limit > ₹15,000) |
| **UPI AutoPay** | `vpa_collect_request`         | **75%** (0.75)         | `HARD_DECLINE_PATTERN`          |
| **UPI AutoPay** | `dunning_step_up_auth`        | **65%** (0.65)         | Soft / Authentication Decline   |
| **UPI AutoPay** | `manual_escalation`           | **35%** (0.35)         | `MANDATE_INACTIVE`              |
| **E-NACH**      | `smart_retry_optimal_window`  | **62%** (0.62)         | `REPEATED_SOFT_DECLINE`         |
| **E-NACH**      | `direct_debit_resubmission`   | **65%** (0.65)         | Clearing / Processing Error     |
| **E-NACH**      | `manual_escalation`           | **30%** (0.30)         | `MANDATE_INACTIVE`              |

---

## 3. Opportunity Queue Prioritization

The **Opportunity Queue** sorts degraded and at-risk subscriptions in descending order of **ERV**:

$$\text{Rank 1} \implies \max(\text{ERV})$$

This ensures high-value enterprise subscriptions with high recovery probabilities (e.g. ₹50,000/mo near card expiry with 88% success rate $\rightarrow$ ERV = ₹38,720) are prioritized ahead of low-value, low-probability cohorts (e.g. ₹499/mo revoked mandate $\rightarrow$ ERV = ₹14).
