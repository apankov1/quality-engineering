---
name: websocket-client-resilience
description: |
  Client-side WebSocket resilience patterns: exponential backoff with jitter,
  circuit breakers, heartbeat hysteresis, command acknowledgment tracking,
  sequence gap detection, and mobile-aware timeouts.

  WHEN to use:
  - Implementing WebSocket client reconnection logic
  - Building real-time features with persistent connections
  - Mobile app WebSocket handling
  - Any client that maintains long-lived server connections

  WHEN NOT to use:
  - Server-side WebSocket handlers
  - HTTP request/response patterns
  - Server-Sent Events (SSE)
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Write
  - Edit
---

# WebSocket Client Resilience

6 resilience patterns for WebSocket clients, extracted from production mobile network conditions.

Mobile WebSocket connections fail in ways that local development environments don't surface. P99 latency on 4G networks is 5-8 seconds. A 5-second health check timeout causes false positives on every slow network.

## Rationalizations (Do Not Skip)

| Rationalization | Why It's Wrong | Required Action |
|-----------------|----------------|-----------------|
| "Our users are on fast networks" | Mobile users exist. Even desktop WiFi has transient blips. | Test with throttled networks |
| "Simple retry is enough" | Without jitter, all clients retry at once after an outage | Add randomized jitter |
| "One missed heartbeat means disconnected" | Network blips last 1-3 seconds. Single miss = false positive. | Use hysteresis (2+ misses) |
| "We'll add resilience later" | Reconnection logic is foundational. Retrofitting it is 10x harder. | Build it in from the start |
| "5 seconds is plenty of timeout" | Mobile P99 is 5-8s. Your "timeout" is their normal latency. | Use 10s+ for mobile |

---

## 1. Backoff with Jitter

**Slug**: `backoff_without_jitter`
**Severity**: must-fail

**Problem**: Exponential backoff without randomization causes all disconnected clients to reconnect at the exact same time after an outage (thundering herd).

**Detect**:
```bash
# Find backoff without jitter
grep -rn "reconnectDelay \* 2\|Math.pow(2, attempt)" src/ | grep -v "Math.random"
```

**Before** (wrong):
```typescript
// All clients retry at exactly 1s, 2s, 4s, 8s...
const delay = 1000 * Math.pow(2, attempts);
setTimeout(() => connect(), delay);
```

**After** (correct):
```typescript
// Each client retries at slightly different times
function getBackoffDelay(attempt: number, baseMs = 1000, maxMs = 30000): number {
  const exponential = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  const jitter = exponential * 0.25 * (Math.random() * 2 - 1); // +/- 25%
  return Math.max(0, exponential + jitter);
}

setTimeout(() => connect(), getBackoffDelay(attempts));
```

---

## 2. Circuit Breaker

**Slug**: `missing_circuit_breaker`
**Severity**: must-fail

**Problem**: Unlimited reconnection attempts without failure tracking. Client keeps retrying against a server that's down, wasting resources and generating noise.

**Detect**:
```bash
# Find reconnect without failure counter
grep -rn "onclose.*setTimeout.*connect\|onerror.*setTimeout.*connect" src/ | grep -v "consecutiveFailures\|failureCount\|maxAttempts"
```

**Before** (wrong):
```typescript
// Retries forever, even if server is down for hours
ws.onclose = () => {
  setTimeout(() => connect(), getBackoffDelay(attempts++));
};
```

**After** (correct):
```typescript
const MAX_FAILURES = 5;
const CIRCUIT_COOLDOWN_MS = 60_000;

let consecutiveFailures = 0;
let circuitOpenUntil = 0;

function onConnectionFailed(): void {
  consecutiveFailures++;

  if (consecutiveFailures >= MAX_FAILURES) {
    // Circuit open -- stop retrying for cooldown period
    circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    console.warn('Circuit open: pausing reconnection for 60s');
    setTimeout(() => attemptReconnect(), CIRCUIT_COOLDOWN_MS);
    return;
  }

  setTimeout(() => attemptReconnect(), getBackoffDelay(consecutiveFailures));
}

function onConnectionSuccess(): void {
  consecutiveFailures = 0; // Reset on success
  circuitOpenUntil = 0;
}

function attemptReconnect(): void {
  if (Date.now() < circuitOpenUntil) return; // Circuit still open
  connect();
}
```

---

## 3. Heartbeat Hysteresis

**Slug**: `single_heartbeat_disconnect`
**Severity**: should-fail

**Problem**: A single missed heartbeat triggers reconnect. Network blips on mobile last 1-3 seconds -- single-miss detection causes false disconnects.

**Detect**:
```bash
# Find single-timeout heartbeat without miss counter
grep -rn "setTimeout.*close\|setTimeout.*disconnect" src/ | grep -i "heartbeat\|health\|ping" | grep -v "missedCount\|missedHeartbeats"
```

**Before** (wrong):
```typescript
// Single miss = disconnect. Too sensitive for mobile.
function startHeartbeat(): void {
  heartbeatTimer = setTimeout(() => {
    ws.close(); // Disconnects on first miss!
  }, 10_000);
}

ws.onmessage = () => {
  clearTimeout(heartbeatTimer);
  startHeartbeat();
};
```

**After** (correct):
```typescript
const MAX_MISSED = 2;
const HEARTBEAT_INTERVAL_MS = 10_000;

let missedHeartbeats = 0;

function startHeartbeatMonitor(): void {
  heartbeatInterval = setInterval(() => {
    missedHeartbeats++;

    if (missedHeartbeats >= MAX_MISSED) {
      console.warn(`${missedHeartbeats} heartbeats missed, reconnecting`);
      clearInterval(heartbeatInterval);
      ws.close(4000, 'Heartbeat timeout');
    } else {
      // Send client ping
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, HEARTBEAT_INTERVAL_MS);
}

// Reset counter on any server message
ws.onmessage = () => {
  missedHeartbeats = 0;
};
```

