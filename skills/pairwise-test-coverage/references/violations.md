# Pairwise Test Violations

Violation rules for pairwise testing coverage.

## 1. Missing Pairwise Coverage

**Violation slug**: `missing_pairwise_coverage`

**Rule**: Multi-factor code changes MUST have corresponding pairwise tests.

**Detect when**:
- PR modifies stateful service without `*.pairwise.spec.*`
- New recovery/retry path added without factor/value coverage
- 3+ interacting parameters without systematic coverage

**Severity**: must-fail

---

## 2. Bug Detection Not Validated

**Violation slug**: `bug_detection_not_validated`

**Rule**: Tests MUST fail before fix and pass after.

**Detect when**:
- Test added alongside fix without proving it catches the bug
- No comment documenting expected failure before fix
- Skipped test without explanation of the bug it covers

**Severity**: must-fail

---

## Definition of Done Checklist

Every PR touching multi-factor code must include:

### Matrix and Tests
- [ ] **Factors documented**: Test file header lists all factor/value combinations
- [ ] **Pairwise matrix**: Minimal covering set as `it.each` test cases

### Test Quality
- [ ] **Bug detection validated**: Tests fail before fix (document with comment)
- [ ] **Deterministic**: Same result on every run

### Documentation
- [ ] **Fix validation comment**: Explain how test proves fix works
