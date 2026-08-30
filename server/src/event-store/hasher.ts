import crypto from 'node:crypto';
import fastJsonStableStringify from 'fast-json-stable-stringify';
import { GENESIS_PREV_HASH } from '@recovery/shared';

/**
 * Deterministically canonicalize JSON payload by sorting keys recursively
 * and ensuring consistent formatting without arbitrary whitespace.
 */
export function canonicalizeJson(data: unknown): string {
  if (data === undefined || data === null) {
    return '{}';
  }
  return fastJsonStableStringify(data);
}

/**
 * Standardize timestamp representation for cryptographic hashing.
 * Converts Date object or string to standard ISO 8601 UTC string.
 */
export function normalizeTimestamp(timestamp: string | Date): string {
  if (timestamp instanceof Date) {
    return timestamp.toISOString();
  }
  return new Date(timestamp).toISOString();
}

export interface ComputeHashParams {
  prevHash: string;
  payload: unknown;
  eventType: string;
  createdAt: string | Date;
}

/**
 * Computes SHA-256 hash for an event in the tamper-evident hash chain.
 *
 * Formula:
 * Hash = SHA-256(prev_hash + canonicalized_payload + event_type + normalized_created_at)
 *
 * Global chaining is used across the entire control plane ledger (rather than
 * per-subscription) so that:
 * 1. The total global event ordering is tamper-evident and non-repudiable.
 * 2. Cross-aggregate events (e.g. circuit-breaker trips, policy evaluations) are part
 *    of the unified ledger.
 * 3. Auditors can verify full system state integrity with a single tip hash verification.
 */
export function computeEventHash({
  prevHash,
  payload,
  eventType,
  createdAt,
}: ComputeHashParams): string {
  const canonicalPayload = canonicalizeJson(payload);
  const normalizedDate = normalizeTimestamp(createdAt);
  const effectivePrevHash = prevHash || GENESIS_PREV_HASH;

  const contentToHash = `${effectivePrevHash}|${eventType}|${normalizedDate}|${canonicalPayload}`;

  return crypto.createHash('sha256').update(contentToHash, 'utf8').digest('hex');
}
