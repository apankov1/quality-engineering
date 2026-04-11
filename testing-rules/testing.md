# Testing Rules

Quality standards and pre-test gate for all test code.

Priority markers: **MUST** = correctness risk if violated. **SHOULD** = quality risk. **MAY** = advisory.

## Pre-Test Gate

**MUST** complete before writing ANY test file. This is non-negotiable.

### Step 1: Identify the requirement

Which issue or acceptance criteria does this test address? Read them.

### Step 2: Read the implementation

Read the source file(s) being tested. Identify:
- Exported functions and their signatures
- Decision branches (if/else, switch, early returns)
- Error paths (throws, catch blocks, error returns)
- External boundaries (API calls, DB queries, external service bindings)
- Edge cases visible in the code (null checks, empty arrays, boundary comparisons)

### Step 3: Select QA technique per function

Match each function to the appropriate technique:
- Multi-branch logic → Equivalence partitioning (one test per class)
- Threshold / limit → Boundary value analysis (at, below, above)
- Multiple conditions to outcome → Decision table (one test per row)
- Entity lifecycle → State transition testing (valid + invalid transitions)
- Data transformation → Equivalence partitioning + boundaries
- Error handling → Equivalence partitioning (per error category)

### Step 4: Enumerate test cases

For each function under test, list cases derived from the technique:
- Name the specific partition, boundary, state transition, or decision row
- Describe the expected output
- Name the production defect it would catch

### Step 5: Write test code (AAA structure)

```typescript
it("returns 'house' for 'House' origin value", () => {
  // Arrange
  const input = "House";

  // Act
  const result = normalizeOrigin(input);

  // Assert
  expect(result).toBe("house");
});
```

### Step 6: Self-verify

Could this test fail if the production code had a real bug? If the test would still pass with a broken implementation, delete it.

## Quality Standards

### MUST

- Complete the pre-test gate before writing any test file
- Select a QA technique from the guide for each function under test
- Enumerate test cases before writing test code
- Use AAA structure (Arrange, Act, Assert) in every test
- Assert on computed values with specific expected values — never truthiness-only
- Import and call at least one production function per test file
- No tautological assertions (`expect(true).toBe(true)`)
- No self-referential assertions (`expect(x).toBe(x)`)
- Never mock the system under test — mock only at external boundaries (fetch, timers, external services)
- Include negative test cases (error paths, invalid inputs, throws)
- Bugs get tests first: write the failing test, verify it fails for the right reason, then fix

### SHOULD

- Use test data builders instead of inline object literals
- Name test files after the function or behavior, not the source file
- One focused concern per test file
- Test the boundary, not the internals — if deleting the call site doesn't break the test, you're testing the wrong layer

## Test Tiers

- **Unit** (`unit/`): Pure logic, no I/O, no DB. Use fake timers for clock-dependent helpers.
- **Integration** (`integration/`): Real database bindings. Real time only (DB time functions are not controlled by fake timers). Prefer seeded timestamps over elapsed-time waits.

## Anti-Patterns (Explicitly Forbidden)

| Anti-pattern | Example | Why |
|---|---|---|
| Tautological assertion | `expect(true).toBe(true)` | Cannot fail |
| Self-referential | `expect(x).toBe(x)` | Always passes |
| Literal roundtrip | Build `{name: "foo"}`, assert `obj.name === "foo"` | Tests construction |
| Truthiness-only | `expect(result).toBeTruthy()` | Passes for any non-null |
| Mock the SUT | Mock `doThing` to test `doThing` | Tests the mock |
| Empty test body | `it("works", () => {})` | Proves nothing |
| No production call | `it("adds", () => expect(1+1).toBe(2))` | Tests JavaScript |
| Schema-success-only | `expect(result.success).toBe(true)` | Doesn't verify parsed data |
