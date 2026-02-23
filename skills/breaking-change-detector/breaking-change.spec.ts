import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Demonstrates the breaking change detection patterns from categories.md.
 * These tests verify the classification logic that the skill teaches agents to apply.
 */

type ChangeKind = 'breaking' | 'safe';

interface FieldChange {
  action: 'add' | 'remove' | 'rename' | 'widen' | 'narrow' | 'make_optional' | 'make_required';
  optional?: boolean;
}

function classifyFieldChange(change: FieldChange): ChangeKind {
  switch (change.action) {
    case 'add':
      return change.optional ? 'safe' : 'breaking';
    case 'remove':
    case 'rename':
    case 'narrow':
    case 'make_required':
      return 'breaking';
    case 'widen':
    case 'make_optional':
      return 'safe';
  }
}

interface SchemaField {
  name: string;
  hasCatchDefault: boolean;
}

function classifySerializedSchema(fields: SchemaField[]): {
  safe: boolean;
  violations: string[];
} {
  const violations: string[] = [];
  for (const field of fields) {
    if (!field.hasCatchDefault) {
      violations.push(`${field.name}: missing .catch() default`);
    }
  }
  return { safe: violations.length === 0, violations };
}

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
