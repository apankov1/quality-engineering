import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePairwiseMatrix,
  validateCoverage,
  formatAsMarkdownTable,
  formatAsTestCases,
} from './pairwise.ts';

describe('generatePairwiseMatrix', () => {
  it('returns empty array for no factors', () => {
    assert.deepStrictEqual(generatePairwiseMatrix({}), []);
  });

  it('returns one row per value for single factor', () => {
    const matrix = generatePairwiseMatrix({ color: ['red', 'green', 'blue'] });
    assert.equal(matrix.length, 3);
    const values = matrix.map((r) => r.color).sort();
    assert.deepStrictEqual(values, ['blue', 'green', 'red']);
  });

  it('covers all pairs for 2 factors', () => {
    const factors = { a: ['1', '2'], b: ['x', 'y'] };
    const matrix = generatePairwiseMatrix(factors);
    const validation = validateCoverage(factors, matrix);
    assert.equal(validation.valid, true);
    assert.equal(validation.coverage, 100);
  });

  it('covers all pairs for 3x3x3', () => {
    const factors = {
      browser: ['chrome', 'firefox', 'safari'],
      os: ['windows', 'macos', 'linux'],
      viewport: ['mobile', 'tablet', 'desktop'],
    };
    const matrix = generatePairwiseMatrix(factors);
    const validation = validateCoverage(factors, matrix);
    assert.equal(validation.valid, true);
    // Near-minimal: should be much less than 27 exhaustive
    assert.ok(matrix.length < 27, `Expected < 27 cases, got ${matrix.length}`);
  });

  it('handles 8x4 without hanging or OOM', () => {
    const factors: Record<string, string[]> = {};
    for (let i = 0; i < 8; i++) {
      factors[`f${i}`] = ['a', 'b', 'c', 'd'];
    }
    const t0 = performance.now();
    const matrix = generatePairwiseMatrix(factors);
    const elapsed = performance.now() - t0;
    const validation = validateCoverage(factors, matrix);

    assert.equal(validation.valid, true);
    assert.ok(elapsed < 5000, `Expected < 5s, took ${elapsed.toFixed(0)}ms`);
    assert.ok(matrix.length < 200, `Expected < 200 cases, got ${matrix.length}`);
  });

  it('throws on too many factors', () => {
    const factors: Record<string, string[]> = {};
    for (let i = 0; i < 21; i++) {
      factors[`f${i}`] = ['a', 'b'];
    }
    assert.throws(() => generatePairwiseMatrix(factors), /Too many factors/);
  });

  it('throws on too many values per factor', () => {
    const values = Array.from({ length: 51 }, (_, i) => `v${i}`);
    assert.throws(() => generatePairwiseMatrix({ f0: values, f1: ['a'] }), /too many values/i);
  });

  it('every row has all factor keys', () => {
    const factors = { a: ['1', '2', '3'], b: ['x', 'y'], c: ['p', 'q', 'r'] };
    const matrix = generatePairwiseMatrix(factors);
    for (const row of matrix) {
      assert.deepStrictEqual(Object.keys(row).sort(), ['a', 'b', 'c']);
    }
  });
});

describe('validateCoverage', () => {
  it('detects missing pairs', () => {
    const factors = { a: ['1', '2'], b: ['x', 'y'] };
    const partial = [{ a: '1', b: 'x' }];
    const validation = validateCoverage(factors, partial);
    assert.equal(validation.valid, false);
    assert.ok(validation.missing.length > 0);
    assert.ok(validation.coverage < 100);
  });
});

describe('formatAsMarkdownTable', () => {
  it('returns message for empty matrix', () => {
    assert.equal(formatAsMarkdownTable([]), 'No test cases generated');
  });

  it('produces valid markdown table', () => {
    const matrix = [{ a: '1', b: 'x' }];
    const table = formatAsMarkdownTable(matrix);
    assert.ok(table.includes('| # | a | b |'));
    assert.ok(table.includes('| 1 | 1 | x |'));
  });
});

describe('formatAsTestCases', () => {
  it('uses JSON.stringify for safe escaping', () => {
    const matrix = [{ key: "it's a \"test\"" }];
    const output = formatAsTestCases(matrix);
    assert.ok(output.includes('key: "it\'s a \\"test\\""'), `Got: ${output}`);
  });
});
