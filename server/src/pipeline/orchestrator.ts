import pg from 'pg';
import type {
  DbInstrument,
  PipelineInstrumentResult,
  PipelineBatchSummary,
  PipelineStatus,
} from '@recovery/shared';
import { EventStore } from '../event-store/event-store.js';
import { getPool } from '../db/connection.js';
import { HealthService } from '../risk/health-service.js';
import { RecoveryPlannerService } from '../planner/planner-service.js';
import { PolicyService } from '../policy/policy-service.js';
import { CohortCircuitBreaker } from '../circuit-breaker/circuit-breaker.js';
import { CircuitBreakerGuard } from '../circuit-breaker/circuit-breaker-guard.js';
import { VerificationGateway } from '../verification/gateway.js';
import { VerificationService } from '../verification/verification-service.js';
import { ExecutionService } from '../execution/execution-service.js';
import { EscalationService } from '../escalation/escalation-service.js';
import { AttributionService } from '../attribution/attribution-service.js';
import type { PipelineProcessOptions, PipelineBatchOptions } from './types.js';

/**
 * End-to-End Autonomous Revenue Recovery Pipeline Orchestrator.
 *
 * Connects all layers:
 *   [1] Risk Intelligence Layer (Health Scorer & ERV Engine)
 *   [2] AI Recovery Planner (Proposed Action Record)
 *   [3] Deterministic Policy Engine ("PERMIT")
 *   [4] Cohort Circuit Breaker Guard
 *   [5] Safety & Verification Gateway (Pre-Action Checks)
 *   [6] Execution Layer & Escalation Workflow
 *   [7] Outcome Attribution & Counterfactual Financial Engine
 *
 * NOTE: This module has ZERO dependency on Fastify/HTTP server bootstrap.
 */
export class RecoveryPipelineOrchestrator {
  private pool: pg.Pool;
  private eventStore: EventStore;
  private healthService: HealthService;
  private plannerService: RecoveryPlannerService;
  private policyService: PolicyService;
  private circuitBreaker: CohortCircuitBreaker;
  private circuitBreakerGuard: CircuitBreakerGuard;
  private verificationGateway: VerificationGateway;
  private verificationService: VerificationService;
  private executionService: ExecutionService;
  private escalationService: EscalationService;
  private attributionService: AttributionService;

  constructor(dependencies?: {
    pool?: pg.Pool;
    eventStore?: EventStore;
    healthService?: HealthService;
    plannerService?: RecoveryPlannerService;
    policyService?: PolicyService;
    circuitBreaker?: CohortCircuitBreaker;
    verificationGateway?: VerificationGateway;
    executionService?: ExecutionService;
    escalationService?: EscalationService;
    attributionService?: AttributionService;
  }) {
    this.pool = dependencies?.pool || getPool();
    this.eventStore = dependencies?.eventStore || new EventStore(this.pool);
    this.healthService =
      dependencies?.healthService || new HealthService(this.eventStore, this.pool);
    this.plannerService =
      dependencies?.plannerService || new RecoveryPlannerService(this.eventStore, this.pool);
    this.policyService =
      dependencies?.policyService || new PolicyService(this.eventStore, this.pool);
    this.circuitBreaker = dependencies?.circuitBreaker || new CohortCircuitBreaker(this.eventStore);
    this.circuitBreakerGuard = new CircuitBreakerGuard(this.circuitBreaker, this.eventStore);
    this.verificationGateway =
      dependencies?.verificationGateway || new VerificationGateway(undefined, this.circuitBreaker);
    this.verificationService = new VerificationService(
      this.verificationGateway,
      this.eventStore,
      this.pool,
    );
    this.escalationService =
      dependencies?.escalationService || new EscalationService(this.pool, this.eventStore);
    this.executionService =
      dependencies?.executionService ||
      new ExecutionService(
        undefined,
        undefined,
        this.escalationService,
        this.verificationGateway,
        this.eventStore,
      );
    this.attributionService =
      dependencies?.attributionService ||
      new AttributionService(this.pool, this.eventStore);
  }

