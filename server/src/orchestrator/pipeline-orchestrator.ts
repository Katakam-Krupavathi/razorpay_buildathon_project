import crypto from 'node:crypto';
import pg from 'pg';
import type {
  DbInstrument,
  PipelineProcessResult,
  EscalationRecord,
  PolicyDecisionRecord,
} from '@recovery/shared';
import { getPool } from '../db/connection.js';
import { EventStore } from '../event-store/event-store.js';
import { HealthService } from '../risk/health-service.js';
import { formulateRecoveryPlan } from '../planner/planner.js';
import { decide } from '../policy/engine.js';
import { CohortCircuitBreaker } from '../circuit-breaker/circuit-breaker.js';
import { CircuitBreakerGuard } from '../circuit-breaker/circuit-breaker-guard.js';
import { VerificationGateway } from '../verification/gateway.js';
import { VerificationService } from '../verification/verification-service.js';
import { ExecutionEngine } from '../execution/execution-engine.js';
import { EscalationService } from '../escalation/escalation-service.js';

export interface BatchPipelineSummary {
  total: number;
  byAction: {
    retry_now: number;
    schedule_retry: number;
    proactive_nudge: number;
    pause: number;
    grace_period: number;
    NO_ACTION: number;
    escalate: number;
  };
  byVerificationStatus: {
    VERIFIED_SAFE: number;
    BLOCKED: number;
  };
  byCircuitBreakerStatus: {
    CLOSED: number;
    OPEN: number;
  };
  escalatedCount: number;
  results: PipelineProcessResult[];
}

/**
 * End-to-End Autonomous Recovery Pipeline Orchestrator.
 *
 * Connects all 6 stages of the control plane into a single zero-trust workflow:
 * 1. Risk Intelligence Scorer
 * 2. AI Recovery Planner
 * 3. Deterministic Policy Engine ("PERMIT")
 * 4. Cohort Circuit Breaker Guard
 * 5. Pre-Action Safety & Verification Gateway
 * 6. Execution Layer / Human Escalation Queue
 */
export class RecoveryPipelineOrchestrator {
  private pool: pg.Pool;
  private eventStore: EventStore;
  private healthService: HealthService;
  private circuitBreaker: CohortCircuitBreaker;
  private cbGuard: CircuitBreakerGuard;
  private verificationGateway: VerificationGateway;
  private verificationService: VerificationService;
  private executionEngine: ExecutionEngine;
  private escalationService: EscalationService;

  constructor(
    pool?: pg.Pool,
    eventStore?: EventStore,
    healthService?: HealthService,
    circuitBreaker?: CohortCircuitBreaker,
    cbGuard?: CircuitBreakerGuard,
    verificationGateway?: VerificationGateway,
    verificationService?: VerificationService,
    executionEngine?: ExecutionEngine,
    escalationService?: EscalationService,
  ) {
    this.pool = pool || getPool();
    this.eventStore = eventStore || new EventStore(this.pool);
    this.healthService = healthService || new HealthService(this.eventStore, this.pool);
    this.circuitBreaker = circuitBreaker || new CohortCircuitBreaker(this.eventStore);
    this.cbGuard = cbGuard || new CircuitBreakerGuard(this.circuitBreaker, this.eventStore);
    this.verificationGateway =
      verificationGateway || new VerificationGateway(undefined, this.circuitBreaker);
    this.verificationService =
      verificationService ||
      new VerificationService(this.verificationGateway, this.eventStore, this.pool);
    this.escalationService =
      escalationService || new EscalationService(this.pool, this.eventStore);
    this.executionEngine =
      executionEngine ||
      new ExecutionEngine(
        undefined,
        undefined,
        this.eventStore,
        this.verificationGateway,
        this.escalationService,
      );
  }

