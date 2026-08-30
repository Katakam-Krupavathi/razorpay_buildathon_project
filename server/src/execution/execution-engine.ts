import crypto from 'node:crypto';
import type {
  ExecutionAction,
  ExecutionResult,
} from '@recovery/shared';
import { RazorpayClient } from '../razorpay/client.js';
import { EventStore } from '../event-store/event-store.js';
import { VerificationGateway } from '../verification/gateway.js';
import { EscalationService } from '../escalation/escalation-service.js';
import {
  type NotificationProvider,
  ConsoleNotificationProvider,
} from './notification-provider.js';
import type { ExecutionContext, ExecutionEngineConfig } from './types.js';

export class ExecutionEngine {
  private razorpayClient: RazorpayClient;
  private notificationProvider: NotificationProvider;
  private eventStore: EventStore;
  private verificationGateway: VerificationGateway;
  private escalationService: EscalationService;

  constructor(
    razorpayClient?: RazorpayClient,
    notificationProvider?: NotificationProvider,
    eventStore?: EventStore,
    verificationGateway?: VerificationGateway,
    escalationService?: EscalationService,
    config?: ExecutionEngineConfig,
  ) {
    this.razorpayClient = razorpayClient || new RazorpayClient();
    this.notificationProvider =
      config?.notificationProvider ||
      notificationProvider ||
      new ConsoleNotificationProvider();
    this.eventStore = eventStore || new EventStore();
    this.verificationGateway = verificationGateway || new VerificationGateway();
    this.escalationService = escalationService || new EscalationService();
  }

  /**
   * Executes the final recovery action adhering to Verification Gateway outcomes.
   */
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const executionId = `exec_${crypto.randomUUID()}`;
    const executedAt = context.referenceTime
      ? new Date(context.referenceTime).toISOString()
      : new Date().toISOString();

    const isVerificationBlocked = context.verification.status === 'BLOCKED';
    const targetAction: ExecutionAction = isVerificationBlocked
      ? 'escalate'
      : (context.decision.finalAction as ExecutionAction);

    let executionStatus: 'SUCCESS' | 'FAILED' | 'ESCALATED' | 'NO_OP' = 'SUCCESS';
    let executionDetails: Record<string, unknown> = {};

    switch (targetAction) {
      case 'retry_now': {
        const subId =
          context.instrument.subscription_id || context.instrument.instrument_id;
        const chargeRes = await this.razorpayClient.chargeSubscription(subId);
        executionStatus = 'SUCCESS';
        executionDetails = {
          mode: 'immediate_charge',
          chargeResponse: chargeRes,
          rail: context.instrument.rail,
        };
        this.verificationGateway.registerExecutedIdempotencyKey(context.idempotencyKey);
        break;
      }

      case 'schedule_retry': {
        // Calculate offset based on rail (Card +24h, UPI +24h, ENACH +48h)
        const offsetHours =
          context.instrument.rail === 'enach'
            ? 48
            : context.instrument.rail === 'upi_autopay'
              ? 24
              : 24;

        const scheduledTime = new Date(
          new Date(executedAt).getTime() + offsetHours * 3600 * 1000,
        ).toISOString();

        executionStatus = 'SUCCESS';
        executionDetails = {
          mode: 'scheduled_retry',
          scheduledAt: scheduledTime,
          offsetHours,
          rail: context.instrument.rail,
        };
        this.verificationGateway.registerExecutedIdempotencyKey(context.idempotencyKey);
        break;
      }

      case 'proactive_nudge': {
        const notifRes = await this.notificationProvider.send({
          notificationId: `notif_${crypto.randomUUID()}`,
          recipient: context.instrument.subscription_id
            ? `customer_${context.instrument.subscription_id}@example.com`
            : `customer_${context.instrument.instrument_id}@example.com`,
          channel: context.instrument.rail === 'upi_autopay' ? 'whatsapp' : 'email',
          template:
            context.instrument.rail === 'card'
              ? 'PROACTIVE_CARD_EXPIRY_NOTIFICATION'
              : 'MANDATE_PRE_DEBIT_NOTIFICATION',
          data: {
            instrumentId: context.instrument.instrument_id,
            rail: context.instrument.rail,
            reason: context.decision.reason,
          },
          sentAt: executedAt,
        });

        executionStatus = 'SUCCESS';
        executionDetails = {
          mode: 'customer_nudge',
          notification: notifRes,
        };
        this.verificationGateway.registerExecutedIdempotencyKey(context.idempotencyKey);
        break;
      }

      case 'pause':
      case 'grace_period': {
        const subId =
          context.instrument.subscription_id || context.instrument.instrument_id;
        const pauseRes = await this.razorpayClient.pauseSubscription(subId, {
          pause_at: 'now',
          pause_duration: 7, // 7 days grace period
        });

        executionStatus = 'SUCCESS';
        executionDetails = {
          mode: 'subscription_pause_grace_period',
          pauseResponse: pauseRes,
          gracePeriodDays: 7,
        };
        this.verificationGateway.registerExecutedIdempotencyKey(context.idempotencyKey);
        break;
      }

      case 'NO_ACTION': {
        executionStatus = 'NO_OP';
        executionDetails = {
          mode: 'no_action_required',
          reason: context.decision.reason,
        };
        break;
      }

      case 'escalate':
      default: {
        const triggerReason = isVerificationBlocked
          ? context.verification.blockedReason || 'PRE_ACTION_VERIFICATION_BLOCKED'
          : context.decision.reason;

        const escalationRecord = await this.escalationService.createEscalation({
          subscriptionId: context.instrument.subscription_id,
          instrumentId: context.instrument.instrument_id,
          decisionId: context.decision.decisionId,
          triggerReason,
          metadata: {
            decision: context.decision,
            verification: context.verification,
          },
        });

        executionStatus = 'ESCALATED';
        executionDetails = {
          mode: 'operations_escalation_queue',
          escalationId: escalationRecord.escalationId,
          triggerReason,
        };
        break;
      }
    }

    const result: ExecutionResult = {
      executionId,
      instrumentId: context.instrument.instrument_id,
      subscriptionId: context.instrument.subscription_id,
      action: targetAction,
      status: executionStatus,
      idempotencyKey: context.idempotencyKey,
      executedAt,
      details: executionDetails,
    };

    // Append action_executed event to EventStore (actor = 'execution_engine')
    await this.eventStore.appendEvent({
      subscriptionId: result.subscriptionId,
      instrumentId: result.instrumentId,
      eventType: 'action_executed',
      actor: 'execution_engine',
      payload: result,
      createdAt: executedAt,
    });

    return result;
  }
}
