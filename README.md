# Quality Engineering Skills for AI Coding Agents

Quality engineering methodologies for AI coding agents. Deterministic concurrency testing, combinatorial coverage, breaking change detection, and client resilience patterns.

These skills teach AI coding agents (Claude Code, Cursor, etc.) rigorous testing methodologies -- not just "write a test", but *how* to test concurrent code, *what* combinations to cover, and *which* invariants to assert.

## Skills

| Skill | What It Does | Key Innovation |
|-------|-------------|----------------|
| **barrier-concurrency-testing** | Deterministic race condition testing via barriers | Replaces flaky setTimeout-based timing tests with reproducible interleaving |
| **pairwise-test-coverage** | Combinatorial testing with matrix generator | Zero-dep pairwise algorithm + 5 named invariant assertions + barrier fixtures |
| **breaking-change-detector** | 6-category breaking change analysis | Tolerant reader pattern for safe schema evolution |
| **websocket-client-resilience** | Client-side WebSocket resilience patterns | Mobile-aware timeouts, circuit breakers, heartbeat hysteresis |

## Install

```bash
# Install a single skill
npx skills add apankov1/quality-engineering --skill barrier-concurrency-testing

# Install another
npx skills add apankov1/quality-engineering --skill pairwise-test-coverage
```

## What's Included

### barrier-concurrency-testing

Testing race conditions with `setTimeout` and hope leads to flaky results. This skill teaches agents to use **barriers** -- deterministic interleave points that make concurrency tests reproducible on every run.

- Barrier interface + tracked cleanup pattern
- Deferred promise alternative for simple cases
- Decision guide: when to use barriers vs deferred
- Violation rules: `inadequate_barrier_coverage`, `flaky_timing_test`

### pairwise-test-coverage

When your system has 4 factors with 3-4 values each, exhaustive testing means 100+ cases. Pairwise testing covers all pair interactions in ~12 cases.

Ships with real runnable code:
- **`pairwise.ts`** -- Zero-dependency greedy covering algorithm (generates minimal test matrices)
- **`test-fixtures.ts`** -- Barrier infrastructure + 5 named invariant assertions
- Step-by-step workflow from factor identification to table-driven tests
- 7 testing technique examples in references (pairwise matrices, property-based, model-based, fault injection, barriers, contract validation, observability assertions)

## Origin

These skills grew out of solving real race conditions, breaking changes, and mobile network failures in a multiplayer platform on Cloudflare Workers. Generalized for any tech stack -- no framework dependencies.

The barrier pattern alone caught 3 data-loss bugs by making race conditions reproducible in CI.

## Framework Compatibility

All skills are framework-agnostic. The patterns work with:
- **Test frameworks**: Vitest, Jest, Node test runner, Go testing, Rust #[test]
- **Languages**: TypeScript/JavaScript (examples), but concepts apply to any language
- **CI systems**: GitHub Actions, GitLab CI, CircleCI, Jenkins

## License

[CC-BY-SA-4.0](LICENSE)
