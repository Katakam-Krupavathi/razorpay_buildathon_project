import crypto from 'node:crypto';
import type { ExecutionActionResult, ExecutionStatus } from '@recovery/shared';
import type { ExecutionContext } from './types.js';
import { RazorpayClient } from '../razorpay/client.js';
import { NotificationService } from '../notifications/notification-service.js';
import { EscalationService } from '../escalation/escalation-service.js';
import { VerificationGateway } from '../verification/gateway.js';
import { EventStore } from '../event-store/event-store.js';
import { getPool } from '../db/connection.js';

export class ExecutionService {
  private razorpayClient: RazorpayClient;
  private notificationService: NotificationService;
  private escalationService: EscalationService;
  private verificationGateway: VerificationGateway;
  private eventStore: EventStore;

  constructor(
    razorpayClient?: RazorpayClient,
    notificationService?: NotificationService,
    escalationService?: EscalationService,
    verificationGateway?: VerificationGateway,
    eventStore?: EventStore,
  ) {
    const pool = getPool();
    this.eventStore = eventStore || new EventStore(pool);
    this.razorpayClient = razorpayClient || new RazorpayClient();
    this.notificationService = notificationService || new NotificationService();
    this.escalationService = escalationService || new EscalationService(pool, this.eventStore);
    this.verificationGateway = verificationGateway || new VerificationGateway(this.razorpayClient);
  }

  /**
   * Executes the verified recovery action or routes to escalation.
   */
  async execute(context: ExecutionContext): Promise<ExecutionActionResult> {
    const actionId = `act_${crypto.randomUUID()}`;
    const executedAt = context.referenceTime
      ? new Date(context.referenceTime).toISOString()
      : new Date().toISOString();

    let status: ExecutionStatus = 'executed';
    let externalReferenceId: string | undefined;
    const details: Record<string, unknown> = {
      decisionId: context.decision.decisionId,
      proposedAction: context.decision.proposedAction,
      finalAction: context.decision.finalAction,
      rail: context.instrument.rail,
    };

    switch (context.action) {
      case 'retry':
      case 'schedule_retry': {
        const subId = context.instrument.subscription_id || 'sub_synthetic_default';
        const chargeRes = await this.razorpayClient.chargeSubscription(subId, {
          amount: Math.round(Number(context.instrument.annualized_value) / 12),
          token: context.instrument.instrument_id,
        });

        externalReferenceId = chargeRes.id;
        status = context.action === 'schedule_retry' ? 'scheduled' : 'executed';
        details.chargeResponse = chargeRes;

        // Register idempotency key to prevent double charge
        this.verificationGateway.registerExecutedIdempotencyKey(context.idempotencyKey);

        // Log action_executed event to EventStore (actor = 'execution_engine')
        await this.eventStore.appendEvent({
          subscriptionId: context.instrument.subscription_id,
          instrumentId: context.instrument.instrument_id,
          eventType: 'action_executed',
          actor: 'execution_engine',
          payload: {
            actionId,
            action: context.action,
            status,
            idempotencyKey: context.idempotencyKey,
            externalReferenceId,
            details,
          },
          createdAt: executedAt,
        });
        break;
      }

      case 'proactive_nudge': {
        const nudgeRes = await this.notificationService.sendNudge({
          recipient: `customer_${context.instrument.subscription_id}@example.com`,
          channel: 'email',
          template: 'PROACTIVE_CARD_EXPIRY_NUDGE',
          subject: 'Payment Method Notice: Action required for your recurring subscription',
          params: {
            instrumentId: context.instrument.instrument_id,
            subscriptionId: context.instrument.subscription_id,
            rail: context.instrument.rail,
          },
          idempotencyKey: context.idempotencyKey,
        });

        externalReferenceId = nudgeRes.messageId;
        status = 'nudged';
        details.notification = nudgeRes;

        this.verificationGateway.registerExecutedIdempotencyKey(context.idempotencyKey);

        await this.eventStore.appendEvent({
          subscriptionId: context.instrument.subscription_id,
          instrumentId: context.instrument.instrument_id,
          eventType: 'action_executed',
          actor: 'execution_engine',
          payload: {
            actionId,
            action: context.action,
            status,
            idempotencyKey: context.idempotencyKey,
            externalReferenceId,
            details,
          },
          createdAt: executedAt,
        });
        break;
      }

      case 'pause':
      case 'grace_period': {
        const subId = context.instrument.subscription_id || 'sub_synthetic_default';
        const pauseRes = await this.razorpayClient.pauseSubscription(subId, {
          pause_at: 'now',
          pause_duration: 7, // 7-day default grace period
        });

        externalReferenceId = pauseRes.id;
        status = 'paused';
        details.pauseResponse = pauseRes;

        this.verificationGateway.registerExecutedIdempotencyKey(context.idempotencyKey);

        await this.eventStore.appendEvent({
          subscriptionId: context.instrument.subscription_id,
          instrumentId: context.instrument.instrument_id,
          eventType: 'action_executed',
          actor: 'execution_engine',
          payload: {
            actionId,
            action: context.action,
            status,
            idempotencyKey: context.idempotencyKey,
            externalReferenceId,
            details,
          },
          createdAt: executedAt,
        });
        break;
      }

      case 'NO_ACTION': {
        status = 'no_op';
        details.message = 'No autonomous intervention required; instrument is healthy or terminal.';

        await this.eventStore.appendEvent({
          subscriptionId: context.instrument.subscription_id,
          instrumentId: context.instrument.instrument_id,
          eventType: 'action_noop',
          actor: 'execution_engine',
          payload: {
            actionId,
            action: context.action,
            status,
            idempotencyKey: context.idempotencyKey,
            details,
          },
          createdAt: executedAt,
        });
        break;
      }

      case 'escalate':
      default: {
        const reason =
          context.verification?.blockedReason ||
          context.decision.reason ||
          'Automated recovery blocked or exceeded safety thresholds.';

        const escalation = await this.escalationService.createEscalation({
          instrumentId: context.instrument.instrument_id,
          subscriptionId: context.instrument.subscription_id,
          reason,
          blockedReason: context.verification?.blockedReason || null,
          proposedAction: context.decision.proposedAction,
          payload: {
            decisionId: context.decision.decisionId,
            ruleIdMatched: context.decision.ruleIdMatched,
            verificationChecks: context.verification?.checks || [],
          },
        });

        externalReferenceId = escalation.escalation_id;
        status = 'escalated';
        details.escalation = escalation;

        await this.eventStore.appendEvent({
          subscriptionId: context.instrument.subscription_id,
          instrumentId: context.instrument.instrument_id,
          eventType: 'action_escalated',
          actor: 'execution_engine',
          payload: {
            actionId,
            action: 'escalate',
            status,
            idempotencyKey: context.idempotencyKey,
            externalReferenceId,
            details,
          },
          createdAt: executedAt,
        });
        break;
      }
    }

    return {
      actionId,
      instrumentId: context.instrument.instrument_id,
      subscriptionId: context.instrument.subscription_id,
      action: context.action,
      status,
      idempotencyKey: context.idempotencyKey,
      executedAt,
      externalReferenceId,
      details,
    };
  }

  getNotificationService(): NotificationService {
    return this.notificationService;
  }

  getEscalationService(): EscalationService {
    return this.escalationService;
  }
}
