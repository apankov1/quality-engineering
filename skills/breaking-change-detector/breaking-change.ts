/**
 * Breaking change classification utilities.
 *
 * Implements the detection logic from categories.md:
 * - Category 1: Contract field changes (add/remove/rename/widen/narrow)
 * - Category 5: Serialized state schema (.catch() default validation)
 */

// --- Types ---

export type ChangeKind = 'breaking' | 'safe';

export interface FieldChange {
  action: 'add' | 'remove' | 'rename' | 'widen' | 'narrow' | 'make_optional' | 'make_required';
  optional?: boolean;
}

export interface SchemaField {
  name: string;
  hasCatchDefault: boolean;
}

export interface SchemaResult {
  safe: boolean;
  violations: string[];
}

// --- Classification functions ---

/**
 * Classify a single field change as breaking or safe.
 *
 * Rules (from categories.md Category 1):
 * - Adding an optional field is safe (tolerant reader ignores unknown fields)
 * - Adding a required field is breaking (old code can't produce it)
 * - Removing, renaming, or narrowing a field is breaking
 * - Widening a type or making a field optional is safe
 */
export function classifyFieldChange(change: FieldChange): ChangeKind {
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

/**
 * Check a serialized state schema for missing .catch() defaults.
 *
 * From categories.md Category 5: every field in a schema used with
 * @Persist or DO snapshot storage MUST have a .catch(defaultValue)
 * so that old hibernated instances can wake safely with new schema.
 */
export function classifySerializedSchema(fields: SchemaField[]): SchemaResult {
  const violations: string[] = [];
  for (const field of fields) {
    if (!field.hasCatchDefault) {
      violations.push(`${field.name}: missing .catch() default`);
    }
  }
  return { safe: violations.length === 0, violations };
}
