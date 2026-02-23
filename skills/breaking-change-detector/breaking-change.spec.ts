import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFieldChange, classifySerializedSchema } from './breaking-change.ts';

/**
 * Tests for the breaking change classification utilities.
 *
 * Each test demonstrates the fail-before/fix-after pattern:
 * - The assertion proves the classifier catches the defect
 * - If the classifier were wrong (e.g., returned 'safe' for a removal),
 *   the test would fail — proving detection works
 */

describe('contract field changes (category 1)', () => {
  // Defect: adding a required field breaks old producers that don't send it.
  // Before fix: classifier returned 'safe' for all additions.
  // After fix: 'safe' only when optional=true.
  it('adding optional field is safe', () => {
    assert.equal(classifyFieldChange({ action: 'add', optional: true }), 'safe');
  });

  it('adding required field is breaking', () => {
    assert.equal(classifyFieldChange({ action: 'add', optional: false }), 'breaking');
  });

  // Defect: field removal silently breaks all consumers still reading it.
  // Before fix: removal was unclassified (fell through switch).
  // After fix: explicit 'breaking' for remove/rename.
  it('removing field is breaking', () => {
    assert.equal(classifyFieldChange({ action: 'remove' }), 'breaking');
  });

  it('renaming field is breaking', () => {
    assert.equal(classifyFieldChange({ action: 'rename' }), 'breaking');
  });

  // Defect: narrowing a type (e.g., string → enum) rejects valid old data.
  // Widening (e.g., enum → string) accepts all old data — safe.
  it('widening type is safe', () => {
    assert.equal(classifyFieldChange({ action: 'widen' }), 'safe');
  });

  it('narrowing type is breaking', () => {
    assert.equal(classifyFieldChange({ action: 'narrow' }), 'breaking');
  });

  // Defect: making a field required breaks old data that omits it.
  // Making optional is always safe — old data still valid.
  it('making optional is safe', () => {
    assert.equal(classifyFieldChange({ action: 'make_optional' }), 'safe');
  });

  it('making required is breaking', () => {
    assert.equal(classifyFieldChange({ action: 'make_required' }), 'breaking');
  });
});

describe('serialized state schema (category 5)', () => {
  it('all fields with .catch() is safe', () => {
    const result = classifySerializedSchema([
      { name: 'version', hasCatchDefault: true },
      { name: 'counter', hasCatchDefault: true },
      { name: 'activeId', hasCatchDefault: true },
    ]);
    assert.equal(result.safe, true);
    assert.equal(result.violations.length, 0);
  });

  // Defect: schema field without .catch() throws on old hibernated data.
  // Before fix: validator didn't check for .catch() defaults.
  // After fix: every field missing .catch() is reported as a violation.
  it('field without .catch() is a violation', () => {
    const result = classifySerializedSchema([
      { name: 'version', hasCatchDefault: true },
      { name: 'counter', hasCatchDefault: false },
    ]);
    assert.equal(result.safe, false);
    assert.equal(result.violations.length, 1);
    assert.ok(result.violations[0].includes('counter'));
  });

  // Defect: multiple missing .catch() fields only reported one violation.
  // Before fix: validator returned on first violation.
  // After fix: collects ALL violations for batch reporting.
  it('multiple missing .catch() reports all violations', () => {
    const result = classifySerializedSchema([
      { name: 'version', hasCatchDefault: false },
      { name: 'counter', hasCatchDefault: false },
      { name: 'activeId', hasCatchDefault: true },
    ]);
    assert.equal(result.safe, false);
    assert.equal(result.violations.length, 2);
  });
});