  /**
   * Processes a single payment instrument through the full 6-stage autonomous recovery pipeline.
   */
  async processInstrument(
    instrumentId: string,
    options?: PipelineProcessOptions,
  ): Promise<PipelineInstrumentResult> {
    const refTime = options?.referenceTime ? new Date(options.referenceTime) : new Date();
    const completedAt = refTime.toISOString();

    // 0. Load instrument from database
    const instResult = await this.pool.query<DbInstrument>(
      'SELECT * FROM instruments WHERE instrument_id = $1;',
      [instrumentId],
    );

    if (instResult.rows.length === 0) {
      throw new Error(`Instrument '${instrumentId}' not found in database.`);
    }
    const instrument = instResult.rows[0];

    // [Stage 1] Risk Intelligence Layer Evaluation
    const healthServiceResult = await this.healthService.evaluateAndPersist(instrumentId, {
      referenceTime: refTime,
    });
    const healthSnapshot = healthServiceResult.health;

    // [Stage 2] AI Recovery Planner Proposal
    const planResult = await this.plannerService.planAndLog(instrumentId, {
      referenceTime: refTime,
    });
    const proposedPlan = planResult.proposal;

    // [Stage 3] Deterministic Policy Engine ("PERMIT")
    // Query event store for proactive nudges/contacts within the current billing cycle (last 30 days)
    let customerContactCountThisCycle = 0;
    try {
      const subEvents = await this.eventStore.getEventsForSubscription(
        instrument.subscription_id,
      );
      const thirtyDaysAgo = new Date(refTime.getTime() - 30 * 86400 * 1000);
      customerContactCountThisCycle = subEvents.filter((e) => {
        const isNudge =
          e.eventType === 'proactive_nudge_sent' ||
          (e.eventType === 'action_executed' &&
            ((e.payload as Record<string, unknown>)?.action === 'proactive_nudge' ||
              (e.payload as Record<string, unknown>)?.finalAction === 'proactive_nudge'));
        const eventTime = new Date(e.createdAt);
        return isNudge && eventTime >= thirtyDaysAgo;
      }).length;
    } catch {
      customerContactCountThisCycle = 0;
    }

    const policyResult = await this.policyService.evaluateAndLog({
      instrumentId: instrument.instrument_id,
      subscriptionId: instrument.subscription_id,
      rail: instrument.rail,
      trajectory: healthSnapshot.trajectory,
      attemptCount: healthSnapshot.featureVector.failure_count_last_3_cycles || 0,
      proposedAction: proposedPlan.proposedAction,
      rootCause: proposedPlan.rootCause,
      expectedRecoveryValue: proposedPlan.expectedRecoveryValue,
      ltvTier: instrument.ltv_tier,
      customerContactCountThisCycle,
      amountPaise: Math.round(Number(instrument.annualized_value) / 12),
      evaluatedAt: refTime.toISOString(),
    });
    let policyDecision = policyResult.decision;

    // [Stage 4] Cohort Circuit Breaker Guard
    const cohortKey = CircuitBreakerGuard.deriveCohortKey(instrument.rail);
    const guardOutcome = await this.circuitBreakerGuard.evaluateDecision(
      policyDecision,
      cohortKey,
      refTime,
    );
    const isCircuitBreakerBlock = !guardOutcome.allowed;
    policyDecision = guardOutcome.decision;

    // Handle Policy / Circuit Breaker Block
    if (policyDecision.result === 'BLOCK') {
      const pipelineStatus: PipelineStatus = isCircuitBreakerBlock
        ? 'blocked_by_circuit_breaker'
        : 'blocked_by_policy';

      const execution = await this.executionService.execute({
        instrument,
        decision: policyDecision,
        idempotencyKey: `idem_pipe_esc_${instrumentId}_${Date.now()}`,
        action: 'escalate',
        referenceTime: refTime,
      });

      const outcome = await this.attributionService.evaluateAndRecord({
        instrument,
        healthSnapshot,
        proposedPlan,
        execution,
        referenceTime: refTime,
      });

      return {
        instrumentId,
        subscriptionId: instrument.subscription_id,
        healthSnapshot,
        proposedPlan,
        policyDecision,
        execution,
        outcome,
        pipelineStatus,
        completedAt,
      };
    }

    // Handle NO_ACTION
    if (policyDecision.finalAction === 'NO_ACTION') {
      const execution = await this.executionService.execute({
        instrument,
        decision: policyDecision,
        idempotencyKey: `idem_pipe_noop_${instrumentId}_${Date.now()}`,
        action: 'NO_ACTION',
        referenceTime: refTime,
      });

      const outcome = await this.attributionService.evaluateAndRecord({
        instrument,
        healthSnapshot,
        proposedPlan,
        execution,
        referenceTime: refTime,
      });

      return {
        instrumentId,
        subscriptionId: instrument.subscription_id,
        healthSnapshot,
        proposedPlan,
        policyDecision,
        execution,
        outcome,
        pipelineStatus: 'no_op',
        completedAt,
      };
    }

    // [Stage 5] Safety & Verification Gateway (Pre-Action Air Gap)
    const idempotencyKey = `idem_pipe_act_${instrumentId}_${Date.now()}`;
    const verificationRecord = await this.verificationGateway.verify({
      instrument,
      decision: policyDecision,
      idempotencyKey,
      cohortKey,
      referenceTime: refTime,
    });

    // Check Verification Gateway Result
    if (verificationRecord.status === 'BLOCKED') {
      // Log stale_state_detected or action_blocked
      const verifyLogRes = await this.verificationService.verifyAndLog({
        instrument,
        decision: policyDecision,
        idempotencyKey,
        cohortKey,
        referenceTime: refTime,
      });

      // Route blocked action to Escalation Workflow
      const execution = await this.executionService.execute({
        instrument,
        decision: policyDecision,
        verification: verifyLogRes.verification,
        idempotencyKey,
        action: 'escalate',
        referenceTime: refTime,
      });

      const outcome = await this.attributionService.evaluateAndRecord({
        instrument,
        healthSnapshot,
        proposedPlan,
        execution,
        verification: verifyLogRes.verification,
        referenceTime: refTime,
      });

      return {
        instrumentId,
        subscriptionId: instrument.subscription_id,
        healthSnapshot,
        proposedPlan,
        policyDecision,
        verification: verifyLogRes.verification,
        execution,
        outcome,
        pipelineStatus: 'blocked_by_verification',
        completedAt,
      };
    }

    // [Stage 6] Verified Execution
    const execution = await this.executionService.execute({
      instrument,
      decision: policyDecision,
      verification: verificationRecord,
      idempotencyKey,
      action: policyDecision.finalAction,
      referenceTime: refTime,
    });

    const pipelineStatus: PipelineStatus =
      policyDecision.finalAction === 'escalate' ? 'escalated' : 'executed';

    const outcome = await this.attributionService.evaluateAndRecord({
      instrument,
      healthSnapshot,
      proposedPlan,
      execution,
      verification: verificationRecord,
      referenceTime: refTime,
    });

    return {
      instrumentId,
      subscriptionId: instrument.subscription_id,
      healthSnapshot,
      proposedPlan,
      policyDecision,
      verification: verificationRecord,
      execution,
      outcome,
      pipelineStatus,
      completedAt,
    };
  }

