/**
 * Breaking change classification utilities.
 *
 * Implements the detection logic from categories.md:
 * - Category 1: Contract field changes (add/remove/rename/widen/narrow)
 * - Category 5: Serialized state schema (.catch() default validation)
 * - Category 6: Event sourcing schema (event type removal/rename detection)
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

export interface EventTypeChangeResult {
  removed: string[];
  added: string[];
  safe: boolean;
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

/**
 * Compare two versions of an event type set and detect breaking changes.
 *
 * From categories.md Category 6:
 * - Removing an event type breaks replay (old events can't be processed)
 * - Renaming an event type is a removal + addition — breaking
 * - Adding new event types is safe (new events, no replay impact)
 * - Safe only when no types are removed
 */
export function classifyEventTypeChanges(
  oldTypes: string[],
  newTypes: string[],
): EventTypeChangeResult {
  const oldSet = new Set(oldTypes);
  const newSet = new Set(newTypes);
  const removed = oldTypes.filter((t) => !newSet.has(t));
  const added = newTypes.filter((t) => !oldSet.has(t));
  return { removed, added, safe: removed.length === 0 };
}
