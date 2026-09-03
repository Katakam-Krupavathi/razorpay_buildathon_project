# Synthetic Dataset Generation Summary Report

**Generated At:** `2026-09-03T08:34:10.393Z`  
**Random Seed Used:** `42`  
**Total Subscriptions Created:** `100`  
**Total Events Synthesized & Chained:** `638`  
**Total Simulated MRR:** `₹8,68,608`  
**Total Simulated ARR:** `₹1,04,23,302`  

---

## 1. Instrument Rail Distribution

| Payment Rail | Count | Percentage | Description |
| :--- | :--- | :--- | :--- |
| **UPI AutoPay** | `54` | `54.0%` | Recurring UPI mandates via VPA / apps |
| **Recurring Cards** | `33` | `33.0%` | Credit & debit card tokenized mandates |
| **E-NACH / NetBanking** | `13` | `13.0%` | High-value direct bank recurring debits |

---

## 2. Subscription Health Trajectory Profiles

| Health Profile | Count | Percentage | Operational Behaviour |
| :--- | :--- | :--- | :--- |
| **HEALTHY** | `60` | `60.0%` | Consistent success history; status: `active` |
| **DEGRADING** | `27` | `27.0%` | Recent soft declines (insufficient funds / bank downtime); status: `pending` |
| **TERMINAL** | `13` | `13.0%` | Max retries exhausted / mandate revoked; status: `halted` |

---

## 3. LTV Tier Distribution

| LTV Tier | Count | Percentage | Typical Monthly Range |
| :--- | :--- | :--- | :--- |
| **Low** | `34` | `34.0%` | ₹499 – ₹1,499 |
| **Medium** | `42` | `42.0%` | ₹1,999 – ₹4,999 |
| **High** | `17` | `17.0%` | ₹7,500 – ₹19,999 |
| **Critical** | `7` | `7.0%` | ₹25,000 – ₹1,00,000 |

---

## 4. Key Simulation Features & Failure Invariant Seeds

- **Cards Near Expiry (0–20 Days):** `3` instruments  
  *Triggers proactive card update dunning flows in Risk Engine (Phase 4–6).*
- **UPI Autopay Exceeding AFA Threshold:** `2` subscriptions  
  *Amounts exceeding RBI limit (₹15,000 standard or ₹1,00,000 MCC category) requiring step-up auth.*
- **Stale Cache Revocation Candidates:** `9` instruments  
  *Seeded as `active` in DB to demonstrate live mandate verification & cache invalidation in Phase 8/13.*
