# Pairwise Test Violations

Violation rules for pairwise testing coverage.

## 1. Missing Pairwise Coverage

**Violation slug**: `missing_pairwise_coverage`

**Rule**: Multi-factor code changes MUST have corresponding pairwise tests.

**Detect when**:
- PR modifies stateful service without `*.pairwise.spec.*` or `*.concurrency.spec.*`
- New recovery/retry path added without factor/value coverage
- Concurrency logic changed without barrier tests

**Severity**: must-fail

---

## 2. Inadequate Barrier Coverage

**Violation slug**: `inadequate_barrier_coverage`

**Rule**: Race conditions MUST have barrier tests at each interleave point.

**Detect when**:
- Transaction with clear/delete doesn't have barrier before AND during
- No `afterEach(() => releaseAllBarriers())` in concurrency test file
- Barrier created but never awaited in test path

**Severity**: must-fail

---

## 3. Missing Invariant Assertions

**Violation slug**: `missing_invariant_assertion`

**Rule**: Concurrency tests MUST assert invariants, not just outcomes.

**Detect when**:
- Test checks `status === 'success'` without verifying queue state
- No assertion on `lastSequence` correctness
- Failure tests don't verify all items preserved

**Severity**: must-fail

---

## 4. Bug Detection Not Validated

**Violation slug**: `bug_detection_not_validated`

**Rule**: Tests MUST fail before fix and pass after.

**Detect when**:
- Test added alongside fix without proving it catches the bug
- No comment documenting expected failure before fix
- Skipped test without explanation of the bug it covers

**Severity**: must-fail

---

## Definition of Done Checklist

Every PR touching multi-factor or concurrent code must include:

### Matrix and Tests
- [ ] **Factors documented**: Test file header lists all factor/value combinations
- [ ] **Pairwise matrix**: Minimal covering set as `it.each` test cases
- [ ] **Concurrency tests**: Barrier-based interleaving for each race window
- [ ] **Invariant assertions**: Use named `assertInvariant*` helpers

### Test Quality
- [ ] **Bug detection validated**: Tests fail before fix (document with comment)
- [ ] **Barriers cleaned up**: `afterEach(() => releaseAllBarriers())`
- [ ] **No flaky timing**: Use barriers, not `setTimeout` or arbitrary delays
- [ ] **Deterministic**: Same result on every run

### Documentation
- [ ] **Race window comments**: Document which race each test covers
- [ ] **Fix validation comment**: Explain how test proves fix works
