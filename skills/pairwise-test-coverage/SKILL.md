---
name: pairwise-test-coverage
description: "Combinatorial testing with a greedy pairwise matrix generator. Covers all factor pairs in near-minimal test cases."
---

# Pairwise Test Coverage

Combinatorial testing that covers all factor pairs in near-minimal test cases.

**When to use**: Multi-factor systems where exhaustive testing is impractical, state machines, retry/recovery logic, configuration matrices, compatibility testing, any code with 3+ interacting parameters.

**When not to use**: Single-factor tests (just test each value), two-factor systems (test all combinations directly), UI snapshot tests, type-only changes.

## Pairwise vs Model-Based

Pairwise selects **which input combinations** to test. [Model-based testing](https://github.com/apankov1/quality-engineering/tree/main/skills/model-based-testing) derives **which state transitions** to test. Different questions, different tools:

| Your system has... | Use | Example |
|--------------------|-----|---------|
| Independent parameters with discrete values | **Pairwise** | OS × browser × locale config matrix |
| Named states with transitions between them | **Model-based** | draft → review → published workflow |
| State machine guards with 5+ boolean inputs | **Both** | Model-based finds the guards, pairwise covers the flag combos |

**Rule of thumb**: if you're testing *what goes in*, use pairwise. If you're testing *what happens next*, use model-based.

## What To Protect (Start Here)

Pairwise coverage protects against **interaction bugs** — defects that only appear when two specific factor values combine. Before generating a matrix, identify which factors interact:

| Decision | Question to Answer | If Yes → Use |
|----------|--------------------|--------------|
| Factor combinations cause different behavior | Do any two parameters interact to produce a unique code path? | `generatePairwiseMatrix` |
| Critical factors need stronger coverage | Are some factors higher-risk (auth, payment, region)? | `factorWeights` option |
| Three-way interactions are plausible | Could a bug require three specific values to trigger? | `strength: 3` option |

**Do not generate tests for decisions the human hasn't confirmed.** A pairwise matrix with arbitrary factors produces coverage numbers without catching bugs — the human must identify which factors actually interact.

## Core Philosophy

**Exhaustive testing doesn't scale.** If a system has 4 factors with 3 values each, that's 81 test cases. Pairwise testing covers all pair interactions in ~12 cases -- an 85% reduction with near-complete defect detection.

## Rationalizations (Do Not Skip)

| Rationalization | Why It's Wrong | Required Action |
|-----------------|----------------|-----------------|
| "We'll test the important combinations" | Unexpected factor interactions go untested without systematic coverage | Generate the pairwise matrix |
| "81 test cases is fine" | 81 cases means 81 things to maintain and debug when they fail | Use pairwise to get 12 |
| "The test passes, so the code works" | Test must FAIL before the fix to prove it catches the bug | Validate detection first |

---

## Included Utilities

```typescript
// Pairwise matrix generator (zero dependencies)
import { generatePairwiseMatrix, generateThreewiseMatrix, formatAsMarkdownTable } from './pairwise.ts';

// Pairwise test case helpers
import { createPairwiseTestCases, generateTestCaseName } from './test-fixtures.ts';
```

```typescript
// 3-wise coverage for critical paths (slower than pairwise)
const matrix3 = generatePairwiseMatrix(factors, { strength: 3 });

// Weighted scoring prioritizes high-risk factors
const weighted = generatePairwiseMatrix(factors, {
  factorWeights: { auth: 10, region: 4 },
});
```

## Performance and Limits

The greedy algorithm never enumerates the Cartesian product. Pair count grows as O(factors² × values²).

| Factors | Values | Cartesian | Pairwise Cases | Time |
|---------|--------|-----------|----------------|------|
| 3 | 3 | 27 | ~10 | <1ms |
| 8 | 4 | 65,536 | ~46 | ~2ms |
| 8 | 8 | 16,777,216 | ~100 | ~10ms |

**Hard limits** (throws if exceeded): max 20 factors, max 50 values per factor. Beyond these, pair count exceeds ~475K (C(20,2) × 50²) and in-memory generation becomes impractical.

For `strength: 3`, interaction growth is much faster. Use only for focused high-risk matrices (typically <= 6 factors with low cardinality).

## Violation Rules

| Slug | Rule | Severity |
|------|------|----------|
| `missing_pairwise_coverage` | Multi-factor code changes need pairwise tests | must-fail |
| `bug_detection_not_validated` | Tests must fail before fix, pass after | must-fail |

## Definition of Done

- [ ] Factors documented in test file header
- [ ] Pairwise matrix as `it.each` test cases
- [ ] Tests fail before fix, pass after

## Companion Skills

This skill provides **combinatorial test matrix generation**, not test design guidance. For broader methodology:

- Search `combinatorial testing` on [skills.sh](https://skills.sh) for constraint handling, higher-strength covering arrays, and test oracle strategies
- Guard truth tables with 5+ boolean inputs use pairwise for coverage — use [model-based-testing](https://github.com/apankov1/quality-engineering/tree/main/skills/model-based-testing) for state machine transition matrices and guard truth table generation
- Zod schemas with 5+ optional fields use pairwise for compound state coverage — use [zod-contract-testing](https://github.com/apankov1/quality-engineering/tree/main/skills/zod-contract-testing) for schema boundary validation and compound state matrices

---

## Details

See references for:
- **workflow.md**: Step-by-step implementation guide
- **violations.md**: Full violation rules with detection patterns
- **examples.md**: 6 testing technique examples (pairwise, property-based, model-based, fault injection, contract, observability)
