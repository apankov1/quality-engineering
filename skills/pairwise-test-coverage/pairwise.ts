/**
 * Pairwise Test Matrix Generator
 *
 * Generates near-minimal test cases that cover all pairs of factor values.
 * Uses an incremental greedy algorithm — never enumerates the Cartesian product.
 *
 * Zero dependencies. Works with any test framework.
 *
 * Complexity: O(result × factors × maxValues) per test case.
 * Handles 8 factors × 8 values (16M Cartesian product) in milliseconds.
 *
 * @example
 * const factors = {
 *   browser: ['chrome', 'firefox', 'safari'],
 *   os: ['windows', 'macos', 'linux'],
 *   viewport: ['mobile', 'tablet', 'desktop'],
 * };
 *
 * const matrix = generatePairwiseMatrix(factors);
 * // Returns ~9 test cases covering all pairs (vs 27 exhaustive)
 */

export type FactorValues = Record<string, string[]>;
export type TestCase = Record<string, string>;

/**
 * Create a canonical key for a pair
 */
function pairKey(factorA: string, valueA: string, factorB: string, valueB: string): string {
  if (factorA < factorB) {
    return `${factorA}:${valueA}|${factorB}:${valueB}`;
  }
  return `${factorB}:${valueB}|${factorA}:${valueA}`;
}

/**
 * Parse a pair key back into its components
 */
function parsePairKey(key: string): [string, string, string, string] {
  const [left, right] = key.split('|');
  const [factorA, valueA] = left.split(':');
  const [factorB, valueB] = right.split(':');
  return [factorA, valueA, factorB, valueB];
}

/**
 * Generate all pairs that need to be covered.
 * O(C(n,2) × v²) — manageable even for large factor sets.
 */
function generateAllPairs(factors: FactorValues): Set<string> {
  const pairs = new Set<string>();
  const factorNames = Object.keys(factors);

  for (let i = 0; i < factorNames.length; i++) {
    for (let j = i + 1; j < factorNames.length; j++) {
      const factorA = factorNames[i];
      const factorB = factorNames[j];

      for (const valueA of factors[factorA]) {
        for (const valueB of factors[factorB]) {
          pairs.add(pairKey(factorA, valueA, factorB, valueB));
        }
      }
    }
  }

  return pairs;
}

/**
 * Count how many uncovered pairs a candidate value would cover,
 * given the values already chosen for preceding factors in this row.
 */
function countNewPairsForValue(
  factorName: string,
  value: string,
  partialCase: TestCase,
  uncoveredPairs: Set<string>,
): number {
  let count = 0;

  for (const [assignedFactor, assignedValue] of Object.entries(partialCase)) {
    const key = pairKey(factorName, value, assignedFactor, assignedValue);
    if (uncoveredPairs.has(key)) {
      count++;
    }
  }

  return count;
}

/**
 * Mark pairs as covered by this test case
 */
function markPairsCovered(
  testCase: TestCase,
  uncoveredPairs: Set<string>,
  factorNames: string[],
): void {
  for (let i = 0; i < factorNames.length; i++) {
    for (let j = i + 1; j < factorNames.length; j++) {
      const factorA = factorNames[i];
      const factorB = factorNames[j];
      const key = pairKey(factorA, testCase[factorA], factorB, testCase[factorB]);
      uncoveredPairs.delete(key);
    }
  }
}

/**
 * Build one test case seeded from an uncovered pair, then greedily fill the rest.
 *
 * 1. Pick an uncovered pair → assign those two factor values
 * 2. For each remaining factor, try every value and pick the one that
 *    covers the most uncovered pairs with already-assigned factors
 *
 * Seeding from an uncovered pair guarantees at least 1 new pair per row,
 * so the algorithm always terminates.
 */
function buildGreedyTestCase(
  factors: FactorValues,
  factorNames: string[],
  uncoveredPairs: Set<string>,
): TestCase {
  const testCase: TestCase = {};

  // Seed from an uncovered pair
  const firstUncovered = uncoveredPairs.values().next().value!;
  const [factorA, valueA, factorB, valueB] = parsePairKey(firstUncovered);
  testCase[factorA] = valueA;
  testCase[factorB] = valueB;

  // Greedily fill remaining factors
  for (const factor of factorNames) {
    if (factor in testCase) continue;

    let bestValue = factors[factor][0];
    let bestCount = -1;

    for (const value of factors[factor]) {
      const count = countNewPairsForValue(factor, value, testCase, uncoveredPairs);
      if (count > bestCount) {
        bestCount = count;
        bestValue = value;
      }
    }

    testCase[factor] = bestValue;
  }

  return testCase;
}

/**
 * Generate near-minimal pairwise test matrix using incremental greedy algorithm.
 *
 * The algorithm builds test cases one at a time, never enumerating the
 * Cartesian product:
 *
 * 1. Generate all pairs that need coverage
 * 2. While uncovered pairs exist:
 *    a. Seed from an uncovered pair (guarantees progress)
 *    b. Greedily fill remaining factors
 *    c. Mark all covered pairs
 *
 * This handles large factor sets (8×8 = 16M Cartesian) in milliseconds.
 */
