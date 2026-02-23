# Pairwise Testing Workflow

Step-by-step guide for implementing pairwise and barrier-based concurrency tests.

## Step 1: Define Factors and Values

For each testable system, identify orthogonal factors:

| Domain | Factor Examples | Value Examples |
|--------|-----------------|----------------|
| API | Auth method | `none`, `token`, `expired-token` |
| API | Request payload | `valid`, `missing-field`, `oversized` |
| API | Rate limit state | `under-limit`, `at-limit`, `over-limit` |
| Queue | Operation | `flush`, `retry`, `dead-letter` |
| Queue | Concurrent op | `none`, `enqueue`, `another-flush` |
| Queue | Interleave point | `after-read`, `before-clear`, `during-clear` |
| Queue | Outcome | `success`, `error`, `timeout` |
| Recovery | Entry point | `cold-start`, `alarm`, `lazy-load` |
| Recovery | Snapshot state | `none`, `valid`, `corrupt` |
| Recovery | Data continuity | `contiguous`, `gap` |

## Step 2: Generate Minimal Pairwise Matrix

Use the included pairwise generator:

```typescript
import { generatePairwiseMatrix } from './pairwise.ts';

const factors = {
  auth: ['none', 'token', 'expired-token'],
  payload: ['valid', 'missing-field', 'oversized'],
  rateLimit: ['under-limit', 'at-limit', 'over-limit'],
};

const matrix = generatePairwiseMatrix(factors);
// Returns ~9 cases covering all pairs (vs 27 exhaustive)
```

Or run standalone:
```bash
npx tsx pairwise.ts
```

## Step 3: Implement Barrier-Based Concurrency Tests

Use the barrier pattern for deterministic interleaving:

```typescript
import { createBarrier, createTrackedBarrier, releaseAllBarriers } from './test-fixtures.ts';

describe('concurrent queue operations', () => {
  afterEach(() => releaseAllBarriers());

  it('preserves items enqueued during flush', async () => {
    const barrier = createTrackedBarrier();

    // Inject barrier into service's transaction path
    const queue = createQueueWithBarrier(barrier);

    // Start flush -- blocks at barrier before clearing
    const flushPromise = queue.flush();

    // Wait for save to complete
    await pollUntil(() => queue.saveCompleted);

    // Concurrent enqueue while flush is blocked
    await queue.enqueue(newItems);

    // Release -- flush continues
    barrier.release();
    await flushPromise;

    // Verify concurrent items preserved
    expect(queue.pending).toEqual(newItems);
  });
});
```

**Pattern**: Always release barriers in `afterEach` to prevent test hangs.

## Step 4: Add Invariant Assertions

Define invariants that MUST hold for correct operation:

```typescript
import {
  assertPreservesConcurrentItems,
  assertPreservesOnFailure,
  assertSequenceContinuity,
  assertLastSequenceCorrect,
  assertRetryCountReset,
} from './test-fixtures.ts';

// After successful processing:
assertPreservesConcurrentItems(queue.remaining, maxProcessedSeq, expect);
assertSequenceContinuity(queue.remaining, expect);
assertLastSequenceCorrect(result.lastSequence, processedBatch, expect);
assertRetryCountReset(queue, expect);

// After failed processing:
assertPreservesOnFailure(queue.remaining, originalQueue, newItems, expect);
```

## Step 5: Table-Driven Pairwise Tests

Use `it.each` for matrix-driven tests:

```typescript
describe('API validation pairwise matrix', () => {
  const testCases = [
    {
      name: 'valid token + valid payload + under limit -> 200',
      auth: 'token',
      payload: 'valid',
      rateLimit: 'under-limit',
      expected: { status: 200 },
    },
    {
      name: 'expired token + valid payload + under limit -> 401',
      auth: 'expired-token',
      payload: 'valid',
      rateLimit: 'under-limit',
      expected: { status: 401 },
    },
    // ... remaining matrix cases
  ];

  it.each(testCases)('$name', async ({ auth, payload, rateLimit, expected }) => {
    const request = buildRequest({ auth, payload, rateLimit });
    const response = await service.handle(request);
    expect(response.status).toBe(expected.status);
  });
});
```
