import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyCompoundState,
  formatStateMatrix,
  generateCompoundStateMatrix,
  testInvalidInput,
  testRefinement,
  testSchemaEvolution,
  testValidInput,
} from "./schema-boundary.ts";
import type { ZodLikeSchema } from "./schema-boundary.ts";

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a simple schema for testing that validates object shape.
 */
function createObjectSchema<T extends Record<string, "string" | "number" | "boolean" | "optional">>(
  shape: T,
): ZodLikeSchema<unknown> {
  return {
    safeParse(data: unknown) {
      if (typeof data !== "object" || data === null) {
        return {
          success: false,
          error: { issues: [{ path: [], message: "Expected object", code: "invalid_type" }] },
        };
      }

      const issues: Array<{ path: string[]; message: string; code: string }> = [];
      const obj = data as Record<string, unknown>;

      for (const [key, type] of Object.entries(shape)) {
        if (type === "optional") continue;

        if (!(key in obj)) {
          issues.push({ path: [key], message: "Required field missing", code: "invalid_type" });
          continue;
        }

        const actual = typeof obj[key];
        if (actual !== type) {
          issues.push({ path: [key], message: `Expected ${type}, got ${actual}`, code: "invalid_type" });
        }
      }

      if (issues.length > 0) {
        return { success: false, error: { issues } };
      }

      return { success: true, data: obj as T };
    },
    parse(data: unknown) {
      const result = this.safeParse(data);
      if (!result.success) {
        throw new Error(result.error.issues.map((i) => i.message).join(", "));
      }
      return result.data;
    },
  };
}

/**
 * Create a schema with a refinement for testing.
 */
function createRefinedSchema(): ZodLikeSchema<{ value: number }> {
  return {
    safeParse(data: unknown) {
      if (typeof data !== "object" || data === null) {
        return {
          success: false,
          error: { issues: [{ path: [], message: "Expected object", code: "invalid_type" }] },
        };
      }

      const obj = data as Record<string, unknown>;
      if (typeof obj.value !== "number") {
        return {
          success: false,
          error: { issues: [{ path: ["value"], message: "Expected number", code: "invalid_type" }] },
        };
      }

      // Refinement: value must be positive
      if (obj.value <= 0) {
        return {
          success: false,
          error: { issues: [{ path: ["value"], message: "Value must be positive", code: "custom" }] },
        };
      }

      return { success: true, data: { value: obj.value } };
    },
    parse(data: unknown) {
      const result = this.safeParse(data);
      if (!result.success) {
        throw new Error(result.error.issues.map((i) => i.message).join(", "));
      }
      return result.data;
    },
  };
}

// ============================================================================
// VALID/INVALID INPUT TESTING
// ============================================================================

describe("testValidInput", () => {
  const schema = createObjectSchema({ name: "string", age: "number" });

  // Defect: Must pass when input is valid
  it("passes for valid input", () => {
    const result = testValidInput(schema, { name: "Alice", age: 30 });
    assert.ok(result);
  });

  // Defect: Must throw with details when input is invalid
  it("throws for invalid input with issue details", () => {
    assert.throws(() => testValidInput(schema, { name: 123, age: "thirty" }), /Expected string.*Expected number/s);
  });

  // Defect: Must throw for missing required fields
  it("throws for missing required fields", () => {
    assert.throws(() => testValidInput(schema, { name: "Alice" }), /Required field missing/);
  });
});

describe("testInvalidInput", () => {
  const schema = createObjectSchema({ name: "string", age: "number" });

  // Defect: Must pass when input is correctly rejected
  it("passes when input is rejected", () => {
    const result = testInvalidInput(schema, { name: 123 });
    assert.ok(result.issues.length > 0);
  });

  // Defect: Must throw when input is unexpectedly valid
  it("throws when input is unexpectedly valid", () => {
    assert.throws(() => testInvalidInput(schema, { name: "Alice", age: 30 }), /Expected invalid input to fail parsing/);
  });

  // Defect: Must verify error path when specified
  it("verifies error occurs at expected path", () => {
    const result = testInvalidInput(schema, { name: "Alice", age: "not a number" }, "age");
    assert.ok(result.issues.some((i) => i.path.includes("age")));
  });

  // Defect: Must throw when error at wrong path
  it("throws when error at wrong path", () => {
    assert.throws(
      () => testInvalidInput(schema, { name: 123, age: 30 }, "age"),
      /Expected error at path "age", but got paths: \[name\]/,
    );
  });
});

