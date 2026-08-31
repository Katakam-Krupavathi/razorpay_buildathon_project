-- ============================================================================
-- 004_recovery_outcomes_attribution.sql
-- Extend recovery_outcomes for Phase 10 Attribution & Counterfactual Engine
-- ============================================================================

ALTER TABLE recovery_outcomes
    ALTER COLUMN invoice_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS instrument_id VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS at_risk_amount BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS recovery_type VARCHAR(50) NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS estimated_baseline_outcome VARCHAR(100) NOT NULL DEFAULT 'total_loss',
    ADD COLUMN IF NOT EXISTS baseline_recovered_estimate BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS revenue_saved BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS counterfactual_details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_recovery_outcomes_recovery_type ON recovery_outcomes(recovery_type);
CREATE INDEX IF NOT EXISTS idx_recovery_outcomes_instrument ON recovery_outcomes(instrument_id);
CREATE INDEX IF NOT EXISTS idx_recovery_outcomes_closed_at ON recovery_outcomes(closed_at);