export function generatePairwiseMatrix(factors: FactorValues): TestCase[] {
  const factorNames = Object.keys(factors);

  // Edge cases
  if (factorNames.length === 0) {
    return [];
  }
  if (factorNames.length === 1) {
    return factors[factorNames[0]].map((v) => ({ [factorNames[0]]: v }));
  }

  const uncoveredPairs = generateAllPairs(factors);
  const result: TestCase[] = [];

  while (uncoveredPairs.size > 0) {
    const testCase = buildGreedyTestCase(factors, factorNames, uncoveredPairs);
    result.push(testCase);
    markPairsCovered(testCase, uncoveredPairs, factorNames);
  }

  return result;
}

/**
 * Format test matrix as markdown table
 */
export function formatAsMarkdownTable(matrix: TestCase[]): string {
  if (matrix.length === 0) {
    return 'No test cases generated';
  }

  const headers = Object.keys(matrix[0]);
  const lines: string[] = [];

  lines.push(`| # | ${headers.join(' | ')} |`);
  lines.push(`|---| ${headers.map(() => '---').join(' | ')} |`);

  matrix.forEach((testCase, index) => {
    const values = headers.map((h) => testCase[h]);
    lines.push(`| ${index + 1} | ${values.join(' | ')} |`);
  });

  return lines.join('\n');
}

/**
 * Format test matrix as TypeScript test cases for it.each
 */
export function formatAsTestCases(matrix: TestCase[], expectedField = 'expected'): string {
  const lines: string[] = ['const testCases = ['];

  matrix.forEach((testCase, index) => {
    const name = Object.entries(testCase)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');

    lines.push(`  {`);
    lines.push(`    name: 'Case ${index + 1}: ${name}',`);

    for (const [key, value] of Object.entries(testCase)) {
      lines.push(`    ${key}: ${JSON.stringify(value)},`);
    }

    lines.push(`    ${expectedField}: { /* TODO: define expected outcome */ },`);
    lines.push(`  },`);
  });

  lines.push('];');

  return lines.join('\n');
}

/**
 * Validate that all pairs are covered by the matrix
 */
export function validateCoverage(
  factors: FactorValues,
  matrix: TestCase[],
): {
  valid: boolean;
  missing: string[];
  coverage: number;
} {
  const allPairs = generateAllPairs(factors);
  const coveredPairs = new Set<string>();
  const factorNames = Object.keys(factors);

  for (const testCase of matrix) {
    for (let i = 0; i < factorNames.length; i++) {
      for (let j = i + 1; j < factorNames.length; j++) {
        const factorA = factorNames[i];
        const factorB = factorNames[j];
        const key = pairKey(factorA, testCase[factorA], factorB, testCase[factorB]);
        coveredPairs.add(key);
      }
    }
  }

  const missing: string[] = [];
  for (const pair of allPairs) {
    if (!coveredPairs.has(pair)) {
      missing.push(pair);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    coverage: ((allPairs.size - missing.length) / allPairs.size) * 100,
  };
}

// CLI usage
if (typeof process !== 'undefined' && process.argv?.[1]?.includes('pairwise')) {
  const compatibilityFactors = {
    browser: ['chrome', 'firefox', 'safari'],
    os: ['windows', 'macos', 'linux'],
    viewport: ['mobile', 'tablet', 'desktop'],
  };

  console.log('=== Browser Compatibility Pairwise Matrix ===\n');
  const matrix = generatePairwiseMatrix(compatibilityFactors);
  console.log(formatAsMarkdownTable(matrix));
  console.log('\n');

  const validation = validateCoverage(compatibilityFactors, matrix);
  console.log(`Coverage: ${validation.coverage.toFixed(1)}%`);
  console.log(`Test cases: ${matrix.length} (vs ${3 * 3 * 3} exhaustive)`);
  console.log(`Valid: ${validation.valid}`);

  if (!validation.valid) {
    console.log('Missing pairs:', validation.missing);
  }

  console.log('\n=== Stress Test: 8 factors × 4 values ===\n');
  const stressFactors: FactorValues = {};
  for (let i = 0; i < 8; i++) {
    stressFactors[`f${i}`] = ['a', 'b', 'c', 'd'];
  }
  const t0 = performance.now();
  const stressMatrix = generatePairwiseMatrix(stressFactors);
  const elapsed = performance.now() - t0;
  const stressValidation = validateCoverage(stressFactors, stressMatrix);
  console.log(`${stressMatrix.length} test cases (vs ${Math.pow(4, 8)} exhaustive)`);
  console.log(`Coverage: ${stressValidation.coverage.toFixed(1)}%`);
  console.log(`Valid: ${stressValidation.valid}`);
  console.log(`Time: ${elapsed.toFixed(1)}ms`);
}
