import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CircuitBreaker,
  RetryPolicy,
  assertQueuePreserved,
  assertQueueTrimmed,
  createFaultInjector,
  createFaultScenario,
} from "./fault-injection.ts";

// ============================================================================
// FAULT SCENARIO
// ============================================================================

describe("createFaultScenario", () => {
  // Defect: Scenario builder must capture all fields
  it("creates scenario with all fields", () => {
    const scenario = createFaultScenario("timeout", "ETIMEDOUT", "retry_scheduled");

    assert.equal(scenario.name, "timeout");
    assert.equal(scenario.fault, "ETIMEDOUT");
    assert.equal(scenario.expected, "retry_scheduled");
  });
});

// ============================================================================
// CIRCUIT BREAKER STATE MACHINE
// ============================================================================

describe("CircuitBreaker", () => {
  describe("initial state", () => {
    // Defect: Circuit must start closed
    it("starts in closed state", () => {
      const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 1000 });
      assert.equal(cb.getState(), "closed");
      assert.equal(cb.canExecute(), true);
    });
  });

  describe("closed -> open transition", () => {
    // Defect: Circuit must open after threshold failures
    it("opens after failure threshold reached", () => {
      const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 1000 });

      cb.recordFailure();
      assert.equal(cb.getState(), "closed");

      cb.recordFailure();
      assert.equal(cb.getState(), "closed");

      cb.recordFailure();
      assert.equal(cb.getState(), "open");
      assert.equal(cb.canExecute(), false);
    });

    // Defect: Success must reset failure count
    it("resets failure count on success", () => {
      const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 1000 });

      cb.recordFailure();
      cb.recordFailure();
      cb.recordSuccess(); // Should reset

      cb.recordFailure();
      cb.recordFailure();
      assert.equal(cb.getState(), "closed"); // Still closed, only 2 failures
    });
  });

  describe("open -> half-open transition", () => {
    // Defect: Circuit must transition to half-open after timeout
    it("transitions to half-open after reset timeout", async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 50 });

      cb.recordFailure();
      assert.equal(cb.getState(), "open");

      await new Promise((r) => setTimeout(r, 60));
      assert.equal(cb.getState(), "half-open");
      assert.equal(cb.canExecute(), true);
    });
  });

  describe("half-open -> closed transition", () => {
    // Defect: Success in half-open must close circuit
    it("closes on success in half-open", async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 10 });

      cb.recordFailure();
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(cb.getState(), "half-open");

      cb.recordSuccess();
      assert.equal(cb.getState(), "closed");
    });

    // Defect: Multiple successes required if successThreshold > 1
    it("requires successThreshold successes to close", async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 10, successThreshold: 2 });

      cb.recordFailure();
      await new Promise((r) => setTimeout(r, 20));

      cb.recordSuccess();
      assert.equal(cb.getState(), "half-open"); // Still half-open

      cb.recordSuccess();
      assert.equal(cb.getState(), "closed"); // Now closed
    });
  });

  describe("half-open -> open transition", () => {
    // Defect: Any failure in half-open must reopen circuit
    it("reopens on failure in half-open", async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 10 });

      cb.recordFailure();
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(cb.getState(), "half-open");

      cb.recordFailure();
      assert.equal(cb.getState(), "open");
    });
  });

  describe("reset", () => {
    // Defect: Reset must return to initial state
    it("resets to closed state", () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 1000 });

      cb.recordFailure();
      assert.equal(cb.getState(), "open");

      cb.reset();
      assert.equal(cb.getState(), "closed");
      assert.equal(cb.getStats().failures, 0);
    });
  });
});

// ============================================================================
// RETRY POLICY
// ============================================================================

