/**
 * Test Fixtures for Pairwise Combinatorial Testing
 *
 * Helpers for generating and running pairwise test matrices.
 *
 * Framework-agnostic: Works with Vitest, Jest, Node test runner.
 *
 * @example
 * import { generatePairwiseMatrix } from './pairwise.ts';
 * import { createPairwiseTestCases } from './test-fixtures.ts';
 *
 * const matrix = generatePairwiseMatrix({ auth: ['none', 'token'], payload: ['valid', 'invalid'] });
 * const cases = createPairwiseTestCases(matrix, (tc) => ({ status: tc.auth === 'none' ? 401 : 200 }));
 * it.each(cases)('$name', ({ auth, payload, expected }) => { ... });
 */

/**
 * Factor definition for pairwise testing
 */
export interface PairwiseFactors {
  [factorName: string]: string[];
}

/**
 * Test case generated from pairwise matrix
 */
export interface PairwiseTestCase {
  name: string;
  [factorName: string]: string;
}

/**
 * Generate test case name from factor values
 */
export function generateTestCaseName(testCase: Record<string, string>): string {
  return Object.entries(testCase)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}

/**
 * Create it.each compatible test cases from pairwise matrix
 */
export function createPairwiseTestCases<T extends Record<string, string>>(
  matrix: T[],
  expectedFn: (testCase: T) => unknown,
): Array<T & { name: string; expected: unknown }> {
  return matrix.map((testCase) => ({
    ...testCase,
    name: generateTestCaseName(testCase),
    expected: expectedFn(testCase),
  }));
}
