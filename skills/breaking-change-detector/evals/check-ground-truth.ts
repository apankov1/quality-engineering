/**
 * Ground truth regression check — calls classification functions directly
 * to verify fixtures produce expected results. Tests the ANALYZER, not the skill.
 * Use run-benchmark.ts to test whether the skill improves model behavior.
 *
 * Usage: npx tsx evals/check-ground-truth.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyApiFieldSemantics,
  classifyDeserializerSafety,
  classifyEnumValueChanges,
  classifyEventTypeChanges,
  classifyFieldChange,
  classifySerializedSchema,
  classifyStatusCodeChanges,
} from "../breaking-change.ts";
import type { ApiFieldDefinition, FieldChange, SchemaField } from "../breaking-change.ts";

const sep = "=".repeat(70);

// --- Eval 1: contract-field-removal ---
console.log(`\n${sep}`);
console.log("EVAL 1: contract-field-removal");
console.log(sep);

const fieldChanges1: { desc: string; change: FieldChange }[] = [
  { desc: "Removed score", change: { action: "remove" } },
  { desc: "Renamed userName→displayName", change: { action: "rename" } },
  { desc: "Narrowed status (string→union)", change: { action: "narrow" } },
  { desc: "Added required tenantId", change: { action: "add", optional: false } },
];
for (const { desc, change } of fieldChanges1) {
  console.log(`  ${classifyFieldChange(change).toUpperCase()}: ${desc}`);
}

// --- Eval 2: contract-safe-additions ---
console.log(`\n${sep}`);
console.log("EVAL 2: contract-safe-additions");
console.log(sep);

const fieldChanges2: { desc: string; change: FieldChange }[] = [
  { desc: "Added optional metadata", change: { action: "add", optional: true } },
  { desc: "Added optional tags", change: { action: "add", optional: true } },
  { desc: "Widened category (union→string)", change: { action: "widen" } },
  { desc: "Made sku optional", change: { action: "make_optional" } },
];
for (const { desc, change } of fieldChanges2) {
  console.log(`  ${classifyFieldChange(change).toUpperCase()}: ${desc}`);
}

// --- Eval 3: schema-missing-catch ---
console.log(`\n${sep}`);
console.log("EVAL 3: schema-missing-catch");
console.log(sep);

const schemaFields3: SchemaField[] = [
  { name: "version", hasCatchDefault: false },
  { name: "playerId", hasCatchDefault: false },
  { name: "level", hasCatchDefault: false },
  { name: "inventory", hasCatchDefault: false },
  { name: "achievements", hasCatchDefault: false },
  { name: "settings.volume", hasCatchDefault: false },
  { name: "settings.difficulty", hasCatchDefault: false },
  { name: "settings.language", hasCatchDefault: true },
  { name: "lastCheckpoint", hasCatchDefault: false },
];
const result3 = classifySerializedSchema(schemaFields3);
console.log(`  Safe: ${result3.safe}`);
console.log(`  Violations (${result3.violations.length}):`);
for (const v of result3.violations) {
  console.log(`    - ${v}`);
}

// --- Eval 4: schema-with-catch ---
console.log(`\n${sep}`);
console.log("EVAL 4: schema-with-catch");
console.log(sep);

const schemaFields4: SchemaField[] = [
  { name: "version", hasCatchDefault: true },
  { name: "name", hasCatchDefault: true },
  { name: "ownerId", hasCatchDefault: true },
  { name: "members", hasCatchDefault: true },
  { name: "settings", hasCatchDefault: true },
  { name: "createdAt", hasCatchDefault: true },
  { name: "updatedAt", hasCatchDefault: true },
];
const result4 = classifySerializedSchema(schemaFields4);
console.log(`  Safe: ${result4.safe}`);
console.log(`  Violations: ${result4.violations.length}`);

// --- Eval 5: deserializer-strict-parse ---
console.log(`\n${sep}`);
console.log("EVAL 5: deserializer-strict-parse");
console.log(sep);

const source5 = readFileSync(join(import.meta.dirname, "fixtures/deserializer-strict-parse.ts"), "utf-8");
const result5 = classifyDeserializerSafety(source5);
console.log(`  Safe: ${result5.safe}`);
console.log(`  Violations (${result5.violations.length}):`);
for (const v of result5.violations) {
  console.log(`    - Line ${v.line}: ${v.message}`);
  console.log(`      ${v.snippet}`);
}

// --- Eval 6: deserializer-safe-parse ---
console.log(`\n${sep}`);
console.log("EVAL 6: deserializer-safe-parse");
console.log(sep);

const source6 = readFileSync(join(import.meta.dirname, "fixtures/deserializer-safe-parse.ts"), "utf-8");
const result6 = classifyDeserializerSafety(source6);
console.log(`  Safe: ${result6.safe}`);
console.log(`  Violations: ${result6.violations.length}`);

// --- Eval 7: event-type-removal ---
console.log(`\n${sep}`);
console.log("EVAL 7: event-type-removal");
console.log(sep);

const oldEvents = [
  "ORDER_CREATED",
  "ORDER_UPDATED",
  "ORDER_CANCELLED",
  "ORDER_COMPLETED",
  "PAYMENT_PENDING",
  "PAYMENT_COMPLETED",
  "PAYMENT_FAILED",
  "REFUND_INITIATED",
  "REFUND_COMPLETED",
  "SHIPPING_STARTED",
  "SHIPPING_DELIVERED",
];
const newEvents = [
  "ORDER_CREATED",
  "ORDER_MODIFIED",
  "ORDER_CANCELLED",
  "ORDER_COMPLETED",
  "ORDER_ARCHIVED",
  "PAYMENT_INITIATED",
  "PAYMENT_COMPLETED",
  "PAYMENT_FAILED",
  "REFUND_INITIATED",
  "REFUND_COMPLETED",
  "SHIPPING_STARTED",
  "SHIPPING_DELIVERED",
];
const result7 = classifyEventTypeChanges(oldEvents, newEvents);
console.log(`  Safe: ${result7.safe}`);
console.log(`  Removed: ${result7.removed.join(", ")}`);
console.log(`  Added: ${result7.added.join(", ")}`);

// --- Eval 8: api-field-changes ---
console.log(`\n${sep}`);
console.log("EVAL 8: api-field-changes");
console.log(sep);

const oldFields: ApiFieldDefinition[] = [
  { name: "id", type: "string", required: true },
  { name: "name", type: "string", required: true },
  { name: "email", type: "string", required: false },
  { name: "avatar", type: "string", required: false },
  { name: "age", type: "number", required: false },
  { name: "role", type: "string", required: true, semantic: "permission level" },
  { name: "createdAt", type: "string", required: true },
];
const newFields: ApiFieldDefinition[] = [
  { name: "id", type: "string", required: true },
  { name: "name", type: "string", required: true },
  { name: "email", type: "string", required: true },
  { name: "age", type: "string", required: false },
  { name: "role", type: "string", required: true, semantic: "department" },
  { name: "createdAt", type: "string", required: true },
  { name: "phone", type: "string", required: false },
  { name: "timezone", type: "string", required: false },
];
const result8 = classifyApiFieldSemantics(oldFields, newFields);
console.log(`  Safe: ${result8.safe}`);
console.log(`  Breaking (${result8.breaking.length}):`);
for (const b of result8.breaking) {
  console.log(`    - ${b}`);
}
console.log(`  Added: ${result8.added.join(", ")}`);

// --- Eval 9: enum-status-mixed ---
console.log(`\n${sep}`);
console.log("EVAL 9: enum-status-mixed");
console.log(sep);

const statusResult = classifyStatusCodeChanges([200, 202, 400, 401, 404, 500], [200, 207, 400, 401, 404, 500]);
console.log(
  `  Status codes — Safe: ${statusResult.safe}, Removed: [${statusResult.removed}], Added: [${statusResult.added}]`,
);

const enumResult = classifyEnumValueChanges(
  ["pending", "confirmed", "shipped", "delivered", "cancelled", "on_hold"],
  ["pending", "confirmed", "shipped", "delivered", "cancelled", "archived"],
);
console.log(`  Enum values — Safe: ${enumResult.safe}, Removed: [${enumResult.removed}], Added: [${enumResult.added}]`);

// --- Eval 10: all-safe-changes ---
console.log(`\n${sep}`);
console.log("EVAL 10: all-safe-changes");
console.log(sep);

const safeFieldChanges: FieldChange[] = [
  { action: "add", optional: true },
  { action: "add", optional: true },
  { action: "widen" },
  { action: "make_optional" },
];
const allSafe = safeFieldChanges.every((c) => classifyFieldChange(c) === "safe");
console.log(`  All field changes safe: ${allSafe}`);

const safeEvents = classifyEventTypeChanges(
  ["SENT", "DELIVERED", "BOUNCED", "FAILED"],
  ["SENT", "DELIVERED", "BOUNCED", "FAILED", "AUDIT_LOGGED"],
);
console.log(`  Event types safe: ${safeEvents.safe}, Added: [${safeEvents.added}]`);

const safeStatus = classifyStatusCodeChanges([200, 400, 401, 500], [200, 207, 400, 401, 500]);
console.log(`  Status codes safe: ${safeStatus.safe}, Added: [${safeStatus.added}]`);

const safeEnum = classifyEnumValueChanges(
  ["queued", "sending", "sent", "failed"],
  ["queued", "sending", "sent", "failed", "retrying"],
);
console.log(`  Enum values safe: ${safeEnum.safe}, Added: [${safeEnum.added}]`);

// --- Eval 11: false-positive-deprecation ---
console.log(`\n${sep}`);
console.log("EVAL 11: false-positive-deprecation");
console.log(sep);

const deprecationChanges: { desc: string; change: FieldChange }[] = [
  { desc: "planName made optional (deprecated, not removed)", change: { action: "make_optional" } },
  { desc: "Added optional planDisplayName", change: { action: "add", optional: true } },
  { desc: "legacyPlanId made optional (deprecated)", change: { action: "make_optional" } },
  { desc: "Widened currency (union→string)", change: { action: "widen" } },
  { desc: "Made discount optional", change: { action: "make_optional" } },
  { desc: "Added optional billingCycle", change: { action: "add", optional: true } },
];
for (const { desc, change } of deprecationChanges) {
  console.log(`  ${classifyFieldChange(change).toUpperCase()}: ${desc}`);
}
const allDeprecationSafe = deprecationChanges.every((c) => classifyFieldChange(c.change) === "safe");
console.log(`  All changes safe: ${allDeprecationSafe}`);