---

## 4. Command Acknowledgment Tracking

**Slug**: `missing_command_ack_tracking`
**Severity**: nice-to-have

**Problem**: Commands (user actions) sent to the server without tracking whether the server acknowledged them. If a command is lost during a network blip, the client has no way to detect or retry it.

**Detect**:
```bash
# Find ws.send for commands without commandId tracking
grep -rn "ws\.send.*type.*command\|ws\.send.*type.*action" src/ | grep -v "pendingCommands\|commandId"
```

**Pattern**:
```typescript
const pendingCommands = new Map<string, { sentAt: number; payload: unknown }>();
const COMMAND_TIMEOUT_MS = 30_000;

function sendCommand(type: string, data: unknown): string {
  const commandId = crypto.randomUUID();
  const message = { type, commandId, data };

  pendingCommands.set(commandId, { sentAt: Date.now(), payload: message });
  ws.send(JSON.stringify(message));

  // Timeout unacknowledged commands
  setTimeout(() => {
    if (pendingCommands.has(commandId)) {
      pendingCommands.delete(commandId);
      console.warn(`Command ${commandId} timed out (no server ack)`);
      // Optionally retry or notify user
    }
  }, COMMAND_TIMEOUT_MS);

  return commandId;
}

// Clear on server acknowledgment
function handleServerAck(commandId: string): void {
  pendingCommands.delete(commandId);
}
```

---

## 5. Sequence Gap Detection

**Slug**: `missing_sequence_tracking`
**Severity**: nice-to-have

**Problem**: Server sends sequenced events but client doesn't track sequence numbers. If events are lost (network issues, server restart), the client's state silently diverges from server state.

**Detect**:
```bash
# Find message handlers without sequence tracking
grep -rn "onmessage\|addEventListener.*message" src/ | grep -v "sequence\|lastReceived\|seqNum"
```

**Pattern**:
```typescript
let lastReceivedSequence = 0;

function handleServerMessage(message: { sequence: number; data: unknown }): void {
  const expected = lastReceivedSequence + 1;

  if (message.sequence > expected) {
    // Gap detected -- events were lost
    const gap = message.sequence - expected;
    console.warn(`Sequence gap: expected ${expected}, got ${message.sequence} (${gap} missing)`);

    // Request missing events from server
    ws.send(JSON.stringify({
      type: 'request_replay',
      fromSequence: expected,
      toSequence: message.sequence - 1,
    }));
  }

  if (message.sequence >= expected) {
    lastReceivedSequence = message.sequence;
    processEvent(message.data);
  }
  // Ignore duplicates (sequence <= lastReceived)
}
```

---

## 6. Mobile-Aware Timeouts

**Slug**: `insufficient_mobile_timeout`
**Severity**: must-fail

**Problem**: Timeouts shorter than 10 seconds cause false positives on mobile networks. P99 latency on 4G is 5-8 seconds. iOS Safari background tab behavior adds further delays.

**Detect**:
```bash
# Find health/heartbeat timeouts under 10 seconds
grep -rn "TIMEOUT.*[0-9]\{4\}\|timeout.*[0-9]\{4\}" src/ | grep -E "[^0-9](5000|6000|7000|8000|9000)[^0-9]" | grep -i "health\|heartbeat\|check\|ping"
```

**Before** (wrong):
```typescript
// 5s timeout = false positives on every slow mobile network
const HEALTH_CHECK_TIMEOUT = 5000;
const HEARTBEAT_INTERVAL = 15000;
```

**After** (correct):
```typescript
// 10s+ timeout accounts for mobile P99 latency
const HEALTH_CHECK_TIMEOUT = 10_000;
const HEARTBEAT_INTERVAL = 30_000; // Generous interval for battery life

// Even better: detect network type and adapt
function getTimeouts(): { heartbeat: number; health: number } {
  const connection = (navigator as any).connection;
  const isSlow = connection?.effectiveType === '2g' || connection?.effectiveType === '3g';

  return {
    heartbeat: isSlow ? 45_000 : 30_000,
    health: isSlow ? 15_000 : 10_000,
  };
}
```

**Why 10 seconds?**
- 4G P99 latency: 5-8 seconds
- iOS Safari background throttling: adds 1-3 seconds
- Network handoff (WiFi to cellular): 2-5 seconds
- Any timeout under 10s WILL cause false disconnects for real mobile users

---

## Quick Reference

| Pattern | Detect | Fix | Severity |
|---------|--------|-----|----------|
| Backoff without jitter | `Math.pow(2, attempt)` without `Math.random()` | Add +/- 25% jitter | must-fail |
| No circuit breaker | Reconnect without failure counter | Trip after 5 failures, 60s cooldown | must-fail |
| Single heartbeat miss | `setTimeout` disconnect without miss counter | Require 2+ missed heartbeats | should-fail |
| No command ack | `ws.send()` without commandId tracking | Track pending commands, timeout at 30s | nice-to-have |
| No sequence tracking | `onmessage` without sequence check | Track lastReceivedSequence, detect gaps | nice-to-have |
| Short mobile timeout | Health timeout < 10s | Use 10s+ for all health checks | must-fail |

## Framework Adaptation

These patterns are framework-agnostic. They work with:
- **Browser**: Native `WebSocket`, Socket.IO, ws library
- **React/Vue/Svelte**: Wrap in composable/hook
- **React Native / Flutter**: Same patterns, different APIs
- **Node.js**: `ws` library for server-to-server WebSocket clients

The core principle: **real-world network conditions are more variable than controlled environments. Design for mobile latency, not localhost.**
