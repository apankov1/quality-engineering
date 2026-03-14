/**
 * Benchmark grader — scores model outputs against evals.json expectations.
 * Grades the MODEL'S text, not the analyzer. Every expectation is evaluated,
 * including explanation quality and line number presence.
 *
 * Usage: npx tsx evals/grade-output.ts <benchmark-dir>
 * Example: npx tsx evals/grade-output.ts benchmarks/2026-03-13T20-30-00
 *
 * Output: grading.json in each run directory + aggregate benchmark.json
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const benchmarkDir = process.argv[2];
if (!benchmarkDir) {
  console.error("Usage: npx tsx evals/grade-output.ts <benchmark-dir>");
  process.exit(1);
}

// Use snapshot from benchmark run if available (reproducible grading),
// otherwise fall back to current evals.json
const snapshotPath = join(benchmarkDir, "evals-snapshot.json");
const evalsPath = existsSync(snapshotPath) ? snapshotPath : join(import.meta.dirname, "evals.json");
if (existsSync(snapshotPath)) {
  console.log("Using evals-snapshot.json from benchmark run\n");
} else {
  console.log("Warning: no evals-snapshot.json found, using current evals.json\n");
}
const evalsData = JSON.parse(readFileSync(evalsPath, "utf-8"));
const evalsByName = new Map(evalsData.evals.map((e: { name: string }) => [e.name, e]));

interface Expectation {
  text: string;
  passed: boolean;
  evidence: string;
}

interface GradingResult {
  eval_id: number;
  eval_name: string;
  configuration: string;
  run_number: number;
  expectations: Expectation[];
  summary: { passed: number; failed: number; total: number; pass_rate: number };
  duration_ms: number;
  output_chars: number;
}

// --- Grading logic ---
// Grades model output text against an expectation string.
// Returns { passed, evidence } with explanation of why.

function gradeExpectation(output: string, expectation: string): { passed: boolean; evidence: string } {
  const outputLower = output.toLowerCase();
  const expLower = expectation.toLowerCase();

  // "Identifies X on Y" — check model mentions the pattern and test name
  if (expLower.includes("identifies")) {
    // Extract pattern/concept (text before "on")
    const onMatch = expectation.match(/identifies\s+(.+?)\s+on\s+'([^']+)'/i);
    if (onMatch) {
      const pattern = onMatch[1].toLowerCase().replace(/['-]/g, "");
      const testName = onMatch[2].toLowerCase();
      // Flexible matching: "empty test body" matches "empty test", "empty_test_body", etc.
      // Strip markdown from output for matching
      const outputStripped = outputLower.replace(/\*\*/g, "").replace(/`/g, "");
      const patternWords = pattern.split(/\s+/).filter((w) => w.length > 2);
      // Require at least 2/3 of pattern words present (not all — model may omit a word)
      const matchedWords = patternWords.filter((w) => outputStripped.includes(w));
      const hasPattern =
        outputStripped.includes(pattern) ||
        outputStripped.includes(pattern.replace(/ /g, "_")) ||
        matchedWords.length >= Math.ceil(patternWords.length * 0.6);
      const hasTest = outputLower.includes(testName);
      if (hasPattern && hasTest)
        return { passed: true, evidence: `Found pattern '${onMatch[1]}' and test '${onMatch[2]}'` };
      if (hasPattern) return { passed: false, evidence: `Found pattern but not test name '${onMatch[2]}'` };
      if (hasTest) return { passed: false, evidence: `Found test name but not pattern '${onMatch[1]}'` };
      return { passed: false, evidence: `Neither pattern '${onMatch[1]}' nor test '${onMatch[2]}' found` };
    }

    // "Identifies that X" — check for concept
    const thatMatch = expectation.match(/identifies\s+that\s+(.+)/i);
    if (thatMatch) {
      const concept = thatMatch[1].toLowerCase();
      const keywords = concept.split(/\s+/).filter((w) => w.length > 3);
      const found = keywords.filter((k) => outputLower.includes(k));
      const passed = found.length >= Math.ceil(keywords.length * 0.5);
      return { passed, evidence: `Matched ${found.length}/${keywords.length} keywords: ${found.join(", ")}` };
    }
  }

  // "Does NOT flag/produce/report X" — check absence
  if (expLower.match(/does not (flag|produce|report)/)) {
    const testMatch = expectation.match(/'([^']+)'/);
    if (testMatch) {
      const fragment = testMatch[1].toLowerCase();
      // Check if the output mentions this test in a negative/issue context
      const lines = output.split("\n");
      // Check if the test appears in a negative context (flagged as an issue),
      // but exclude lines that are praising the test ("clean", "proper", "good")
      const flaggedLines = lines.filter((l) => {
        const ll = l.toLowerCase();
        if (!ll.includes(fragment)) return false;
        const isNegative =
          ll.includes("issue") ||
          ll.includes("fail") ||
          ll.includes("finding") ||
          ll.includes("severity") ||
          ll.includes("breaking") ||
          ll.includes("weak");
        const isPositive =
          ll.includes("clean") ||
          ll.includes("proper") ||
          ll.includes("correct") ||
          ll.includes("good") ||
          ll.includes("no issues");
        return isNegative && !isPositive;
      });
      const passed = flaggedLines.length === 0;
      return {
        passed,
        evidence: passed ? `'${testMatch[1]}' not flagged` : `'${testMatch[1]}' appears in findings context`,
      };
    }
    // Generic "does not produce false positives" / "does not flag any test"
    // Check if the output reports ANY issues — look for issue-reporting patterns
    const issuePatterns =
      /\bissues?\s+found\b|\bfound\s+\d+\s+issue|\bweak\s+test\s+pattern|\bmust-fail\b|\bshould-fail\b|\banti-pattern\b|\bseverity\b/i;
    const cleanPatterns =
      /\bno\s+(issues|findings|problems|weak|slop)\b|\bfile\s+is\s+clean\b|\bwell[- ]written\b|\bwell[- ]structured\b|\b0\s+issues\b/i;
    const reportsIssues = issuePatterns.test(output);
    const reportsClean = cleanPatterns.test(output);
    const passed = reportsClean && !reportsIssues;
    return {
      passed,
      evidence: passed
        ? "Output indicates clean file"
        : reportsIssues
          ? "Output reports issues on this file"
          : "No clear clean/issue indicator",
    };
  }

  // "Reports zero findings" or "states no issues"
  if (
    expLower.includes("reports zero findings") ||
    expLower.includes("no issues were detected") ||
    expLower.includes("no slop")
  ) {
    const cleanRe =
      /\bno\s+(issues|findings|problems|weak|slop|patterns)\b|\bfile\s+is\s+clean\b|\bwell[- ]written\b|\bwell[- ]structured\b|\b0\s+issues\b/i;
    const issueRe = /\bissues?\s+found\b|\bfound\s+\d+\s+issue|\bweak\s+test\s+pattern|\bmust-fail\b|\bshould-fail\b/i;
    const looksClean = cleanRe.test(output) && !issueRe.test(output);
    return {
      passed: looksClean,
      evidence: looksClean ? "Output indicates clean file" : "Output does not clearly indicate clean file",
    };
  }

  // "Classifies X as must-fail/should-fail"
  if (expLower.includes("classifies") && (expLower.includes("must-fail") || expLower.includes("should-fail"))) {
    const severity = expLower.includes("must-fail") ? "must-fail" : "should-fail";
    // Extract the issue name being classified
    const classifiesMatch = expectation.match(/classifies\s+(.+?)\s+as\s+(must-fail|should-fail)/i);
    const issueName = classifiesMatch ? classifiesMatch[1].toLowerCase().replace(/['-]/g, "") : "";
    const issueWords = issueName.split(/\s+/).filter((w) => w.length > 2);

    // Check that the severity appears NEAR the issue name (within ~5 lines)
    const lines = output.split("\n");
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      const ll = lines[i].toLowerCase();
      const hasSev =
        ll.includes(severity) ||
        ll.includes(severity.replace("-", " ")) ||
        (severity === "must-fail" && (ll.includes("critical") || ll.includes("blocking")));
      if (!hasSev) continue;

      // Check nearby lines (±3) for the issue name
      const window = lines
        .slice(Math.max(0, i - 3), i + 4)
        .join(" ")
        .toLowerCase();
      const issueNearby =
        issueWords.length === 0 ||
        issueWords.filter((w) => window.includes(w)).length >= Math.ceil(issueWords.length * 0.5);
      if (issueNearby) {
        found = true;
        break;
      }
    }
    return {
      passed: found,
      evidence: found
        ? `Severity '${severity}' found near '${issueName}'`
        : `Severity '${severity}' not found near '${issueName}'`,
    };
  }

  // "Explains that X" — check for explanatory content
  if (expLower.includes("explains that") || expLower.includes("explains ")) {
    const concept = expectation.replace(/^explains?\s+that\s+/i, "").toLowerCase();
    const keywords = concept
      .split(/\s+/)
      .filter(
        (w) =>
          w.length > 3 && !["this", "that", "with", "from", "into", "only", "also", "does", "have", "been"].includes(w),
      );
    const found = keywords.filter((k) => outputLower.includes(k));
    const threshold = Math.ceil(keywords.length * 0.4);
    const passed = found.length >= threshold;
    return {
      passed,
      evidence: `Matched ${found.length}/${keywords.length} explanation keywords (need ${threshold}): ${found.join(", ")}`,
    };
  }

  // "Provides line numbers"
  if (expLower.includes("line number")) {
    // Strip markdown formatting for line number detection
    const stripped = output.replace(/\*\*/g, "").replace(/`/g, "");
    const hasLineNumbers =
      /\blines?\s*:?\s*~?\d+/i.test(stripped) || /\(lines?\s+\d+\)/i.test(stripped) || /\bL\d+\b/.test(stripped);
    return {
      passed: hasLineNumbers,
      evidence: hasLineNumbers ? "Line numbers present in output" : "No line numbers found",
    };
  }

  // "Recognizes X as assertion helpers/equivalents"
  if (
    expLower.includes("recognizes") ||
    expLower.includes("assertion equivalent") ||
    expLower.includes("assertion helper")
  ) {
    const hasRecognition =
      outputLower.includes("assertion helper") ||
      outputLower.includes("assertion equivalent") ||
      outputLower.includes("custom assert") ||
      outputLower.includes("wrapper") ||
      outputLower.includes("internally call");
    return {
      passed: hasRecognition,
      evidence: hasRecognition ? "Recognizes assertion helpers" : "No helper recognition found",
    };
  }

  // "If it reports any findings, they are limited to X"
  if (expLower.includes("limited to")) {
    const limitMatch = expectation.match(/limited to\s+(.+?)(?:\s*\(|$)/i);
    if (limitMatch) {
      const allowed = limitMatch[1].toLowerCase().trim();
      const allowedWords = allowed.split(/[\s_]+/).filter((w) => w.length > 2);

      // Split output into issue sections (look for numbered items, headings, bullets)
      const issueBlocks = output.split(/(?=^#{1,3}\s+\d|^\*\*\d|^-\s+\*\*|^\d+\.\s+)/m).filter((b) => b.trim());

      // Count issue blocks that DON'T relate to the allowed concept
      let unrelatedCount = 0;
      let totalIssueBlocks = 0;
      for (const block of issueBlocks) {
        const bl = block.toLowerCase();
        const looksLikeIssue =
          bl.includes("issue") ||
          bl.includes("pattern") ||
          bl.includes("severity") ||
          bl.includes("fail") ||
          bl.includes("weak") ||
          bl.includes("problem");
        if (!looksLikeIssue) continue;
        totalIssueBlocks++;
        const relatesToAllowed = allowedWords.some((w) => bl.includes(w));
        if (!relatesToAllowed) unrelatedCount++;
      }

      if (totalIssueBlocks === 0) {
        return { passed: true, evidence: "No issue blocks found in output" };
      }
      const passed = unrelatedCount === 0;
      return {
        passed,
        evidence: passed
          ? `All ${totalIssueBlocks} issue(s) relate to '${allowed}'`
          : `${unrelatedCount}/${totalIssueBlocks} issue(s) are unrelated to '${allowed}'`,
      };
    }
    return { passed: false, evidence: "Could not parse limitation clause" };
  }

  // Fallback: keyword matching
  const keywords = expLower
    .split(/\s+/)
    .filter(
      (w) =>
        w.length > 4 &&
        !["should", "report", "issue", "found", "about", "their", "there", "which", "where"].includes(w),
    );
  const found = keywords.filter((k) => outputLower.includes(k));
  const passed = found.length >= Math.ceil(keywords.length * 0.4);
  return { passed, evidence: `Keyword match: ${found.length}/${keywords.length} — ${found.slice(0, 5).join(", ")}` };
}

// --- Walk benchmark directory ---
const evalDirs = readdirSync(benchmarkDir).filter((d) => d.startsWith("eval-"));
const allGradings: GradingResult[] = [];

for (const evalDirName of evalDirs.sort()) {
  const evalName = evalDirName.replace(/^eval-\d+-/, "");
  const evalDef = evalsByName.get(evalName);
  if (!evalDef) {
    console.warn(`Skipping ${evalDirName}: no matching eval in evals.json`);
    continue;
  }

  const evalDir = join(benchmarkDir, evalDirName);
  const configDirs = readdirSync(evalDir).filter((d) => d.startsWith("with") || d.startsWith("without"));

  for (const configDir of configDirs) {
    const configPath = join(evalDir, configDir);
    const runDirs = readdirSync(configPath).filter((d) => d.startsWith("run-"));

    for (const runDir of runDirs.sort()) {
      const runPath = join(configPath, runDir);
      const outputPath = join(runPath, "output.md");
      const metadataPath = join(runPath, "eval_metadata.json");

      if (!existsSync(outputPath)) {
        console.warn(`Skipping ${runPath}: no output.md`);
        continue;
      }

      const output = readFileSync(outputPath, "utf-8");
      const metadata = existsSync(metadataPath) ? JSON.parse(readFileSync(metadataPath, "utf-8")) : {};

      // Grade every expectation
      const expectations: Expectation[] = evalDef.expectations.map((exp: string) => {
        const result = gradeExpectation(output, exp);
        return { text: exp, passed: result.passed, evidence: result.evidence };
      });

      const passedCount = expectations.filter((e: Expectation) => e.passed).length;
      const grading: GradingResult = {
        eval_id: evalDef.id,
        eval_name: evalDef.name,
        configuration: configDir,
        run_number: Number.parseInt(runDir.replace("run-", "")),
        expectations,
        summary: {
          passed: passedCount,
          failed: expectations.length - passedCount,
          total: expectations.length,
          pass_rate: expectations.length > 0 ? passedCount / expectations.length : 0,
        },
        duration_ms: metadata.duration_ms ?? 0,
        output_chars: output.length,
      };

      writeFileSync(join(runPath, "grading.json"), JSON.stringify(grading, null, 2));
      allGradings.push(grading);

      const pct = Math.round(grading.summary.pass_rate * 100);
      console.log(
        `${evalDirName} | ${configDir} | ${runDir} — ${pct}% (${grading.summary.passed}/${grading.summary.total})`,
      );
    }
  }
}

// --- Aggregate ---
interface ConfigStats {
  pass_rate: { mean: number; stddev: number; min: number; max: number };
  duration_ms: { mean: number; stddev: number };
  count: number;
}

function computeStats(values: number[]): { mean: number; stddev: number; min: number; max: number } {
  if (values.length === 0) return { mean: 0, stddev: 0, min: 0, max: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return {
    mean: +mean.toFixed(4),
    stddev: +Math.sqrt(variance).toFixed(4),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

const byConfig = new Map<string, GradingResult[]>();
for (const g of allGradings) {
  const list = byConfig.get(g.configuration) ?? [];
  list.push(g);
  byConfig.set(g.configuration, list);
}

const configSummaries: Record<string, ConfigStats> = {};
for (const [config, gradings] of byConfig) {
  const passRates = gradings.map((g) => g.summary.pass_rate);
  const durations = gradings.map((g) => g.duration_ms);
  configSummaries[config] = {
    pass_rate: computeStats(passRates),
    duration_ms: { mean: computeStats(durations).mean, stddev: computeStats(durations).stddev },
    count: gradings.length,
  };
}

const benchmark = {
  benchmark_question: evalsData.benchmark_question,
  timestamp: new Date().toISOString(),
  total_runs: allGradings.length,
  config_summary: configSummaries,
  per_eval: [...new Set(allGradings.map((g) => g.eval_name))].map((name) => {
    const evalGradings = allGradings.filter((g) => g.eval_name === name);
    const byEvalConfig: Record<string, { pass_rate: number; duration_ms: number }[]> = {};
    for (const g of evalGradings) {
      if (!byEvalConfig[g.configuration]) byEvalConfig[g.configuration] = [];
      byEvalConfig[g.configuration].push({ pass_rate: g.summary.pass_rate, duration_ms: g.duration_ms });
    }
    return { eval_name: name, configurations: byEvalConfig };
  }),
};

writeFileSync(join(benchmarkDir, "benchmark.json"), JSON.stringify(benchmark, null, 2));

// --- Print summary ---
console.log(`\n${"=".repeat(70)}`);
console.log("AGGREGATE RESULTS");
console.log("=".repeat(70));

for (const [config, stats] of Object.entries(configSummaries)) {
  const sem = stats.pass_rate.stddev / Math.sqrt(stats.count);
  console.log(`\n${config} (n=${stats.count}):`);
  console.log(`  Pass rate: ${(stats.pass_rate.mean * 100).toFixed(1)}% ± ${(sem * 100).toFixed(1)}% (SEM)`);
  console.log(`  Range: ${(stats.pass_rate.min * 100).toFixed(0)}% – ${(stats.pass_rate.max * 100).toFixed(0)}%`);
  console.log(`  Avg duration: ${stats.duration_ms.mean.toFixed(0)}ms`);
}

if (configSummaries.with_skill && configSummaries.without_skill) {
  const delta = configSummaries.with_skill.pass_rate.mean - configSummaries.without_skill.pass_rate.mean;
  console.log(`\nDelta (with - without): ${(delta * 100).toFixed(1)} percentage points`);
}

console.log(`\nResults saved to ${join(benchmarkDir, "benchmark.json")}`);
