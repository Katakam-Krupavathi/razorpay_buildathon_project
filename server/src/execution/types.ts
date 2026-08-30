import type {
  PolicyDecisionRecord,
  PreActionVerificationRecord,
  DbInstrument,
  ExecutionAction,
  ExecutionResult,
} from '@recovery/shared';
import type { NotificationProvider } from './notification-provider.js';

export interface ExecutionContext {
  decision: PolicyDecisionRecord;
  verification: PreActionVerificationRecord;
  instrument: DbInstrument;
  idempotencyKey: string;
  referenceTime?: string | Date;
}

export interface ExecutionEngineConfig {
  notificationProvider?: NotificationProvider;
}

export type { ExecutionAction, ExecutionResult };