// ============================================================================
// SCHEMA EVOLUTION
// ============================================================================

describe("testSchemaEvolution", () => {
  // Defect: Must pass when old data still parses
  it("passes when old data parses with new schema", () => {
    const schema = createObjectSchema({ name: "string", age: "optional" });
    const oldData = { name: "Alice" }; // No age field

    const result = testSchemaEvolution(schema, oldData);
    assert.ok(result);
  });

  // Defect: Must throw with context when evolution breaks
  it("throws when schema evolution breaks old data", () => {
    const newSchema = createObjectSchema({ name: "string", age: "number" }); // age now required
    const oldData = { name: "Alice" }; // No age field

    assert.throws(() => testSchemaEvolution(newSchema, oldData), /Schema evolution failed.*Required field missing/s);
  });
});

// ============================================================================
// REFINEMENT TESTING
// ============================================================================

describe("testRefinement", () => {
  const schema = createRefinedSchema();

  // Defect: Must test both pass and fail cases
  it("validates passing and failing cases", () => {
    const { passResult, failIssues } = testRefinement(
      schema,
      { value: 10 }, // Passing: positive
      { value: -5 }, // Failing: negative
      "must be positive",
    );

    assert.equal(passResult.value, 10);
    assert.ok(failIssues.some((i) => i.message.includes("must be positive")));
  });

  // Defect: Must throw when passing input fails
  it("throws when passing input unexpectedly fails", () => {
    assert.throws(() => testRefinement(schema, { value: -1 }, { value: -1 }), /Expected valid input to parse/);
  });

  // Defect: Must throw when failing input passes
  it("throws when failing input unexpectedly passes", () => {
    assert.throws(() => testRefinement(schema, { value: 5 }, { value: 10 }), /expected failing input to be rejected/);
  });

  // Defect: Must verify expected error message
  it("throws when error message doesn't match", () => {
    assert.throws(
      () => testRefinement(schema, { value: 10 }, { value: -5 }, "wrong expected message"),
      /Expected refinement message/,
    );
  });
});

// ============================================================================
// COMPOUND STATE MATRIX
// ============================================================================

describe("generateCompoundStateMatrix", () => {
  // Defect: Must generate 2^N combinations
  it("generates 2^0 = 1 entry for 0 fields", () => {
    const matrix = generateCompoundStateMatrix([]);
    assert.equal(matrix.length, 1);
    assert.deepEqual(matrix[0].fields, {});
    assert.equal(matrix[0].label, "(empty)");
  });

  // Defect: 2^1 = 2 for 1 field
  it("generates 2^1 = 2 entries for 1 field", () => {
    const matrix = generateCompoundStateMatrix(["value"]);
    assert.equal(matrix.length, 2);

    const absent = matrix.find((e) => !e.fields.value);
    const present = matrix.find((e) => e.fields.value);

    assert.ok(absent);
    assert.ok(present);
    assert.equal(absent.label, "(empty)");
    assert.equal(present.label, "value");
  });

  // Defect: 2^2 = 4 for 2 fields
  it("generates 2^2 = 4 entries for 2 fields", () => {
    const matrix = generateCompoundStateMatrix(["a", "b"]);
    assert.equal(matrix.length, 4);

    // Check all combinations exist
    const combinations = matrix.map((e) => `${e.fields.a ? "a" : "-"}${e.fields.b ? "b" : "-"}`);
    assert.deepEqual(combinations.sort(), ["--", "-b", "a-", "ab"].sort());
  });

  // Defect: 2^3 = 8 for 3 fields
  it("generates 2^3 = 8 entries for 3 fields", () => {
    const matrix = generateCompoundStateMatrix(["value", "candidates", "isGiven"]);
    assert.equal(matrix.length, 8);

    // Verify specific combinations
    const valueOnly = matrix.find((e) => e.fields.value && !e.fields.candidates && !e.fields.isGiven);
    const candidatesOnly = matrix.find((e) => !e.fields.value && e.fields.candidates && !e.fields.isGiven);
    const all = matrix.find((e) => e.fields.value && e.fields.candidates && e.fields.isGiven);

    assert.ok(valueOnly);
    assert.ok(candidatesOnly);
    assert.ok(all);

    assert.equal(valueOnly.label, "value");
    assert.equal(candidatesOnly.label, "candidates");
    assert.equal(all.label, "value + candidates + isGiven");
  });

  // Defect: 2^4 = 16 for 4 fields
  it("generates 2^4 = 16 entries for 4 fields", () => {
    const matrix = generateCompoundStateMatrix(["a", "b", "c", "d"]);
    assert.equal(matrix.length, 16);
  });

  // Defect: Index must be sequential 0 to 2^N - 1
  it("assigns sequential indices", () => {
    const matrix = generateCompoundStateMatrix(["x", "y"]);
    const indices = matrix.map((e) => e.index).sort((a, b) => a - b);
    assert.deepEqual(indices, [0, 1, 2, 3]);
  });
});

