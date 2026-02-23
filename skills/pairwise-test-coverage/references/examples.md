# Pairwise Testing Examples

Concrete examples for each testing technique.

## 1. Pairwise Testing

```typescript
import { describe, it, expect } from 'vitest'; // or jest, node:test
import { classifyError } from './error-classifier.js';

const cases = [
  [
    'retryable + timeout + no-circuit-breaker',
    {
      error: new TimeoutError('service-a', 5000),
      circuitState: 'closed',
      expected: { shouldRetry: true, backoffMs: 1000 },
    },
  ],
  [
    'retryable + timeout + circuit-open',
    {
      error: new TimeoutError('service-a', 5000),
      circuitState: 'open',
      expected: { shouldRetry: false, backoffMs: 0 },
    },
  ],
  [
    'non-retryable + validation + closed',
    {
      error: new ValidationError('invalid input'),
      circuitState: 'closed',
      expected: { shouldRetry: false, backoffMs: 0 },
    },
  ],
];

describe('classifyError pairwise', () => {
  it.each(cases)('%s', (_name, { error, circuitState, expected }) => {
    expect(classifyError(error, circuitState)).toMatchObject(expected);
  });
});
```

---

## 2. Property-Based Testing

```typescript
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

const computeChecksum = (state: unknown) => JSON.stringify(state);

describe('checksum property', () => {
  it('matches when computed from same state', () => {
    fc.assert(
      fc.property(fc.jsonObject(), (state) => {
        const checksum = computeChecksum(state);
        const result = compareChecksums(checksum, state, computeChecksum);
        expect(result.matched).toBe(true);
      }),
    );
  });

  it('detects mutation', () => {
    fc.assert(
      fc.property(fc.jsonObject(), fc.jsonObject(), (state1, state2) => {
        fc.pre(JSON.stringify(state1) !== JSON.stringify(state2));
        const checksum = computeChecksum(state1);
        const result = compareChecksums(checksum, state2, computeChecksum);
        expect(result.matched).toBe(false);
      }),
    );
  });
});
```

---

## 3. Model-Based Testing

```typescript
import { describe, it, expect } from 'vitest';

type State = 'idle' | 'processing' | 'retrying' | 'failed' | 'succeeded';
type Action = 'start' | 'succeed' | 'fail' | 'retry' | 'giveUp';

const transition = (state: State, action: Action): State => {
  if (state === 'idle' && action === 'start') return 'processing';
  if (state === 'processing' && action === 'succeed') return 'succeeded';
  if (state === 'processing' && action === 'fail') return 'retrying';
  if (state === 'retrying' && action === 'retry') return 'processing';
  if (state === 'retrying' && action === 'giveUp') return 'failed';
  return state; // Invalid transition = no-op
};

describe('queue processor state model', () => {
  it('never reaches succeeded after fail without retry', () => {
    const actions: Action[] = ['start', 'fail', 'succeed'];
    const final = actions.reduce(transition, 'idle' as State);
    expect(final).not.toBe('succeeded');
  });

  it('can recover via retry', () => {
    const actions: Action[] = ['start', 'fail', 'retry', 'succeed'];
    const final = actions.reduce(transition, 'idle' as State);
    expect(final).toBe('succeeded');
  });

  it('transitions table', () => {
    const transitions: Array<[State, Action, State]> = [
      ['idle', 'start', 'processing'],
      ['processing', 'succeed', 'succeeded'],
      ['processing', 'fail', 'retrying'],
      ['retrying', 'retry', 'processing'],
      ['retrying', 'giveUp', 'failed'],
      // Invalid transitions
      ['idle', 'succeed', 'idle'],
      ['succeeded', 'fail', 'succeeded'],
    ];

    for (const [from, action, expected] of transitions) {
      expect(transition(from, action)).toBe(expected);
    }
  });
});
```

---

## 4. Fault Injection

```typescript
it('returns error status and increments retry count on storage failure', async () => {
  const storage = createTestStorage();
  const repository = {
    saveBatch: async () => { throw new Error('Storage timeout'); },
  };
  const processor = new QueueProcessor({ storage, repository, logger: console });

  const result = await processor.flush();

  expect(result.status).toBe('error');
  expect(storage.getRetryCount()).toBe(1);
  expect(storage.getPendingItems()).toHaveLength(originalItemCount); // Nothing lost
});

it('escalates to dead-letter after max retries', async () => {
  const storage = createTestStorage({ retryCount: 4 }); // At limit
  const repository = {
    saveBatch: async () => { throw new Error('Persistent failure'); },
  };
  const processor = new QueueProcessor({ storage, repository, logger: console });

  const result = await processor.flush();

  expect(result.status).toBe('dead_lettered');
  expect(storage.getDeadLetterCount()).toBe(1);
});
```

---

## 5. Deterministic Concurrency (Barrier)

```typescript
it('preserves new items queued after save, before clear', async () => {
  const { storage, barriers } = createStorageWithBarriers();
  const repository = {
    saveBatch: async (items) => {
      storage.signalSaveCompleted();
      return items;
    },
  };
  const processor = new QueueProcessor({ storage, repository, logger: console });

  // Pre-populate queue
  storage.setQueue({ pendingItems: items1to10, retryCount: 0 });
  barriers.afterRead.release();

  const flushPromise = processor.flush();

  // Wait for save to complete
  await pollUntil(() => repository.saveBatch.called);

  // Concurrent enqueue while flush is blocked before clear
  await processor.enqueue(items11to14);

  barriers.transactionStart.release();
  await flushPromise;

  const queue = storage.getQueue();
  expect(queue.pendingItems.map((e) => e.sequenceNumber)).toEqual([11, 12, 13, 14]);
});
```

---

## 6. Contract Tests

```typescript
import { describe, it, expect } from 'vitest';
import { RollbackMessageSchema } from '../schemas.js';

describe('rollback message schema', () => {
  it('accepts valid rollback message', () => {
    const msg = {
      type: 'rollback',
      commandId: 'cmd-1',
      reason: 'checksum_mismatch',
      serverChecksum: '0123456789abcdef',
      clientChecksum: 'fedcba9876543210',
      serverState: { items: [], count: 0 },
      timestamp: Date.now(),
    };
    expect(RollbackMessageSchema.safeParse(msg).success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const msg = { type: 'rollback', commandId: 'cmd-1' };
    expect(RollbackMessageSchema.safeParse(msg).success).toBe(false);
  });
});
```

---

## 7. Observability Assertions

```typescript
it('logs error context on sequence gap', async () => {
  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
  const service = new RecoveryService({ logger, storage: failingStorage });

  await expect(service.recover()).rejects.toThrow('Sequence gap');

  expect(logger.warn).toHaveBeenCalledWith(
    'Sequence gap detected during recovery',
    expect.objectContaining({
      expectedSequence: 42,
      actualSequence: 46,
    }),
  );
});
```