describe("RetryPolicy", () => {
  describe("getDelayWithoutJitter", () => {
    // Defect: Base delay for attempt 0
    it("returns base delay for attempt 0", () => {
      const policy = new RetryPolicy({ maxRetries: 5, baseDelay: 100 });
      assert.equal(policy.getDelayWithoutJitter(0), 100);
    });

    // Defect: Exponential backoff must double each attempt
    it("doubles delay for each attempt", () => {
      const policy = new RetryPolicy({ maxRetries: 5, baseDelay: 100 });
      assert.equal(policy.getDelayWithoutJitter(0), 100);
      assert.equal(policy.getDelayWithoutJitter(1), 200);
      assert.equal(policy.getDelayWithoutJitter(2), 400);
      assert.equal(policy.getDelayWithoutJitter(3), 800);
    });

    // Defect: Must cap at maxDelay
    it("caps at maxDelay", () => {
      const policy = new RetryPolicy({ maxRetries: 10, baseDelay: 100, maxDelay: 500 });
      assert.equal(policy.getDelayWithoutJitter(0), 100);
      assert.equal(policy.getDelayWithoutJitter(5), 500); // Would be 3200
      assert.equal(policy.getDelayWithoutJitter(10), 500);
    });

    // Defect: Negative attempt must return 0
    it("returns 0 for negative attempt", () => {
      const policy = new RetryPolicy({ maxRetries: 3, baseDelay: 100 });
      assert.equal(policy.getDelayWithoutJitter(-1), 0);
    });
  });

  describe("getDelay (with jitter)", () => {
    // Defect: Jitter must stay within bounds
    it("stays within jitter bounds", () => {
      const policy = new RetryPolicy({ maxRetries: 5, baseDelay: 1000, jitterFactor: 0.1 });

      // Run multiple times to test randomness
      for (let i = 0; i < 10; i++) {
        const delay = policy.getDelay(0);
        assert.ok(delay >= 900, `delay ${delay} should be >= 900`);
        assert.ok(delay <= 1100, `delay ${delay} should be <= 1100`);
      }
    });
  });

  describe("shouldRetry", () => {
    // Defect: Must allow retries up to maxRetries
    it("allows retries up to maxRetries", () => {
      const policy = new RetryPolicy({ maxRetries: 3, baseDelay: 100 });

      assert.equal(policy.shouldRetry(0), true);
      assert.equal(policy.shouldRetry(1), true);
      assert.equal(policy.shouldRetry(2), true);
      assert.equal(policy.shouldRetry(3), false);
    });

    // Defect: Negative attempts must return false (consistent with getDelay guards)
    it("returns false for negative attempts", () => {
      const policy = new RetryPolicy({ maxRetries: 3, baseDelay: 100 });
      assert.equal(policy.shouldRetry(-1), false);
    });
  });

  describe("getAllDelays", () => {
    // Defect: Must return array of all delays
    it("returns all retry delays", () => {
      const policy = new RetryPolicy({ maxRetries: 4, baseDelay: 100 });
      const delays = policy.getAllDelays();

      assert.deepEqual(delays, [100, 200, 400, 800]);
    });
  });
});

// ============================================================================
// FAULT INJECTOR
// ============================================================================

describe("createFaultInjector", () => {
  // Defect: Null fault name must execute original
  it("executes original when fault is null", () => {
    const original = (x: number) => x * 2;
    const injector = createFaultInjector(original, { timeout: new Error("Timeout") });

    const result = injector(null, 5);
    assert.equal(result, 10);
  });

  // Defect: Fault name must throw mapped error
  it("throws mapped error for fault name", () => {
    const original = () => "success";
    const injector = createFaultInjector(original, {
      timeout: new Error("ETIMEDOUT"),
      reset: new Error("ECONNRESET"),
    });

    assert.throws(() => injector("timeout"), /ETIMEDOUT/);
    assert.throws(() => injector("reset"), /ECONNRESET/);
  });

  // Defect: Unknown fault name must execute original (not crash)
  it("executes original for unknown fault name", () => {
    const original = () => "success";
    const injector = createFaultInjector(original, { timeout: new Error("Timeout") });

    const result = injector("unknown");
    assert.equal(result, "success");
  });

  // Defect: Async original must still work when no fault injected
  it("preserves async behavior when no fault", async () => {
    const original = async (x: number) => x * 2;
    const injector = createFaultInjector(original, { timeout: new Error("Timeout") });

    const result = await injector(null, 5);
    assert.equal(result, 10);
  });

  // Defect: Sync throw for async-wrapped functions is intentional —
  // fault injection simulates boundary failures at the call site,
  // not inside the async pipeline
  it("throws synchronously even for async originals", () => {
    const original = async () => "success";
    const injector = createFaultInjector(original, { timeout: new Error("ETIMEDOUT") });

    assert.throws(() => injector("timeout"), /ETIMEDOUT/);
  });
});

