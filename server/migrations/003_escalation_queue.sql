-- Migration: 003_escalation_queue.sql
-- Autonomous Revenue Recovery Control Plane
-- Manual review escalation queue for blocked or high-risk instruments

CREATE TABLE IF NOT EXISTS escalation_queue (
    escalation_id VARCHAR(255) PRIMARY KEY,
    instrument_id VARCHAR(255) NOT NULL,
    subscription_id VARCHAR(255) NULL,
    reason TEXT NOT NULL,
    blocked_reason VARCHAR(100) NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'resolved', 'dismissed'
    proposed_action VARCHAR(100) NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ NULL,
    resolved_by VARCHAR(255) NULL,
    resolution_notes TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_escalation_queue_status ON escalation_queue(status);
CREATE INDEX IF NOT EXISTS idx_escalation_queue_instrument_id ON escalation_queue(instrument_id);
CREATE INDEX IF NOT EXISTS idx_escalation_queue_created_at ON escalation_queue(created_at);