describe("formatStateMatrix", () => {
  // Defect: Must format as markdown table
  it("formats as markdown table with headers", () => {
    const matrix = generateCompoundStateMatrix(["a", "b"]);
    const output = formatStateMatrix(matrix);

    assert.ok(output.includes("| # |"));
    assert.ok(output.includes("| a |"));
    assert.ok(output.includes("| b |"));
    assert.ok(output.includes("| Label |"));
    assert.ok(output.includes("---"));
  });

  // Defect: Must handle empty matrix
  it("handles empty matrix", () => {
    const output = formatStateMatrix([]);
    assert.equal(output, "(empty matrix)");
  });
});

describe("applyCompoundState", () => {
  // Defect: Must include only present fields
  it("includes only present fields from template", () => {
    const entry = { fields: { a: true, b: false, c: true }, label: "a + c", index: 5 };
    const template = { a: 1, b: 2, c: 3 };

    const result = applyCompoundState(entry, template);

    assert.deepEqual(result, { a: 1, c: 3 });
  });

  // Defect: Must return empty object when all absent
  it("returns empty object when all fields absent", () => {
    const entry = { fields: { a: false, b: false }, label: "(empty)", index: 0 };
    const template = { a: 1, b: 2 };

    const result = applyCompoundState(entry, template);

    assert.deepEqual(result, {});
  });
});

// ============================================================================
// INTEGRATION: SCHEMA BOUNDARY WORKFLOW
// ============================================================================

describe("integration: cell schema compound state testing", () => {
  /**
   * Example: Testing a cell schema with optional value, candidates, and isGiven fields.
   * This simulates how you'd use the compound state matrix for exhaustive testing.
   */

  // Mock cell schema: value required if isGiven, candidates allowed anytime
  const cellSchema: ZodLikeSchema<unknown> = {
    safeParse(data: unknown) {
      if (typeof data !== "object" || data === null) {
        return {
          success: false,
          error: { issues: [{ path: [], message: "Expected object", code: "invalid_type" }] },
        };
      }

      const obj = data as Record<string, unknown>;
      const issues: Array<{ path: string[]; message: string; code: string }> = [];

      // Refinement: given cells must have a value
      if (obj.isGiven === true && obj.value === undefined) {
        issues.push({ path: ["value"], message: "Given cells must have a digit value", code: "custom" });
      }

      if (issues.length > 0) {
        return { success: false, error: { issues } };
      }

      return { success: true, data: obj };
    },
    parse(data: unknown) {
      const result = this.safeParse(data);
      if (!result.success) {
        throw new Error(result.error.issues.map((i) => i.message).join(", "));
      }
      return result.data;
    },
  };

  // Defect: Compound matrix must cover all valid combinations
  it("tests all valid cell state combinations", () => {
    const matrix = generateCompoundStateMatrix(["value", "candidates", "isGiven"]);
    const template = { value: 5, candidates: [1, 3, 7], isGiven: true };

    let validCount = 0;
    let invalidCount = 0;

    for (const entry of matrix) {
      const input = applyCompoundState(entry, template);
      const result = cellSchema.safeParse(input);

      // Given without value should fail
      if (input.isGiven === true && input.value === undefined) {
        assert.equal(result.success, false, `Entry ${entry.label} should fail: given without value`);
        invalidCount++;
      } else {
        // All other combinations should pass
        if (!result.success) {
          assert.fail(`Entry ${entry.label} unexpectedly failed: ${JSON.stringify(input)}`);
        }
        validCount++;
      }
    }

    // 8 combinations, 2 are invalid (isGiven alone, isGiven + candidates without value)
    assert.equal(validCount, 6);
    assert.equal(invalidCount, 2);
  });
});
