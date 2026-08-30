# 🎙️ Live Demo Script & Evaluator Runbook

> **Autonomous Revenue Recovery Control Plane for Razorpay Mandates**  
> *A 5-minute judge & presenter walkthrough showcasing AI-driven trajectory scoring, deterministic policy bounds, cryptographic audit ledgers, and the signature "2 AM" Safety Verification Gateway.*

---

## ⏱️ Demo Outline & Time Allocation

| Section | Topic | Key Takeaway | Target Duration |
| :--- | :--- | :--- | :--- |
| **Part 1** | **The Problem** | Involuntary churn & the hidden failure modes of Indian recurring rails | 45 seconds |
| **Part 2** | **The Core Insight** | Evolved Health Trajectory Scorer & Expected Recovery Value (ERV) | 60 seconds |
| **Part 3** | **Live Batch Run** | Revenue Command Center: Scorecard & Opportunity Queue | 60 seconds |
| **Part 4** | **The "2 AM" Safety Demo** | Verification Gateway catching out-of-band mandate revocation live | 75 seconds |
| **Part 5** | **Cryptographic Audit** | 8-Stage chronological Decision Trace & explainability synthesis | 45 seconds |
| **Part 6** | **Impact & Closing** | ROI metrics & final thesis | 15 seconds |

---

## 🚀 Quick Setup (Cold-Start in 1 Command)

```bash
# 1. Start database & cache stack (if not already running)
docker compose up -d

# 2. Run one-command demo bootstrap
make demo
# OR: npm run demo
```

*The command resets the database, generates the deterministic 100-subscription synthetic dataset with seed=42, executes the recovery pipeline batch, and launches the Fastify backend (`http://localhost:4000`) and React Dashboard (`http://localhost:5173`).*

---

## 🎬 Section-by-Section Demo Script

### Part 1: The Problem (45s) — Why Dumb Retry Bots Destroy Subscriptions
- **Spoken Narration**:
  > *"Every subscription business in India loses 3% to 7% of its Monthly Recurring Revenue to involuntary churn. But here's the dirty secret: most recovery systems make the problem worse. They are 'dumb retry bots' that blindly fire off 10 webhook retries against expired cards, smash into NPCI's strict 1+3 retry limits on UPI Autopay, violate RBI Additional Factor of Authentication (AFA) limits above ₹15,000, and blindly hammer bank gateways that are down.*
  >
  > *We built the **Autonomous Revenue Recovery Control Plane** to replace blind retries with a safe, closed-loop control system: **Predict, Permit, Guard, Verify, Execute, and Measure**."*

---

### Part 2: The Core Insight (60s) — Health Trajectory & Expected Recovery Value (ERV)
- **Visual Action**: Switch to the **Revenue Command Center Dashboard** (`http://localhost:5173`) and highlight the **Scorecard Banner** and **Opportunity Queue**.
- **Spoken Narration**:
  > *"Instead of waiting for a payment to fail and panicking, our system maintains a dynamic **Health Trajectory** for every payment instrument:*
  > 1. **Healthy ($\ge 0.70$)**: Untouched. Zero customer fatigue.
  > 2. **Degrading ($0.30 - 0.70$)**: Proactively saved before failure occurs (e.g. Card Expiry in $\le 20$ days triggers a low-friction customer update link).
  > 3. **Terminal ($< 0.30$)**: Repeated hard declines or inactive mandates placed into a high-touch grace period rather than spamming the user.
  >
  > *Every opportunity is ranked by **Expected Recovery Value (ERV)**, which mathematically balances the amount at risk against the recovery probability: $\text{ERV} = \text{Amount at Risk} \times P(\text{recovery})$."*

---

### Part 3: Live Batch Run (60s) — Real Financial Scorecard
- **Visual Action**: Click **"Run Recovery Agent Batch"** in the top control bar. Watch the live telemetry spin and update the scorecard.
- **Key Metrics to Point Out on the Screen**:
  - **Monitored ARR**: ₹1.04 Cr across 100 active subscriptions.
  - **Monthly Revenue at Risk**: ₹1,54,000 MRR diagnosed across degrading/terminal cohorts.
  - **Recovered MRR**: ₹1,07,796 MRR recovered at a **70.0% recovery rate**.
  - **Counterfactual Net Saved**: ₹75,457 MRR saved net of baseline churn discounts (15% proactive, 30% reactive).
  - **Zero Execution Authority Structural Boundary**: The AI planner can only propose actions; the deterministic policy engine enforces hard NPCI caps.

---

### Part 4: The Signature "2 AM" Safety Demo (75s) — Live Mandate Revocation
- **The Setup**:
  > *"Imagine it's 2 AM. A subscriber opens their bank app and revokes their eNACH mandate. The merchant's local database still says 'active'. At 2:05 AM, a scheduled dunning cron runs. A traditional retry bot would attempt to charge the revoked mandate, trigger an illegal charge attempt, incur bank bounce penalties, and damage merchant reputation.*
  >
  > *Let's see what our **Verification Gateway** does."*
- **Visual Action**:
  1. In the top presenter bar, enter `inst_card_0001` (or target instrument).
  2. Click **"Simulate Mandate Revocation"**.
  3. Notice the amber alert banner: *Live Razorpay mock state flipped to 'revoked', while local DB cache remains 'active'.*
  4. Click **"Run Recovery Agent Batch"**.
  5. Open the **Decision Trace** for `sub_0001`.
- **Result on Screen**:
  - The Verification Gateway performs its **Zero-Trust Live State Check** immediately before execution.
  - It catches the divergence (`cached: active` vs `live: revoked`).
  - It immediately halts execution (`BLOCKED_STALE_STATE`), flags the discrepancy, and safely routes the subscription to the human operations queue.

---

### Part 5: Cryptographic Audit Trail (45s) — Why Did the Agent Do This?
- **Visual Action**: Click **"Trace"** on any row in the Opportunity Queue or Instrument Directory.
- **Spoken Narration**:
  > *"Every single decision in this control plane is backed by an append-only, SHA-256 hash-chained immutable event store. In this modal, reviewers can see the complete 8-stage chronological decision lifecycle:*
  >
  > $$\text{Detect} \longrightarrow \text{Diagnose} \longrightarrow \text{Propose} \longrightarrow \text{Permit} \longrightarrow \text{Guard} \longrightarrow \text{Verify} \longrightarrow \text{Execute} \longrightarrow \text{Measure}$$
  >
  > *Look at the **'Why did the agent do this?'** card: it synthesizes the root-cause diagnosis, the exact policy rule ID matched, and the counterfactual recovery attribution. There is zero black-box obscurity."*

---

### Part 6: Cohort Circuit Breakers & Final Pitch (15s)
- **Visual Action**: Click the **"Cohort Circuit Breakers"** tab.
- **Spoken Narration**:
  > *"If an issuer or UPI gateway goes down and success rates dip below 40%, our cohort circuit breaker trips in real-time, preventing retry storms across the entire merchant account until an operator resets it.*
  >
  > *In summary: **Never retry blindly; always predict, permit, guard, verify, execute, and measure.**"*
