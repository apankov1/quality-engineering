# Quality Engineering Skills for AI Coding Agents

[![CI](https://github.com/apankov1/quality-engineering/actions/workflows/ci.yml/badge.svg)](https://github.com/apankov1/quality-engineering/actions/workflows/ci.yml)

Quality engineering methodologies for AI coding agents. Deterministic concurrency testing, combinatorial coverage, breaking change detection, and client resilience patterns.

These skills teach AI coding agents (Claude Code, Cursor, etc.) rigorous testing methodologies -- not just "write a test", but *how* to test concurrent code, *what* combinations to cover, and *which* invariants to assert.

## Skills

| Skill | What It Does | Key Innovation |
|-------|-------------|----------------|
| **barrier-concurrency-testing** | Deterministic race condition testing via barriers | Replaces flaky setTimeout-based timing tests with reproducible interleaving |
| **breaking-change-detector** | 6-category breaking change analysis | Tolerant reader pattern for safe schema evolution |
| **pairwise-test-coverage** | Combinatorial testing with matrix generator | Zero-dep greedy algorithm covers all factor pairs in near-minimal test cases |
| **websocket-client-resilience** | Client-side WebSocket resilience patterns | Mobile-aware timeouts, circuit breakers, heartbeat hysteresis |

## Quickstart for QA Reviewers

Prove detection in under a minute. Clone the repo and run one command per skill:

```bash
git clone https://github.com/apankov1/quality-engineering.git
cd quality-engineering

# Pairwise coverage: generate a 3×3×3 matrix, then stress-test 8×4
node --experimental-strip-types skills/pairwise-test-coverage/pairwise.ts

# Barrier concurrency: 7 tests for deterministic race condition patterns
node --experimental-strip-types --test skills/barrier-concurrency-testing/test-fixtures.spec.ts

# Breaking change detector: 11 tests for field classification + schema validation
node --experimental-strip-types --test skills/breaking-change-detector/breaking-change.spec.ts

# WebSocket resilience: 21 tests for backoff, circuit breaker, heartbeat, gaps, timeouts
node --experimental-strip-types --test skills/websocket-client-resilience/resilience.spec.ts
```

Each skill ships importable utilities alongside its tests. Import what you need:

```typescript
import { generatePairwiseMatrix } from './skills/pairwise-test-coverage/pairwise.ts';
import { classifyFieldChange } from './skills/breaking-change-detector/breaking-change.ts';
import { circuitBreakerTransition } from './skills/websocket-client-resilience/resilience.ts';
import { createBarrier, createTrackedCleanup } from './skills/barrier-concurrency-testing/test-fixtures.ts';
```

**Node.js 18-20 (LTS)?** Replace `node --experimental-strip-types` with `npx tsx`:

```bash
npx tsx --test skills/barrier-concurrency-testing/test-fixtures.spec.ts
npx tsx skills/pairwise-test-coverage/pairwise.ts
```

## Install

```bash
# Install a single skill
npx skills add apankov1/quality-engineering --skill barrier-concurrency-testing

# Install another
npx skills add apankov1/quality-engineering --skill pairwise-test-coverage
```

## What's Included

### barrier-concurrency-testing

Do not test race conditions with `setTimeout` and hope. This skill teaches agents to use **barriers** -- deterministic interleave points that make concurrency tests reproducible on every run.

- Barrier interface + tracked cleanup pattern
- 5 named invariant assertions for queue/sequence correctness
- Deferred promise alternative for simple cases
- Decision guide: when to use barriers vs deferred
- Violation rules: `inadequate_barrier_coverage`, `flaky_timing_test`

### breaking-change-detector

Detects breaking changes across 6 categories that could disrupt active sessions or lose client compatibility. Uses the tolerant reader pattern for safe schema evolution.

- **`breaking-change.ts`** -- Field change classifier and serialized schema validator
- 6 detection categories: contracts, database schema, RPC/API, WebSocket protocol, serialized state, event sourcing
- Backward compatibility checklist for schema/contract changes
- Output format template: CRITICAL (disrupts sessions) / WARNING (migration required) / SAFE
- Violation rules: `contract_field_removal`, `schema_without_catch`, `strict_parse_in_deserialize`, `migration_drops_column`, `endpoint_removed`, `event_type_renamed`

### pairwise-test-coverage

When your system has 4 factors with 3-4 values each, exhaustive testing means 100+ cases. Pairwise testing covers all pair interactions in ~12 cases.

Ships with real runnable code:
- **`pairwise.ts`** -- Zero-dependency greedy covering algorithm (generates near-minimal test matrices)
- **`test-fixtures.ts`** -- Pairwise test case helpers (name generation, expected-value mapping)
- Step-by-step workflow from factor identification to table-driven tests
- 6 testing technique examples in references (pairwise matrices, property-based, model-based, fault injection, contract validation, observability assertions)

### websocket-client-resilience

6 resilience patterns for WebSocket clients, designed for real-world mobile network conditions where P99 latency is 5-8 seconds.

- **`resilience.ts`** -- Backoff calculator, circuit breaker state machine, heartbeat hysteresis, gap detector, timeout classifier
- Command acknowledgment, sequence gap detection, mobile-aware timeouts
- Before/after code examples for each pattern
- Violation rules with severity levels (must-fail, should-fail, nice-to-have)

## Try It

Run the test suites and CLI demo with Node.js 22+ (no install needed):

```bash
git clone https://github.com/apankov1/quality-engineering.git
cd quality-engineering

# Run all tests (51 tests across all 4 skills)
node --experimental-strip-types --test \
  skills/pairwise-test-coverage/pairwise.spec.ts \
  skills/barrier-concurrency-testing/test-fixtures.spec.ts \
  skills/breaking-change-detector/breaking-change.spec.ts \
  skills/websocket-client-resilience/resilience.spec.ts

# Run the pairwise CLI demo (3×3×3 matrix + 8×4 stress test)
node --experimental-strip-types skills/pairwise-test-coverage/pairwise.ts
```

**Node.js < 22?** Use `npx tsx` instead:

```bash
npx tsx --test \
  skills/pairwise-test-coverage/pairwise.spec.ts \
  skills/barrier-concurrency-testing/test-fixtures.spec.ts \
  skills/breaking-change-detector/breaking-change.spec.ts \
  skills/websocket-client-resilience/resilience.spec.ts
```

**GitHub Actions snippet** for CI:

```yaml
- name: Quality engineering skill tests
  run: |
    node --experimental-strip-types --test \
      skills/pairwise-test-coverage/pairwise.spec.ts \
      skills/barrier-concurrency-testing/test-fixtures.spec.ts \
      skills/breaking-change-detector/breaking-change.spec.ts \
      skills/websocket-client-resilience/resilience.spec.ts
```

## When to Apply

Start with the change you're making. Each skill targets a different failure mode.

| What Changed | Skill | Why |
|---|---|---|
| Shared types, API signatures, DB schema | breaking-change-detector | Catch incompatibilities before merge |
| Code with concurrent access or shared state | barrier-concurrency-testing | Expose race windows deterministically |
| 3+ interacting parameters (config, modes, states) | pairwise-test-coverage | Cover pair interactions without exhaustive explosion |
| WebSocket client reconnection or health checks | websocket-client-resilience | Survive real mobile network conditions |

## Defect Classes

| Skill | Defects Caught | Example |
|---|---|---|
| barrier-concurrency-testing | Race conditions, write ordering bugs, stale reads | Flush conflict: two writers interleave, last-write-wins silently drops data |
| breaking-change-detector | Backward-incompatible schema/API/protocol changes | Renamed field breaks active sessions still using old format |
| pairwise-test-coverage | Interaction bugs in untested parameter combinations | Auth=expired + role=admin works, but auth=expired + role=guest crashes |
| websocket-client-resilience | Reconnection storms, false disconnects, lost messages | All clients retry at once after outage (thundering herd) |

## Workflow Integration

```
Design         → pairwise-test-coverage (define factor matrix for new feature)
Implementation → barrier-concurrency-testing (test concurrent paths as you write them)
Pre-merge      → breaking-change-detector (audit contract/schema diffs)
Client deploy  → websocket-client-resilience (verify reconnection patterns)
```

## PR Review Checklist

When reviewing a pull request, walk the diff and select skills based on what changed:

1. **Scan the diff** -- `git diff --name-only base...HEAD`
2. **Match files to skills**:
   - Contract/schema/migration files → run **breaking-change-detector**
   - Concurrent or stateful code → run **barrier-concurrency-testing**
   - Multi-factor config or mode logic → run **pairwise-test-coverage**
   - WebSocket client code → run **websocket-client-resilience**
3. **Check for overlap** -- a single PR may trigger multiple skills (e.g., a schema migration that also adds concurrent flush logic)
4. **Verify each finding has a test** -- every violation the skill flags should map to a test case in the PR (see Proving Defect Detection below)

## Proving Defect Detection

A test that only passes is not evidence. To prove a test catches the bug:

1. **Write the test first** -- before any fix, write a test that exercises the defect
2. **Confirm it fails** -- run the test and verify it fails for the expected reason (not a syntax error or import failure)
3. **Apply the fix** -- make the minimal change to correct the behavior
4. **Confirm it passes** -- the same test now passes, proving the fix addresses the defect
5. **Document the proof** -- add a comment in the test referencing the failure:

```typescript
// Regression: before fix, barrier.wait() resolved immediately
// because release() was called in constructor. See commit abc1234.
it('blocks until explicitly released', async () => {
  const barrier = createBarrier();
  let resolved = false;
  barrier.wait().then(() => { resolved = true; });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(resolved, false); // Would have been true before fix
  barrier.release();
  await barrier.wait();
  assert.equal(resolved, true);
});
```

This is the `bug_detection_not_validated` rule from pairwise-test-coverage, applied as a cross-cutting practice.

## Reporting Findings

Use this template when documenting skill results. Each finding maps to a severity, the skill that detected it, and the risk it traces to.

```markdown
## Findings: PR #142

### MUST-FIX

| # | Skill | Violation | File | Risk |
|---|-------|-----------|------|------|
| 1 | breaking-change-detector | `contract_field_removal` | types.ts:42 | Active sessions fail on state load |
| 2 | barrier-concurrency-testing | `inadequate_barrier_coverage` | flush.spec.ts | Race window untested: concurrent writes |

### SHOULD-FIX

| # | Skill | Violation | File | Risk |
|---|-------|-----------|------|------|
| 3 | websocket-client-resilience | heartbeat hysteresis | client.ts:88 | False disconnects on slow networks |

### ADVISORY

| # | Skill | Violation | File | Risk |
|---|-------|-----------|------|------|
| 4 | pairwise-test-coverage | `missing_pairwise_coverage` | retry.spec.ts | 3 factors × 4 values, only happy path tested |

**Severity mapping**: must-fail → MUST-FIX, should-fail → SHOULD-FIX, nice-to-have → ADVISORY
```

Each row traces from **violation** (what's wrong) → **file** (where) → **risk** (why it matters). Reviewers can triage by severity and verify each finding has a corresponding test using the fail-before/fix-after proof above.

## Non-Functional Quality

These skills cover correctness and compatibility, not performance benchmarking or load testing. But several non-functional concerns are addressed through existing patterns:

| Concern | Covered By | How |
|---|---|---|
| **Fault tolerance** | pairwise-test-coverage [examples](skills/pairwise-test-coverage/references/examples.md) (section 4) | Inject storage/network failures, verify retry and dead-letter behavior |
| **Observability** | pairwise-test-coverage [examples](skills/pairwise-test-coverage/references/examples.md) (section 6) | Assert structured log output on failure paths (fields, context, severity) |
| **Resilience under degraded networks** | websocket-client-resilience | Circuit breakers, backoff with jitter, mobile-aware timeouts |
| **State machine correctness** | pairwise-test-coverage [examples](skills/pairwise-test-coverage/references/examples.md) (section 3) | Model-based transition tables, verify illegal states are unreachable |
| **Concurrency under contention** | barrier-concurrency-testing | Deterministic interleaving for write ordering and stale-read detection |

**Not covered**: load/stress testing, latency percentile benchmarks, throughput profiling, SLO threshold validation, large-scale chaos engineering. These require runtime infrastructure (load generators, APM tooling, distributed tracing) that is outside the scope of static analysis skills.

## Origin

These skills grew out of solving real race conditions, breaking changes, and mobile network failures in a multiplayer platform on Cloudflare Workers. Generalized for any tech stack -- no framework dependencies.

## Framework Compatibility

All skills are framework-agnostic. The patterns work with:
- **Test frameworks**: Vitest, Jest, Node test runner, Go testing, Rust #[test]
- **Languages**: TypeScript/JavaScript (examples), but concepts apply to any language
- **CI systems**: GitHub Actions, GitLab CI, CircleCI, Jenkins

## License

[CC-BY-SA-4.0](LICENSE)
