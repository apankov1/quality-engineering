import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertContextMutation,
  assertGuardTruthTable,
  assertTransition,
  canTransition,
  createGuardTruthTable,
  createStateMachine,
  getInvalidTransitionPairs,
  getTerminalStates,
  getValidTransitionPairs,
  testTransitionMatrix,
} from "./state-machine.ts";

// ============================================================================
// STATE MACHINE CREATION
// ============================================================================

describe("createStateMachine", () => {
  // Defect: State machine factory must enumerate all states from keys
  it("creates machine with all states from transition map", () => {
    const machine = createStateMachine({
      idle: ["running"],
      running: ["paused", "stopped"],
      paused: ["running"],
      stopped: [],
    });

    assert.deepEqual(machine.states, ["idle", "running", "paused", "stopped"]);
  });

  // Defect: Empty transition map should work (edge case)
  it("handles empty transition map", () => {
    const machine = createStateMachine({});
    assert.deepEqual(machine.states, []);
  });

  // Defect: Undeclared target states must throw at creation time
  it("throws on undeclared target state", () => {
    assert.throws(
      () => createStateMachine({ a: ["b"], b: ["ghost"] }),
      /Undeclared target state "ghost" in transition from "b"/,
    );
  });
});

// ============================================================================
// TRANSITION VALIDATION
// ============================================================================

describe("canTransition", () => {
  // slop-ignore: no_negative_test — canTransition is a pure predicate API that returns false for invalid transitions instead of throwing.
  const machine = createStateMachine({
    idle: ["running"],
    running: ["paused", "stopped"],
    paused: ["running"],
    stopped: [],
  });

  // Defect: Valid transitions must return true
  it("returns true for valid transition", () => {
    assert.equal(canTransition(machine, "idle", "running"), true);
    assert.equal(canTransition(machine, "running", "paused"), true);
    assert.equal(canTransition(machine, "running", "stopped"), true);
  });

  // Defect: Invalid transitions must return false (not throw)
  it("returns false for invalid transition", () => {
    assert.equal(canTransition(machine, "idle", "stopped"), false);
    assert.equal(canTransition(machine, "stopped", "idle"), false);
    assert.equal(canTransition(machine, "paused", "stopped"), false);
  });

  // Defect: Unknown states must return false (not throw)
  it("returns false for unknown state", () => {
    assert.equal(canTransition(machine, "unknown" as "idle", "running"), false);
  });

  // Defect: Self-transitions only valid if explicitly listed
  it("rejects self-transition unless explicit", () => {
    assert.equal(canTransition(machine, "idle", "idle"), false);
    assert.equal(canTransition(machine, "running", "running"), false);
  });
});

describe("assertTransition", () => {
  const machine = createStateMachine({
    idle: ["running"],
    running: ["stopped"],
    stopped: [],
  });

  // Defect: Assert must not throw on valid transition
  it("does not throw for valid transition", () => {
    assert.doesNotThrow(() => assertTransition(machine, "idle", "running"));
  });

  // Defect: Assert must throw with descriptive message on invalid
  it("throws for invalid transition with valid targets", () => {
    assert.throws(
      () => assertTransition(machine, "idle", "stopped"),
      /Invalid transition: idle -> stopped.*Valid targets from idle: \[running\]/,
    );
  });
});

// ============================================================================
// TERMINAL STATES
// ============================================================================

describe("getTerminalStates", () => {
  // Defect: Must identify states with no outgoing transitions
  it("returns states with empty transition arrays", () => {
    const machine = createStateMachine({
      start: ["middle"],
      middle: ["end"],
      end: [],
    });

    assert.deepEqual(getTerminalStates(machine), ["end"]);
  });

  // Defect: Multiple terminal states must all be returned
  it("returns multiple terminal states", () => {
    const machine = createStateMachine({
      start: ["win", "lose"],
      win: [],
      lose: [],
    });

    const terminals = getTerminalStates(machine);
    assert.equal(terminals.length, 2);
    assert.ok(terminals.includes("win"));
    assert.ok(terminals.includes("lose"));
  });
});

// ============================================================================
// TRANSITION MATRIX
// ============================================================================

