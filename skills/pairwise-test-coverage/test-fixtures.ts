/**
 * Test Fixtures for Pairwise/Concurrency Testing
 *
 * Provides reusable patterns for:
 * - Barrier-based timing control (deterministic concurrency tests)
 * - Invariant assertion helpers (named, descriptive failure messages)
 * - Pairwise test case generation helpers
 *
 * Framework-agnostic: Uses standard assertion patterns.
 * Adapt `expect()` calls to your test framework (Vitest, Jest, Node test runner).
 *
 * @example
 * import { createTrackedBarrier, releaseAllBarriers } from './test-fixtures';
 *
 * describe('concurrency tests', () => {
 *   afterEach(() => releaseAllBarriers());
 *
 *   it('handles concurrent operations', async () => {
 *     const barrier = createTrackedBarrier();
 *     // ... test logic with barrier.wait() and barrier.release()
 *   });
 * });
 */

// NOTE: Import `expect` from your test framework:
// import { expect } from 'vitest';  // or 'jest' or '@jest/globals'

// ============================================================================
// BARRIER PATTERN
// ============================================================================

/**
 * Barrier for timing control in concurrency tests.
 *
 * Allows tests to pause execution at specific points and resume when ready.
 * Critical for deterministic interleaving tests.
 */
export interface Barrier {
  /** Wait until barrier is released */
  wait: () => Promise<void>;
  /** Release the barrier, allowing waiters to proceed */
  release: () => void;
  /** Check if barrier has been released */
  readonly released: boolean;
}

/**
 * Create a barrier for timing control
 */
export function createBarrier(): Barrier {
  let resolve: () => void;
  let released = false;

  const promise = new Promise<void>((r) => {
    resolve = () => {
      released = true;
      r();
    };
  });

  return {
    wait: () => promise,
    release: () => resolve(),
    get released() {
      return released;
    },
  };
}

// Track all active barriers for cleanup
const activeBarriers: Barrier[] = [];

/**
 * Create a barrier that's automatically tracked for cleanup.
 *
 * MUST call releaseAllBarriers() in afterEach to prevent test hangs.
 */
export function createTrackedBarrier(): Barrier {
  const barrier = createBarrier();
  activeBarriers.push(barrier);
  return barrier;
}

/**
 * Release all tracked barriers -- MUST be called in afterEach.
 *
 * Prevents test hangs when barriers are not explicitly released.
 */
export function releaseAllBarriers(): void {
  activeBarriers.forEach((b) => {
    if (!b.released) {
      b.release();
    }
  });
  activeBarriers.length = 0;
}

/**
 * Get count of active barriers (for debugging)
 */
export function getActiveBarrierCount(): number {
  return activeBarriers.length;
}

// ============================================================================
// INVARIANT ASSERTIONS
// ============================================================================

/**
 * Item with a sequence number for ordered queue testing.
 *
 * Adapt this interface to your domain:
 * - Event queues: { sequenceNumber, eventId, payload }
 * - Message queues: { sequenceNumber, messageId, body }
 * - Task queues: { sequenceNumber, taskId, status }
 */
export interface SequencedItem {
  sequenceNumber: number;
  id?: string;
  data?: unknown;
}

/**
 * INVARIANT 1: Only items <= maxProcessedSequence may be removed.
 *
 * After successful processing, the queue should only contain items
 * with sequence > maxProcessedSequence (i.e., concurrent additions).
 */
export function assertPreservesConcurrentItems(
  remainingItems: SequencedItem[],
  maxProcessedSequence: number,
  expect: (value: unknown, message?: string) => { toHaveLength: (n: number) => void },
): void {
  const violations = remainingItems.filter((e) => e.sequenceNumber <= maxProcessedSequence);

  expect(
    violations,
    `INVARIANT 1 violated: ${violations.length} items with seq <= ${maxProcessedSequence} still in queue: [${violations.map((e) => e.sequenceNumber).join(', ')}]`,
  ).toHaveLength(0);
}

/**
 * INVARIANT 2: Failed processing preserves all items.
 *
 * After failed processing, the queue must contain at least all prior items
 * plus any new items added concurrently.
 */
