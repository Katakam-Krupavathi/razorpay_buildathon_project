import { newDb, IMemoryDb } from 'pg-mem';
import pg, { QueryResultRow } from 'pg';

export interface TestPool extends pg.Pool {
  __disableImmutabilityTrigger?: () => void;
  __enableImmutabilityTrigger?: () => void;
}

export interface TestDatabase {
  db: IMemoryDb;
  pool: TestPool;
  cleanup: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const db = newDb({
    autoCreateForeignKeyIndices: true,
  });

  // Register now() timestamp function
  db.public.registerFunction({
    name: 'now',
    returns: 'timestamptz',
    implementation: () => new Date().toISOString(),
  });

  // Create ENUM types
  db.public.none(`
    CREATE TYPE instrument_rail AS ENUM ('card', 'upi_autopay', 'enach');
    CREATE TYPE mandate_status AS ENUM ('active', 'paused', 'revoked', 'expired');
    CREATE TYPE subscription_status AS ENUM ('authenticated', 'activated', 'active', 'pending', 'halted', 'paused', 'resumed', 'completed', 'cancelled');
    CREATE TYPE event_actor AS ENUM ('razorpay_webhook', 'health_scorer', 'recovery_planner', 'policy_engine', 'circuit_breaker', 'verification_gateway', 'execution_engine', 'human');
  `);

  // Create Tables
  db.public.none(`
    CREATE TABLE instruments (
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

    CREATE TABLE subscriptions (
      subscription_id VARCHAR(255) PRIMARY KEY,
      customer_id VARCHAR(255) NOT NULL,
      plan_id VARCHAR(255) NOT NULL,
      status subscription_status NOT NULL DEFAULT 'pending',
      current_instrument_id VARCHAR(255) NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE events (
      event_id VARCHAR(255) PRIMARY KEY,
      sequence_number BIGSERIAL UNIQUE NOT NULL,
      prev_hash VARCHAR(64) NOT NULL,
      hash VARCHAR(64) NOT NULL,
      subscription_id VARCHAR(255) NULL,
      instrument_id VARCHAR(255) NULL,
      event_type VARCHAR(100) NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}',
      actor event_actor NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE health_snapshots (
      snapshot_id VARCHAR(255) PRIMARY KEY,
      instrument_id VARCHAR(255) NULL,
      subscription_id VARCHAR(255) NULL,
      health_score NUMERIC(5, 4) NOT NULL DEFAULT 1.0000,
      trajectory VARCHAR(50) NOT NULL DEFAULT 'HEALTHY',
      root_cause VARCHAR(100) NOT NULL DEFAULT 'NONE',
      recovery_probability NUMERIC(5, 4) NOT NULL DEFAULT 1.0000,
      features JSONB NOT NULL DEFAULT '{}',
      computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE policy_decisions (
      decision_id VARCHAR(255) PRIMARY KEY,
      subscription_id VARCHAR(255) NOT NULL,
      decision VARCHAR(50) NOT NULL,
      target_action VARCHAR(100) NOT NULL,
      evaluated_rules JSONB NOT NULL DEFAULT '[]',
      evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE recovery_outcomes (
      outcome_id VARCHAR(255) PRIMARY KEY,
      invoice_id VARCHAR(255) NOT NULL,
      subscription_id VARCHAR(255) NOT NULL,
      recovered_amount BIGINT NOT NULL DEFAULT 0,
      cost_incurred BIGINT NOT NULL DEFAULT 0,
      net_value_recovered BIGINT NOT NULL DEFAULT 0,
      status VARCHAR(50) NOT NULL,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TYPE escalation_status AS ENUM ('pending', 'in_review', 'resolved', 'dismissed');

    CREATE TABLE escalations (
      escalation_id VARCHAR(255) PRIMARY KEY,
      subscription_id VARCHAR(255) NULL,
      instrument_id VARCHAR(255) NOT NULL,
      decision_id VARCHAR(255) NULL,
      status escalation_status NOT NULL DEFAULT 'pending',
      trigger_reason VARCHAR(255) NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ NULL,
      resolved_by VARCHAR(255) NULL,
      resolution_notes TEXT NULL
    );
  `);

  // Create pg-mem adapter pool
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool() as unknown as TestPool;

  // Enforce append-only immutability trigger simulation
  let immutabilityTriggerActive = true;

  const originalQuery = pool.query.bind(pool);
  pool.query = function <R extends QueryResultRow = QueryResultRow>(
    queryTextOrConfig: string | pg.QueryConfig<unknown[]>,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>> {
    const text = typeof queryTextOrConfig === 'string' ? queryTextOrConfig : queryTextOrConfig.text;
    if (immutabilityTriggerActive && typeof text === 'string') {
      if (/^\s*(UPDATE|DELETE\s+FROM)\s+events\b/i.test(text)) {
        return Promise.reject(
          new Error(
            'Events table is append-only. UPDATE and DELETE operations are strictly forbidden.',
          ),
        );
      }
    }
    return originalQuery(queryTextOrConfig as string, values);
  } as typeof pool.query;

  const originalConnect = pool.connect.bind(pool);
  pool.connect = (async (): Promise<pg.PoolClient> => {
    const client = await originalConnect();
    const origClientQuery = client.query.bind(client);
    client.query = function <R extends QueryResultRow = QueryResultRow>(
      queryTextOrConfig: string | pg.QueryConfig<unknown[]>,
      values?: unknown[],
    ): Promise<pg.QueryResult<R>> {
      const text =
        typeof queryTextOrConfig === 'string' ? queryTextOrConfig : queryTextOrConfig.text;
      if (immutabilityTriggerActive && typeof text === 'string') {
        if (/^\s*(UPDATE|DELETE\s+FROM)\s+events\b/i.test(text)) {
          return Promise.reject(
            new Error(
              'Events table is append-only. UPDATE and DELETE operations are strictly forbidden.',
            ),
          );
        }
      }
      return origClientQuery(queryTextOrConfig as string, values);
    } as typeof client.query;
    return client;
  }) as typeof pool.connect;

  // Allow tests to temporarily bypass trigger to simulate direct DB manipulation / attack
  pool.__disableImmutabilityTrigger = () => {
    immutabilityTriggerActive = false;
  };
  pool.__enableImmutabilityTrigger = () => {
    immutabilityTriggerActive = true;
  };

  const cleanup = async () => {
    await pool.end();
  };

  return { db, pool, cleanup };
}
