/**
 * Fault Injection Testing: Resilience Utilities
 *
 * Provides reusable patterns for:
 * - Fault scenario definition and injection
 * - Circuit breaker state machine
 * - Retry policy with exponential backoff and jitter
 * - Queue preservation assertions
 *
 * Framework-agnostic: Uses standard assertion patterns.
 *
 * @example
 * import { CircuitBreaker, RetryPolicy, createFaultInjector } from './fault-injection';
 *
 * const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 5000 });
 * const policy = new RetryPolicy({ maxRetries: 3, baseDelay: 100 });
 */

// ============================================================================
// FAULT SCENARIO
// ============================================================================

/**
 * A fault scenario for testing resilience.
 */
export interface FaultScenario {
  name: string;
  fault: string;
  expected: string;
  description?: string;
}

/**
 * Create a fault scenario builder.
 */
export function createFaultScenario(name: string, fault: string, expected: string): FaultScenario {
  return { name, fault, expected };
}

// ============================================================================
// CIRCUIT BREAKER
// ============================================================================

/**
 * Circuit breaker states.
 */
export type CircuitState = "closed" | "open" | "half-open";

/**
 * Circuit breaker configuration.
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Time in ms before attempting to close a half-open circuit */
  resetTimeout: number;
  /** Number of successes in half-open state to close circuit */
  successThreshold?: number;
}

/**
 * Circuit breaker state machine.
 *
 * States:
 * - closed: Normal operation, failures increment counter
 * - open: Circuit tripped, all requests fail immediately
 * - half-open: Testing if service recovered, limited requests allowed
 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private readonly config: Required<CircuitBreakerConfig>;

  constructor(config: CircuitBreakerConfig) {
    this.config = {
      ...config,
      successThreshold: config.successThreshold ?? 1,
    };
  }

  getState(): CircuitState {
    // Auto-transition from open to half-open after timeout
    if (this.state === "open" && Date.now() - this.lastFailureTime >= this.config.resetTimeout) {
      this.state = "half-open";
      this.successes = 0;
    }
    return this.state;
  }

  /**
   * Check if request should be allowed through.
   */
  canExecute(): boolean {
    const state = this.getState();
    return state === "closed" || state === "half-open";
  }

  /**
   * Record a successful request.
   */
  recordSuccess(): void {
    const currentState = this.getState(); // Trigger auto-transition from open→half-open
    if (currentState === "half-open") {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.state = "closed";
        this.failures = 0;
        this.successes = 0;
      }
    } else if (currentState === "closed") {
      // Reset failure count on success
      this.failures = 0;
    }
  }

  /**
   * Record a failed request.
   */
  recordFailure(): void {
    const currentState = this.getState(); // Trigger auto-transition from open→half-open
    this.lastFailureTime = Date.now();

    if (currentState === "half-open") {
      // Any failure in half-open immediately opens circuit
      this.state = "open";
      this.successes = 0;
    } else if (currentState === "closed") {
      this.failures++;
      if (this.failures >= this.config.failureThreshold) {
        this.state = "open";
      }
    }
  }

  /**
   * Reset the circuit breaker to closed state.
   */
  reset(): void {
    this.state = "closed";
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = 0;
  }

  /**
   * Get diagnostic info for testing/logging.
   */
  getStats(): { state: CircuitState; failures: number; successes: number } {
    return {
      state: this.getState(),
      failures: this.failures,
      successes: this.successes,
    };
  }
}

// ============================================================================
// RETRY POLICY
// ============================================================================

/**
 * Retry policy configuration.
 */
export interface RetryPolicyConfig {
  /** Maximum number of retries */
  maxRetries: number;
  /** Base delay in ms before first retry */
  baseDelay: number;
  /** Maximum delay cap in ms */
  maxDelay?: number;
  /** Jitter factor (0-1) for randomization */
  jitterFactor?: number;
}

/**
 * Retry policy with exponential backoff and optional jitter.
 */
export class RetryPolicy {
  private readonly config: Required<RetryPolicyConfig>;

  constructor(config: RetryPolicyConfig) {
    this.config = {
      ...config,
      maxDelay: config.maxDelay ?? 30000,
      jitterFactor: config.jitterFactor ?? 0.1,
    };
  }

