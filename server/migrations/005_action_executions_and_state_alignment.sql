-- Migration: 005_action_executions_and_state_alignment.sql
-- Persistent execution idempotency table, Razorpay subscription state machine alignment, and durable webhook event ID

-- 1. Persistent action_executions table for execution idempotency
CREATE TABLE IF NOT EXISTS action_executions (
    execution_id VARCHAR(255) PRIMARY KEY,
    idempotency_key VARCHAR(255) UNIQUE NOT NULL,
    instrument_id VARCHAR(255) NOT NULL,
    subscription_id VARCHAR(255) NULL,
    action VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'executed',
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_action_executions_idempotency_key ON action_executions(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_action_executions_instrument_id ON action_executions(instrument_id);

-- 2. Add razorpay_event_id column to events table with unique constraint
ALTER TABLE events ADD COLUMN IF NOT EXISTS razorpay_event_id VARCHAR(255) NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_razorpay_event_id ON events(razorpay_event_id) WHERE razorpay_event_id IS NOT NULL;

-- 3. Update subscription_status enum values if missing
DO $$ BEGIN
    ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'created';
    ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'expired';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
