---
name: zod-contract-testing
description: Validates Zod schema parsing at boundaries. Tests valid/invalid inputs, schema evolution, refinement coverage, and compound state matrices (2^N optional field combinations).
---

# Zod Contract Testing

Test schemas at boundaries — not just happy-path inputs.

Schemas define contracts between systems. A schema that accepts invalid data is a security hole. A schema that rejects valid data is a broken integration. This skill teaches you to systematically test schemas at system boundaries.

**When to use**: Testing API request/response schemas, WebSocket message validation, database record parsing, external data ingestion, any Zod schema at a system boundary.

**When not to use**: Internal type assertions, UI component props, type definitions without runtime validation.

## Rationalizations (Do Not Skip)

| Rationalization | Why It's Wrong | Required Action |
|-----------------|----------------|-----------------|
| "The type system ensures correctness" | TypeScript doesn't exist at runtime | Test Zod parsing with real data |
| "I tested valid inputs" | Invalid inputs cause production errors | Test rejection of invalid inputs |
| "Refinements are simple" | `.refine()` failures are easy to miss | Test BOTH passing and failing cases |
| "Optional fields are optional" | 2^N combinations have hidden bugs | Use compound state matrix |

---

## Included Utilities

```typescript
import {
  testValidInput,
  testInvalidInput,
  testSchemaEvolution,
  testRefinement,
  generateCompoundStateMatrix,
  formatStateMatrix,
  applyCompoundState,
} from './schema-boundary.ts';
```

## Core Workflow

### Step 1: Test Valid Inputs

Verify the schema accepts all valid input shapes:

```typescript
import { z } from 'zod';

const UserSchema = z.object({
  name: z.string(),
  age: z.number().optional(),
});

it('accepts valid user', () => {
  testValidInput(UserSchema, { name: 'Alice', age: 30 });
  testValidInput(UserSchema, { name: 'Bob' });  // age optional
});
```

### Step 2: Test Invalid Inputs

Verify the schema rejects invalid data and errors at the correct path:

```typescript
it('rejects missing required field', () => {
  testInvalidInput(UserSchema, {}, 'name');  // Error at 'name' path
});

it('rejects wrong type', () => {
  testInvalidInput(UserSchema, { name: 123 }, 'name');
});

it('rejects extra invalid fields', () => {
  // Zod strips extra fields by default, so this passes
  // Use .strict() if you want to reject unknown fields
});
```

### Step 3: Test Schema Evolution

When schemas change, old serialized data must still parse:

```typescript
// Old schema: { name: string }
// New schema: { name: string, email?: string }

const NewUserSchema = z.object({
  name: z.string(),
  email: z.string().email().optional(),
});

it('backward compatible with old data', () => {
  const oldData = { name: 'Alice' };  // No email field
  testSchemaEvolution(NewUserSchema, oldData);
});
```

### Step 4: Test Refinements

Every `.refine()` MUST have tests for both passing and failing cases:

```typescript
const PositiveNumberSchema = z.object({
  value: z.number().refine(n => n > 0, 'Value must be positive'),
});

it('refinement: positive vs non-positive', () => {
  testRefinement(
    PositiveNumberSchema,
    { value: 10 },           // Passing case
    { value: -5 },           // Failing case
    'must be positive',      // Expected error message
  );
});
```

### Step 5: Generate Compound State Matrix

For schemas with N optional fields, there are 2^N possible combinations. Test them all:

```typescript
// Cell schema: value?, candidates?, isGiven?
// 2^3 = 8 combinations

const matrix = generateCompoundStateMatrix(['value', 'candidates', 'isGiven']);
console.log(formatStateMatrix(matrix));
/*
| # | value | candidates | isGiven | Label |
|---|-------|------------|---------|-------|
| 0 | -     | -          | -       | (empty) |
| 1 | Y     | -          | -       | value |
| 2 | -     | Y          | -       | candidates |
| 3 | Y     | Y          | -       | value + candidates |
| 4 | -     | -          | Y       | isGiven |
| 5 | Y     | -          | Y       | value + isGiven |
| 6 | -     | Y          | Y       | candidates + isGiven |
| 7 | Y     | Y          | Y       | value + candidates + isGiven |
*/
```

### Step 6: Apply Matrix to Schema Tests

Generate test inputs from the matrix:

```typescript
const CellSchema = z.object({
  value: z.number().optional(),
  candidates: z.array(z.number()).optional(),
  isGiven: z.boolean().optional(),
}).refine(
  cell => !(cell.isGiven && cell.value === undefined),
  'Given cells must have a digit value',
);

describe('cell schema compound states', () => {
  const matrix = generateCompoundStateMatrix(['value', 'candidates', 'isGiven']);
  const template = { value: 5, candidates: [1, 3, 7], isGiven: true };

  for (const entry of matrix) {
    const input = applyCompoundState(entry, template);
    const shouldFail = input.isGiven && input.value === undefined;

    it(`${entry.label}: ${shouldFail ? 'rejects' : 'accepts'}`, () => {
      if (shouldFail) {
        testInvalidInput(CellSchema, input);
      } else {
        testValidInput(CellSchema, input);
      }
    });
  }
});
```

---

## Compound State Matrix Decision

| Optional Fields | Combinations | Testing Approach |
|-----------------|--------------|------------------|
| 0-2 | 1-4 | Enumerate manually |
| 3 | 8 | Use matrix, manageable |
| 4 | 16 | Use matrix, essential |
| 5+ | 32+ | Use matrix + classify into valid/invalid buckets |

---

## Violation Rules

### missing_invalid_input_test
Every Zod schema MUST have tests for invalid inputs, not just valid ones.
**Severity**: must-fail

### missing_refinement_coverage
Every `.refine()` or `.superRefine()` MUST have tests for both the passing AND failing case.
**Severity**: must-fail

### missing_compound_state_test
Schemas with 3+ optional fields MUST use compound state matrix to cover all combinations.
**Severity**: must-fail

### schema_not_at_boundary
Zod parsing MUST happen at system boundaries (API handlers, WebSocket messages, database reads), not inside business logic.
**Severity**: should-fail

### type_assertion_instead_of_parse
Use `Schema.parse()` or `Schema.safeParse()`, NEVER `as Type` casts for external data.
**Severity**: must-fail

---

## Companion Skills

This skill teaches **testing methodology**, not Zod API usage. For general Zod guidance, pair with a Zod API reference skill:

- Search `zod` on [skills.sh](https://skills.sh) for schema authoring, transforms, error handling, and framework integrations
- Our utilities work with any Zod version (v3, v4) via the `ZodLikeSchema` interface — no version lock-in

---

## Quick Reference

| Utility | When | Example |
|---------|------|---------|
| `testValidInput` | Verify acceptance | `testValidInput(schema, { name: 'Alice' })` |
| `testInvalidInput` | Verify rejection | `testInvalidInput(schema, {}, 'name')` |
| `testSchemaEvolution` | Backward compat | `testSchemaEvolution(newSchema, oldData)` |
| `testRefinement` | Pass + fail | `testRefinement(schema, passing, failing, message)` |
| `generateCompoundStateMatrix` | Optional fields | `generateCompoundStateMatrix(['a', 'b', 'c'])` |
| `applyCompoundState` | Generate input | `applyCompoundState(entry, template)` |

See [patterns.md](./references/patterns.md) for Zod-specific patterns, boundary testing methodology, and integration with TypeScript strict mode.
