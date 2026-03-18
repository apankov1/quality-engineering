/**
 * Ground truth regression check — calls classification functions on actual
 * fixture files and compares results against evals.json ground_truth.
 * Exits non-zero if any fixture drifts from its declared ground truth.
 *
 * Usage: npx tsx evals/check-ground-truth.ts [eval-ids...]
 * Example: npx tsx evals/check-ground-truth.ts 3 4 5 6
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyDeserializerSafety } from "../breaking-change.ts";

const evalsPath = join(import.meta.dirname, "evals.json");
const evalsData = JSON.parse(readFileSync(evalsPath, "utf-8"));

const requestedIds = process.argv.slice(2).map(Number);
const evalsToRun =
  requestedIds.length > 0
    ? evalsData.evals.filter((e: { id: number }) => requestedIds.includes(e.id))
    : evalsData.evals;

const sep = "=".repeat(70);
let totalPassed = 0;
let totalFailed = 0;

interface EvalDef {
  id: number;
  name: string;
  files: string[];
  ground_truth: Record<string, unknown>;
}

for (const evalDef of evalsToRun as EvalDef[]) {
  console.log(`\n${sep}`);
  console.log(`EVAL ${evalDef.id}: ${evalDef.name}`);
  console.log(sep);

  const gt = evalDef.ground_truth;
  if (!gt) {
    console.log("  SKIP — no ground_truth defined");
    continue;
  }

  // files[] paths are relative to the skill dir, not the evals/ dir
  const skillDir = join(import.meta.dirname, "..");
  const fixturePath = join(skillDir, evalDef.files[0]);
  let source: string;
  try {
    source = readFileSync(fixturePath, "utf-8");
  } catch {
    console.log(`  FAIL — fixture not found: ${fixturePath}`);
    totalFailed++;
    continue;
  }

  // --- Schema evals (3, 4): classifySerializedSchema takes structured SchemaField[] input,
  // not raw source code. These evals can't be automated from fixtures alone —
  // they need the structured extraction layer that the model provides.
  if (evalDef.name.startsWith("schema-")) {
    console.log("  SKIP — schema classifier takes structured input, not raw .ts source");
    console.log(`  Ground truth: ${JSON.stringify(gt)}`);
    continue;
  }

  // --- Deserializer evals (5, 6): classify safety from source ---
  if (evalDef.name.startsWith("deserializer-")) {
    try {
      const result = classifyDeserializerSafety(source);

      const expectedSafe = gt.all_safe ?? gt.safe;
      if (expectedSafe !== undefined) {
        if (result.safe === expectedSafe) {
          console.log(`  PASS: safe=${result.safe} (expected ${expectedSafe})`);
          totalPassed++;
        } else {
          console.log(`  FAIL: safe=${result.safe} (expected ${expectedSafe})`);
          totalFailed++;
        }
      }

      if (result.violations.length > 0) {
        for (const v of result.violations) {
          console.log(`    - Line ${v.line}: ${v.message}`);
        }
      }
    } catch (err) {
      console.log(`  FAIL — classifyDeserializerSafety threw: ${err}`);
      totalFailed++;
    }
    continue;
  }

  // --- Other evals: report ground truth for manual verification ---
  // Contract field changes, event types, API fields, etc. don't have a
  // fixture→classifier pipeline that reads raw .ts files (the classifier
  // takes structured input, not source code). Log ground truth for reference.
  console.log("  INFO — ground_truth declared but no source→classifier pipeline for this eval type.");
  console.log(`  Ground truth: ${JSON.stringify(gt, null, 2).split("\n").join("\n  ")}`);
}

// --- Summary ---
console.log(`\n${sep}`);
console.log(`SUMMARY: ${totalPassed} passed, ${totalFailed} failed`);
console.log(sep);

if (totalFailed > 0) {
  process.exit(1);
}
