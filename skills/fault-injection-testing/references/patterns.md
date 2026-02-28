# Fault Injection Testing Patterns

Deep-dive into failure matrix methodology and boundary injection rules.

## Failure Matrix Methodology

Enumerate all failure modes for each external dependency:

| Dependency | Failure Mode | Error Type | Expected Recovery |
|------------|--------------|------------|-------------------|
| Database | Connection timeout | ETIMEDOUT | Retry with backoff |
| Database | Connection reset | ECONNRESET | Circuit half-open |
| Database | Constraint violation | SQLITE_CONSTRAINT | Idempotent retry |
| HTTP API | 429 Rate Limited | RateLimitError | Extended backoff |
| HTTP API | 503 Unavailable | ServiceError | Circuit open |

## Circuit Breaker State Diagram

```
      ┌──────────────────┐
      │     CLOSED       │◄────────────┐
      └────────┬─────────┘             │
               │ failures >= threshold │
               v                       │
      ┌──────────────────┐      success│
      │      OPEN        │             │
      └────────┬─────────┘             │
               │ timeout               │
               v                       │
      ┌──────────────────┐─────────────┘
      │   HALF-OPEN      │
      └──────────────────┘
               │ failure
               └──────────────────────►OPEN
```

## Backoff Calculation Reference

```
delay(n) = min(baseDelay * 2^n, maxDelay) * (1 ± jitter)

Example with base=100ms, max=30s, jitter=0.1:
  n=0: 100ms ± 10ms
  n=1: 200ms ± 20ms
  n=2: 400ms ± 40ms
  n=3: 800ms ± 80ms
```

## Queue Preservation Invariants

1. **No Data Loss**: All items before must exist after failure
2. **Proper Trimming**: Only items > maxProcessed should remain after success
3. **Retry Count Reset**: New items have retryCount=0

## Boundary-Only Injection

Inject faults ONLY at system boundaries (database, network, external services), not inside business logic.
