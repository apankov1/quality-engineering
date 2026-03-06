import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyApiFieldSemantics,
  classifyDeserializerSafety,
  classifyEnumValueChanges,
  classifyEventTypeChanges,
  classifyFieldChange,
  classifySerializedSchema,
  classifyStatusCodeChanges,
} from "./breaking-change.ts";

/**
 * Tests for the breaking change classification utilities.
 *
 * Each test demonstrates the fail-before/fix-after pattern:
 * - The assertion proves the classifier catches the defect
 * - If the classifier were wrong (e.g., returned 'safe' for a removal),
 *   the test would fail — proving detection works
 */

describe("contract field changes (category 1)", () => {
  // Defect: adding a required field breaks old producers that don't send it.
  // Before fix: classifier returned 'safe' for all additions.
  // After fix: 'safe' only when optional=true.
  it("adding optional field is safe", () => {
    assert.equal(classifyFieldChange({ action: "add", optional: true }), "safe");
  });

  it("adding required field is breaking", () => {
    assert.equal(classifyFieldChange({ action: "add", optional: false }), "breaking");
  });

  // Defect: field removal/rename/narrow/required promotion break backwards compatibility.
  // Before fix: some actions were not explicitly classified.
  it("classifies irreversible actions as breaking", () => {
    const actions = ["remove", "rename", "narrow", "make_required"] as const;
    const results = actions.map((action) => classifyFieldChange({ action }));
    assert.deepEqual(results, ["breaking", "breaking", "breaking", "breaking"]);
  });

  // Defect: widening types and making fields optional should remain backward compatible.
  it("classifies widening and optionalization as safe", () => {
    const actions = ["widen", "make_optional"] as const;
    const results = actions.map((action) => classifyFieldChange({ action }));
    assert.deepEqual(results, ["safe", "safe"]);
  });

  it("throws on unknown action", () => {
    const invalidChange = { action: "unknown" } as unknown as Parameters<typeof classifyFieldChange>[0];
    assert.throws(() => classifyFieldChange(invalidChange), /Unknown field change action/);
  });
});

describe("serialized state schema (category 5)", () => {
  // slop-ignore: no_negative_test — this classifier reports violations in return values, not thrown errors.
  it("all fields with .catch() is safe", () => {
    const result = classifySerializedSchema([
      { name: "version", hasCatchDefault: true },
      { name: "counter", hasCatchDefault: true },
      { name: "activeId", hasCatchDefault: true },
    ]);
    assert.equal(result.safe, true);
    assert.equal(result.violations.length, 0);
  });

  // Defect: schema field without .catch() throws on old hibernated data.
  // Before fix: validator didn't check for .catch() defaults.
  // After fix: every field missing .catch() is reported as a violation.
  it("field without .catch() is a violation", () => {
    const result = classifySerializedSchema([
      { name: "version", hasCatchDefault: true },
      { name: "counter", hasCatchDefault: false },
    ]);
    assert.equal(result.safe, false);
    assert.equal(result.violations.length, 1);
    assert.ok(result.violations[0].includes("counter"));
  });

  // Defect: multiple missing .catch() fields only reported one violation.
  // Before fix: validator returned on first violation.
  // After fix: collects ALL violations for batch reporting.
  it("multiple missing .catch() reports all violations", () => {
    const result = classifySerializedSchema([
      { name: "version", hasCatchDefault: false },
      { name: "counter", hasCatchDefault: false },
      { name: "activeId", hasCatchDefault: true },
    ]);
    assert.equal(result.safe, false);
    assert.equal(result.violations.length, 2);
  });
});

