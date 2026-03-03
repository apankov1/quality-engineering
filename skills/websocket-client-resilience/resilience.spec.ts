import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CommandAckTracker,
  circuitBreakerTransition,
  classifyTimeout,
  detectSequenceGap,
  getBackoffDelay,
  shouldDisconnect,
} from "./resilience.ts";

/**
 * Tests for the WebSocket resilience pattern utilities.
 *
 * Each describe block maps to a pattern from patterns.md and demonstrates
 * the fail-before/fix-after defect detection methodology:
 * - Comments explain what bug the test catches
 * - If the implementation were naive/broken, the assertion would fail
 */

describe("backoff with jitter (pattern 1)", () => {
  it("grows exponentially", () => {
    const d0 = getBackoffDelay(0, 1000, 30000);
    const d3 = getBackoffDelay(3, 1000, 30000);
    // attempt 0 base is 1000, attempt 3 base is 8000
    // With +/- 25% jitter: d0 in [750, 1250], d3 in [6000, 10000]
    assert.ok(d0 >= 750 && d0 <= 1250, `attempt 0: ${d0}`);
    assert.ok(d3 >= 6000 && d3 <= 10000, `attempt 3: ${d3}`);
  });

  // Defect: without cap, attempt 10 = 1024 seconds. Users wait 17 minutes.
  // Before fix: exponential grew unbounded.
  // After fix: capped at maxMs (30s default), jitter stays within +25%.
  it("caps at maxMs", () => {
    const d10 = getBackoffDelay(10, 1000, 30000);
    assert.ok(d10 <= 37500, `attempt 10 exceeded cap: ${d10}`);
  });

  // Defect: without jitter, all clients retry at the same instant (thundering herd).
  // Before fix: delay = baseMs * 2^attempt (deterministic).
  // After fix: +/- 25% jitter ensures spread across time window.
  // Uses 100 samples to make flake probability negligible (P(all identical) ≈ 2^-99).
  it("adds jitter (not deterministic)", () => {
    const delays = Array.from({ length: 100 }, () => getBackoffDelay(2, 1000, 30000));
    const unique = new Set(delays);
    assert.ok(unique.size >= 2, `Expected jitter variation, got ${unique.size} unique values`);
  });

  it("never returns negative", () => {
    for (let i = 0; i < 100; i++) {
      assert.ok(getBackoffDelay(i, 1000, 30000) >= 0);
    }
  });

  it("returns 0 for negative attempts", () => {
    assert.equal(getBackoffDelay(-1, 1000, 30000), 0);
  });

  it("returns 0 for non-finite attempts", () => {
    assert.equal(getBackoffDelay(Number.NaN, 1000, 30000), 0);
  });
});

describe("circuit breaker (pattern 2)", () => {
  it("stays closed below threshold", () => {
    assert.equal(circuitBreakerTransition("closed", 3, 5, false), "closed");
  });

  // Defect: without circuit breaker, client hammers a down server indefinitely.
  // Before fix: always returned 'closed' (reconnect immediately).
  // After fix: transitions to 'open' at failure threshold, blocking reconnection.
  it("opens at threshold", () => {
    assert.equal(circuitBreakerTransition("closed", 5, 5, false), "open");
  });

  it("stays open before cooldown", () => {
    assert.equal(circuitBreakerTransition("open", 5, 5, false), "open");
  });

  it("transitions to half-open after cooldown", () => {
    assert.equal(circuitBreakerTransition("open", 5, 5, true), "half-open");
  });

  it("closes on success in half-open", () => {
    assert.equal(circuitBreakerTransition("half-open", 0, 5, false), "closed");
  });

  // Defect: half-open state stayed open after failure, never retried.
  // Before fix: half-open + failure → stayed half-open (limbo state).
  // After fix: half-open + failure → back to 'open' (full cooldown).
  it("reopens on failure in half-open", () => {
    assert.equal(circuitBreakerTransition("half-open", 1, 5, false), "open");
  });
});

