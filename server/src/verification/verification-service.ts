import pg from 'pg';
import type {
  PreActionVerificationRecord,
  StaleStateDetectedPayload,
} from '@recovery/shared';
import { VerificationGateway } from './gateway.js';
import { EventStore } from '../event-store/event-store.js';
import { getPool } from '../db/connection.js';
import type { VerificationContext, VerificationGatewayConfig } from './types.js';

export interface VerificationServiceResult {
  verification: PreActionVerificationRecord;
  isSafe: boolean;
}

/**
 * Verification Orchestration Service.
 *
 * Runs immediately before action execution, performs the 4 verification checks,
 * and emits audit events (stale_state_detected / action_blocked / action_verified) to EventStore.
 */
export class VerificationService {
  private gateway: VerificationGateway;
  private eventStore: EventStore;
  private pool: pg.Pool;

  constructor(
    gateway?: VerificationGateway,
    eventStore?: EventStore,
    pool?: pg.Pool,
  ) {
    this.pool = pool || getPool();
    this.eventStore = eventStore || new EventStore(this.pool);
    this.gateway = gateway || new VerificationGateway();
  }

  /**
   * Performs pre-action verification and writes audit events to EventStore.
   */
  async verifyAndLog(
    context: VerificationContext,
    customConfig?: Partial<VerificationGatewayConfig>,
  ): Promise<VerificationServiceResult> {
    const verification = await this.gateway.verify(context, customConfig);
    const isSafe = verification.status === 'VERIFIED_SAFE';

    // 1. If Stale State Detected -> Emit stale_state_detected event (actor = 'verification_gateway')
    if (
      verification.status === 'BLOCKED' &&
      verification.blockedReason === 'STALE_STATE_DISAGREEMENT'
    ) {
      await this.eventStore.appendEvent<StaleStateDetectedPayload>({
        subscriptionId: context.instrument.subscription_id,
        instrumentId: context.instrument.instrument_id,
        eventType: 'stale_state_detected',
        actor: 'verification_gateway',
        payload: {
          instrumentId: context.instrument.instrument_id,
          subscriptionId: context.instrument.subscription_id,
          cachedStatus: verification.cachedMandateStatus,
          liveStatus: verification.liveMandateStatus,
          divergenceDetectedAt: verification.verifiedAt,
          reason: `Stale state divergence: Cached status '${verification.cachedMandateStatus}' differs from live gateway state '${verification.liveMandateStatus}'. Action aborted; routed to manual human review.`,
        },
        createdAt: verification.verifiedAt,
      });
    }

    // 2. Emit action_blocked or action_verified event
    if (!isSafe) {
      await this.eventStore.appendEvent<PreActionVerificationRecord>({
        subscriptionId: context.instrument.subscription_id,
        instrumentId: context.instrument.instrument_id,
        eventType: 'action_blocked',
        actor: 'verification_gateway',
        payload: verification,
        createdAt: verification.verifiedAt,
      });
    } else {
      await this.eventStore.appendEvent<PreActionVerificationRecord>({
        subscriptionId: context.instrument.subscription_id,
        instrumentId: context.instrument.instrument_id,
        eventType: 'action_verified',
        actor: 'verification_gateway',
        payload: verification,
        createdAt: verification.verifiedAt,
      });
    }

    return {
      verification,
      isSafe,
    };
  }
}