describe("deserializer safety (category 5)", () => {
  // slop-ignore: no_negative_test — parser safety is modeled as safe=false with violation metadata.
  it("safeParse in fromJSON is safe", () => {
    const result = classifyDeserializerSafety(`
class State {
  static fromJSON(json: unknown) {
    const parsed = Schema.safeParse(json);
    if (!parsed.success) return new State();
    return new State();
  }
}
`);
    assert.deepEqual(result, { safe: true, violations: [] });
  });

  it("parse in fromJSON is breaking", () => {
    const result = classifyDeserializerSafety(`
class State {
  static fromJSON(json: unknown) {
    return Schema.parse(json);
  }
}
`);
    assert.equal(result.safe, false);
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0].line, 4);
  });

  it("parse outside fromJSON is ignored", () => {
    const result = classifyDeserializerSafety(`
const value = Schema.parse(input);
class State {
  static fromJSON(json: unknown) {
    return Schema.safeParse(json);
  }
}
`);
    assert.equal(result.safe, true);
    assert.deepEqual(result.violations, []);
  });

  it("single-line fromJSON does not leak detection scope", () => {
    const result = classifyDeserializerSafety(`
class State {
  static fromJSON(json: unknown) { return Schema.parse(json); }
}
const value = Schema.parse(input);
`);
    assert.equal(result.safe, false);
    assert.equal(result.violations.length, 1);
  });
});

describe("event type changes (category 6)", () => {
  // slop-ignore: no_negative_test — event compatibility is expressed as diff output, not exceptions.
  it("no changes is safe", () => {
    const result = classifyEventTypeChanges(["USER_CREATED", "ORDER_PLACED"], ["USER_CREATED", "ORDER_PLACED"]);
    assert.equal(result.safe, true);
    assert.equal(result.removed.length, 0);
    assert.equal(result.added.length, 0);
  });

  // Defect: adding new event types breaks nothing — old events still replay.
  it("adding event types is safe", () => {
    const result = classifyEventTypeChanges(["USER_CREATED"], ["USER_CREATED", "USER_DELETED"]);
    assert.equal(result.safe, true);
    assert.equal(result.added.length, 1);
    assert.ok(result.added.includes("USER_DELETED"));
  });

  // Defect: removing an event type breaks replay — old events have no handler.
  // Before fix: no detection — removed type silently ignored during replay.
  // After fix: removal detected, classified as breaking.
  it("removing event type is breaking", () => {
    const result = classifyEventTypeChanges(["USER_CREATED", "ORDER_PLACED"], ["USER_CREATED"]);
    assert.equal(result.safe, false);
    assert.deepEqual(result.removed, ["ORDER_PLACED"]);
  });

  // Defect: renaming an event type = removal + addition. Both old and new appear.
  // Before fix: rename looked "safe" because new type existed.
  // After fix: old type in removed list — classified as breaking.
  it("renaming event type is breaking (remove + add)", () => {
    const result = classifyEventTypeChanges(
      ["ORDER_PLACED"],
      ["ORDER_CREATED"], // renamed
    );
    assert.equal(result.safe, false);
    assert.deepEqual(result.removed, ["ORDER_PLACED"]);
    assert.deepEqual(result.added, ["ORDER_CREATED"]);
  });

  it("mixed: some added, some removed", () => {
    const result = classifyEventTypeChanges(["A", "B", "C"], ["B", "D", "E"]);
    assert.equal(result.safe, false);
    assert.deepEqual(result.removed.sort(), ["A", "C"]);
    assert.deepEqual(result.added.sort(), ["D", "E"]);
  });
});