describe("testTransitionMatrix", () => {
  const machine = createStateMachine({
    a: ["b"],
    b: ["c"],
    c: [],
  });

  // Defect: Matrix must have N*N entries for N states
  it("generates N*N entries", () => {
    const matrix = testTransitionMatrix(machine);
    assert.equal(matrix.length, 9); // 3 * 3
  });

  // Defect: Each entry must have correct validity
  it("marks valid transitions correctly", () => {
    const matrix = testTransitionMatrix(machine);
    const ab = matrix.find((e) => e.from === "a" && e.to === "b");
    const ac = matrix.find((e) => e.from === "a" && e.to === "c");

    assert.equal(ab?.valid, true);
    assert.equal(ac?.valid, false);
  });
});

describe("getValidTransitionPairs", () => {
  // Defect: Must filter to only valid pairs
  it("returns only valid transitions", () => {
    const machine = createStateMachine({
      a: ["b", "c"],
      b: [],
      c: [],
    });

    const valid = getValidTransitionPairs(machine);
    assert.equal(valid.length, 2);
    assert.ok(valid.every((e) => e.valid));
  });
});

describe("getInvalidTransitionPairs", () => {
  // Defect: Must filter to only invalid pairs
  it("returns only invalid transitions", () => {
    const machine = createStateMachine({
      a: ["b"],
      b: [],
    });

    const invalid = getInvalidTransitionPairs(machine);
    // 2*2=4 total, 1 valid (a->b), so 3 invalid
    assert.equal(invalid.length, 3);
    assert.ok(invalid.every((e) => !e.valid));
  });
});

// ============================================================================
// GUARD TRUTH TABLE
// ============================================================================

describe("createGuardTruthTable", () => {
  interface GuardInput {
    state: string;
    hasPermission: boolean;
  }

  const canProceed = (input: GuardInput) => input.state === "ready" && input.hasPermission;

  // Defect: Must evaluate guard for each case
  it("evaluates guard for all cases", () => {
    const results = createGuardTruthTable(canProceed, [
      { inputs: { state: "ready", hasPermission: true }, expected: true },
      { inputs: { state: "ready", hasPermission: false }, expected: false },
      { inputs: { state: "idle", hasPermission: true }, expected: false },
    ]);

    assert.equal(results.length, 3);
    assert.ok(results.every((r) => r.pass));
  });

  // Defect: Must detect when actual differs from expected
  it("marks failures when actual differs from expected", () => {
    const results = createGuardTruthTable(canProceed, [
      { inputs: { state: "ready", hasPermission: true }, expected: false }, // Wrong expectation
    ]);

    assert.equal(results[0].pass, false);
    assert.equal(results[0].expected, false);
    assert.equal(results[0].actual, true);
  });
});

describe("assertGuardTruthTable", () => {
  const isEven = (input: { n: number }) => input.n % 2 === 0;

  // Defect: Must not throw when all cases pass
  it("does not throw when all cases pass", () => {
    assert.doesNotThrow(() => {
      assertGuardTruthTable(isEven, [
        { inputs: { n: 2 }, expected: true },
        { inputs: { n: 3 }, expected: false },
        { inputs: { n: 0 }, expected: true },
      ]);
    });
  });

  // Defect: Must throw with details when cases fail
  it("throws with failure details", () => {
    assert.throws(
      () => assertGuardTruthTable(isEven, [{ inputs: { n: 2 }, expected: false, label: "two" }]),
      /Guard truth table: 1\/1 cases failed.*two.*expected false, got true/s,
    );
  });
});

// ============================================================================
// CONTEXT MUTATION
// ============================================================================

