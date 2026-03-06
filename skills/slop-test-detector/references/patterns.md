# Slop Patterns Reference

All 18 slop patterns with before (slop) and after (fixed) examples.

---

## Must-Fail Patterns

### 1. empty_test_body

**Before (slop)**:
```typescript
it("handles edge case", () => {
  const result = processData(input);
  // TODO: add assertions
});
```

**After (fixed)**:
```typescript
it("handles edge case", () => {
  const result = processData(input);
  assert.equal(result.status, "success");
  assert.equal(result.items.length, 3);
});
```

**Note**: Tests using assertion-equivalent helpers like `assertLogEntry()` or `testValidInput()` are NOT flagged — the detector recognizes `assert[A-Z]*()` and `test[A-Z]*()` patterns as assertion equivalents.

---

### 2. commented_out_assertions

**Before (slop)**:
```typescript
it("validates input", () => {
  const result = validate(data);
  // assert.equal(result.valid, true);
  // assert.equal(result.errors.length, 0);
});
```

**After (fixed)**:
```typescript
it("validates input", () => {
  const result = validate(data);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});
```

---

### 3. tautological_assertion

**Before (slop)**:
```typescript
it("processes correctly", () => {
  processData(input);
  assert.ok(true);  // always passes
  assert.equal(1, 1);  // always passes
});
```

**After (fixed)**:
```typescript
it("processes correctly", () => {
  const result = processData(input);
  assert.equal(result.processed, true);
  assert.equal(result.count, 5);
});
```

---

### 4. self_referential_assertion

**Before (slop)**:
```typescript
it("returns correct value", () => {
  const result = calculate(10);
  assert.equal(result, result);  // always passes
});
```

**After (fixed)**:
```typescript
it("returns correct value", () => {
  const result = calculate(10);
  assert.equal(result, 20);
});
```

---

## Should-Fail Patterns

### 5. missing_defect_comment

**Before (slop)**:
```typescript
it("opens after failure threshold", () => {
  cb.recordFailure();
  cb.recordFailure();
  cb.recordFailure();
  assert.equal(cb.getState(), "open");
});
```

**After (fixed)**:
```typescript
// Defect: without circuit breaker, client hammers a down server indefinitely — cascading failures take down the entire service mesh.
it("opens after failure threshold", () => {
  cb.recordFailure();
  cb.recordFailure();
  cb.recordFailure();
  assert.equal(cb.getState(), "open");
});
```

---

### 6. trivial_defect_comment

**Before (slop)**:
```typescript
// Defect: Must work correctly
it("validates input", () => { ... });
```

**After (fixed)**:
```typescript
// Defect: if validation accepts malformed input, corrupt records propagate to downstream systems and cause silent data loss in billing.
it("validates input", () => { ... });
```

The minimum is 10 words — enough to explain what breaks, for whom, and the consequence.

---

### 7. assert_on_type_not_value

**Before (slop)**:
```typescript
it("creates logger with all levels", () => {
  const logger = createMockLogger();
  assert.equal(typeof logger.debug, "function");
  assert.equal(typeof logger.info, "function");
  assert.equal(typeof logger.warn, "function");
  assert.equal(typeof logger.error, "function");
});
```

**After (fixed)**:
```typescript
it("creates logger with all levels", () => {
  const logger = createMockLogger();
  assert.equal(typeof logger.debug, "function");
  logger.info("test message", { key: "value" });
  assert.equal(logger.entries.length, 1);
  assert.equal(logger.entries[0].level, "info");
});
```

---

### 8. truthiness_only

**Before (slop)**:
```typescript
it("finds matching entry", () => {
  const entry = assertLogEntry(logger, "info", "message");
  assert.ok(entry);
});
```

**After (fixed)**:
```typescript
it("finds matching entry", () => {
  const entry = assertLogEntry(logger, "info", "message");
  assert.equal(entry.message, "message");
  assert.equal(entry.level, "info");
});
```

**Note**: If the test also calls assertion-equivalent helpers (like `assertLogEntry`), the rule does not fire.

---

### 9. no_negative_test

**Before (slop)** — describe block with 5 tests, all positive:
```typescript
describe("validate", () => {
  it("accepts valid email", () => { ... });
  it("accepts valid phone", () => { ... });
  it("accepts valid name", () => { ... });
  // No test for what happens with INVALID input
});
```

**After (fixed)**:
```typescript
describe("validate", () => {
  it("accepts valid email", () => { ... });
  it("accepts valid phone", () => { ... });
  it("accepts valid name", () => { ... });
  it("rejects invalid email", () => {
    assert.throws(() => validate({ email: "not-an-email" }), /Invalid email/);
  });
});
```

---

### 10. duplicate_assertion_set

**Before (slop)** — two tests with identical assertion patterns:
```typescript
it("status code removal is breaking", () => {
  const result = classifyStatusCodeChanges([200, 400, 404], [200, 400]);
  assert.equal(result.safe, false);
  assert.equal(result.removed.length, 1);
});

it("enum value removal is breaking", () => {
  const result = classifyEnumValueChanges(["draft", "published"], ["draft"]);
  assert.equal(result.safe, false);
  assert.equal(result.removed.length, 1);
});
```

These test different functions but have identical assertion shapes. The rule flags this as should-fail to prompt review — the tests may be correct but should differentiate their assertions.

