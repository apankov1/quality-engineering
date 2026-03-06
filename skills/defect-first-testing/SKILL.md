---
name: defect-first-testing
description: "Reverses the test-writing workflow: analyze production code for its fault surface (what bugs could exist), then write tests targeting those specific defects. Use this skill whenever writing tests, generating test files, adding test coverage, or when asked to 'test this function' — prevents slop tests that compile and pass but catch zero bugs."
---

# Defect-First Testing

Agents write tests that exercise APIs but catch zero bugs. They start from "what does this function do?" and produce tests that mirror the implementation. This skill reverses the workflow — start from "what bugs could exist in this code?" and write tests that would detect those bugs.

**When to use**: Writing tests for any function or module. Generating test files. Adding test coverage. Reviewing whether existing tests actually catch bugs.

**When not to use**: Writing implementation code. Measuring coverage metrics. Testing trivial getters/setters with no logic.

## Rationalizations (Do Not Skip)

| Rationalization | Why It's Wrong | Required Action |
|---|---|---|
| "I'll test the happy path first" | Happy-path tests catch zero bugs — the happy path already works | Start from fault surface, test defect scenarios first |
| "100% coverage means thorough testing" | Coverage counts lines executed, not bugs caught | Check that each test targets a specific defect class |
| "The function signature tells me what to test" | Signatures describe contracts, not failure modes | Analyze the implementation for fault-prone patterns |
| "I'll add edge cases later" | "Later" never comes — and agents don't revisit | Identify edge cases up front via fault surface analysis |

---

## What To Protect (Start Here)

Before writing tests, analyze the production code for fault-prone patterns:

| Decision | Question to Answer | If Yes → Check Fault Class |
|---|---|---|
| Boundaries are correct | Does the code compare values or use indices? | `off-by-one`, `boundary-zero`, `empty-collection` |
| Null/undefined is handled | Does the code access properties that could be null? | `null-undefined` |
| Errors propagate correctly | Does the code catch or throw errors? | `missing-error-path`, `swallowed-error`, `wrong-error-type` |
| Types are validated | Does the code convert or coerce types? | `type-coercion`, `nan-propagation` |
| Math is safe | Does the code divide, modulo, or use domain-restricted functions? | `division-by-zero`, `nan-propagation` |
| Mutations are intentional | Does the code modify arrays/objects in place? | `shared-mutation` |
| Async failures surface | Does the code use Promise.all or .catch? | `unhandled-rejection` |
| All branches execute | Does the code have switch/if-else chains? | `missing-branch` |

---

## The Defect-First Workflow

### Step 1: Analyze the Fault Surface

Read the production code and call `analyzeFaultSurface(source)`. This scans for patterns that historically produce bugs and returns a structured fault surface.

```typescript
const surface = analyzeFaultSurface(productionCode);
// surface.entries — each fault with line, defect class, and test strategy
// surface.summary — fault counts per category
// surface.coverage — unique defect classes found
```

### Step 2: Generate Test Suggestions

Call `suggestTests(surface)` to get concrete test case suggestions for each defect class.

```typescript
const suggestions = suggestTests(surface);
// Each suggestion: name, defectComment, inputs, expectedBehavior
```

### Step 3: Write Tests

For each suggestion, write a test that:
1. Starts with a `// Defect:` comment explaining what production bug this catches
2. Constructs inputs that trigger the specific fault
3. Asserts on the specific behavior that would break if the defect existed

```typescript
// Defect: off-by-one in loop termination — iterating arr.length
//         instead of arr.length-1 causes reading past the last valid element
it('handles boundary at last element', () => {
  const result = processItems([1, 2, 3]);
  assert.equal(result.lastProcessed, 3);
});
```

### Step 4: Validate Coverage

Call `validateCoverage(testSource, surface)` to check that your tests cover the identified fault surface.

```typescript
const validation = validateCoverage(testSource, surface);
// validation.covered — number of defect classes with targeting tests
// validation.gaps — defect classes with no targeting test
// validation.score — 0-100 coverage score
```

---

## Included Utilities

```typescript
import {
  analyzeFaultSurface,
  suggestTests,
  validateCoverage,
  formatTestPlan,
} from './defect-first.ts';
```

---

## Key Principle: Every Test Needs a Defect Hypothesis

A test without a defect hypothesis is just an API exercise. Before writing `it('should return X')`, answer: **"What production bug does this test catch?"**

If you can't name the bug, don't write the test.

| Bad (API exercise) | Good (defect hypothesis) |
|---|---|
| `it('returns an array')` | `it('returns empty array for empty input, not undefined')` |
| `it('handles valid input')` | `it('rejects NaN when numeric input expected')` |
| `it('calls the callback')` | `it('calls callback exactly once, not per retry attempt')` |

---

## Violation Rules

| Rule | Severity | Description |
|---|---|---|
| Tests written without fault surface analysis | must-fix | Every test file must be preceded by `analyzeFaultSurface()` |
| Test without `// Defect:` comment | should-fix | Every `it()` block should name its defect hypothesis |
| Defect class in surface with no targeting test | should-fix | `validateCoverage()` reports gaps |
| Test asserts on type/truthiness only | must-fix | Assertions must verify specific values, not just existence |

---

## Companion Skills

- **slop-test-detector**: Run after generating tests to catch remaining slop patterns. If `analyzeTestFile()` reports must-fail findings, the tests need rework.
- **fault-injection-testing**: For testing failure paths in code with external dependencies.
- **pairwise-test-coverage**: For combinatorial input coverage when multiple parameters interact.
- **model-based-testing**: For testing state machine transitions.

---

## Reference

See [references/fault-catalog.md](references/fault-catalog.md) for the complete catalog of 16 code patterns and their associated defect classes, with before/after examples.
