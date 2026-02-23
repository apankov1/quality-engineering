import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFieldChange, classifySerializedSchema } from './breaking-change.ts';

/**
 * Tests for the breaking change classification utilities.
 * Verifies the logic from categories.md against concrete examples.
 */

describe('contract field changes (category 1)', () => {
  it('adding optional field is safe', () => {
    assert.equal(classifyFieldChange({ action: 'add', optional: true }), 'safe');
  });

  it('adding required field is breaking', () => {
    assert.equal(classifyFieldChange({ action: 'add', optional: false }), 'breaking');
  });

  it('removing field is breaking', () => {
    assert.equal(classifyFieldChange({ action: 'remove' }), 'breaking');
  });

  it('renaming field is breaking', () => {
    assert.equal(classifyFieldChange({ action: 'rename' }), 'breaking');
  });

  it('widening type is safe', () => {
    assert.equal(classifyFieldChange({ action: 'widen' }), 'safe');
  });

  it('narrowing type is breaking', () => {
    assert.equal(classifyFieldChange({ action: 'narrow' }), 'breaking');
  });

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

  it('field without .catch() is a violation', () => {
    const result = classifySerializedSchema([
      { name: 'version', hasCatchDefault: true },
      { name: 'counter', hasCatchDefault: false },
    ]);
    assert.equal(result.safe, false);
    assert.equal(result.violations.length, 1);
    assert.ok(result.violations[0].includes('counter'));
  });

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