// ============================================================================
// QUEUE PRESERVATION ASSERTIONS
// ============================================================================

describe("assertQueuePreserved", () => {
  // Defect: Must pass when all items preserved
  it("passes when all items preserved", () => {
    const before = [{ sequenceNumber: 1 }, { sequenceNumber: 2 }, { sequenceNumber: 3 }];
    const after = [{ sequenceNumber: 1 }, { sequenceNumber: 2 }, { sequenceNumber: 3 }];

    const result = assertQueuePreserved(before, after);
    assert.equal(result.preserved, true);
    assert.deepEqual(result.missing, []);
  });

  // Defect: Must throw when items missing
  it("throws when items are missing", () => {
    const before = [{ sequenceNumber: 1 }, { sequenceNumber: 2 }, { sequenceNumber: 3 }];
    const after = [{ sequenceNumber: 1 }, { sequenceNumber: 3 }]; // 2 missing

    assert.throws(() => assertQueuePreserved(before, after), /missing sequences \[2\]/);
  });

  // Defect: Duplicate sequence numbers must be detected (not silently collapsed)
  it("throws on duplicate sequence numbers", () => {
    const before = [{ sequenceNumber: 1 }, { sequenceNumber: 1 }, { sequenceNumber: 2 }];
    const after = [{ sequenceNumber: 1 }, { sequenceNumber: 2 }];

    assert.throws(() => assertQueuePreserved(before, after), /duplicate sequence numbers/);
  });

  // Defect: Must allow extra items (concurrent additions)
  it("allows extra items from concurrent additions", () => {
    const before = [{ sequenceNumber: 1 }, { sequenceNumber: 2 }];
    const after = [{ sequenceNumber: 1 }, { sequenceNumber: 2 }, { sequenceNumber: 3 }];

    const result = assertQueuePreserved(before, after);
    assert.equal(result.preserved, true);
    assert.deepEqual(result.extra, [3]);
  });
});

describe("assertQueueTrimmed", () => {
  // Defect: Must pass when properly trimmed
  it("passes when items <= max are removed", () => {
    const after = [{ sequenceNumber: 4 }, { sequenceNumber: 5 }];

    const result = assertQueueTrimmed(after, 3);
    assert.equal(result.valid, true);
  });

  // Defect: Must throw when old items remain
  it("throws when items <= max still present", () => {
    const after = [{ sequenceNumber: 2 }, { sequenceNumber: 4 }, { sequenceNumber: 5 }];

    assert.throws(() => assertQueueTrimmed(after, 3), /items with seq <= 3 still present: \[2\]/);
  });
});

// ============================================================================
// INTEGRATION: RESILIENCE WORKFLOW
// ============================================================================

describe("integration: fault-tolerant operation", () => {
  // Defect: Integration test validates complete resilience workflow
  it("retries with backoff until circuit opens", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 5000 });
    const policy = new RetryPolicy({ maxRetries: 5, baseDelay: 100 });

    const attempts: number[] = [];

    // Simulate operation with failures
    for (let attempt = 0; attempt < 5; attempt++) {
      if (!cb.canExecute()) {
        break; // Circuit open
      }

      attempts.push(policy.getDelayWithoutJitter(attempt));
      cb.recordFailure();
    }

    // Should have 3 attempts before circuit opens
    assert.equal(attempts.length, 3);
    assert.deepEqual(attempts, [100, 200, 400]);
    assert.equal(cb.getState(), "open");
  });
});
