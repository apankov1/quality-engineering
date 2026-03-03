/**
 * Zod Contract Testing: Schema Boundary Utilities
 *
 * Provides reusable patterns for:
 * - Valid/invalid input testing at schema boundaries
 * - Schema evolution and backward compatibility
 * - Refinement testing (both pass and fail cases)
 * - Compound state matrix generation (2^N optional field combinations)
 *
 * Requires Zod as a peer dependency for actual schema testing.
 * This module provides the test structure patterns.
 *
 * @example
 * import { testValidInput, testInvalidInput, generateCompoundStateMatrix } from './schema-boundary';
 * import { z } from 'zod';
 *
 * const schema = z.object({ name: z.string(), age: z.number().optional() });
 * testValidInput(schema, { name: 'Alice', age: 30 });
 * testInvalidInput(schema, { age: 'not a number' }, 'name');
 *
 * // Generate all combinations of optional fields
 * const matrix = generateCompoundStateMatrix(['value', 'candidates', 'isGiven']);
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Minimal Zod-like schema interface for generic typing.
 *
 * This allows the utilities to work with any Zod schema without
 * requiring Zod as a direct dependency.
 */
export interface ZodLikeSchema<T = unknown> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: { issues: ZodIssue[] } };
  parse(data: unknown): T;
}

/**
 * Zod issue type (simplified).
 */
export interface ZodIssue {
  path: (string | number)[];
  message: string;
  code: string;
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Test that a schema accepts valid input.
 *
 * @throws Error if parse fails
 */
export function testValidInput<T>(schema: ZodLikeSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  [${i.path.join(".")}] ${i.message}`).join("\n");
    throw new Error(`Expected valid input to parse successfully:\n${issues}\nInput: ${JSON.stringify(input)}`);
  }
  return result.data;
}

/**
 * Test that a schema rejects invalid input.
 *
 * @param schema - The Zod schema to test
 * @param input - Invalid input that should fail
 * @param expectedPath - Optional path where error should occur (e.g., 'name' or 'users.0.email')
 */
export function testInvalidInput<T>(
  schema: ZodLikeSchema<T>,
  input: unknown,
  expectedPath?: string,
): { issues: ZodIssue[] } {
  const result = schema.safeParse(input);

  if (result.success) {
    throw new Error(`Expected invalid input to fail parsing, but it succeeded:\nInput: ${JSON.stringify(input)}`);
  }

  if (expectedPath) {
    const pathParts = expectedPath.split(".");
    const hasMatchingPath = result.error.issues.some((i) => {
      const issuePath = i.path.map(String);
      return pathParts.every((part, idx) => issuePath[idx] === part);
    });

    if (!hasMatchingPath) {
      const actualPaths = result.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Expected error at path "${expectedPath}", but got paths: [${actualPaths}]`);
    }
  }

  return { issues: result.error.issues };
}

/**
 * Test schema backward compatibility with old data.
 *
 * Use this to verify that schema changes don't break existing serialized data.
 */
export function testSchemaEvolution<T>(schema: ZodLikeSchema<T>, oldInput: unknown): T {
  try {
    return testValidInput(schema, oldInput);
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    throw new Error(`Schema evolution failed - old data no longer parses:\n${err}`);
  }
}

export interface VersionedSchemaCase<T = unknown> {
  version: string;
  schema: ZodLikeSchema<T>;
  fixtures: unknown[];
}

export interface VersionCompatibilityCell {
  fromVersion: string;
  toVersion: string;
  compatible: boolean;
  passed: number;
  total: number;
  failures: Array<{
    fixtureIndex: number;
    issues: ZodIssue[];
  }>;
}

/**
 * Build a version compatibility matrix by testing each version's fixtures
 * against every schema version in the provided sequence.
 */
export function generateVersionCompatibilityMatrix(versions: VersionedSchemaCase[]): VersionCompatibilityCell[] {
  const cells: VersionCompatibilityCell[] = [];

  for (const from of versions) {
    for (const to of versions) {
      const failures: VersionCompatibilityCell["failures"] = [];
      let passed = 0;

      from.fixtures.forEach((fixture, fixtureIndex) => {
        const result = to.schema.safeParse(fixture);
        if (result.success) {
          passed++;
          return;
        }
        failures.push({
          fixtureIndex,
          issues: result.error.issues,
        });
      });

      cells.push({
        fromVersion: from.version,
        toVersion: to.version,
        compatible: failures.length === 0,
        passed,
        total: from.fixtures.length,
        failures,
      });
    }
  }

  return cells;
}

/**
 * Assert backward compatibility across version jumps.
 *
 * For each from-version, newer schemas up to `maxForwardDistance` must parse
 * all fixtures emitted by that from-version.
 */