  /**
   * Runs the complete end-to-end recovery pipeline for a single payment instrument.
   */
  async processInstrument(
    instrumentId: string,
    referenceTime?: string | Date,
  ): Promise<PipelineProcessResult> {
    const refDate = referenceTime ? new Date(referenceTime) : new Date();

    // 1. Fetch instrument record
    const instResult = await this.pool.query<DbInstrument>(
      'SELECT * FROM instruments WHERE instrument_id = $1;',
      [instrumentId],
    );

    if (instResult.rows.length === 0) {
      throw new Error(`Payment instrument '${instrumentId}' not found.`);
    }

    const instrument = instResult.rows[0];

    // =========================================================================
    // Stage 1: Risk Intelligence & ERV Computation
    // =========================================================================
    const healthEvaluation = await this.healthService.evaluateAndPersist(instrumentId, {
      referenceTime: refDate,
    });
    const healthResult = healthEvaluation.health;
    const ervResult = healthEvaluation.erv;

    // =========================================================================
    // Stage 2: AI Recovery Planner (Zero Execution Authority)
    // =========================================================================
    const proposedPlan = formulateRecoveryPlan(
      {
        instrument,
        health: healthResult,
        erv: ervResult,
      },
      {
        referenceTime: refDate,
      },
    );

    // =========================================================================
    // Stage 3: Deterministic Policy Engine ("PERMIT")
    // =========================================================================
    const policyResult = decide({
      instrumentId: instrument.instrument_id,
      subscriptionId: instrument.subscription_id,
      rail: instrument.rail,
      trajectory: healthResult.trajectory,
      attemptCount: healthResult.featureVector.consecutive_failures || 0,
      proposedAction: proposedPlan.proposedAction,
      rootCause: healthResult.rootCause,
      expectedRecoveryValue: proposedPlan.expectedRecoveryValue,
      ltvTier: instrument.ltv_tier || 'standard',
      customerContactCountThisCycle: 0,
      amountPaise: Math.round(Number(instrument.annualized_value || 1200000) / 12),
      evaluatedAt: refDate.toISOString(),
    });

    const policyDecision: PolicyDecisionRecord = {
      decisionId: `dec_${crypto.randomUUID()}`,
      instrumentId: instrument.instrument_id,
      subscriptionId: instrument.subscription_id,
      result: policyResult.result,
      proposedAction: proposedPlan.proposedAction,
      finalAction: policyResult.finalAction,
      ruleIdMatched: policyResult.ruleIdMatched,
      reason: policyResult.reason,
      evaluatedAt: policyResult.evaluatedAt,
    };

    // =========================================================================
    // Stage 4: Circuit Breaker Pipeline Guard
    // =========================================================================
    const cohortKey = CircuitBreakerGuard.deriveCohortKey(instrument.rail);
    const cbEvaluation = await this.cbGuard.evaluateDecision(
      policyDecision,
      cohortKey,
      refDate,
    );
    const guardedDecision = cbEvaluation.decision;

    // =========================================================================
    // Stage 5: Pre-Action Safety & Verification Gateway ("2 AM" Air Gap)
    // =========================================================================
    const idempotencyKey = `idem_${instrument.instrument_id}_${refDate.getTime()}_${crypto.randomBytes(4).toString('hex')}`;
    const verificationServiceResult = await this.verificationService.verifyAndLog({
      instrument,
      decision: guardedDecision,
      idempotencyKey,
      referenceTime: refDate,
      cohortKey,
    });
    const verificationRecord = verificationServiceResult.verification;

    // =========================================================================
    // Stage 6: Execution Layer / Escalation Queue
    // =========================================================================
    const executionResult = await this.executionEngine.execute({
      instrument,
      decision: guardedDecision,
      verification: verificationRecord,
      idempotencyKey,
      referenceTime: refDate,
    });

    let escalationRecord: EscalationRecord | undefined;
    if (executionResult.status === 'ESCALATED' && executionResult.details?.escalationId) {
      const esc = await this.escalationService.getEscalationById(
        executionResult.details.escalationId as string,
      );
      if (esc) escalationRecord = esc;
    }

    return {
      instrumentId: instrument.instrument_id,
      subscriptionId: instrument.subscription_id,
      risk: healthResult,
      erv: ervResult,
      plan: proposedPlan,
      policy: guardedDecision,
      verification: verificationRecord,
      execution: executionResult,
      escalation: escalationRecord,
    };
  }

  /**
   * Runs the full recovery pipeline across all payment instruments in the database.
   */
  async processBatch(referenceTime?: string | Date): Promise<BatchPipelineSummary> {
    const instrumentsResult = await this.pool.query<DbInstrument>(
      'SELECT * FROM instruments ORDER BY created_at ASC;',
    );

    const summary: BatchPipelineSummary = {
      total: instrumentsResult.rows.length,
      byAction: {
        retry_now: 0,
        schedule_retry: 0,
        proactive_nudge: 0,
        pause: 0,
        grace_period: 0,
        NO_ACTION: 0,
        escalate: 0,
      },
      byVerificationStatus: {
        VERIFIED_SAFE: 0,
        BLOCKED: 0,
      },
      byCircuitBreakerStatus: {
        CLOSED: 0,
        OPEN: 0,
      },
      escalatedCount: 0,
      results: [],
    };

    for (const inst of instrumentsResult.rows) {
      const result = await this.processInstrument(inst.instrument_id, referenceTime);
      summary.results.push(result);

      // Track by action
      const act = result.execution.action;
      if (act in summary.byAction) {
        summary.byAction[act]++;
      }

      // Track verification status
      if (result.verification.status === 'VERIFIED_SAFE') {
        summary.byVerificationStatus.VERIFIED_SAFE++;
      } else {
        summary.byVerificationStatus.BLOCKED++;
      }

      // Track circuit breaker status
      const cbCheck = result.verification.checks.find(
        (c) => c.check === 'CIRCUIT_BREAKER_CHECK',
      );
      if (cbCheck && !cbCheck.passed) {
        summary.byCircuitBreakerStatus.OPEN++;
      } else {
        summary.byCircuitBreakerStatus.CLOSED++;
      }

      // Track escalations
      if (result.execution.status === 'ESCALATED') {
        summary.escalatedCount++;
      }
    }

    return summary;
  }
}
