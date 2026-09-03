-- Migration: 001_initial_schema.sql
-- Autonomous Revenue Recovery Control Plane
-- Core relational tables and immutable hash-chained event store

-- ============================================================================
-- 1. ENUMS
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE instrument_rail AS ENUM ('card', 'upi_autopay', 'enach');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE mandate_status AS ENUM ('active', 'paused', 'revoked', 'expired');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE subscription_status AS ENUM (
        'created',
        'authenticated',
        'activated',
        'active',
        'pending',
        'halted',
        'paused',
        'resumed',
        'completed',
        'cancelled',
        'expired'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE event_actor AS ENUM (
        'razorpay_webhook',
        'health_scorer',
        'recovery_planner',
        'policy_engine',
        'circuit_breaker',
        'verification_gateway',
        'execution_engine',
        'human'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 2. INSTRUMENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS instruments (
    instrument_id VARCHAR(255) PRIMARY KEY,
    subscription_id VARCHAR(255) NOT NULL,
    rail instrument_rail NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expiry_date TIMESTAMPTZ NULL,
    mandate_status mandate_status NOT NULL DEFAULT 'active',
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ltv_tier VARCHAR(50) NOT NULL DEFAULT 'standard',
    annualized_value BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_instruments_subscription_id ON instruments(subscription_id);
CREATE INDEX IF NOT EXISTS idx_instruments_mandate_status ON instruments(mandate_status);
CREATE INDEX IF NOT EXISTS idx_instruments_rail ON instruments(rail);

-- ============================================================================
-- 3. SUBSCRIPTIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS subscriptions (
    subscription_id VARCHAR(255) PRIMARY KEY,
    customer_id VARCHAR(255) NOT NULL,
    plan_id VARCHAR(255) NOT NULL,
    status subscription_status NOT NULL DEFAULT 'pending',
    current_instrument_id VARCHAR(255) NULL REFERENCES instruments(instrument_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_customer_id ON subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- ============================================================================
-- 4. EVENTS TABLE (Append-Only Hash-Chained Event Store)
-- ============================================================================

CREATE TABLE IF NOT EXISTS events (
    event_id VARCHAR(255) PRIMARY KEY,
    sequence_number BIGSERIAL UNIQUE NOT NULL,
    prev_hash VARCHAR(64) NOT NULL,
    hash VARCHAR(64) NOT NULL,
    subscription_id VARCHAR(255) NULL,
    instrument_id VARCHAR(255) NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    actor event_actor NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_sequence_number ON events(sequence_number ASC);
CREATE INDEX IF NOT EXISTS idx_events_hash ON events(hash);
CREATE INDEX IF NOT EXISTS idx_events_prev_hash ON events(prev_hash);
CREATE INDEX IF NOT EXISTS idx_events_subscription_id ON events(subscription_id);
CREATE INDEX IF NOT EXISTS idx_events_instrument_id ON events(instrument_id);
CREATE INDEX IF NOT EXISTS idx_events_event_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);

-- Trigger to strictly forbid UPDATE or DELETE on events (Immutable Ledger)
CREATE OR REPLACE FUNCTION prevent_events_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Events table is append-only. UPDATE and DELETE operations are strictly forbidden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_events_mutation ON events;
CREATE TRIGGER trg_prevent_events_mutation
BEFORE UPDATE OR DELETE ON events
FOR EACH ROW
EXECUTE FUNCTION prevent_events_mutation();

-- ============================================================================
-- 5. HEALTH SNAPSHOTS (Pre-allocated for Phase 4+)
-- ============================================================================

CREATE TABLE IF NOT EXISTS health_snapshots (
    snapshot_id VARCHAR(255) PRIMARY KEY,
    subscription_id VARCHAR(255) NOT NULL,
    risk_score NUMERIC(5, 4) NOT NULL DEFAULT 0.0000,
    failure_category VARCHAR(100) NOT NULL,
    churn_probability NUMERIC(5, 4) NOT NULL DEFAULT 0.0000,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_snapshots_subscription ON health_snapshots(subscription_id);
CREATE INDEX IF NOT EXISTS idx_health_snapshots_computed_at ON health_snapshots(computed_at);

-- ============================================================================
-- 6. POLICY DECISIONS (Pre-allocated for Phase 6+)
-- ============================================================================

CREATE TABLE IF NOT EXISTS policy_decisions (
    decision_id VARCHAR(255) PRIMARY KEY,
    subscription_id VARCHAR(255) NOT NULL,
    decision VARCHAR(50) NOT NULL,
    target_action VARCHAR(100) NOT NULL,
    evaluated_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_policy_decisions_subscription ON policy_decisions(subscription_id);
CREATE INDEX IF NOT EXISTS idx_policy_decisions_decision ON policy_decisions(decision);
CREATE INDEX IF NOT EXISTS idx_policy_decisions_evaluated_at ON policy_decisions(evaluated_at);

-- ============================================================================
-- 7. RECOVERY OUTCOMES (Pre-allocated for Phase 10+)
-- ============================================================================

CREATE TABLE IF NOT EXISTS recovery_outcomes (
    outcome_id VARCHAR(255) PRIMARY KEY,
    invoice_id VARCHAR(255) NULL,
    subscription_id VARCHAR(255) NOT NULL,
    recovered_amount BIGINT NOT NULL DEFAULT 0,
    cost_incurred BIGINT NOT NULL DEFAULT 0,
    net_value_recovered BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recovery_outcomes_invoice ON recovery_outcomes(invoice_id);
CREATE INDEX IF NOT EXISTS idx_recovery_outcomes_subscription ON recovery_outcomes(subscription_id);
CREATE INDEX IF NOT EXISTS idx_recovery_outcomes_status ON recovery_outcomes(status);