export function assertVersionCompatibility(
  versions: VersionedSchemaCase[],
  maxForwardDistance = Number.POSITIVE_INFINITY,
): VersionCompatibilityCell[] {
  const matrix = generateVersionCompatibilityMatrix(versions);
  const versionIndex = new Map(versions.map((version, idx) => [version.version, idx]));

  const failures = matrix.filter((cell) => {
    const fromIndex = versionIndex.get(cell.fromVersion);
    const toIndex = versionIndex.get(cell.toVersion);
    if (fromIndex === undefined || toIndex === undefined) return false;
    const forwardDistance = toIndex - fromIndex;
    return forwardDistance > 0 && forwardDistance <= maxForwardDistance && !cell.compatible;
  });

  if (failures.length > 0) {
    const details = failures
      .map((failure) => {
        const issueDetails = failure.failures
          .map((entry) => {
            const issueText = entry.issues.map((issue) => `[${issue.path.join(".")}] ${issue.message}`).join("; ");
            return `fixture #${entry.fixtureIndex}: ${issueText}`;
          })
          .join(" | ");
        return `${failure.fromVersion} -> ${failure.toVersion}: ${issueDetails}`;
      })
      .join("\n");
    throw new Error(`Version compatibility failed:\n${details}`);
  }

  return matrix;
}

// ============================================================================
// REFINEMENT TESTING
// ============================================================================

/**
 * Test a schema refinement with both passing and failing cases.
 *
 * Refinements are `.refine()` or `.superRefine()` validations.
 * Each refinement MUST have tests for both the passing and failing case.
 */
export function testRefinement<T>(
  schema: ZodLikeSchema<T>,
  passingInput: unknown,
  failingInput: unknown,
  expectedMessage?: string,
): { passResult: T; failIssues: ZodIssue[] } {
  // Test passing case
  const passResult = testValidInput(schema, passingInput);

  // Test failing case
  const failResult = schema.safeParse(failingInput);
  if (failResult.success) {
    throw new Error(`Refinement test: expected failing input to be rejected:\nInput: ${JSON.stringify(failingInput)}`);
  }

  // Check for expected message if provided
  if (expectedMessage) {
    const hasMessage = failResult.error.issues.some((i) => i.message.includes(expectedMessage));
    if (!hasMessage) {
      const actualMessages = failResult.error.issues.map((i) => i.message).join(", ");
      throw new Error(`Expected refinement message "${expectedMessage}", got: [${actualMessages}]`);
    }
  }

  return { passResult, failIssues: failResult.error.issues };
}

// ============================================================================
// COMPOUND STATE MATRIX
// ============================================================================

/**
 * A single combination in the compound state matrix.
 *
 * Each entry represents one of the 2^N combinations of optional field presence.
 */
export interface CompoundStateEntry {
  /** Which fields are present (true) or absent (false) */
  fields: Record<string, boolean>;
  /** Human-readable label for this combination */
  label: string;
  /** Binary index (0 to 2^N - 1) */
  index: number;
}

const MAX_COMPOUND_FIELDS = 16;

/**
 * Generate all 2^N combinations of optional field presence.
 *
 * For a schema with N optional fields, this generates all possible
 * combinations of which fields are present vs absent. Use this to
 * ensure complete coverage of compound states.
 *
 * @example
 * const matrix = generateCompoundStateMatrix(['value', 'candidates', 'isGiven']);
 * // Returns 8 entries (2^3):
 * // { value: false, candidates: false, isGiven: false } // empty
 * // { value: true, candidates: false, isGiven: false }  // value only
 * // { value: false, candidates: true, isGiven: false }  // candidates only
 * // ... and so on
 */
export function generateCompoundStateMatrix(fieldNames: string[]): CompoundStateEntry[] {
  const n = fieldNames.length;
  if (n > MAX_COMPOUND_FIELDS) {
    throw new Error(
      `Too many optional fields (${n}). Maximum is ${MAX_COMPOUND_FIELDS} to avoid runaway 2^N matrix size.`,
    );
  }
  const count = 2 ** n;
  const entries: CompoundStateEntry[] = [];

  for (let i = 0; i < count; i++) {
    const fields: Record<string, boolean> = {};
    const presentFields: string[] = [];

    for (let j = 0; j < n; j++) {
      const isPresent = ((i >> j) & 1) === 1;
      fields[fieldNames[j]] = isPresent;
      if (isPresent) {
        presentFields.push(fieldNames[j]);
      }
    }

    const label = presentFields.length === 0 ? "(empty)" : presentFields.join(" + ");

    entries.push({ fields, label, index: i });
  }

  return entries;
}

/**
 * Format a compound state matrix as a markdown table.
 *
 * Useful for documentation and debugging.
 */
export function formatStateMatrix(entries: CompoundStateEntry[]): string {
  if (entries.length === 0) return "(empty matrix)";

  const fieldNames = Object.keys(entries[0].fields);
  const header = `| # | ${fieldNames.join(" | ")} | Label |`;
  const separator = `|${"-".repeat(3)}|${fieldNames.map(() => "-".repeat(3)).join("|")}|${"-".repeat(10)}|`;

  const rows = entries.map((e) => {
    const values = fieldNames.map((f) => (e.fields[f] ? "Y" : "-"));
    return `| ${e.index} | ${values.join(" | ")} | ${e.label} |`;
  });

  return [header, separator, ...rows].join("\n");
}

/**
 * Create test input based on a compound state entry.
 *
 * Takes a template object with all possible field values,
 * and returns a new object with only the fields marked as present.
 */
export function applyCompoundState<T extends Record<string, unknown>>(
  entry: CompoundStateEntry,
  template: T,
): Partial<T> {
  const result: Partial<T> = {};

  for (const [key, isPresent] of Object.entries(entry.fields)) {
    if (isPresent && key in template) {
      result[key as keyof T] = template[key as keyof T];
    }
  }

  return result;
}
