# Model-Based Testing Patterns

Deep-dive into XState-style testing, complex guards, and schema evolution.

## XState Integration

XState machines define transitions declaratively. This skill's utilities mirror XState concepts:

| XState Concept | This Skill | Purpose |
|----------------|------------|---------|
| Machine config | `createStateMachine(transitions)` | Define valid transitions |
| `can()` method | `canTransition(machine, from, to)` | Check transition validity |
| Guards | `assertGuardTruthTable()` | Test boolean conditions |
| Context | `assertContextMutation()` | Test side effects |
| Final states | `getTerminalStates()` | Identify endpoints |

## State/Context Separation

XState separates **finite states** from **extended context**. Test them independently:

```typescript
type SessionState = 'idle' | 'authenticating' | 'authenticated' | 'error';

interface SessionContext {
  userId: string | null;
  retryCount: number;
}

it('same state, different contexts', () => {
  const session1 = { state: 'authenticated', context: { userId: 'alice', retryCount: 0 } };
  const session2 = { state: 'authenticated', context: { userId: 'bob', retryCount: 3 } };
  assert.equal(session1.state, session2.state);
});
```

## Complex Guard Testing

Guards with multiple inputs require exhaustive truth tables:

```typescript
interface ProcessGuardInput {
  state: 'pending' | 'running' | 'stopped';
  hasResources: boolean;
  isAuthorized: boolean;
}

function canStart(input: ProcessGuardInput): boolean {
  return input.state === 'pending' && input.hasResources && input.isAuthorized;
}

// Test representative cases
assertGuardTruthTable(canStart, [
  { inputs: { state: 'pending', hasResources: true, isAuthorized: true }, expected: true },
  { inputs: { state: 'running', hasResources: true, isAuthorized: true }, expected: false },
  { inputs: { state: 'pending', hasResources: false, isAuthorized: true }, expected: false },
  { inputs: { state: 'pending', hasResources: true, isAuthorized: false }, expected: false },
]);
```

## Hierarchical State Machines

For nested states, flatten the state type:

```typescript
type FlatState = 'inactive' | 'active.running' | 'active.paused';

const machine = createStateMachine<FlatState>({
  'inactive': ['active.running'],
  'active.running': ['active.paused', 'inactive'],
  'active.paused': ['active.running', 'inactive'],
});
```

## Transition Path Testing

Test complete paths through the state machine:

```typescript
function testPath(machine: StateMachine, path: string[]): void {
  for (let i = 0; i < path.length - 1; i++) {
    assertTransition(machine, path[i], path[i + 1]);
  }
}

it('happy path', () => {
  testPath(workflow, ['draft', 'review', 'approved', 'published']);
});
```
