/**
 * WebSocket client resilience utilities.
 *
 * Implements the 6 patterns from patterns.md:
 * 1. Backoff with jitter
 * 2. Circuit breaker state machine
 * 3. Heartbeat hysteresis
 * 4. Command acknowledgment tracking
 * 5. Sequence gap detection
 * 6. Mobile-aware timeout classification
 */

// --- Types ---

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface SequenceGapResult {
  gap: boolean;
  missing: number;
}

// --- Pattern 1: Backoff with jitter ---

/**
 * Calculate reconnection delay with exponential backoff and jitter.
 *
 * From patterns.md Pattern 1:
 * - Exponential growth: baseMs * 2^attempt
 * - Capped at maxMs to prevent absurd delays
 * - +/- 25% jitter to prevent thundering herd
 * - Never returns negative
 */
export function getBackoffDelay(attempt: number, baseMs = 1000, maxMs = 30000): number {
  const exponential = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  const jitter = exponential * 0.25 * (Math.random() * 2 - 1);
  return Math.max(0, exponential + jitter);
}

// --- Pattern 2: Circuit breaker ---

/**
 * Compute the next circuit breaker state.
 *
 * From patterns.md Pattern 2:
 * - closed → open: when consecutive failures reach threshold
 * - open → half-open: when cooldown timer expires
 * - half-open → closed: on first success (failures reset)
 * - half-open → open: on any failure (back to full cooldown)
 */
export function circuitBreakerTransition(
  state: CircuitState,
  consecutiveFailures: number,
  maxFailures: number,
  cooldownExpired: boolean,
): CircuitState {
  if (state === 'closed' && consecutiveFailures >= maxFailures) return 'open';
  if (state === 'open' && cooldownExpired) return 'half-open';
  if (state === 'half-open' && consecutiveFailures === 0) return 'closed';
  if (state === 'half-open' && consecutiveFailures > 0) return 'open';
  return state;
}

// --- Pattern 3: Heartbeat hysteresis ---

/**
 * Determine whether to disconnect based on missed heartbeats.
 *
 * From patterns.md Pattern 3:
 * - Single missed heartbeat: tolerate (network jitter)
 * - 2+ missed: disconnect and reconnect
 * - Prevents false disconnects on slow networks
 */
export function shouldDisconnect(missedHeartbeats: number, threshold = 2): boolean {
  return missedHeartbeats >= threshold;
}

// --- Pattern 4: Command acknowledgment tracking ---

export interface PendingCommand {
  commandId: string;
  type: string;
  data: unknown;
  sentAt: number;
}

/**
 * Tracks sent commands awaiting server acknowledgment.
 *
 * From patterns.md Pattern 4:
 * - Every command sent to the server gets a unique ID
 * - Server must acknowledge each command within a timeout
 * - Unacknowledged commands can be retried or surfaced to the user
 * - Prevents silent command loss during network blips
 *
 * @param nowFn - Injectable clock for deterministic testing (defaults to Date.now)
 */
export class CommandAckTracker {
  private pending = new Map<string, PendingCommand>();
  private counter = 0;
  private nowFn: () => number;

  constructor(nowFn: () => number = Date.now) {
    this.nowFn = nowFn;
  }

  /** Track a new command. Returns the commandId. */
  send(type: string, data: unknown): string {
    const commandId = `cmd_${++this.counter}`;
    this.pending.set(commandId, {
      commandId,
      type,
      data,
      sentAt: this.nowFn(),
    });
    return commandId;
  }

  /** Acknowledge a command by ID. Returns true if it was pending. */
  acknowledge(commandId: string): boolean {
    return this.pending.delete(commandId);
  }

  /** Get all commands that have exceeded the timeout. */
  getTimedOut(timeoutMs: number): PendingCommand[] {
    const now = this.nowFn();
    const timedOut: PendingCommand[] = [];
    for (const cmd of this.pending.values()) {
      if (now - cmd.sentAt >= timeoutMs) {
        timedOut.push(cmd);
      }
    }
    return timedOut;
  }

  /** Number of commands still awaiting acknowledgment. */
  get pendingCount(): number {
    return this.pending.size;
  }
}

// --- Pattern 5: Sequence gap detection ---

/**
 * Detect gaps in a message sequence.
 *
 * From patterns.md Pattern 5:
 * - Compares incoming sequence number against expected (lastReceived + 1)
 * - Returns gap=true and count of missing messages if incoming > expected
 * - Used to trigger state resync when messages are lost
 */
export function detectSequenceGap(
  lastReceived: number,
  incoming: number,
): SequenceGapResult {
  const expected = lastReceived + 1;
  if (incoming > expected) {
    return { gap: true, missing: incoming - expected };
  }
  return { gap: false, missing: 0 };
}

// --- Pattern 6: Mobile-aware timeout classification ---

/**
 * Classify a timeout duration as safe or risky for mobile networks.
 *
 * From patterns.md Pattern 6:
 * - Mobile P99 latency is 5-8 seconds
 * - Timeouts under 10 seconds risk false disconnects on mobile
 * - 10+ seconds accommodates real-world network conditions
 */
export function classifyTimeout(timeoutMs: number): 'safe' | 'risky' {
  return timeoutMs >= 10_000 ? 'safe' : 'risky';
}
