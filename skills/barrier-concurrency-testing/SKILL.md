---
name: barrier-concurrency-testing
description: Deterministic race condition testing using barriers and deferred promises. Replaces flaky setTimeout-based timing tests with reproducible interleaving control.
---

# Barrier Concurrency Testing

Deterministic race condition testing -- no flaky timing-based tests.

Instead of `setTimeout` (flaky) or `sleep` (slow), use **barriers** to pause execution at exact interleave points. The test controls when each concurrent operation proceeds, making race condition tests deterministic and reproducible on every run.

**When to use**: Testing concurrent operations, flush conflicts, parallel mutations, race windows between read and write, lock contention scenarios, any code where timing affects correctness.

**When not to use**: Sequential-only code, simple unit tests, UI components, read-only operations, code with no concurrency concerns.

## Rationalizations (Do Not Skip)

| Rationalization | Why It's Wrong | Required Action |
|-----------------|----------------|-----------------|
| "setTimeout is good enough" | Timing-based tests are inherently flaky -- they pass 99 times, fail on CI | Use barriers for deterministic control |
| "It passed 10 times, it's fine" | Heisenbugs hide in timing windows that haven't been hit yet | Barrier at every interleave point |
| "We don't have race conditions" | Any concurrent code has race windows | Write a barrier test to prove it |
| "Barriers are too complex" | 15 lines of setup prevents hours of debugging flaky failures | Copy the pattern from references |

---

## What To Protect (Start Here)

Before generating barrier tests, identify which concurrency decisions apply to your code:

| Decision | Question to Answer | If Yes → Use |
|----------|--------------------|--------------|
| Concurrent writes must not lose data | Can two writes to the same resource happen simultaneously? | `assertPreservesConcurrentItems` |
| Failed operations must not corrupt state | Can a failure leave behind partial or inconsistent state? | `assertPreservesOnFailure` |
| Event/message ordering must be preserved | Does processing order affect correctness? | `assertSequenceContinuity` |
| Retry state must reset on new input | Can stale retry counts or error flags affect new operations? | `assertRetryCountReset` |

**Do not generate tests for decisions the human hasn't confirmed.** A barrier test without a named invariant is coverage theater — it proves the barrier works, not that the system is correct.

---

## Included Utilities

```typescript
// Barrier infrastructure + invariant assertions + test data generators
import {
  createBarrier,
  createTrackedBarrier,
  releaseAllBarriers,
  assertPreservesConcurrentItems,
  assertPreservesOnFailure,
  assertSequenceContinuity,
  assertLastSequenceCorrect,
  assertRetryCountReset,
  createTestItems,
} from './test-fixtures.ts';
```

## Violation Rules

### inadequate_barrier_coverage
Race conditions MUST have barrier tests at each interleave point. If there are N interleave points in the code, there must be N barrier test cases.
**Severity**: must-fail

### flaky_timing_test
NEVER use `setTimeout`, `sleep`, or arbitrary delays for concurrency testing. Use barriers for deterministic control.
**Severity**: must-fail

---

## Companion Skills

This skill provides **deterministic timing control** for concurrency tests, not concurrency architecture guidance. For broader methodology:

- Search `concurrency` on [skills.sh](https://skills.sh) for lock-free patterns, actor models, and thread safety analysis
- Concurrent state machines need transition coverage — use [model-based-testing](https://github.com/apankov1/quality-engineering/tree/main/skills/model-based-testing) for N*N transition matrices and guard truth tables
- Concurrent failure recovery needs resilience testing — use [fault-injection-testing](https://github.com/apankov1/quality-engineering/tree/main/skills/fault-injection-testing) for circuit breaker, retry policy, and queue preservation under concurrent load

---

## Quick Reference

| Scenario | Pattern | Example |
|----------|---------|---------|
| Block before transaction | `barrier.wait()` in transaction start | Verify concurrent writes preserved |
| Block during I/O | `deferred.promise` as mock return | Verify queue depth during processing |
| Multiple interleave points | Multiple barriers, release in sequence | Test all orderings of concurrent ops |
| Cleanup | `afterEach(() => releaseAllBarriers())` | Prevent test hangs |

See [patterns.md](./references/patterns.md) for full code examples, deferred promise alternative, and framework adaptation guide.
