import type { DbEscalationRecord, EscalationStatus } from '@recovery/shared';

export interface CreateEscalationParams {
  instrumentId: string;
  subscriptionId?: string | null;
  reason: string;
  blockedReason?: string | null;
  proposedAction?: string | null;
  payload?: Record<string, unknown>;
}

export interface EscalationFilter {
  status?: EscalationStatus;
  instrumentId?: string;
  limit?: number;
  offset?: number;
}

export interface ResolveEscalationParams {
  escalationId: string;
  resolvedBy: string;
  resolutionNotes: string;
  status?: 'resolved' | 'dismissed';
}

export type { DbEscalationRecord, EscalationStatus };
