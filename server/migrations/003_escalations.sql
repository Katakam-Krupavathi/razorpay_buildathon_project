-- Migration 003: Escalations Queue Schema
-- Defines the human review queue for blocked recovery actions and critical safety alerts.

CREATE TYPE escalation_status AS ENUM (
  'pending',
  'in_review',
  'resolved',
  'dismissed'
);

CREATE TABLE IF NOT EXISTS escalations (
  escalation_id VARCHAR(64) PRIMARY KEY,
  subscription_id VARCHAR(64) REFERENCES subscriptions(subscription_id) ON DELETE SET NULL,
  instrument_id VARCHAR(64) REFERENCES instruments(instrument_id) ON DELETE CASCADE,
  decision_id VARCHAR(64) NULL,
  status escalation_status NOT NULL DEFAULT 'pending',
  trigger_reason VARCHAR(128) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMPTZ NULL,
  resolved_by VARCHAR(128) NULL,
  resolution_notes TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_escalations_status ON escalations(status);
CREATE INDEX IF NOT EXISTS idx_escalations_instrument_id ON escalations(instrument_id);
CREATE INDEX IF NOT EXISTS idx_escalations_subscription_id ON escalations(subscription_id);
CREATE INDEX IF NOT EXISTS idx_escalations_created_at ON escalations(created_at);