export function assertPreservesOnFailure(
  queueAfter: SequencedItem[],
  queueBefore: SequencedItem[],
  newItems: SequencedItem[] = [],
  expect: (value: unknown, message?: string) => { toContain: (item: unknown) => void },
): void {
  const expectedSequences = [...queueBefore, ...newItems].map((e) => e.sequenceNumber);
  const actualSequences = queueAfter.map((e) => e.sequenceNumber);

  for (const seq of expectedSequences) {
    expect(
      actualSequences,
      `INVARIANT 2 violated: sequence ${seq} missing after failed processing`,
    ).toContain(seq);
  }
}

/**
 * INVARIANT 3: No gaps in remaining queue sequences.
 *
 * After any operation, queue sequences should be contiguous.
 */
export function assertSequenceContinuity(
  remainingItems: SequencedItem[],
  expect: (value: unknown, message?: string) => { toBe: (expected: unknown) => void },
): void {
  if (remainingItems.length <= 1) {
    return; // No gaps possible with 0 or 1 items
  }

  const seqs = remainingItems.map((e) => e.sequenceNumber).sort((a, b) => a - b);

  for (let i = 1; i < seqs.length; i++) {
    expect(seqs[i], `INVARIANT 3 violated: gap between ${seqs[i - 1]} and ${seqs[i]}`).toBe(
      seqs[i - 1] + 1,
    );
  }
}

/**
 * INVARIANT 4: lastSequence = max sequence ACTUALLY processed.
 *
 * The returned lastSequence must match what was actually processed,
 * NOT the current queue max (which may include concurrent additions).
 */
export function assertLastSequenceCorrect(
  returnedLastSequence: number | undefined,
  processedItems: SequencedItem[],
  expect: (value: unknown, message?: string) => { toBeUndefined: () => void; toBe: (expected: unknown) => void },
): void {
  if (processedItems.length === 0) {
    expect(
      returnedLastSequence,
      'INVARIANT 4 violated: lastSequence should be undefined for empty batch',
    ).toBeUndefined();
    return;
  }

  const expectedLastSequence = processedItems[processedItems.length - 1].sequenceNumber;
  expect(
    returnedLastSequence,
    `INVARIANT 4 violated: lastSequence=${returnedLastSequence} but processed max=${expectedLastSequence}`,
  ).toBe(expectedLastSequence);
}

/**
 * INVARIANT 5: retryCount reset for concurrent additions.
 *
 * After successful processing, remaining items (concurrent additions)
 * must have retryCount=0. They are new items that have never been
 * attempted -- inheriting retryCount causes premature failure escalation.
 */
export function assertRetryCountReset(
  queue: { retryCount: number; pendingItems: SequencedItem[] },
  expect: (value: unknown, message?: string) => { toBe: (expected: unknown) => void },
): void {
  if (queue.pendingItems.length > 0) {
    expect(
      queue.retryCount,
      `INVARIANT 5 violated: concurrent additions have retryCount=${queue.retryCount}, should be 0`,
    ).toBe(0);
  }
}

// ============================================================================
// TEST DATA GENERATORS
// ============================================================================

/**
 * Create test items with sequential numbers
 */
export function createTestItems(startSeq: number, count: number): SequencedItem[] {
  return Array.from({ length: count }, (_, i) => ({
    sequenceNumber: startSeq + i,
    id: `item-${startSeq + i}`,
    data: { type: 'test', seq: startSeq + i },
  }));
}

// ============================================================================
// PAIRWISE TEST HELPERS
// ============================================================================

/**
 * Factor definition for pairwise testing
 */
export interface PairwiseFactors {
  [factorName: string]: string[];
}

/**
 * Test case generated from pairwise matrix
 */
export interface PairwiseTestCase {
  name: string;
  [factorName: string]: string;
}

/**
 * Generate test case name from factor values
 */
export function generateTestCaseName(testCase: Record<string, string>): string {
  return Object.entries(testCase)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}

/**
 * Create it.each compatible test cases from pairwise matrix
 */
export function createPairwiseTestCases<T extends Record<string, string>>(
  matrix: T[],
  expectedFn: (testCase: T) => unknown,
): Array<T & { name: string; expected: unknown }> {
  return matrix.map((testCase) => ({
    ...testCase,
    name: generateTestCaseName(testCase),
    expected: expectedFn(testCase),
  }));
}
