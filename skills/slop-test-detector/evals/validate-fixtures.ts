/**
 * Ground truth validator — runs analyzeTestFile() on each fixture
 * and prints the actual findings vs expected.
 *
 * Usage: npx tsx evals/validate-fixtures.ts
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { analyzeTestFile, getPreset } from "../slop-detector.js";

const fixturesDir = join(import.meta.dirname, "fixtures");
const files = readdirSync(fixturesDir)
  .filter((f) => f.endsWith(".spec.ts"))
  .sort();

for (const file of files) {
  const filePath = join(fixturesDir, file);
  const source = readFileSync(filePath, "utf-8");

  // Use balanced preset for most, strict for defect-comments
  const isStrict = file.includes("defect-comments");
  const config = getPreset(isStrict ? "strict" : "balanced");

  // For false-positive-helpers, configure assertion equivalents
  if (file.includes("false-positive-helpers")) {
    config.assertionEquivalents = ["assertEventEmitted", "assertPayloadContains", "testDeliveryOrder"];
  }

  const report = analyzeTestFile(source, filePath, config);

  console.log(`\n${"=".repeat(70)}`);
  console.log(`FILE: ${file}`);
  console.log(
    `Score: ${report.score}/100 | Tests: ${report.summary.testCount} | Must-fail: ${report.summary.mustFail} | Should-fail: ${report.summary.shouldFail}`,
  );

  if (report.findings.length === 0) {
    console.log("  (no findings)");
  } else {
    for (const f of report.findings) {
      console.log(`  [${f.severity}] ${f.rule} — "${f.testName}" (line ${f.line})`);
      console.log(`    ${f.message}`);
    }
  }
}
