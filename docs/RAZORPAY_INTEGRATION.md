# Razorpay Test-Mode Integration & Webhook Ingestion Engine

This document provides a comprehensive reference for the Razorpay test-mode integration, webhook signature verification, state machine projection, and test-charge simulation within the **Autonomous Revenue Recovery Control Plane**.

---

## 1. Overview & Architectural Principles

The webhook receiver serves as the primary ingress gateway for asynchronous payment lifecycle events dispatched by Razorpay.

```
┌─────────────────────────┐
│ Razorpay Webhook Event  │
└────────────┬────────────┘
             │ HTTP POST with 'x-razorpay-signature'
             ▼
┌─────────────────────────┐
│ 1. Signature Verifier   │ ── Constant-time HMAC-SHA256 verification
└────────────┬────────────┘
             │ [Signature Valid]
             ▼
┌─────────────────────────┐
│ 2. Hash-Chained Store   │ ── Appends raw event to PostgreSQL 'events' table
│   (Source of Truth)     │    (Actor: 'razorpay_webhook')
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 3. Materialized View    │ ── Projects status to 'subscriptions' table
│   (State Projection)    │    (active -> pending -> halted -> resumed)
└─────────────────────────┘
```

### Core Invariants:

1. **Source of Truth**: The append-only, hash-chained `events` table is the immutable single source of truth.
2. **Materialized State**: The `subscriptions` table is a derived projection kept in sync by replaying/applying events.
3. **Cryptographic Validation**: Any request with a missing, mismatched, or malformed signature is rejected immediately with HTTP 400 and logged as a security warning.

---

## 2. Handled Webhook Events & State Transitions

The webhook engine handles all 9 subscription lifecycle events emitted by Razorpay:

| Webhook Event            | Trigger Condition                            | Mapped Subscription Status | Description                                                    |
| :----------------------- | :------------------------------------------- | :------------------------- | :------------------------------------------------------------- |
| `subscription.activated` | Customer completes mandate authentication    | `active`                   | Mandate is registered and active for recurring debit.          |
| `subscription.charged`   | Recurring debit transaction succeeds         | `active`                   | Invoice settled; billing period advanced.                      |
| `subscription.updated`   | Plan, quantity, or schedule modified         | `active`                   | Subscription parameters updated.                               |
| `subscription.pending`   | Charge failed (insufficient funds, downtime) | `pending`                  | Payment failure recorded; autonomous recovery triggered.       |
| `subscription.halted`    | Max automated retries exhausted by gateway   | `halted`                   | Recurring debit halted; requires dunning/step-up intervention. |
| `subscription.paused`    | Merchant or customer pauses subscription     | `paused`                   | Invoicing and auto-debits suspended.                           |
| `subscription.resumed`   | Subscription unpaused                        | `active`                   | Recurring debits reactivated.                                  |
| `subscription.cancelled` | Subscription cancelled                       | `cancelled`                | Final termination; no further charges allowed.                 |
| `subscription.completed` | All billing cycles completed                 | `completed`                | Subscription lifecycle naturally finished.                     |

---

## 3. Webhook Signature Verification

Razorpay computes an HMAC using the SHA-256 algorithm with your configured webhook secret:

$$\text{Signature} = \text{HMAC-SHA256}(\text{Raw Request Body}, \text{Webhook Secret})$$

### Implementation Details:

- The raw unparsed request payload string is passed into the HMAC generator.
- The generated signature is compared against the `x-razorpay-signature` header using `crypto.timingSafeEqual` to prevent timing attacks.

```typescript
import crypto from 'node:crypto';

export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const receivedBuffer = Buffer.from(signature, 'utf8');

  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}
```

---

## 4. Razorpay Client SDK Wrapper

The server-side client ([`server/src/razorpay/client.ts`](file:///c:/Users/krupa/OneDrive/Desktop/buildathon/server/src/razorpay/client.ts)) provides methods to interact with Razorpay APIs using test-mode credentials:

### Available Client Methods:

- `createPlan(params)`: Creates recurring plans with configurable frequency and amount.
- `createSubscription(params)`: Generates test subscriptions linked to a plan.
- `fetchLiveSubscriptionState(subscriptionId)`: Direct API query returning live Razorpay subscription entity.
- `fetchLiveMandateState(tokenId, customerId)`: Direct API query returning token/mandate details.

---

## 5. Simulating Charge Failures & State Transitions

You can test the autonomous recovery control plane by simulating webhook events:

### 1. Seed Initial Test Subscriptions

```bash
npm run razorpay:seed-test-data
```

### 2. Simulate Payment Failure (`active` $\rightarrow$ `pending`)

Send a mock webhook with an invalid transaction or insufficient balance error:

```bash
curl -X POST http://localhost:4000/api/webhooks/razorpay \
  -H "Content-Type: application/json" \
  -H "x-razorpay-signature: <computed_hmac>" \
  -d '{
    "entity": "event",
    "account_id": "acc_test_123",
    "event": "subscription.pending",
    "contains": ["subscription", "payment"],
    "payload": {
      "subscription": {
        "entity": {
          "id": "sub_test_live_001",
          "plan_id": "plan_test_pro_monthly",
          "status": "pending"
        }
      },
      "payment": {
        "entity": {
          "id": "pay_fail_001",
          "amount": 299900,
          "status": "failed",
          "error_code": "BAD_REQUEST_PAYMENT_FAILED",
          "error_description": "Insufficient balance in customer account"
        }
      }
    },
    "created_at": 1700000000
  }'
```

### 3. Simulate Gateway Halting (`pending` $\rightarrow$ `halted`)

```bash
curl -X POST http://localhost:4000/api/webhooks/razorpay \
  -H "Content-Type: application/json" \
  -H "x-razorpay-signature: <computed_hmac>" \
  -d '{
    "entity": "event",
    "account_id": "acc_test_123",
    "event": "subscription.halted",
    "contains": ["subscription"],
    "payload": {
      "subscription": {
        "entity": {
          "id": "sub_test_live_001",
          "plan_id": "plan_test_pro_monthly",
          "status": "halted"
        }
      }
    },
    "created_at": 1700000100
  }'
```

### 4. Verify Ledger Hash Integrity

After receiving events, verify that the hash chain is cryptographically sound:

```bash
npm run test -w @recovery/server
```
