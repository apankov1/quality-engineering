/**
 * Ground truth regression check — calls analyzeTestFile() directly to verify
 * fixtures produce the expected findings. This tests the ANALYZER, not the skill.
 * Use run-benchmark.ts to test whether the skill improves model behavior.
 *
 * Usage: npx tsx evals/check-ground-truth.ts [eval-ids...]
 * Example: npx tsx evals/check-ground-truth.ts 1 4 10
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeTestFile, formatReport, getPreset } from "../slop-detector.ts";

const evalsPath = join(import.meta.dirname, "evals.json");
const evalsData = JSON.parse(readFileSync(evalsPath, "utf-8"));

const requestedIds = process.argv.slice(2).map(Number);
const evalsToRun =
  requestedIds.length > 0
    ? evalsData.evals.filter((e: { id: number }) => requestedIds.includes(e.id))
    : evalsData.evals;

let totalPassed = 0;
let totalFailed = 0;

for (const eval_ of evalsToRun) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`EVAL ${eval_.id}: ${eval_.name}`);
  console.log(`${"=".repeat(70)}`);

  // Load fixture
  const fixturePath = join(import.meta.dirname, "..", eval_.files[0]);
  const source = readFileSync(fixturePath, "utf-8");

  // Configure preset
  const isStrict = eval_.name.includes("defect-comments");
  const config = getPreset(isStrict ? "strict" : "balanced");

  if (eval_.name.includes("false-positive-helpers")) {
    config.assertionEquivalents = ["assertEventEmitted", "assertPayloadContains", "testDeliveryOrder"];
  }

  // Run analysis
  const report = analyzeTestFile(source, fixturePath, config);
  const ruleNames = report.findings.map((f) => f.rule);

  // Print report
  console.log(formatReport(report));

  // Check ground truth only (not natural language expectations — those are for the grader)
  const gt = eval_.ground_truth;
  let passed = 0;
  let failed = 0;

  // Check expected rules present
  for (const rule of gt.expected_rules) {
    if (ruleNames.includes(rule)) {
      console.log(`  PASS: Expected rule '${rule}' found`);
      passed++;
    } else {
      console.log(`  FAIL: Expected rule '${rule}' NOT found`);
      failed++;
    }
  }

  // Check forbidden rules on clean tests
  for (const testFragment of gt.forbidden_rules_on_clean_tests) {
    const flagged = report.findings.some((f) => f.testName.includes(testFragment));
    if (flagged) {
      console.log(`  FAIL: Clean test '${testFragment}' was incorrectly flagged`);
      failed++;
    } else {
      console.log(`  PASS: Clean test '${testFragment}' not flagged`);
      passed++;
    }
  }

  // Check score
  if (report.score === gt.score) {
    console.log(`  PASS: Score ${report.score} matches`);
    passed++;
  } else {
    console.log(`  FAIL: Score ${report.score} != expected ${gt.score}`);
    failed++;
  }

  // Check counts
  if (report.summary.mustFail === gt.must_fail_count) {
    console.log(`  PASS: Must-fail count ${report.summary.mustFail} matches`);
    passed++;
  } else {
    console.log(`  FAIL: Must-fail count ${report.summary.mustFail} != expected ${gt.must_fail_count}`);
    failed++;
  }

  if (report.summary.shouldFail === gt.should_fail_count) {
    console.log(`  PASS: Should-fail count ${report.summary.shouldFail} matches`);
    passed++;
  } else {
    console.log(`  FAIL: Should-fail count ${report.summary.shouldFail} != expected ${gt.should_fail_count}`);
    failed++;
  }

  console.log(`  RESULT: ${passed} passed, ${failed} failed`);
  totalPassed += passed;
  totalFailed += failed;
}

console.log(`\n${"=".repeat(70)}`);
console.log(`TOTAL: ${totalPassed} passed, ${totalFailed} failed`);
if (totalFailed > 0) process.exit(1);
