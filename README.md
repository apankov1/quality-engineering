# Quality Engineering Skills for AI Coding Agents

[![CI](https://github.com/apankov1/quality-engineering/actions/workflows/ci.yml/badge.svg)](https://github.com/apankov1/quality-engineering/actions/workflows/ci.yml)

Quality engineering methodologies for AI coding agents. Deterministic concurrency testing, combinatorial coverage, breaking change detection, client resilience patterns, fault injection, state machine testing, contract validation, and observability assertions.

These skills teach AI coding agents (Claude Code, Cursor, etc.) rigorous testing methodologies -- not just "write a test", but *how* to test concurrent code, *what* combinations to cover, and *which* invariants to assert.

## Skills

| Skill | What It Does | Key Innovation |
|-------|-------------|----------------|
| **barrier-concurrency-testing** | Deterministic race condition testing via barriers | Replaces flaky setTimeout-based timing tests with reproducible interleaving |
| **breaking-change-detector** | 6-category breaking change analysis | Tolerant reader pattern for safe schema evolution |
| **fault-injection-testing** | Circuit breaker, retry policy, queue preservation | Executable resilience primitives with state machine transitions |
| **model-based-testing** | State machine transition matrices and guard truth tables | N*N transition coverage, context mutation assertions |
| **observability-testing** | Structured log assertions and level policy enforcement | Mock logger with 5 assertion types, level classification heuristic |
| **pairwise-test-coverage** | Combinatorial testing with matrix generator | Zero-dep greedy algorithm covers all factor pairs in near-minimal test cases |
| **websocket-client-resilience** | Client-side WebSocket resilience patterns | Mobile-aware timeouts, circuit breakers, heartbeat hysteresis |
| **zod-contract-testing** | Schema boundary testing with compound state matrices | 2^N optional field coverage, refinement assertions, schema evolution |

## Quickstart for QA Reviewers

Prove detection in under a minute. Clone the repo and run one command per skill:

```bash
git clone https://github.com/apankov1/quality-engineering.git
cd quality-engineering

# Run all 174 tests across 8 skills
node --experimental-strip-types --test skills/*/*.spec.ts

# Or run individual skills:

# Barrier concurrency: 7 tests for deterministic race condition patterns
node --experimental-strip-types --test skills/barrier-concurrency-testing/test-fixtures.spec.ts

# Breaking change detector: 16 tests for field classification, schema validation, event type changes
node --experimental-strip-types --test skills/breaking-change-detector/breaking-change.spec.ts

# Fault injection: 29 tests for circuit breaker, retry policy, queue preservation
node --experimental-strip-types --test skills/fault-injection-testing/fault-injection.spec.ts

# Model-based testing: 31 tests for state machines, guard truth tables, context mutations
node --experimental-strip-types --test skills/model-based-testing/state-machine.spec.ts

# Observability testing: 27 tests for mock logger, log assertions, level classification
node --experimental-strip-types --test skills/observability-testing/structured-logger.spec.ts

# Pairwise coverage: 13 tests including safety rails and edge cases
node --experimental-strip-types --test skills/pairwise-test-coverage/pairwise.spec.ts

# WebSocket resilience: 27 tests for backoff, circuit breaker, heartbeat, command ack, gaps, timeouts
node --experimental-strip-types --test skills/websocket-client-resilience/resilience.spec.ts

# Zod contract testing: 24 tests for schema boundary validation, compound state matrices
node --experimental-strip-types --test skills/zod-contract-testing/schema-boundary.spec.ts
```

Each skill ships importable utilities alongside its tests. Import what you need:

```typescript
import { generatePairwiseMatrix } from './skills/pairwise-test-coverage/pairwise.ts';
import { classifyFieldChange } from './skills/breaking-change-detector/breaking-change.ts';
import { circuitBreakerTransition, CommandAckTracker } from './skills/websocket-client-resilience/resilience.ts';
import { createBarrier, createTrackedCleanup } from './skills/barrier-concurrency-testing/test-fixtures.ts';
import { CircuitBreaker, RetryPolicy, createFaultInjector } from './skills/fault-injection-testing/fault-injection.ts';
import { createStateMachine, testTransitionMatrix, assertGuardTruthTable } from './skills/model-based-testing/state-machine.ts';
import { createMockLogger, assertLogEntry, assertNoLogsAbove } from './skills/observability-testing/structured-logger.ts';
import { testValidInput, testInvalidInput, generateCompoundStateMatrix } from './skills/zod-contract-testing/schema-boundary.ts';
```

**Node.js 18-20 (LTS)?** Replace `node --experimental-strip-types` with `npx tsx`:

```bash
npx tsx --test skills/*/*.spec.ts
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

### fault-injection-testing

Simulates storage and network failures for resilience testing. Ships executable circuit breaker, retry policy with exponential backoff, and queue preservation assertions.

- **`fault-injection.ts`** -- Circuit breaker state machine (closed/open/half-open), RetryPolicy with jitter, fault injector, queue assertions
- Circuit breaker with configurable failure/success thresholds and reset timeout
- Exponential backoff with jitter and max delay cap
- Queue preservation and trimming assertions for message ordering
- Violation rules: `missing_circuit_breaker_test`, `missing_retry_backoff_test`, `missing_queue_preservation_test`

### model-based-testing

Tests state machine transitions with XState-style patterns. Validates transition matrices, guard truth tables, context mutations, and terminal state handling.

- **`state-machine.ts`** -- State machine factory, transition validator, matrix generator, guard truth table, context mutation assertions
- N*N transition matrix generation for exhaustive state pair coverage
- Guard truth tables for boolean condition testing (2^N for N ≤ 4, pairwise for 5+)
- Context mutation assertions with deep structural equality and field removal detection
- Violation rules: `missing_transition_coverage`, `missing_guard_truth_table`, `missing_context_mutation_test`, `untested_terminal_state`

### observability-testing

Verifies structured log output and error context. Provides mock logger creation, log level policy enforcement, and assertion patterns for observability testing.

- **`structured-logger.ts`** -- Mock logger, log assertions, level policy, level classifier
- 5 assertion types: `assertLogEntry`, `assertNoLogsAbove`, `assertHasLogLevel`, `assertErrorLogged`, `classifyLogLevel`
- Log level policy with production sampling guidance
- Common misclassification table for alert fatigue prevention
- Violation rules: `missing_error_log_assertion`, `happy_path_logs_error`, `log_level_misclassification`, `missing_context_fields`, `console_spy_instead_of_mock`

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

### zod-contract-testing

Tests Zod schemas at system boundaries -- not just happy-path inputs. Compound state matrices cover all 2^N optional field combinations.

- **`schema-boundary.ts`** -- Valid/invalid input testing, schema evolution, refinement coverage, compound state matrix generator
- Compound state matrix for 2^N optional field combinations (exhaustive for ≤4, pairwise for 5+)
- Schema evolution testing for backward compatibility
- Refinement coverage (both passing and failing cases)
- Violation rules: `missing_invalid_input_test`, `missing_refinement_coverage`, `missing_compound_state_test`, `schema_not_at_boundary`, `type_assertion_instead_of_parse`

## Try It

Run the test suites with Node.js 22+ (no install needed):

```bash
git clone https://github.com/apankov1/quality-engineering.git
cd quality-engineering

# Run all tests (174 tests across 8 skills)
node --experimental-strip-types --test skills/*/*.spec.ts

# Run the pairwise CLI demo (3×3×3 matrix + 8×4 stress test)
node --experimental-strip-types skills/pairwise-test-coverage/pairwise.ts
```

**Node.js < 22?** Use `npx tsx` instead:

```bash
npx tsx --test skills/*/*.spec.ts
```

**GitHub Actions snippet** for CI:

```yaml
- name: Quality engineering skill tests
  run: node --experimental-strip-types --test skills/*/*.spec.ts
```

## When to Apply

Start with the change you're making. Each skill targets a different failure mode.

| What Changed | Skill | Why |
|---|---|---|
| Shared types, API signatures, DB schema | breaking-change-detector | Catch incompatibilities before merge |
| Code with concurrent access or shared state | barrier-concurrency-testing | Expose race windows deterministically |
| 3+ interacting parameters (config, modes, states) | pairwise-test-coverage | Cover pair interactions without exhaustive explosion |
| WebSocket client reconnection or health checks | websocket-client-resilience | Survive real mobile network conditions |
| Named states, lifecycles, workflow progressions | model-based-testing | N*N transition matrix catches invalid transitions |
| Error paths, retry logic, circuit breakers | fault-injection-testing | Verify resilience under simulated failures |
| Structured logging, error context, alert levels | observability-testing | Assert log output as first-class behavior |
| Zod schemas at system boundaries | zod-contract-testing | Test rejection of invalid data, not just acceptance |

## Defect Classes

| Skill | Defects Caught | Example |
|---|---|---|
| barrier-concurrency-testing | Race conditions, write ordering bugs, stale reads | Flush conflict: two writers interleave, last-write-wins silently drops data |
| breaking-change-detector | Backward-incompatible schema/API/protocol changes | Renamed field breaks active sessions still using old format |
| fault-injection-testing | Missing retry logic, uncapped backoff, queue data loss | Circuit stays closed despite repeated failures, queue items silently dropped |
| model-based-testing | Invalid transitions allowed, guard logic gaps | Draft→Published allowed (skipping review), context mutation side effects |
| observability-testing | Missing error logs, wrong log levels, alert fatigue | Error path logs at info level, happy path produces spurious warnings |
| pairwise-test-coverage | Interaction bugs in untested parameter combinations | Auth=expired + role=admin works, but auth=expired + role=guest crashes |
| websocket-client-resilience | Reconnection storms, false disconnects, lost messages | All clients retry at once after outage (thundering herd) |
| zod-contract-testing | Schema accepts invalid data, rejects valid data | Optional field combination triggers refinement bug, old data rejected |

## Workflow Integration

```
Design         → pairwise-test-coverage (define factor matrix for new feature)
               → model-based-testing (define state machine transitions)
Implementation → barrier-concurrency-testing (test concurrent paths as you write them)
               → observability-testing (verify logging as you add error paths)
               → fault-injection-testing (test resilience of new integrations)
Pre-merge      → breaking-change-detector (audit contract/schema diffs)
               → zod-contract-testing (verify boundary schemas)
Client deploy  → websocket-client-resilience (verify reconnection patterns)
```

## PR Review Checklist

When reviewing a pull request, walk the diff and select skills based on what changed:

1. **Scan the diff** -- `git diff --name-only base...HEAD`
2. **Match files to skills**:
   - Contract/schema/migration files → run **breaking-change-detector** + **zod-contract-testing**
   - Concurrent or stateful code → run **barrier-concurrency-testing**
   - Multi-factor config or mode logic → run **pairwise-test-coverage**
   - WebSocket client code → run **websocket-client-resilience**
   - State machines, lifecycles, workflow states → run **model-based-testing**
   - Error handling, retry logic, circuit breakers → run **fault-injection-testing**
   - Logging statements, error context → run **observability-testing**
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

These skills cover correctness and compatibility, not performance benchmarking or load testing. But several non-functional concerns are addressed directly:

| Concern | Covered By | How |
|---|---|---|
| **Fault tolerance** | fault-injection-testing | Circuit breaker state machine, retry with backoff, queue preservation |
| **Observability** | observability-testing | Mock logger assertions, log level policy, error context validation |
| **State machine correctness** | model-based-testing | N*N transition matrix, guard truth tables, context mutation assertions |
| **Resilience under degraded networks** | websocket-client-resilience | Circuit breakers, backoff with jitter, mobile-aware timeouts |
| **Concurrency under contention** | barrier-concurrency-testing | Deterministic interleaving for write ordering and stale-read detection |
| **Contract safety** | zod-contract-testing | Boundary validation, compound state matrices, schema evolution |

**Not covered**: load/stress testing, latency percentile benchmarks, throughput profiling, SLO threshold validation, large-scale chaos engineering. These require runtime infrastructure (load generators, APM tooling, distributed tracing) that is outside the scope of static analysis skills.

## Origin

These skills grew out of solving real race conditions, breaking changes, and mobile network failures in a multiplayer platform on Cloudflare Workers. Generalized for any tech stack -- no framework dependencies.

## Framework Compatibility

All skills are framework-agnostic. The patterns work with:
- **Test frameworks**: Vitest, Jest, Node test runner, Go testing, Rust #[test]
- **Languages**: TypeScript/JavaScript (examples), but concepts apply to any language
- **CI systems**: GitHub Actions, GitLab CI, CircleCI, Jenkins

## License

[MIT](LICENSE)
