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
 * Safety: Throws if factors exceed 20 or any factor has more than 50 values.
 * The pair count grows as O(factors² × values²) — 20 factors × 50 values =
 * ~475K pairs (C(20,2) × 50²), which is the practical ceiling for in-memory generation.
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

import { pathToFileURL } from "node:url";

export type FactorValues = Record<string, string[]>;
export type TestCase = Record<string, string>;
type CoverageStrength = 2 | 3;
type InteractionTuple = Array<[string, string]>;

export interface PairwiseOptions {
  /** Coverage strength: 2 = pairwise (default), 3 = three-wise */
  strength?: CoverageStrength;
  /** Optional factor weights for prioritizing critical-factor interactions */
  factorWeights?: Record<string, number>;
}

const DEFAULT_STRENGTH: CoverageStrength = 2;
const MAX_INTERACTIONS = 500_000;

/**
 * Create a canonical key for a k-wise interaction.
 */
function interactionKey(interaction: InteractionTuple): string {
  const normalized = [...interaction].sort(([factorA], [factorB]) => factorA.localeCompare(factorB));
  return JSON.stringify(normalized);
}

/**
 * Parse an interaction key back into its components.
 */
function parseInteractionKey(key: string, cache: Map<string, InteractionTuple>): InteractionTuple {
  const cached = cache.get(key);
  if (cached) return cached;

  let parsed: unknown;
  try {
    parsed = JSON.parse(key);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid pair key: ${msg}`);
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some(
      (entry) =>
        !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || typeof entry[1] !== "string",
    )
  ) {
    throw new Error("Invalid pair key shape");
  }

  const interaction = parsed as InteractionTuple;
  cache.set(key, interaction);
  return interaction;
}

/**
 * Generate k-combinations from an array.
 */
function generateCombinations<T>(items: T[], k: number): T[][] {
  if (k <= 0 || k > items.length) return [];
  const result: T[][] = [];
  const current: T[] = [];

  const visit = (start: number): void => {
    if (current.length === k) {
      result.push([...current]);
      return;
    }
    for (let i = start; i <= items.length - (k - current.length); i++) {
      current.push(items[i]);
      visit(i + 1);
      current.pop();
    }
  };

  visit(0);
  return result;
}

/**
 * Generate all required k-wise interactions for coverage.
 */
function generateAllInteractions(
  factors: FactorValues,
  factorNames: string[],
  strength: CoverageStrength,
): Set<string> {
  const interactions = new Set<string>();
  const factorCombos = generateCombinations(factorNames, strength);

  for (const combo of factorCombos) {
    const current: InteractionTuple = [];
    const build = (idx: number): void => {
      if (idx === combo.length) {
        interactions.add(interactionKey(current));
        if (interactions.size > MAX_INTERACTIONS) {
          throw new Error(
            `Interaction count exceeds practical limit (${MAX_INTERACTIONS}). Reduce factor/value count or use lower strength.`,
          );
        }
        return;
      }

      const factor = combo[idx];
      for (const value of factors[factor]) {
        current.push([factor, value]);
        build(idx + 1);
        current.pop();
      }
    };
    build(0);
  }

  return interactions;
}

function scoreInteraction(interaction: InteractionTuple, weights?: Record<string, number>): number {
  if (!weights) return 1;
  const totalWeight = interaction.reduce((sum, [factor]) => sum + (weights[factor] ?? 1), 0);
  return totalWeight / interaction.length;
}

function orderFactorsByWeight(factorNames: string[], weights?: Record<string, number>): string[] {
  if (!weights) return factorNames;
  return [...factorNames].sort((a, b) => (weights[b] ?? 1) - (weights[a] ?? 1) || a.localeCompare(b));
}

/**
 * Count how many uncovered interactions a candidate value would complete.
 */
function countNewInteractionsForValue(
  factorName: string,
  value: string,
  partialCase: TestCase,
  uncoveredInteractions: Set<string>,
  parseCache: Map<string, InteractionTuple>,
  weights?: Record<string, number>,
): number {
  let score = 0;

  for (const key of uncoveredInteractions) {
    const interaction = parseInteractionKey(key, parseCache);

    let hasCandidateFactor = false;
    let complete = true;
    for (const [factor, interactionValue] of interaction) {
      if (factor === factorName) {
        if (interactionValue !== value) {
          complete = false;
          break;
        }
        hasCandidateFactor = true;
        continue;
      }

      if (partialCase[factor] !== interactionValue) {
        complete = false;
        break;
      }
    }

    if (hasCandidateFactor && complete) {
      score += scoreInteraction(interaction, weights);
    }
  }

  return score;
}

/**
 * Mark interactions as covered by this test case.
 */
function markInteractionsCovered(
  testCase: TestCase,
  uncoveredInteractions: Set<string>,
  factorNames: string[],
  strength: CoverageStrength,
): void {
  const factorCombos = generateCombinations(factorNames, strength);
  for (const combo of factorCombos) {
    const interaction: InteractionTuple = combo.map((factor) => [factor, testCase[factor]]);
    uncoveredInteractions.delete(interactionKey(interaction));
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
  uncoveredInteractions: Set<string>,
  parseCache: Map<string, InteractionTuple>,
  weights?: Record<string, number>,
): TestCase {
  const testCase: TestCase = {};

  // Seed from an uncovered interaction
  const firstUncoveredResult = uncoveredInteractions.values().next();
  if (!firstUncoveredResult.value) throw new Error("No uncovered interactions available");
  const seedInteraction = parseInteractionKey(firstUncoveredResult.value, parseCache);
  for (const [factor, seededValue] of seedInteraction) {
    testCase[factor] = seededValue;
  }

  // Greedily fill remaining factors
  for (const factor of factorNames) {
    if (factor in testCase) continue;

    let bestValue = factors[factor][0];
    let bestScore = -1;

    for (const value of factors[factor]) {
      const score = countNewInteractionsForValue(factor, value, testCase, uncoveredInteractions, parseCache, weights);
      if (score > bestScore) {
        bestScore = score;
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
export function generatePairwiseMatrix(factors: FactorValues, options: PairwiseOptions = {}): TestCase[] {
  const strength = options.strength ?? DEFAULT_STRENGTH;
  if (strength !== 2 && strength !== 3) {
    throw new Error(`Unsupported coverage strength ${String(strength)}. Supported values: 2 or 3.`);
  }

  const factorNames = orderFactorsByWeight(Object.keys(factors), options.factorWeights);

  // Safety rails: prevent runaway generation on extreme inputs
  if (factorNames.length > 20) {
    throw new Error(
      `Too many factors (${factorNames.length}). Maximum is 20. Pair count grows as O(factors² × values²).`,
    );
  }
  const maxValues = Math.max(0, ...factorNames.map((f) => factors[f].length));
  if (maxValues > 50) {
    throw new Error(
      `Factor has too many values (${maxValues}). Maximum is 50. Pair count grows as O(factors² × values²).`,
    );
  }
  if (strength === 3 && factorNames.length < 3) {
    throw new Error("3-wise coverage requires at least 3 factors.");
  }

  // Edge cases
  if (factorNames.length === 0) {
    return [];
  }
  for (const name of factorNames) {
    if (factors[name].length === 0) {
      throw new Error(`Factor "${name}" has no values. Every factor must have at least one value.`);
    }
  }
  if (factorNames.length === 1) {
    return factors[factorNames[0]].map((v) => ({ [factorNames[0]]: v }));
  }

  const uncoveredInteractions = generateAllInteractions(factors, factorNames, strength);
  const parseCache = new Map<string, InteractionTuple>();
  const result: TestCase[] = [];

  while (uncoveredInteractions.size > 0) {
    const testCase = buildGreedyTestCase(
      factors,
      factorNames,
      uncoveredInteractions,
      parseCache,
      options.factorWeights,
    );
    result.push(testCase);
    markInteractionsCovered(testCase, uncoveredInteractions, factorNames, strength);
  }

  return result;
}

export function generateThreewiseMatrix(
  factors: FactorValues,
  options: Omit<PairwiseOptions, "strength"> = {},
): TestCase[] {
  return generatePairwiseMatrix(factors, { ...options, strength: 3 });
}

/**
 * Format test matrix as markdown table
 */
export function formatAsMarkdownTable(matrix: TestCase[]): string {
  if (matrix.length === 0) {
    return "No test cases generated";
  }

  const headers = Object.keys(matrix[0]);
  const lines: string[] = [];

  lines.push(`| # | ${headers.join(" | ")} |`);
  lines.push(`|---| ${headers.map(() => "---").join(" | ")} |`);

  matrix.forEach((testCase, index) => {
    const values = headers.map((h) => testCase[h]);
    lines.push(`| ${index + 1} | ${values.join(" | ")} |`);
  });

  return lines.join("\n");
}

/**
 * Format test matrix as TypeScript test cases for it.each
 */
export function formatAsTestCases(matrix: TestCase[], expectedField = "expected"): string {
  const lines: string[] = ["const testCases = ["];

  matrix.forEach((testCase, index) => {
    const name = Object.entries(testCase)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");

    lines.push("  {");
    lines.push(`    name: 'Case ${index + 1}: ${name}',`);

    for (const [key, value] of Object.entries(testCase)) {
      lines.push(`    ${key}: ${JSON.stringify(value)},`);
    }

    lines.push(`    ${expectedField}: { /* TODO: define expected outcome */ },`);
    lines.push("  },");
  });

  lines.push("];");

  return lines.join("\n");
}

/**
 * Validate that all pairs are covered by the matrix
 */
export function validateCoverage(
  factors: FactorValues,
  matrix: TestCase[],
  options: PairwiseOptions = {},
): {
  valid: boolean;
  missing: string[];
  coverage: number;
} {
  const strength = options.strength ?? DEFAULT_STRENGTH;
  if (strength !== 2 && strength !== 3) {
    throw new Error(`Unsupported coverage strength ${String(strength)}. Supported values: 2 or 3.`);
  }

  const factorNames = orderFactorsByWeight(Object.keys(factors), options.factorWeights);
  const allInteractions = generateAllInteractions(factors, factorNames, strength);
  const coveredInteractions = new Set<string>();
  const factorCombos = generateCombinations(factorNames, strength);

  for (const testCase of matrix) {
    for (const combo of factorCombos) {
      const interaction: InteractionTuple = combo.map((factor) => [factor, testCase[factor]]);
      coveredInteractions.add(interactionKey(interaction));
    }
  }

  const missing: string[] = [];
  for (const interaction of allInteractions) {
    if (!coveredInteractions.has(interaction)) {
      missing.push(interaction);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    coverage: allInteractions.size === 0 ? 100 : ((allInteractions.size - missing.length) / allInteractions.size) * 100,
  };
}

export function runPairwiseCliDemo(): void {
  const compatibilityFactors = {
    browser: ["chrome", "firefox", "safari"],
    os: ["windows", "macos", "linux"],
    viewport: ["mobile", "tablet", "desktop"],
  };

  console.log("=== Browser Compatibility Pairwise Matrix ===\n");
  const matrix = generatePairwiseMatrix(compatibilityFactors);
  console.log(formatAsMarkdownTable(matrix));
  console.log("\n");

  const validation = validateCoverage(compatibilityFactors, matrix);
  console.log(`Coverage: ${validation.coverage.toFixed(1)}%`);
  console.log(`Test cases: ${matrix.length} (vs ${3 * 3 * 3} exhaustive)`);
  console.log(`Valid: ${validation.valid}`);

  if (!validation.valid) {
    console.log("Missing pairs:", validation.missing);
  }

  console.log("\n=== Stress Test: 8 factors × 4 values ===\n");
  const stressFactors: FactorValues = {};
  for (let i = 0; i < 8; i++) {
    stressFactors[`f${i}`] = ["a", "b", "c", "d"];
  }
  const t0 = performance.now();
  const stressMatrix = generatePairwiseMatrix(stressFactors);
  const elapsed = performance.now() - t0;
  const stressValidation = validateCoverage(stressFactors, stressMatrix);
  console.log(`${stressMatrix.length} test cases (vs ${4 ** 8} exhaustive)`);
  console.log(`Coverage: ${stressValidation.coverage.toFixed(1)}%`);
  console.log(`Valid: ${stressValidation.valid}`);
  console.log(`Time: ${elapsed.toFixed(1)}ms`);
}

// CLI usage
if (typeof process !== "undefined" && process.argv?.[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPairwiseCliDemo();
}