  /**
   * Processes a batch of instruments sequentially through the recovery pipeline.
   */
  async processBatch(options?: PipelineBatchOptions): Promise<PipelineBatchSummary> {
    const startTime = Date.now();
    const limit = options?.limit || 1000;
    const offset = options?.offset || 0;

    let querySql =
      'SELECT instrument_id FROM instruments ORDER BY created_at ASC LIMIT $1 OFFSET $2;';
    const values: unknown[] = [limit, offset];

    if (options?.railFilter) {
      querySql =
        'SELECT instrument_id FROM instruments WHERE rail = $1 ORDER BY created_at ASC LIMIT $2 OFFSET $3;';
      values.unshift(options.railFilter);
    }

    const result = await this.pool.query<{ instrument_id: string }>(querySql, values);
    const instrumentIds = result.rows.map((r) => r.instrument_id);

    let executedCount = 0;
    let escalatedCount = 0;
    let blockedByPolicyCount = 0;
    let blockedByCircuitBreakerCount = 0;
    let blockedByVerificationCount = 0;
    let noOpCount = 0;
    const byActionType: Record<string, number> = {
      retry: 0,
      schedule_retry: 0,
      proactive_nudge: 0,
      pause: 0,
      escalate: 0,
      NO_ACTION: 0,
    };

    for (const instrumentId of instrumentIds) {
      const res = await this.processInstrument(instrumentId, {
        referenceTime: options?.referenceTime,
      });

      if (res.execution?.action) {
        byActionType[res.execution.action] = (byActionType[res.execution.action] || 0) + 1;
      }

      switch (res.pipelineStatus) {
        case 'executed':
          executedCount++;
          break;
        case 'escalated':
          escalatedCount++;
          break;
        case 'blocked_by_policy':
          blockedByPolicyCount++;
          escalatedCount++;
          break;
        case 'blocked_by_circuit_breaker':
          blockedByCircuitBreakerCount++;
          escalatedCount++;
          break;
        case 'blocked_by_verification':
          blockedByVerificationCount++;
          escalatedCount++;
          break;
        case 'no_op':
          noOpCount++;
          break;
      }
    }

    const wallClockMs = Date.now() - startTime;
    const scorecard = await this.attributionService.getScorecard();

    return {
      totalProcessed: instrumentIds.length,
      executedCount,
      byActionType,
      escalatedCount,
      blockedByPolicyCount,
      blockedByCircuitBreakerCount,
      blockedByVerificationCount,
      noOpCount,
      scorecard,
      wallClockMs,
      completedAt: new Date().toISOString(),
    };
  }

  getCircuitBreaker(): CohortCircuitBreaker {
    return this.circuitBreaker;
  }

  getVerificationGateway(): VerificationGateway {
    return this.verificationGateway;
  }

  getExecutionService(): ExecutionService {
    return this.executionService;
  }

  getEscalationService(): EscalationService {
    return this.escalationService;
  }

  getAttributionService(): AttributionService {
    return this.attributionService;
  }
}
