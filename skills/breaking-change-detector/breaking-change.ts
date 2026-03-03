/**
 * Breaking change classification utilities.
 *
 * Implements the detection logic from categories.md:
 * - Category 1: Contract field changes (add/remove/rename/widen/narrow)
 * - Category 5: Serialized state schema (.catch() default validation)
 * - Category 6: Event sourcing schema (event type removal/rename detection)
 */

// --- Types ---

export type ChangeKind = "breaking" | "safe";

export interface FieldChange {
  action: "add" | "remove" | "rename" | "widen" | "narrow" | "make_optional" | "make_required";
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

export interface StatusCodeChangeResult {
  removed: number[];
  added: number[];
  safe: boolean;
}

export interface EnumValueChangeResult {
  removed: string[];
  added: string[];
  safe: boolean;
}

export interface ApiFieldDefinition {
  name: string;
  type: string;
  required?: boolean;
  semantic?: string;
}

export interface ApiFieldSemanticsResult {
  safe: boolean;
  breaking: string[];
  added: string[];
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
    case "add":
      return change.optional ? "safe" : "breaking";
    case "remove":
    case "rename":
    case "narrow":
    case "make_required":
      return "breaking";
    case "widen":
    case "make_optional":
      return "safe";
    default:
      throw new Error(`Unknown field change action: ${String(change.action)}`);
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
export function classifyEventTypeChanges(oldTypes: string[], newTypes: string[]): EventTypeChangeResult {
  const oldSet = new Set(oldTypes);
  const newSet = new Set(newTypes);
  const removed = oldTypes.filter((t) => !newSet.has(t));
  const added = newTypes.filter((t) => !oldSet.has(t));
  return { removed, added, safe: removed.length === 0 };
}

/**
 * Compare HTTP status codes for an endpoint version.
 *
 * Removing a status code is treated as breaking because clients may
 * rely on that response contract.
 */
export function classifyStatusCodeChanges(oldStatuses: number[], newStatuses: number[]): StatusCodeChangeResult {
  const oldSet = new Set(oldStatuses);
  const newSet = new Set(newStatuses);
  const removed = oldStatuses.filter((code) => !newSet.has(code));
  const added = newStatuses.filter((code) => !oldSet.has(code));
  return { removed, added, safe: removed.length === 0 };
}

/**
 * Compare enum values for API contracts.
 *
 * Removing enum values is breaking. Adding values is safe for tolerant readers.
 */
export function classifyEnumValueChanges(oldValues: string[], newValues: string[]): EnumValueChangeResult {
  const oldSet = new Set(oldValues);
  const newSet = new Set(newValues);
  const removed = oldValues.filter((value) => !newSet.has(value));
  const added = newValues.filter((value) => !oldSet.has(value));
  return { removed, added, safe: removed.length === 0 };
}

/**
 * Compare API field definitions for semantic compatibility.
 *
 * Breaking conditions:
 * - field removed
 * - field type changed
 * - optional field made required
 * - documented semantic meaning changed
 * - newly introduced required field
 */
export function classifyApiFieldSemantics(
  oldFields: ApiFieldDefinition[],
  newFields: ApiFieldDefinition[],
): ApiFieldSemanticsResult {
  const oldByName = new Map(oldFields.map((field) => [field.name, field]));
  const newByName = new Map(newFields.map((field) => [field.name, field]));

  const breaking: string[] = [];
  const added: string[] = [];

  for (const oldField of oldFields) {
    const updatedField = newByName.get(oldField.name);
    if (!updatedField) {
      breaking.push(`${oldField.name}: removed`);
      continue;
    }
    if (oldField.type !== updatedField.type) {
      breaking.push(`${oldField.name}: type changed from ${oldField.type} to ${updatedField.type}`);
    }
    if (!oldField.required && updatedField.required) {
      breaking.push(`${oldField.name}: made required`);
    }
    if (oldField.semantic && updatedField.semantic && oldField.semantic !== updatedField.semantic) {
      breaking.push(`${oldField.name}: semantic changed`);
    }
  }

  for (const newField of newFields) {
    if (oldByName.has(newField.name)) continue;
    if (newField.required) {
      breaking.push(`${newField.name}: new required field`);
    } else {
      added.push(newField.name);
    }
  }

  return {
    safe: breaking.length === 0,
    breaking,
    added,
  };
}
