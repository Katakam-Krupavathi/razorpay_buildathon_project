# Synthetic Dataset Generation Summary Report

**Generated At:** `2026-08-30T12:45:00.000Z`  
**Random Seed Used:** `42` (Deterministic Mulberry32 PRNG)  
**Total Subscriptions Created:** `100`  
**Total Events Synthesized & Chained:** `528`  
**Total Simulated MRR:** `₹1,02,48,760`  
**Total Simulated ARR:** `₹12,29,85,120`

---

## 1. Instrument Rail Distribution

| Payment Rail            | Count | Percentage | Description                                                    |
| :---------------------- | :---- | :--------- | :------------------------------------------------------------- |
| **UPI AutoPay**         | `43`  | `43.0%`    | Recurring UPI mandates via VPA / apps (GPay, PhonePe, Paytm)   |
| **Recurring Cards**     | `42`  | `42.0%`    | Credit & debit card tokenized RBI-compliant recurring mandates |
| **E-NACH / NetBanking** | `15`  | `15.0%`    | High-value direct bank standing instructions                   |

---

## 2. Subscription Health Trajectory Profiles

| Health Profile | Count | Percentage | Status    | Operational Behaviour                                                                                                  |
| :------------- | :---- | :--------- | :-------- | :--------------------------------------------------------------------------------------------------------------------- |
| **HEALTHY**    | `62`  | `62.0%`    | `active`  | 100% successful charge history; 0 recent soft declines                                                                 |
| **DEGRADING**  | `24`  | `24.0%`    | `pending` | Recent 1–2 soft declines (insufficient funds, temporary bank downtime); active candidate for autonomous recovery retry |
| **TERMINAL**   | `14`  | `14.0%`    | `halted`  | Max automated retries exhausted / mandate revoked; routed to high-friction dunning or manual escalation                |

---

## 3. LTV Tier Distribution

| LTV Tier     | Count | Percentage | Monthly Value Range | Annualized Cohort Value |
| :----------- | :---- | :--------- | :------------------ | :---------------------- |
| **Low**      | `37`  | `37.0%`    | ₹499 – ₹1,499       | ₹43,76,400              |
| **Medium**   | `38`  | `38.0%`    | ₹1,999 – ₹4,999     | ₹1,56,84,000            |
| **High**     | `18`  | `18.0%`    | ₹7,500 – ₹19,999    | ₹2,88,44,720            |
| **Critical** | `7`   | `7.0%`     | ₹25,000 – ₹1,00,000 | ₹7,40,80,000            |

---

## 4. Key Simulation Features & Failure Invariant Seeds

- **Cards Near Expiry (0–20 Days):** `11` instruments  
  _Triggers proactive card expiry notification and token migration rules in Risk Intelligence (Phase 4–6)._
- **UPI AutoPay Exceeding AFA Threshold:** `16` subscriptions  
  _Amounts exceeding RBI limit (₹15,000 standard or ₹1,00,000 MCC category) requiring step-up authentication._
- **Stale Cache Revocation Candidates:** `5` instruments  
  _Seeded as `active` in DB to demonstrate live mandate verification & cache invalidation in Phase 8/13._
- **Global Hash Chain:** `528` chained events linked sequentially from Genesis hash `0000000000000000000000000000000000000000000000000000000000000000` to tip with 100% verified integrity.
