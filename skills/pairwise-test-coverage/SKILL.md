---
name: pairwise-test-coverage
description: |
  Combinatorial testing with a greedy pairwise matrix generator, barrier-based
  concurrency fixtures, and named invariant assertions.

  WHEN to use:
  - Multi-factor systems where exhaustive testing is impractical
  - State machines, retry/recovery logic, concurrent operations
  - Configuration matrices, compatibility testing
  - Any code with 3+ interacting parameters

  WHEN NOT to use:
  - Single-factor tests (just test each value)
  - Two-factor systems (test all combinations directly)
  - UI snapshot tests, type-only changes
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Write
  - Edit
references:
  - ./references/workflow.md
  - ./references/violations.md
  - ./references/examples.md
---

# Pairwise Test Coverage

Combinatorial testing that covers all factor pairs in minimal test cases, plus barrier-based concurrency testing and invariant assertion patterns.

## Core Philosophy

**Exhaustive testing doesn't scale.** If a system has 4 factors with 3 values each, that's 81 test cases. Pairwise testing covers all pair interactions in ~12 cases -- an 85% reduction with near-complete defect detection.

**Test race conditions BEFORE fixing them.** Tests must catch bugs with current code, then validate the fix (TDD approach for concurrency).

## Rationalizations (Do Not Skip)

| Rationalization | Why It's Wrong | Required Action |
|-----------------|----------------|-----------------|
| "We'll test the important combinations" | Unexpected factor interactions go untested without systematic coverage | Generate the pairwise matrix |
| "81 test cases is fine" | 81 cases means 81 things to maintain and debug when they fail | Use pairwise to get 12 |
| "The race condition is too hard to test" | If it's too hard to test, it's too hard to verify the fix works | Use barriers |
| "The test passes, so the code works" | Test must FAIL before the fix to prove it catches the bug | Validate detection first |

---

## Quick Reference

| Technique | Use When | Key Pattern |
|-----------|----------|-------------|
| **Pairwise Matrix** | Multiple factors with discrete values | `it.each(cases)` table-driven |
| **Barrier Tests** | Race conditions, interleaving | `createBarrier()` + `afterEach(releaseAll)` |
| **Invariant Assertions** | Queue/state consistency after concurrent ops | `assertInvariant*` named helpers |
| **Property-Based** | Value ranges, type safety invariants | `fc.assert(fc.property(...))` |
| **Model-Based** | State machine transitions | Transition table tests |
| **Fault Injection** | Storage/network failures | Mock rejection scenarios |
| **Contract Tests** | Schema validation at boundaries | `Schema.safeParse()` assertions |

## Included Utilities

```typescript
// Pairwise matrix generator (zero dependencies)
import { generatePairwiseMatrix, formatAsMarkdownTable } from './pairwise.ts';

// Barrier infrastructure + invariant assertions
import {
  createBarrier,
  createTrackedBarrier,
  releaseAllBarriers,
  assertPreservesConcurrentItems,
  assertPreservesOnFailure,
  assertSequenceContinuity,
} from './test-fixtures.ts';
```

## Violation Rules

| Slug | Rule | Severity |
|------|------|----------|
| `missing_pairwise_coverage` | Multi-factor code changes need pairwise tests | must-fail |
| `inadequate_barrier_coverage` | Race conditions need barriers at each interleave | must-fail |
| `missing_invariant_assertion` | Concurrency tests must assert invariants, not just outcomes | must-fail |
| `bug_detection_not_validated` | Tests must fail before fix, pass after | must-fail |

## Definition of Done

- [ ] Factors documented in test file header
- [ ] Pairwise matrix as `it.each` test cases
- [ ] Barrier tests at each race window
- [ ] `afterEach(() => releaseAllBarriers())`
- [ ] Invariant assertions (not just outcome checks)
- [ ] Tests fail before fix, pass after

## Details

See references for:
- **workflow.md**: Step-by-step implementation guide
- **violations.md**: Full violation rules with detection patterns
- **examples.md**: Concrete code examples for each technique