describe("api-level compatibility checks", () => {
  // slop-ignore: no_negative_test — compatibility checks intentionally return diagnostics instead of throwing.
  // Defect: removing a status code breaks clients that branch on it (e.g., 404 handler becomes dead code).
  it("status code removal is breaking", () => {
    const result = classifyStatusCodeChanges([200, 400, 404], [200, 400]);
    assert.equal(result.safe, false);
    assert.deepEqual(result.removed, [404]);
  });

  it("status code additions are safe", () => {
    const result = classifyStatusCodeChanges([200], [200, 202]);
    assert.equal(result.safe, true);
    assert.deepEqual(result.added, [202]);
  });

  // Defect: removing an enum value breaks clients that store it — existing records fail validation.
  it("enum value removal is breaking", () => {
    const result = classifyEnumValueChanges(["draft", "published"], ["draft"]);
    assert.equal(result.safe, false);
    assert.deepEqual(result.removed, ["published"]);
  });

  it("enum value additions are safe", () => {
    const result = classifyEnumValueChanges(["draft"], ["draft", "archived"]);
    assert.equal(result.safe, true);
    assert.deepEqual(result.added, ["archived"]);
  });

  // Defect: semantic meaning change (dollars → cents) silently corrupts calculations — same type, different unit.
  it("semantic meaning changes are breaking", () => {
    const result = classifyApiFieldSemantics(
      [{ name: "amount", type: "number", required: true, semantic: "dollars" }],
      [{ name: "amount", type: "number", required: true, semantic: "cents" }],
    );
    assert.equal(result.safe, false);
    assert.equal(result.breaking[0], "amount: semantic changed from dollars to cents");
  });

  it("semantic removal is breaking", () => {
    const result = classifyApiFieldSemantics(
      [{ name: "amount", type: "number", required: true, semantic: "cents" }],
      [{ name: "amount", type: "number", required: true }],
    );
    assert.deepEqual(result.breaking, ["amount: semantic changed from cents to <unspecified>"]);
    assert.equal(result.added.length, 0);
  });

  it("semantic introduction is breaking", () => {
    const result = classifyApiFieldSemantics(
      [{ name: "amount", type: "number", required: true }],
      [{ name: "amount", type: "number", required: true, semantic: "cents" }],
    );
    assert.match(result.breaking[0], /semantic changed from <unspecified> to cents/);
    assert.equal(result.safe, false);
  });

  it("new required fields are breaking", () => {
    const result = classifyApiFieldSemantics(
      [{ name: "id", type: "string", required: true }],
      [
        { name: "id", type: "string", required: true },
        { name: "tenantId", type: "string", required: true },
      ],
    );
    assert.ok(result.breaking.includes("tenantId: new required field"));
    assert.equal(result.breaking.length, 1);
  });

  it("new optional fields are safe additions", () => {
    const result = classifyApiFieldSemantics(
      [{ name: "id", type: "string", required: true }],
      [
        { name: "id", type: "string", required: true },
        { name: "traceId", type: "string", required: false },
      ],
    );
    assert.deepEqual(result.added, ["traceId"]);
    assert.equal(result.breaking.length, 0);
  });

  it("field removal is breaking", () => {
    const result = classifyApiFieldSemantics(
      [
        { name: "id", type: "string", required: true },
        { name: "name", type: "string", required: true },
      ],
      [{ name: "id", type: "string", required: true }],
    );
    assert.deepEqual(result.breaking, ["name: removed"]);
  });

  // Defect: type change (string → number) breaks deserialization — runtime crash at parse site.
  it("type change is breaking", () => {
    const result = classifyApiFieldSemantics(
      [{ name: "amount", type: "string", required: true }],
      [{ name: "amount", type: "number", required: true }],
    );
    assert.match(result.breaking.join("|"), /amount: type changed from string to number/);
    assert.equal(result.added.length, 0);
  });

  it("optional-to-required promotion is breaking", () => {
    const result = classifyApiFieldSemantics(
      [{ name: "email", type: "string", required: false }],
      [{ name: "email", type: "string", required: true }],
    );
    assert.deepEqual(result.breaking, ["email: made required"]);
    assert.equal(result.safe, false);
  });

  it("no changes is safe", () => {
    const fields = [
      { name: "id", type: "string", required: true },
      { name: "name", type: "string", required: false },
    ];
    const result = classifyApiFieldSemantics(fields, fields);
    assert.equal(result.safe, true);
    assert.equal(result.breaking.length, 0);
    assert.equal(result.added.length, 0);
  });

  it("empty field lists are safe", () => {
    const result = classifyApiFieldSemantics([], []);
    assert.equal(result.safe, true);
    assert.equal(result.breaking.length, 0);
  });

  it("no changes to status codes is safe", () => {
    const result = classifyStatusCodeChanges([200, 400], [200, 400]);
    assert.equal(result.safe, true);
    assert.equal(result.removed.length, 0);
    assert.equal(result.added.length, 0);
  });

  it("no changes to enum values is safe", () => {
    const result = classifyEnumValueChanges(["draft", "published"], ["draft", "published"]);
    assert.deepEqual(result, { safe: true, removed: [], added: [] });
  });
});