---

### 11. assert_return_type_only

**Before (slop)**:
```typescript
it("creates valid config", () => {
  const result = createConfig({ debug: true });
  assert.ok(result);  // only checks non-null
});
```

**After (fixed)**:
```typescript
it("creates valid config", () => {
  const result = createConfig({ debug: true });
  assert.equal(result.debug, true);
  assert.equal(result.logLevel, "debug");
});
```

---

### 12. no_input_variation

**Before (slop)** — same function called with identical args in sibling tests:
```typescript
it("test A", () => {
  assert.equal(classify("error"), "high");
});

it("test B", () => {
  assert.ok(classify("error"));  // same input!
});
```

**After (fixed)**:
```typescript
it("classifies error keywords as high", () => {
  assert.equal(classify("error"), "high");
});

it("classifies info keywords as low", () => {
  assert.equal(classify("info"), "low");
});
```

---

### 13. literal_roundtrip

**Before (slop)** — assertion echoes the literal used during construction:
```typescript
it("creates a user", () => {
  const user = { name: "Alice", age: 30 };
  assert.equal(user.name, "Alice");  // just reading back the literal
  assert.equal(user.age, 30);        // same — no computation tested
});
```

**After (fixed)** — pass the object through a function and assert on computed output:
```typescript
it("serializes user correctly", () => {
  const user = { name: "Alice", age: 30 };
  const result = serializeUser(user);
  assert.equal(result.displayName, "Alice");
  assert.equal(result.isAdult, true);
});
```

---

### 14. schema_success_only

**Before (slop)** — only checks `.success`, never inspects `.data` or `.error`:
```typescript
it("validates email", () => {
  const result = emailSchema.safeParse("user@example.com");
  assert.equal(result.success, true);  // schema could accept anything
});
```

**After (fixed)** — also checks parsed data or error details:
```typescript
it("validates email", () => {
  const result = emailSchema.safeParse("user@example.com");
  assert.equal(result.success, true);
  assert.equal(result.data, "user@example.com");
});

it("rejects invalid email", () => {
  const result = emailSchema.safeParse("not-an-email");
  assert.equal(result.success, false);
  assert.ok(result.error.issues.length > 0);
});
```

---

### 15. conditional_assertion (must-fail)

**Before (slop)** — all assertions inside a conditional, so the test passes silently if the condition is false:
```typescript
it("handles results", () => {
  const results = fetchResults();
  if (results.length > 0) {
    assert.equal(results[0].status, "ok");
  }
  // If results is empty, test passes with ZERO assertions
});
```

**After (fixed)** — assert unconditionally:
```typescript
it("handles results", () => {
  const results = fetchResults();
  assert.ok(results.length > 0, "expected at least one result");
  assert.equal(results[0].status, "ok");
});
```

---

### 16. vacuous_property

**Before (slop)** — `return true` path with zero assertions (2a):
```typescript
it('priority correctness', () => {
  fc.assert(
    fc.property(gameKindGen, eventTypeGen, (gameKind, eventType) => {
      if (hasGameSpecific && isPlatformEvent) {
        expect(result).toEqual(gameSpecificMeta);
        return true;
      }
      return true;  // most inputs hit this path — 0 assertions
    }),
  );
});
```

**Before (slop)** — zero-variation generators (2b):
```typescript
it('default constructor', () => {
  fc.assert(
    fc.property(fc.constant(undefined), (_ignored) => {
      const chain = new EventHashChain();
      expect(chain.getSemanticHash()).toBeUndefined();
      // fc.constant = same test every run
    }),
  );
});
```

**After (fixed)** — assert on all paths with real generators:
```typescript
it('priority correctness', () => {
  fc.assert(
    fc.property(gameKindGen, eventTypeGen, (gameKind, eventType) => {
      const result = resolvePriority(gameKind, eventType);
      expect(result).toBeDefined();
      expect(typeof result.priority).toBe('number');
    }),
  );
});
```

---

### 17. no_production_call

**Before (slop)** — test only exercises builtins, no production function called:
```typescript
it('expert-level weights must always yield negative net score', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: -100, max: -50 }),
      fc.integer({ min: 20, max: 49 }),
      (breakingPenalty, creationBonus) => {
        const netScore = breakingPenalty + creationBonus;
        return netScore < 0;  // pure arithmetic — no production function
      },
    ),
  );
});
```

**After (fixed)** — call the actual scoring function:
```typescript
it('expert-level weights must always yield negative net score', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: -100, max: -50 }),
      fc.integer({ min: 20, max: 49 }),
      (breakingPenalty, creationBonus) => {
        const score = computeNetScore(breakingPenalty, creationBonus);
        return score < 0;
      },
    ),
  );
});
```

---

### 18. impossible_assertion

**Before (slop)** — assertion that is mathematically impossible to fail:
```typescript
expect(Object.keys(aliasToCanonical).length).toBeGreaterThanOrEqual(0);
// .length is always >= 0 — this CANNOT fail
```

**After (fixed)** — assert on a specific expected length:
```typescript
expect(Object.keys(aliasToCanonical).length).toBeGreaterThanOrEqual(1);
// or assert the exact count:
expect(Object.keys(aliasToCanonical)).toHaveLength(5);
```
