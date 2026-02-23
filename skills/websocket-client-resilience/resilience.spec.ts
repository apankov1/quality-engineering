import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getBackoffDelay,
  circuitBreakerTransition,
  shouldDisconnect,
  detectSequenceGap,
  classifyTimeout,
} from './resilience.ts';

/**
 * Tests for the WebSocket resilience pattern utilities.
 * Verifies the algorithms from patterns.md against concrete scenarios.
 */

describe('backoff with jitter (pattern 1)', () => {
  it('grows exponentially', () => {
    const d0 = getBackoffDelay(0, 1000, 30000);
    const d3 = getBackoffDelay(3, 1000, 30000);
    // attempt 0 base is 1000, attempt 3 base is 8000
    // With +/- 25% jitter: d0 in [750, 1250], d3 in [6000, 10000]
    assert.ok(d0 >= 750 && d0 <= 1250, `attempt 0: ${d0}`);
    assert.ok(d3 >= 6000 && d3 <= 10000, `attempt 3: ${d3}`);
  });

  it('caps at maxMs', () => {
    const d10 = getBackoffDelay(10, 1000, 30000);
    // Base would be 1024000, capped to 30000, jitter +/- 25%
    assert.ok(d10 <= 37500, `attempt 10 exceeded cap: ${d10}`);
  });

  it('adds jitter (not deterministic)', () => {
    const delays = Array.from({ length: 20 }, () => getBackoffDelay(2, 1000, 30000));
    const unique = new Set(delays);
    // With 20 samples, jitter should produce at least 2 distinct values
    assert.ok(unique.size >= 2, `Expected jitter variation, got ${unique.size} unique values`);
  });

  it('never returns negative', () => {
    for (let i = 0; i < 100; i++) {
      assert.ok(getBackoffDelay(i, 1000, 30000) >= 0);
    }
  });
});

describe('circuit breaker (pattern 2)', () => {
  it('stays closed below threshold', () => {
    assert.equal(circuitBreakerTransition('closed', 3, 5, false), 'closed');
  });

  it('opens at threshold', () => {
    assert.equal(circuitBreakerTransition('closed', 5, 5, false), 'open');
  });

  it('stays open before cooldown', () => {
    assert.equal(circuitBreakerTransition('open', 5, 5, false), 'open');
  });

  it('transitions to half-open after cooldown', () => {
    assert.equal(circuitBreakerTransition('open', 5, 5, true), 'half-open');
  });

  it('closes on success in half-open', () => {
    assert.equal(circuitBreakerTransition('half-open', 0, 5, false), 'closed');
  });

  it('reopens on failure in half-open', () => {
    assert.equal(circuitBreakerTransition('half-open', 1, 5, false), 'open');
  });
});

describe('heartbeat hysteresis (pattern 3)', () => {
  it('does not disconnect on single miss', () => {
    assert.equal(shouldDisconnect(1), false);
  });

  it('disconnects on 2 missed heartbeats', () => {
    assert.equal(shouldDisconnect(2), true);
  });

  it('disconnects on 3+ missed heartbeats', () => {
    assert.equal(shouldDisconnect(3), true);
  });

  it('does not disconnect on zero misses', () => {
    assert.equal(shouldDisconnect(0), false);
  });
});

describe('sequence gap detection (pattern 5)', () => {
  it('detects no gap for sequential messages', () => {
    const result = detectSequenceGap(5, 6);
    assert.equal(result.gap, false);
    assert.equal(result.missing, 0);
  });

  it('detects gap with correct count', () => {
    const result = detectSequenceGap(5, 9);
    assert.equal(result.gap, true);
    assert.equal(result.missing, 3);
  });

  it('handles first message (sequence 1 after 0)', () => {
    const result = detectSequenceGap(0, 1);
    assert.equal(result.gap, false);
  });
});

describe('mobile-aware timeouts (pattern 6)', () => {
  it('5s timeout is risky', () => {
    assert.equal(classifyTimeout(5000), 'risky');
  });

  it('10s timeout is safe', () => {
    assert.equal(classifyTimeout(10_000), 'safe');
  });

  it('15s timeout is safe', () => {
    assert.equal(classifyTimeout(15_000), 'safe');
  });

  it('9999ms is still risky', () => {
    assert.equal(classifyTimeout(9999), 'risky');
  });
});
