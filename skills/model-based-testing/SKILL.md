---
name: model-based-testing
description: Tests state machine transitions with XState-style patterns. Validates transition matrices, guard truth tables, context mutations, and terminal state handling.
---

# Model-Based Testing

Test state machines systematically — don't guess at valid transitions.

State machines are everywhere: workflow states, lifecycle management, game turns, circuit breakers. Most bugs come from invalid transitions being allowed or valid transitions being blocked. This skill teaches you to systematically test ALL state pairs, not just the happy path.

**When to use**: Any code with named states, lifecycles (initializing → ready → stopping), workflow progressions (draft → review → published), turn-based systems, circuit breakers, or XState machines.

**When not to use**: Stateless functions, simple CRUD, UI rendering without state machines, pure data transformations.

## Model-Based vs Pairwise

Model-based derives **which state transitions** to test. [Pairwise testing](https://github.com/apankov1/quality-engineering/tree/main/skills/pairwise-test-coverage) selects **which input combinations** to test. Different questions, different tools:

| Your system has... | Use | Example |
|--------------------|-----|---------|
| Named states with transitions between them | **Model-based** | draft → review → published workflow |
| Independent parameters with discrete values | **Pairwise** | retry count × timeout × backoff × status |
| State machine guards with 5+ boolean inputs | **Both** | Model-based finds the guards, pairwise covers the flag combos |

**Rule of thumb**: if you're testing *what happens next*, use model-based. If you're testing *what goes in*, use pairwise.

## What To Protect (Start Here)

State machine tests protect against **invalid transitions** — states that should be unreachable but aren't. Before generating a transition matrix, identify which decisions apply:

| Decision | Question to Answer | If Yes → Use |
|----------|--------------------|--------------|
| Invalid transitions must be impossible | Which state changes are explicitly forbidden? | `getInvalidTransitionPairs` |
| Guards must enforce access control | Do boolean conditions gate transitions (permissions, flags, locks)? | `assertGuardTruthTable` |
| Side effects must be exact | Do transitions modify counters, timestamps, or flags? | `assertContextMutation` |
| Terminal states must be final | Are there states with no valid exit (completed, cancelled, archived)? | `getTerminalStates` |

**Do not generate tests for decisions the human hasn't confirmed.** A 25-test transition matrix that just verifies `canTransition()` returns true/false without connecting to business rules (who can approve? when can you go back to draft?) is testing the map, not the territory.

## Rationalizations (Do Not Skip)

| Rationalization | Why It's Wrong | Required Action |
|-----------------|----------------|-----------------|
| "I tested the happy path" | Invalid transitions cause production bugs | Test ALL state pairs with transition matrix |
| "The enum defines valid states" | States are listed, but transitions aren't tested | Create explicit validTransitions map + tests |
| "Edge cases are rare" | Murphy's law: rare edge cases happen at scale | Guard truth table covers ALL input combinations |
| "Context mutations are obvious" | Side effects of transitions hide subtle bugs | Assert exact context changes on each transition |

---

## Included Utilities

```typescript
import {
  createStateMachine,
  canTransition,
  assertTransition,
  getValidTransitions,
  getTerminalStates,
  testTransitionMatrix,
  getValidTransitionPairs,
  getInvalidTransitionPairs,
  createGuardTruthTable,
  assertGuardTruthTable,
  assertContextMutation,
} from './state-machine.ts';
```

## Core Workflow

### Step 1: Define State Machine from Transition Map

```typescript
type WorkflowState = 'draft' | 'review' | 'approved' | 'rejected' | 'published';

const workflow = createStateMachine<WorkflowState>({
  draft: ['review'],
  review: ['approved', 'rejected'],
  approved: ['published'],
  rejected: ['draft'],       // Can return to draft
  published: [],             // Terminal state
});
```

### Step 2: Generate Transition Matrix

```typescript
// Generate ALL N*N state pairs with validity
const matrix = testTransitionMatrix(workflow);
// Returns 25 entries for 5 states

// Split into valid/invalid for separate test suites
const validPairs = getValidTransitionPairs(workflow);   // 5 valid
const invalidPairs = getInvalidTransitionPairs(workflow); // 20 invalid
```

### Step 3: Test Valid Transitions

```typescript
describe('valid transitions', () => {
  const validPairs = getValidTransitionPairs(workflow);

  for (const { from, to } of validPairs) {
    it(`allows ${from} -> ${to}`, () => {
      assert.equal(canTransition(workflow, from, to), true);
    });
  }
});
```

### Step 4: Test Invalid Transitions

```typescript
describe('invalid transitions', () => {
  const invalidPairs = getInvalidTransitionPairs(workflow);

  for (const { from, to } of invalidPairs) {
    it(`rejects ${from} -> ${to}`, () => {
      assert.equal(canTransition(workflow, from, to), false);
    });
  }
});
```

### Step 5: Test Guards with Truth Tables

Guards are boolean functions that gate transitions. Test ALL input combinations:

```typescript
interface GuardInput { state: string; isPaused: boolean; hasPermission: boolean }

function canBeginMove(input: GuardInput): boolean {
  if (input.state !== 'awaiting_input') return false;
  if (input.isPaused && !input.hasPermission) return false;
  return true;
}

// Truth table covers ALL 2^N combinations of boolean flags
assertGuardTruthTable(canBeginMove, [
  { inputs: { state: 'awaiting_input', isPaused: false, hasPermission: false }, expected: true },
  { inputs: { state: 'awaiting_input', isPaused: true, hasPermission: false }, expected: false },
  { inputs: { state: 'awaiting_input', isPaused: true, hasPermission: true }, expected: true },
  { inputs: { state: 'idle', isPaused: false, hasPermission: true }, expected: false },
]);
```

### Step 6: Test Context Mutations

State transitions often modify context (counters, timestamps, flags). Test that ONLY expected fields change:

```typescript
it('increments moveCount on completeMove', () => {
  const before = { state: 'executing', moveCount: 5, lastMoveAt: 1000 };
  const after = { state: 'completed', moveCount: 6, lastMoveAt: 2000 };

  assertContextMutation(before, after, {
    state: 'completed',
    moveCount: 6,
    lastMoveAt: 2000
  });
  // Would throw if any other field changed unexpectedly
});
```

### Step 7: Test Terminal States

Terminal states have no outgoing transitions. Verify they're identified correctly:

```typescript
const terminals = getTerminalStates(workflow);
assert.deepEqual(terminals, ['published']);
```

---

## Violation Rules

### missing_transition_coverage
State machines MUST have tests for ALL state pairs, not just happy paths. If you have N states, you need N*N test cases (most will be "rejects invalid transition").
**Severity**: must-fail

### missing_guard_truth_table
Guard functions with multiple boolean inputs MUST have truth table tests covering all 2^N combinations (for N ≤ 4). For 5+ boolean inputs, switch to pairwise coverage.
**Severity**: must-fail

### missing_context_mutation_test
Transitions that modify context MUST have assertions verifying exact changes and no unexpected side effects.
**Severity**: should-fail

### untested_terminal_state
Terminal states (no outgoing transitions) MUST be explicitly identified and tested.
**Severity**: should-fail

---

## Companion Skills

This skill provides **testing utilities** for state machines, not state machine design guidance. For broader methodology:

- Search `state machine` or `xstate` on [skills.sh](https://skills.sh) for machine design, statechart authoring, and framework integration
- The circuit breaker is a state machine — use [fault-injection-testing](https://github.com/apankov1/quality-engineering/tree/main/skills/fault-injection-testing) for circuit breaker, retry policy, and queue preservation testing
- Guard truth tables with 5+ boolean inputs produce 32+ rows — use [pairwise-test-coverage](https://github.com/apankov1/quality-engineering/tree/main/skills/pairwise-test-coverage) for near-minimal coverage of all input pairs

---

## Quick Reference

| Pattern | When | Example |
|---------|------|---------|
| Transition matrix | Always for state machines | `testTransitionMatrix(machine)` |
| Valid/invalid split | Table-driven tests | `getValidTransitionPairs()` / `getInvalidTransitionPairs()` |
| Guard truth table | Boolean guard functions | 2^N rows for N boolean inputs |
| Context mutation | Transitions with side effects | `assertContextMutation(before, after, expected)` |
| Terminal states | Lifecycle endpoints | `getTerminalStates(machine)` |

See [patterns.md](./references/patterns.md) for XState integration, complex guard examples, and hibernation safety testing.
