import type {
  DecisionTrace,
  DecisionTraceStep,
  TraceStage,
  GracePeriodAuditItem,
  UpiAutopayCapAuditItem,
  StaleStateAuditItem,
  CircuitBreakerTripAuditItem,
  ComplianceAuditReport,
} from '@recovery/shared';

export interface DecisionTraceOptions {
  includeDerivedTables?: boolean;
}

export interface ComplianceQueryOptions {
  daysLookback?: number;
  limit?: number;
  offset?: number;
}

export type {
  DecisionTrace,
  DecisionTraceStep,
  TraceStage,
  GracePeriodAuditItem,
  UpiAutopayCapAuditItem,
  StaleStateAuditItem,
  CircuitBreakerTripAuditItem,
  ComplianceAuditReport,
};
