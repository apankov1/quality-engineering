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
---

# WebSocket Client Resilience

> **Status**: Batch 2 -- coming soon. This is a stub.

6 resilience patterns for WebSocket clients, extracted from production mobile failures.

## Violations

| Slug | Pattern | Severity |
|------|---------|----------|
| `backoff_without_jitter` | Exponential backoff without randomization (thundering herd) | must-fail |
| `missing_circuit_breaker` | Unlimited reconnection without failure tracking | must-fail |
| `single_heartbeat_disconnect` | Single missed heartbeat triggers reconnect (no hysteresis) | should-fail |
| `missing_command_ack_tracking` | Commands sent without tracking for acknowledgment | nice-to-have |
| `missing_sequence_tracking` | No tracking of received sequence numbers for gap detection | nice-to-have |
| `insufficient_mobile_timeout` | Timeouts too short for mobile network latency (<10s) | must-fail |

## Key Insight

Mobile WebSocket connections fail in ways desktop testing never reveals. P99 latency on 4G networks is 5-8 seconds. A 5-second health check timeout causes false positives on every slow network.

*Full skill content coming in Batch 2.*
