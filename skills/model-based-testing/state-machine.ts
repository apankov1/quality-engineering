/**
 * Model-Based Testing: State Machine Utilities
 *
 * Provides reusable patterns for:
 * - State machine definition from transition maps
 * - Transition validation (valid/invalid)
 * - Full transition matrix generation for table-driven tests
 * - Guard truth table testing
 * - Context mutation assertions
 *
 * Framework-agnostic: Uses standard assertion patterns.
 *
 * @example
 * import { createStateMachine, testTransitionMatrix, createGuardTruthTable } from './state-machine';
 *
 * const machine = createStateMachine({
 *   idle: ['running'],
 *   running: ['paused', 'stopped'],
 *   paused: ['running', 'stopped'],
 *   stopped: [],
 * });
 *
 * // Generate all valid/invalid pairs for table-driven tests
 * const matrix = testTransitionMatrix(machine);
 */

// ============================================================================
// STATE MACHINE
// ============================================================================

/**
 * A state machine defined by its valid transitions.
 */
export interface StateMachine<S extends string = string> {
  readonly states: readonly S[];
  readonly transitions: Readonly<Record<S, readonly S[]>>;
}

/**
 * Create a state machine from a transition map.
 *
 * Every key is a valid state. The value is the list of states
 * reachable from that state. Empty arrays are terminal states.
 */
export function createStateMachine<S extends string>(transitions: Record<S, readonly S[]>): StateMachine<S> {
  const states = Object.keys(transitions) as S[];
  const stateSet = new Set(states);

  // Validate all target states are declared as keys
  for (const from of states) {
    for (const to of transitions[from]) {
      if (!stateSet.has(to)) {
        throw new Error(
          `Undeclared target state "${to}" in transition from "${from}". All target states must be keys in the transition map.`,
        );
      }
    }
  }

  return { states, transitions };
}

/**
 * Check if a transition from `from` to `to` is valid.
 */
export function canTransition<S extends string>(machine: StateMachine<S>, from: S, to: S): boolean {
  const targets = machine.transitions[from];
  if (!targets) return false;
  return targets.includes(to);
}

/**
 * Assert a transition is valid. Throws with descriptive message on invalid.
 */
export function assertTransition<S extends string>(machine: StateMachine<S>, from: S, to: S): void {
  if (!canTransition(machine, from, to)) {
    const valid = getValidTransitions(machine, from);
    throw new Error(`Invalid transition: ${from} -> ${to}. Valid targets from ${from}: [${valid.join(", ")}]`);
  }
}

/**
 * Get valid target states from a given state.
 */
export function getValidTransitions<S extends string>(machine: StateMachine<S>, from: S): readonly S[] {
  return machine.transitions[from] ?? [];
}

/**
 * Get terminal states (states with no outgoing transitions).
 */
export function getTerminalStates<S extends string>(machine: StateMachine<S>): S[] {
  return machine.states.filter((s) => machine.transitions[s].length === 0);
}

// ============================================================================
// TRANSITION MATRIX
// ============================================================================

/**
 * A single entry in the transition matrix.
 */
export interface TransitionMatrixEntry<S extends string = string> {
  from: S;
  to: S;
  valid: boolean;
}

/**
 * Generate all possible state pairs with their validity.
 *
 * Produces N*N entries (where N = number of states), marking each
 * as valid or invalid. Use with `it.each` or similar table-driven patterns.
 */
export function testTransitionMatrix<S extends string>(machine: StateMachine<S>): TransitionMatrixEntry<S>[] {
  const entries: TransitionMatrixEntry<S>[] = [];

  for (const from of machine.states) {
    for (const to of machine.states) {
      entries.push({
        from,
        to,
        valid: canTransition(machine, from, to),
      });
    }
  }

  return entries;
}

/**
 * Get only valid transitions from the matrix.
 */
