-- ============================================================================
-- Migration 002: Evolve Health Snapshots Schema for Phase 4 Risk Intelligence
-- ============================================================================

ALTER TABLE health_snapshots
    ADD COLUMN IF NOT EXISTS instrument_id VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS health_score NUMERIC(5, 4) NOT NULL DEFAULT 1.0000,
    ADD COLUMN IF NOT EXISTS trajectory VARCHAR(50) NOT NULL DEFAULT 'HEALTHY',
    ADD COLUMN IF NOT EXISTS root_cause VARCHAR(100) NOT NULL DEFAULT 'NONE',
    ADD COLUMN IF NOT EXISTS recovery_probability NUMERIC(5, 4) NOT NULL DEFAULT 1.0000,
    ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '{}';

ALTER TABLE health_snapshots
    ALTER COLUMN subscription_id DROP NOT NULL,
    ALTER COLUMN failure_category DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_health_snapshots_instrument ON health_snapshots(instrument_id);
CREATE INDEX IF NOT EXISTS idx_health_snapshots_trajectory ON health_snapshots(trajectory);
CREATE INDEX IF NOT EXISTS idx_health_snapshots_root_cause ON health_snapshots(root_cause);