describe("assertContextMutation", () => {
  // Defect: Must pass when expected changes match
  it("passes when expected fields change correctly", () => {
    const before = { count: 0, name: "test" };
    const after = { count: 1, name: "test" };

    const result = assertContextMutation(before, after, { count: 1 });

    assert.deepEqual(result.changed, ["count"]);
    assert.deepEqual(result.unchanged, ["name"]);
    assert.deepEqual(result.unexpected, []);
  });

  // Defect: Must throw when expected change is wrong
  it("throws when expected change has wrong value", () => {
    const before = { count: 0 };
    const after = { count: 2 };

    assert.throws(() => assertContextMutation(before, after, { count: 1 }), /count: expected 1, got 2/);
  });

  // Defect: Expected change on removed key must throw (not silently match undefined)
  it("throws when expected key was removed from after", () => {
    const before = { a: 1, b: 2 } as Record<string, unknown>;
    const after = { b: 2 } as Record<string, unknown>;

    assert.throws(
      () => assertContextMutation(before, after, { a: undefined }),
      /a: expected undefined, but key was removed/,
    );
  });

  // Defect: Must throw when unexpected field changes
  it("throws when non-expected field changes", () => {
    const before = { count: 0, name: "old" };
    const after = { count: 1, name: "new" };

    assert.throws(
      () => assertContextMutation(before, after, { count: 1 }),
      /name: changed unexpectedly from "old" to "new"/,
    );
  });

  // Defect: Must detect newly added keys in after
  it("throws when after has keys not in before", () => {
    const before = { count: 1 };
    const after = { count: 1, leaked: true };

    assert.throws(() => assertContextMutation(before, after as typeof before, {}), /leaked: appeared unexpectedly/);
  });

  // Defect: Must detect field removal (key present with undefined vs key absent)
  it("detects field removal as unexpected change", () => {
    const before = { a: undefined, b: 1 } as Record<string, unknown>;
    const after = { b: 1 } as Record<string, unknown>;

    assert.throws(() => assertContextMutation(before, after, {}), /a: removed unexpectedly/);
  });

  // Defect: Must use deep equality for object/array values
  it("compares nested objects structurally, not by reference", () => {
    const before = { count: 0, meta: { a: 1 } };
    const after = { count: 1, meta: { a: 1 } };

    const result = assertContextMutation(before, after, { count: 1 });
    assert.deepEqual(result.unchanged, ["meta"]); // meta unchanged despite different reference
  });

  // Defect: Must handle expected changes with nested objects
  it("accepts structurally equal expected objects", () => {
    const before = { tags: ["old"] };
    const after = { tags: ["new", "added"] };

    const result = assertContextMutation(before, after, { tags: ["new", "added"] });
    assert.deepEqual(result.changed, ["tags"]);
  });

  // Defect: Must handle multiple expected changes
  it("handles multiple expected changes", () => {
    const before = { a: 1, b: 2, c: 3 };
    const after = { a: 10, b: 20, c: 3 };

    const result = assertContextMutation(before, after, { a: 10, b: 20 });

    assert.deepEqual(result.changed, ["a", "b"]);
    assert.deepEqual(result.unchanged, ["c"]);
  });
});

// ============================================================================
// INTEGRATION: FULL WORKFLOW
// ============================================================================

describe("integration: workflow state machine", () => {
  type WorkflowState = "draft" | "review" | "approved" | "rejected" | "published";

  const workflow = createStateMachine<WorkflowState>({
    draft: ["review"],
    review: ["approved", "rejected"],
    approved: ["published"],
    rejected: ["draft"],
    published: [],
  });

  // Defect: Integration test ensures all components work together
  it("validates complete workflow paths", () => {
    // Happy path: draft -> review -> approved -> published
    const happyPath: WorkflowState[] = ["draft", "review", "approved", "published"];
    for (let i = 0; i < happyPath.length - 1; i++) {
      assert.ok(
        canTransition(workflow, happyPath[i], happyPath[i + 1]),
        `${happyPath[i]} -> ${happyPath[i + 1]} should be valid`,
      );
    }

    // Rejection path: draft -> review -> rejected -> draft
    const rejectionPath: WorkflowState[] = ["draft", "review", "rejected", "draft"];
    for (let i = 0; i < rejectionPath.length - 1; i++) {
      assert.ok(
        canTransition(workflow, rejectionPath[i], rejectionPath[i + 1]),
        `${rejectionPath[i]} -> ${rejectionPath[i + 1]} should be valid`,
      );
    }
  });

  it("identifies published as terminal state", () => {
    const terminals = getTerminalStates(workflow);
    assert.deepEqual(terminals, ["published"]);
  });

  it("matrix covers all 25 state pairs", () => {
    const matrix = testTransitionMatrix(workflow);
    assert.equal(matrix.length, 25); // 5 * 5

    // Count valid transitions
    const valid = matrix.filter((e) => e.valid);
    assert.equal(valid.length, 5); // draft->review, review->approved, review->rejected, approved->published, rejected->draft
  });

  // Defect: invalid workflow jumps must fail loudly in assertion helpers to prevent silent invalid state transitions.
  it("throws on impossible workflow jump", () => {
    assert.throws(() => assertTransition(workflow, "draft", "published"), /Invalid transition: draft -> published/);
  });
});
