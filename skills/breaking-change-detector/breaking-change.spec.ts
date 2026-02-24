import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyEventTypeChanges, classifyFieldChange, classifySerializedSchema } from "./breaking-change.ts";

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

  // Defect: field removal silently breaks all consumers still reading it.
  // Before fix: removal was unclassified (fell through switch).
  // After fix: explicit 'breaking' for remove/rename.
  it("removing field is breaking", () => {
    assert.equal(classifyFieldChange({ action: "remove" }), "breaking");
  });

  it("renaming field is breaking", () => {
    assert.equal(classifyFieldChange({ action: "rename" }), "breaking");
  });

  // Defect: narrowing a type (e.g., string → enum) rejects valid old data.
  // Widening (e.g., enum → string) accepts all old data — safe.
  it("widening type is safe", () => {
    assert.equal(classifyFieldChange({ action: "widen" }), "safe");
  });

  it("narrowing type is breaking", () => {
    assert.equal(classifyFieldChange({ action: "narrow" }), "breaking");
  });

  // Defect: making a field required breaks old data that omits it.
  // Making optional is always safe — old data still valid.
  it("making optional is safe", () => {
    assert.equal(classifyFieldChange({ action: "make_optional" }), "safe");
  });

  it("making required is breaking", () => {
    assert.equal(classifyFieldChange({ action: "make_required" }), "breaking");
  });
});

describe("serialized state schema (category 5)", () => {
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

describe("event type changes (category 6)", () => {
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
    assert.equal(result.removed.length, 1);
    assert.ok(result.removed.includes("ORDER_PLACED"));
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
    assert.equal(result.removed.length, 1);
    assert.equal(result.added.length, 1);
    assert.ok(result.removed.includes("ORDER_PLACED"));
    assert.ok(result.added.includes("ORDER_CREATED"));
  });

  it("mixed: some added, some removed", () => {
    const result = classifyEventTypeChanges(["A", "B", "C"], ["B", "D", "E"]);
    assert.equal(result.safe, false);
    assert.deepEqual(result.removed.sort(), ["A", "C"]);
    assert.deepEqual(result.added.sort(), ["D", "E"]);
  });
});