  /**
   * Calculate delay for a given attempt number (0-indexed).
   */
  getDelay(attempt: number): number {
    if (attempt < 0) return 0;

    // Exponential backoff: baseDelay * 2^attempt
    const exponentialDelay = this.config.baseDelay * 2 ** attempt;
    const cappedDelay = Math.min(exponentialDelay, this.config.maxDelay);

    // Add jitter: delay ± (delay * jitterFactor)
    const jitter = cappedDelay * this.config.jitterFactor * (Math.random() * 2 - 1);

    return Math.max(0, Math.round(cappedDelay + jitter));
  }

  /**
   * Calculate delay without jitter (for deterministic testing).
   */
  getDelayWithoutJitter(attempt: number): number {
    if (attempt < 0) return 0;
    const exponentialDelay = this.config.baseDelay * 2 ** attempt;
    return Math.min(exponentialDelay, this.config.maxDelay);
  }

  /**
   * Check if retry should be attempted.
   */
  shouldRetry(attempt: number): boolean {
    return attempt >= 0 && attempt < this.config.maxRetries;
  }

  /**
   * Get all delays for all retries (useful for planning).
   */
  getAllDelays(): number[] {
    const delays: number[] = [];
    for (let i = 0; i < this.config.maxRetries; i++) {
      delays.push(this.getDelayWithoutJitter(i));
    }
    return delays;
  }
}

// ============================================================================
// FAULT INJECTOR
// ============================================================================

/**
 * Wrap a function to inject faults by name.
 *
 * The faultMap defines which fault names trigger which errors.
 * Call the returned function with a fault name to trigger that error,
 * or with null to execute the original function.
 */
export function createFaultInjector<T, A extends unknown[]>(
  original: (...args: A) => T | Promise<T>,
  faultMap: Record<string, Error>,
): (faultName: string | null, ...args: A) => T | Promise<T> {
  return (faultName: string | null, ...args: A) => {
    if (faultName && faultMap[faultName]) {
      throw faultMap[faultName];
    }
    return original(...args);
  };
}

// ============================================================================
// QUEUE PRESERVATION ASSERTIONS
// ============================================================================

/**
 * Item with sequence number for queue testing.
 */
export interface QueueItem {
  sequenceNumber: number;
  id?: string;
  data?: unknown;
}

/**
 * Assert queue preserved all items after a transient failure.
 *
 * After a transient failure (timeout, network error), the queue should
 * retain all items that were present before the operation. Items may
 * be reordered but none should be lost.
 */
export function assertQueuePreserved(
  queueBefore: QueueItem[],
  queueAfter: QueueItem[],
): { preserved: boolean; missing: number[]; extra: number[] } {
  const beforeSeqList = queueBefore.map((i) => i.sequenceNumber);
  const afterSeqList = queueAfter.map((i) => i.sequenceNumber);
  const beforeSeqs = new Set(beforeSeqList);
  const afterSeqs = new Set(afterSeqList);

  // Detect duplicate sequence numbers (Set would silently collapse them)
  if (beforeSeqList.length !== beforeSeqs.size || afterSeqList.length !== afterSeqs.size) {
    throw new Error("Queue contains duplicate sequence numbers — sequences must be unique");
  }

  const missing: number[] = [];
  const extra: number[] = [];

  for (const seq of beforeSeqs) {
    if (!afterSeqs.has(seq)) {
      missing.push(seq);
    }
  }

  for (const seq of afterSeqs) {
    if (!beforeSeqs.has(seq)) {
      extra.push(seq);
    }
  }

  const preserved = missing.length === 0;

  if (!preserved) {
    throw new Error(`Queue preservation violated: missing sequences [${missing.join(", ")}]`);
  }

  return { preserved, missing, extra };
}

/**
 * Assert queue was properly trimmed after successful processing.
 *
 * After successful processing up to maxProcessedSequence, only items
 * with sequence > maxProcessedSequence should remain.
 */
export function assertQueueTrimmed(
  queueAfter: QueueItem[],
  maxProcessedSequence: number,
): { valid: boolean; violations: number[] } {
  const violations = queueAfter.filter((i) => i.sequenceNumber <= maxProcessedSequence).map((i) => i.sequenceNumber);

  const valid = violations.length === 0;

  if (!valid) {
    throw new Error(
      `Queue trim violated: items with seq <= ${maxProcessedSequence} still present: [${violations.join(", ")}]`,
    );
  }

  return { valid, violations };
}
