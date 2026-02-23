---
name: barrier-concurrency-testing
description: |
  Deterministic race condition testing using barriers and deferred promises.
  Replaces flaky setTimeout-based timing tests with reproducible interleaving control.

  WHEN to use:
  - Testing concurrent operations, flush conflicts, parallel mutations
  - Race windows between read and write, lock contention scenarios
  - Any code where timing affects correctness

  WHEN NOT to use:
  - Sequential-only code, simple unit tests
  - UI components, read-only operations
  - Code with no concurrency concerns
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Write
  - Edit
---

# Barrier Concurrency Testing

Deterministic race condition testing -- no flaky timing-based tests.

## Core Idea

Instead of `setTimeout` (flaky) or `sleep` (slow), use **barriers** to pause execution at exact interleave points. The test controls when each concurrent operation proceeds, making race condition tests deterministic and reproducible on every run.

## Rationalizations (Do Not Skip)

| Rationalization | Why It's Wrong | Required Action |
|-----------------|----------------|-----------------|
| "setTimeout is good enough" | Timing-based tests are inherently flaky -- they pass 99 times, fail on CI | Use barriers for deterministic control |
| "It passed 10 times, it's fine" | Heisenbugs hide in timing windows you haven't hit yet | Barrier at every interleave point |
| "We don't have race conditions" | Any concurrent code has race windows | Write a barrier test to prove it |
| "Barriers are too complex" | 15 lines of setup prevents hours of debugging flaky failures | Copy the pattern below |

---

## Workflow

### Step 1: Create Barrier Infrastructure

```typescript
export interface Barrier {
  wait: () => Promise<void>;
  release: () => void;
  released: boolean;
}

export function createBarrier(): Barrier {
  let resolve: () => void;
  let released = false;
  const promise = new Promise<void>((r) => {
    resolve = () => { released = true; r(); };
  });
  return {
    wait: () => promise,
    release: () => resolve(),
    get released() { return released; },
  };
}
```

### Step 2: Always Clean Up Barriers

Unreleased barriers cause test hangs. Always release in `afterEach`:

```typescript
const activeBarriers: Barrier[] = [];

function createTrackedBarrier(): Barrier {
  const barrier = createBarrier();
  activeBarriers.push(barrier);
  return barrier;
}

function releaseAllBarriers(): void {
  activeBarriers.forEach((b) => { if (!b.released) b.release(); });
  activeBarriers.length = 0;
}

afterEach(() => {
  releaseAllBarriers();
});
```

### Step 3: Test a Race Window

The pattern: start concurrent operations, block one at a barrier, let the other proceed, then release the barrier and verify the result.

```typescript
it('preserves items enqueued after save starts but before clear', async () => {
  const barrier = createTrackedBarrier();

  // Inject barrier into the service's transaction path
  const queue = createQueueWithBarrier(barrier);

  // Start flush (will block at barrier before clearing)
  const flushPromise = queue.flush();

  // Wait for the save to complete (use your framework's polling utility)
  await pollUntil(() => repository.saveBatch.called);

  // Enqueue concurrently while flush is blocked before clear
  await queue.enqueue(newItems);

  // Release the barrier -- flush continues and clears
  barrier.release();
  await flushPromise;

  // Verify: concurrent items were NOT lost during clear
  expect(queue.pending).toEqual(newItems);
});
```

> **Framework note**: The `pollUntil` step varies by test framework. Vitest provides `vi.waitFor()`, testing-library provides `waitFor()`, or write a simple polling loop with `setTimeout`.

### Alternative: Deferred Promises

For simpler cases where you only need to pause/resume at a single point:

```typescript
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

it('handles enqueue during processing', async () => {
  const deferred = createDeferred<Result>();

  // Block the service at the execute step
  mockExecute.mockReturnValueOnce(deferred.promise);

  const p1 = service.process();

  // Wait for processing to start
  await pollUntil(() => service.isProcessing);

  // Concurrent operation while blocked
  const p2 = service.enqueue(newCommand);
  expect(service.depth).toBe(2);

  // Release
  deferred.resolve({ success: true });
  await Promise.all([p1, p2]);
});
```

**When to use deferred vs barriers**:
- **Deferred**: Simple pause/resume at a single point (one concurrent operation)
- **Barriers**: Complex multi-step synchronization (multiple interleave points)

---

## Violation Rules

### inadequate_barrier_coverage
Race conditions MUST have barrier tests at each interleave point. If there are N interleave points in the code, there must be N barrier test cases.
**Severity**: must-fail

### flaky_timing_test
NEVER use `setTimeout`, `sleep`, or arbitrary delays for concurrency testing. Use barriers for deterministic control.
**Severity**: must-fail

---

## Quick Reference

| Scenario | Pattern | Example |
|----------|---------|---------|
| Block before transaction | `barrier.wait()` in transaction start | Verify concurrent writes preserved |
| Block during I/O | `deferred.promise` as mock return | Verify queue depth during processing |
| Multiple interleave points | Multiple barriers, release in sequence | Test all orderings of concurrent ops |
| Cleanup | `afterEach(() => releaseAllBarriers())` | Prevent test hangs |

## Framework Adaptation

The barrier pattern is framework-agnostic. It works with:
- **Vitest**: Use `vi.waitFor()` for polling, `vi.fn()` for mock injection
- **Jest**: Use `waitFor` from testing-library or custom polling
- **Node test runner**: Custom polling with `setTimeout`
- **Go/Rust/Java**: Same concept -- channels/condvars replace promises

The core principle is the same: **control timing explicitly, never rely on wall-clock delays**.
