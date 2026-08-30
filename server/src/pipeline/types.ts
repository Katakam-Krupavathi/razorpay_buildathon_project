import type {
  PipelineInstrumentResult,
  PipelineBatchSummary,
  PipelineStatus,
} from '@recovery/shared';

export interface PipelineProcessOptions {
  referenceTime?: string | Date;
  mockExecution?: boolean;
}

export interface PipelineBatchOptions {
  referenceTime?: string | Date;
  limit?: number;
  offset?: number;
  railFilter?: string;
}

export type { PipelineInstrumentResult, PipelineBatchSummary, PipelineStatus };
