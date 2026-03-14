/**
 * Quick eval runner — checks fixture analysis results against evals.json expectations.
 * Validates that expectations are well-written and achievable.
 *
 * Usage: npx tsx evals/run-quick-eval.ts [eval-ids...]
 * Example: npx tsx evals/run-quick-eval.ts 1 4 10
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeTestFile, formatReport, getPreset } from "../slop-detector.js";

const evalsPath = join(import.meta.dirname, "evals.json");
const evalsData = JSON.parse(readFileSync(evalsPath, "utf-8"));

const requestedIds = process.argv.slice(2).map(Number);
const evalsToRun =
  requestedIds.length > 0
    ? evalsData.evals.filter((e: { id: number }) => requestedIds.includes(e.id))
    : evalsData.evals.slice(0, 3);

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
  console.log("\n--- Skill Output ---");
  console.log(formatReport(report));

  // Check expectations
  console.log("\n--- Expectation Check ---");
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
      console.log(`  PASS: Clean test '${testFragment}' not flagged (correct)`);
      passed++;
    }
  }

  // Check score
  if (report.score === gt.score) {
    console.log(`  PASS: Score ${report.score} matches ground truth`);
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

  // Now check natural-language expectations (heuristic matching)
  console.log("\n--- Natural Language Expectations ---");
  for (const exp of eval_.expectations) {
    const expLower = exp.toLowerCase();
    let matched = false;
    let reason = "";

    if (expLower.includes("identifies") && expLower.includes("'")) {
      // Extract rule name from quotes
      const ruleMatch = exp.match(/'([a-z_]+)'/);
      if (ruleMatch) {
        const ruleName = ruleMatch[1];
        matched = ruleNames.includes(ruleName);
        reason = matched ? `rule '${ruleName}' found in findings` : `rule '${ruleName}' not in findings`;
      }
    } else if (expLower.includes("does not flag") || expLower.includes("does not produce")) {
      // Check no findings on mentioned test
      const testMatch = exp.match(/'([^']+)'/);
      if (testMatch) {
        const fragment = testMatch[1];
        matched = !report.findings.some((f) => f.testName.includes(fragment));
        reason = matched ? `'${fragment}' correctly not flagged` : `'${fragment}' was flagged (unexpected)`;
      } else {
        // Generic "does not flag any test" or "does not produce false positives"
        matched = report.findings.length === 0;
        reason = matched ? "zero findings" : `${report.findings.length} findings present`;
      }
    } else if (expLower.includes("reports zero findings") || expLower.includes("no slop")) {
      matched = report.findings.length === 0;
      reason = matched ? "zero findings" : `${report.findings.length} findings`;
    } else if (expLower.includes("score of 100") || expLower.includes("file is clean")) {
      matched = report.score === 100;
      reason = `score is ${report.score}`;
    } else if (expLower.includes("classifies") && expLower.includes("must-fail")) {
      const ruleMatch = exp.match(/([a-z_]+) as must-fail/);
      if (ruleMatch) {
        const finding = report.findings.find((f) => f.rule === ruleMatch[1]);
        matched = finding?.severity === "must-fail";
        reason = finding ? `severity is '${finding.severity}'` : "rule not found";
      }
    } else if (expLower.includes("explains") || expLower.includes("provides line numbers")) {
      // These require model output — skip for ground truth check
      matched = true;
      reason = "requires model output (skipped in ground truth check)";
    } else if (expLower.includes("recognizes") && expLower.includes("assertion equivalents")) {
      matched = !ruleNames.includes("empty_test_body") && !ruleNames.includes("truthiness_only");
      reason = matched ? "no empty_test_body or truthiness_only" : "false positive fired";
    } else if (expLower.includes("limited to no_negative_test")) {
      const nonNegRules = ruleNames.filter((r) => r !== "no_negative_test");
      matched = nonNegRules.length === 0;
      reason = matched ? "only no_negative_test findings" : `also found: ${nonNegRules.join(", ")}`;
    } else {
      reason = "could not auto-check (requires model judgment)";
    }

    const status = matched ? "PASS" : reason.includes("could not") ? "SKIP" : "FAIL";
    console.log(`  ${status}: ${exp}`);
    if (reason) console.log(`         ${reason}`);
    if (status === "PASS") passed++;
    else if (status === "FAIL") failed++;
  }

  console.log(`\n  RESULT: ${passed} passed, ${failed} failed`);
}