describe("heartbeat hysteresis (pattern 3)", () => {
  // Defect: disconnecting on single missed heartbeat causes false disconnects.
  // Before fix: shouldDisconnect(1) returned true.
  // After fix: threshold=2 tolerates single-miss network blips.
  it("does not disconnect on single miss", () => {
    assert.equal(shouldDisconnect(1), false);
  });

  it("disconnects on 2 missed heartbeats", () => {
    assert.equal(shouldDisconnect(2), true);
  });

  it("disconnects on 3+ missed heartbeats", () => {
    assert.equal(shouldDisconnect(3), true);
  });

  it("does not disconnect on zero misses", () => {
    assert.equal(shouldDisconnect(0), false);
  });
});

describe("command acknowledgment tracking (pattern 4)", () => {
  // Defect: commands sent during network blip are silently lost.
  // Before fix: ws.send() with no tracking — no way to detect unacknowledged commands.
  // After fix: every command tracked by ID, timed out if no server ack.
  it("tracks sent commands with unique IDs", () => {
    const tracker = new CommandAckTracker();
    const id1 = tracker.send("move", { x: 1 });
    const id2 = tracker.send("move", { x: 2 });
    assert.notEqual(id1, id2);
    assert.equal(tracker.pendingCount, 2);
  });

  it("acknowledges known commands", () => {
    const tracker = new CommandAckTracker();
    const id = tracker.send("move", { x: 1 });
    assert.equal(tracker.acknowledge(id), true);
    assert.equal(tracker.pendingCount, 0);
  });

  it("rejects unknown commandId", () => {
    const tracker = new CommandAckTracker();
    assert.equal(tracker.acknowledge("cmd_unknown"), false);
  });

  it("identifies timed-out commands", () => {
    let now = 1000;
    const tracker = new CommandAckTracker(() => now);
    tracker.send("move", { x: 1 });
    tracker.send("move", { x: 2 });

    // Advance clock past timeout
    now = 31_000;
    const timedOut = tracker.getTimedOut(30_000);
    assert.equal(timedOut.length, 2);
    assert.equal(timedOut[0].type, "move");
  });

  it("does not return acknowledged commands as timed out", () => {
    let now = 1000;
    const tracker = new CommandAckTracker(() => now);
    const id1 = tracker.send("move", { x: 1 });
    tracker.send("move", { x: 2 });
    tracker.acknowledge(id1);

    now = 31_000;
    const timedOut = tracker.getTimedOut(30_000);
    assert.equal(timedOut.length, 1);
  });

  it("does not return recent commands as timed out", () => {
    let now = 1000;
    const tracker = new CommandAckTracker(() => now);
    tracker.send("move", { x: 1 });

    now = 5000; // Only 4 seconds elapsed
    const timedOut = tracker.getTimedOut(30_000);
    assert.equal(timedOut.length, 0);
    assert.equal(tracker.pendingCount, 1);
  });
});

describe("sequence gap detection (pattern 5)", () => {
  it("detects no gap for sequential messages", () => {
    const result = detectSequenceGap(5, 6);
    assert.equal(result.gap, false);
    assert.equal(result.missing, 0);
  });

  // Defect: without gap detection, lost messages cause silent state drift.
  // Before fix: client processed messages without checking sequence.
  // After fix: gap detected with exact count of missing messages for resync.
  it("detects gap with correct count", () => {
    const result = detectSequenceGap(5, 9);
    assert.equal(result.gap, true);
    assert.equal(result.missing, 3);
  });

  it("handles first message (sequence 1 after 0)", () => {
    const result = detectSequenceGap(0, 1);
    assert.equal(result.gap, false);
  });
});

describe("mobile-aware timeouts (pattern 6)", () => {
  // Defect: 5s timeout causes false disconnects on mobile (P99 = 5-8s).
  // Before fix: classifyTimeout(5000) returned 'safe'.
  // After fix: anything under 10s classified as 'risky'.
  it("5s timeout is risky", () => {
    assert.equal(classifyTimeout(5000), "risky");
  });

  it("10s timeout is safe", () => {
    assert.equal(classifyTimeout(10_000), "safe");
  });

  it("15s timeout is safe", () => {
    assert.equal(classifyTimeout(15_000), "safe");
  });

  // Defect: boundary case — 9999ms looks close to safe but is still risky.
  // Proves the classifier uses >= 10000, not > 10000 or rounding.
  it("9999ms is still risky", () => {
    assert.equal(classifyTimeout(9999), "risky");
  });
});
