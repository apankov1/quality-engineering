/**
 * Pairwise Test Matrix Generator
 *
 * Generates minimal test cases that cover all pairs of factor values.
 * Uses a greedy algorithm that's deterministic and fast for typical test scenarios.
 *
 * Zero dependencies. Works with any test framework.
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
 * Generate all pairs that need to be covered
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
 * Create a canonical key for a pair
 */
function pairKey(factorA: string, valueA: string, factorB: string, valueB: string): string {
  if (factorA < factorB) {
    return `${factorA}:${valueA}|${factorB}:${valueB}`;
  }
  return `${factorB}:${valueB}|${factorA}:${valueA}`;
}

/**
 * Count how many uncovered pairs this test case would cover
 */
function countNewPairs(
  testCase: TestCase,
  uncoveredPairs: Set<string>,
  factorNames: string[],
): number {
  let count = 0;

  for (let i = 0; i < factorNames.length; i++) {
    for (let j = i + 1; j < factorNames.length; j++) {
      const factorA = factorNames[i];
      const factorB = factorNames[j];
      const key = pairKey(factorA, testCase[factorA], factorB, testCase[factorB]);

      if (uncoveredPairs.has(key)) {
        count++;
      }
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
 * Generate all possible test cases (Cartesian product)
 */
function generateAllTestCases(factors: FactorValues): TestCase[] {
  const factorNames = Object.keys(factors);

  if (factorNames.length === 0) {
    return [{}];
  }

  const [firstFactor, ...restFactors] = factorNames;
  const restObject: FactorValues = {};
  for (const f of restFactors) {
    restObject[f] = factors[f];
  }

  const restCases = generateAllTestCases(restObject);
  const result: TestCase[] = [];

  for (const value of factors[firstFactor]) {
    for (const restCase of restCases) {
      result.push({ [firstFactor]: value, ...restCase });
    }
  }

  return result;
}

/**
 * Generate minimal pairwise test matrix using greedy algorithm.
 *
 * The algorithm:
 * 1. Generate all pairs that need coverage
 * 2. While uncovered pairs exist:
 *    a. Find test case that covers most uncovered pairs
 *    b. Add it to result
 *    c. Mark its pairs as covered
 *
 * This produces a minimal or near-minimal set in O(n * p) where
 * n = total test cases, p = total pairs.
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
  const allTestCases = generateAllTestCases(factors);
  const result: TestCase[] = [];

  while (uncoveredPairs.size > 0) {
    let bestCase: TestCase | null = null;
    let bestCount = 0;

    for (const testCase of allTestCases) {
      const count = countNewPairs(testCase, uncoveredPairs, factorNames);
      if (count > bestCount) {
        bestCount = count;
        bestCase = testCase;
      }
    }

    if (bestCase === null || bestCount === 0) {
      break;
    }

    result.push(bestCase);
    markPairsCovered(bestCase, uncoveredPairs, factorNames);
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
      lines.push(`    ${key}: '${value}',`);
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

  console.log('\n=== As Test Cases ===\n');
  console.log(formatAsTestCases(matrix));
}