export function getValidTransitionPairs<S extends string>(machine: StateMachine<S>): TransitionMatrixEntry<S>[] {
  return testTransitionMatrix(machine).filter((e) => e.valid);
}

/**
 * Get only invalid transitions from the matrix.
 */
export function getInvalidTransitionPairs<S extends string>(machine: StateMachine<S>): TransitionMatrixEntry<S>[] {
  return testTransitionMatrix(machine).filter((e) => !e.valid);
}

// ============================================================================
// GUARD TRUTH TABLE
// ============================================================================

/**
 * A single row in a guard truth table.
 */
export interface GuardTruthTableRow<T extends Record<string, unknown> = Record<string, unknown>> {
  inputs: T;
  expected: boolean;
  label?: string;
}

/**
 * Create a guard truth table for parameterized testing.
 *
 * Guards are boolean functions that gate transitions. This helper
 * structures test cases as a truth table for exhaustive coverage.
 */
export function createGuardTruthTable<T extends Record<string, unknown>>(
  guard: (input: T) => boolean,
  cases: GuardTruthTableRow<T>[],
): { inputs: T; expected: boolean; actual: boolean; pass: boolean; label?: string }[] {
  return cases.map((c) => {
    const actual = guard(c.inputs);
    return {
      inputs: c.inputs,
      expected: c.expected,
      actual,
      pass: actual === c.expected,
      label: c.label,
    };
  });
}

/**
 * Assert all guard truth table cases pass.
 */
export function assertGuardTruthTable<T extends Record<string, unknown>>(
  guard: (input: T) => boolean,
  cases: GuardTruthTableRow<T>[],
): void {
  const results = createGuardTruthTable(guard, cases);
  const failures = results.filter((r) => !r.pass);

  if (failures.length > 0) {
    const details = failures
      .map((f) => {
        const label = f.label ? ` (${f.label})` : "";
        return `  inputs: ${JSON.stringify(f.inputs)}${label} -> expected ${f.expected}, got ${f.actual}`;
      })
      .join("\n");

    throw new Error(`Guard truth table: ${failures.length}/${results.length} cases failed:\n${details}`);
  }
}

// ============================================================================
// CONTEXT MUTATION HELPERS
// ============================================================================

/**
 * Deep structural equality check for context values.
 * Handles primitives, plain objects, and arrays.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
  }
  return true;
}

/**
 * Assert that a transition produces the expected context changes.
 *
 * Compares before/after context objects, checking that specified
 * fields changed to expected values while other fields remain unchanged.
 */
export function assertContextMutation<T extends Record<string, unknown>>(
  before: T,
  after: T,
  expectedChanges: Partial<T>,
): { changed: string[]; unchanged: string[]; unexpected: string[] } {
  const changed: string[] = [];
  const unchanged: string[] = [];
  const unexpected: string[] = [];

  for (const key of Object.keys(expectedChanges) as (keyof T & string)[]) {
    if (deepEqual(after[key], expectedChanges[key])) {
      changed.push(key);
    } else {
      unexpected.push(`${key}: expected ${JSON.stringify(expectedChanges[key])}, got ${JSON.stringify(after[key])}`);
    }
  }

  for (const key of Object.keys(before) as (keyof T & string)[]) {
    if (key in expectedChanges) continue;
    if (deepEqual(before[key], after[key])) {
      unchanged.push(key);
    } else {
      unexpected.push(
        `${key}: changed unexpectedly from ${JSON.stringify(before[key])} to ${JSON.stringify(after[key])}`,
      );
    }
  }

  // Detect keys added in after that weren't in before or expectedChanges
  for (const key of Object.keys(after) as (keyof T & string)[]) {
    if (key in before || key in expectedChanges) continue;
    unexpected.push(`${key}: appeared unexpectedly with value ${JSON.stringify(after[key])}`);
  }

  if (unexpected.length > 0) {
    throw new Error(`Context mutation violations:\n  ${unexpected.join("\n  ")}`);
  }

  return { changed, unchanged, unexpected };
}
