/**
 * Shared benchmark grader — scores model outputs against evals.json expectations.
 * Grades the MODEL'S text output against expectation strings using pattern-specific
 * logic with a keyword-match fallback.
 *
 * Usage: npx tsx evals/grade-output.ts <benchmark-dir>
 * Example: npx tsx evals/grade-output.ts skills/slop-test-detector/benchmarks/2026-03-14T01-30-54
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
// otherwise walk up from benchmark dir to find evals.json in the skill's evals/ dir.
const snapshotPath = join(benchmarkDir, "evals-snapshot.json");
let evalsPath: string;
if (existsSync(snapshotPath)) {
  evalsPath = snapshotPath;
  console.log("Using evals-snapshot.json from benchmark run\n");
} else {
  // benchmarkDir is typically <skill>/benchmarks/<timestamp> — walk up to find evals/evals.json
  const fallback = join(benchmarkDir, "../../evals/evals.json");
  if (existsSync(fallback)) {
    evalsPath = fallback;
    console.log(`Warning: no evals-snapshot.json found. Falling back to ${fallback}\n`);
  } else {
    console.error(
      `No evals-snapshot.json in ${benchmarkDir} and no evals.json found nearby. Run the benchmark first.`,
    );
    process.exit(1);
  }
}

const evalsData = JSON.parse(readFileSync(evalsPath, "utf-8"));
const evalsByName = new Map(evalsData.evals.map((e: { name: string }) => [e.name, e]));

// Build known-rules list from whichever coverage matrix exists
const knownRules = Object.keys(
  evalsData.rule_coverage_matrix ?? evalsData.category_coverage_matrix ?? {},
);

// --- Types ---

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
  duration_api_ms: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_cost_usd: number;
  };
  output_chars: number;
}

// --- Text utilities ---

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[`*()[\]{}:.,'"]/g, " ")
    .replace(/[_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function hasConceptMatch(text: string, concept: string): boolean {
  const haystack = text.toLowerCase().replace(/[_-]/g, " ");
  const conceptWords = normalizeWords(concept);
  if (conceptWords.length === 0) return false;
  const matchedWords = conceptWords.filter((w) => haystack.includes(w));
  return matchedWords.length >= Math.ceil(conceptWords.length * 0.6);
}

function findMentionedRules(output: string): string[] {
  return knownRules.filter((rule) => hasConceptMatch(output, rule));
}

function isSeveritySectionLine(line: string, severityVariants: string[]): boolean {
  const trimmed = line.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.startsWith("-")) return false;
  return severityVariants.some((variant) => trimmed.includes(variant));
}

function isIssueListLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length === 0 || /^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed);
}

// --- Stop words for keyword-based checks ---
const STOP_WORDS = new Set([
  "this", "that", "with", "from", "into", "only", "also",
  "does", "have", "been", "should", "report", "issue",
  "found", "about", "their", "there", "which", "where",
]);

// --- Grading logic ---
// Each function handles one expectation pattern.
// Returns { passed, evidence } with explanation of why.

function gradeIdentifiesOnPattern(
  output: string,
  expectation: string,
): { passed: boolean; evidence: string } | null {
  const onMatch = expectation.match(/identifies\s+(.+?)\s+on\s+'([^']+)'/i);
  if (!onMatch) return null;

  const pattern = onMatch[1].toLowerCase().replace(/['-]/g, "");
  const testName = onMatch[2].toLowerCase();
  const outputStripped = output.toLowerCase().replace(/\*\*/g, "").replace(/`/g, "");
  const patternWords = pattern.split(/\s+/).filter((w) => w.length > 2);
  const matchedWords = patternWords.filter((w) => outputStripped.includes(w));
  const hasPattern =
    outputStripped.includes(pattern) ||
    outputStripped.includes(pattern.replace(/ /g, "_")) ||
    matchedWords.length >= Math.ceil(patternWords.length * 0.6);
  const hasTest = output.toLowerCase().includes(testName);

  if (hasPattern && hasTest)
    return { passed: true, evidence: `Found pattern '${onMatch[1]}' and test '${onMatch[2]}'` };
  if (hasPattern) return { passed: false, evidence: `Found pattern but not test name '${onMatch[2]}'` };
  if (hasTest) return { passed: false, evidence: `Found test name but not pattern '${onMatch[1]}'` };
  return { passed: false, evidence: `Neither pattern '${onMatch[1]}' nor test '${onMatch[2]}' found` };
}

function gradeIdentifiesThat(
  output: string,
  expectation: string,
): { passed: boolean; evidence: string } | null {
  const thatMatch = expectation.match(/identifies\s+that\s+(.+)/i);
  if (!thatMatch) return null;

  const concept = thatMatch[1].toLowerCase();
  const keywords = concept.split(/\s+/).filter((w) => w.length > 3);
  const found = keywords.filter((k) => output.toLowerCase().includes(k));
  const passed = found.length >= Math.ceil(keywords.length * 0.5);
  return { passed, evidence: `Matched ${found.length}/${keywords.length} keywords: ${found.join(", ")}` };
}

function gradeDoesNotFlag(
  output: string,
  expectation: string,
): { passed: boolean; evidence: string } | null {
  const expLower = expectation.toLowerCase();
  if (!expLower.match(/does not (flag|produce|report)/)) return null;

  // "Does NOT flag 'test name'" — check if a quoted test name appears in issue context
  const testMatch = expectation.match(/'([^']+)'/);
  if (testMatch) {
    const fragment = testMatch[1].toLowerCase();
    const lines = output.split("\n");
    const flaggedLines = lines.filter((l) => {
      const ll = l.toLowerCase();
      if (!ll.includes(fragment)) return false;
      const isNegative =
        ll.includes("issue") || ll.includes("fail") || ll.includes("finding") ||
        ll.includes("severity") || ll.includes("breaking") || ll.includes("weak") ||
        ll.includes("missing") || ll.includes("unsafe") || ll.includes("violation");
      const isPositive =
        ll.includes("clean") || ll.includes("proper") || ll.includes("correct") ||
        ll.includes("good") || ll.includes("no issues") || ll.includes("safe");
      return isNegative && !isPositive;
    });
    const passed = flaggedLines.length === 0;
    return {
      passed,
      evidence: passed ? `'${testMatch[1]}' not flagged` : `'${testMatch[1]}' appears in findings context`,
    };
  }

  // "Does NOT flag pattern_name on any test" — check if a specific slop pattern is mentioned as a finding
  const patternOnMatch = expLower.match(/does not flag\s+(\w+)\s+on\s+/);
  if (patternOnMatch) {
    const patternName = patternOnMatch[1];
    const patternVariants = [
      patternName,
      patternName.replace(/_/g, " "),
      patternName.replace(/_/g, "-"),
    ];
    // Check each line: is the pattern mentioned in a finding/issue context?
    // Exclude lines where the pattern appears alongside "clean", "not found", "no", "none", etc.
    const lines = output.split("\n");
    const flaggedAsIssue = lines.some((line) => {
      const ll = line.toLowerCase().replace(/[_-]/g, " ");
      const hasPattern = patternVariants.some((v) => ll.includes(v));
      if (!hasPattern) return false;
      // Pattern is mentioned — check if it's flagged as a finding or marked clean
      const isClean =
        ll.includes("clean") || ll.includes("not found") || ll.includes("not detected") ||
        ll.includes("no ") || ll.includes("none") || ll.includes("n/a") ||
        ll.includes("✅") || ll.includes("pass");
      const isFinding =
        ll.includes("found") || ll.includes("detected") || ll.includes("issue") ||
        ll.includes("violation") || ll.includes("severity") || ll.includes("fail") ||
        ll.includes("⚠") || ll.includes("❌") || ll.includes("warning");
      // If the line says "clean" for this pattern, it's not flagged
      if (isClean && !isFinding) return false;
      // If the line says "found/detected/issue", it IS flagged
      if (isFinding && !isClean) return true;
      // Ambiguous — check for negative indicators more carefully
      // Table rows like "| pattern | Clean |" are not findings
      if (/\|\s*clean\s*\|/i.test(line)) return false;
      // Default: if pattern is mentioned without clear clean indicator, treat as flagged
      return !isClean;
    });
    return {
      passed: !flaggedAsIssue,
      evidence: flaggedAsIssue
        ? `Pattern '${patternName}' flagged as a finding in output`
        : `Pattern '${patternName}' not flagged as a finding`,
    };
  }

  // Generic "does not produce false positives" / "does not flag any test"
  const issuePatterns =
    /\bissues?\s+found\b|\bfound\s+\d+\s+issue|\bweak\s+test\s+pattern|\bmust-fail\b|\bshould-fail\b|\banti-pattern\b|\bseverity\b|\bbreaking\s+change|\b❌\b|\bmissing\s+\.catch\b|\bunsafe\b/i;
  const cleanPatterns =
    /\bno\s+(issues|findings|problems|weak|slop|breaking)\b|\bno\s+breaking\s+changes?\b|\ball\s+(fields\s+)?are\s+(safe|properly|protected)\b|\bfile\s+is\s+clean\b|\bwell[- ]written\b|\bwell[- ]structured\b|\b0\s+issues\b|\bbackward[- ]compatible\b|\bfully\s+safe\b/i;
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

function gradeReportsClean(
  output: string,
  expectation: string,
): { passed: boolean; evidence: string } | null {
  const expLower = expectation.toLowerCase();
  if (
    !expLower.includes("reports zero findings") &&
    !expLower.includes("no issues were detected") &&
    !expLower.includes("no slop") &&
    !expLower.includes("states the file is clean") &&
    !expLower.includes("reports the schema as safe") &&
    !expLower.includes("reports the fromjson method as safe") &&
    !expLower.includes("reports all contract field changes as safe") &&
    !expLower.includes("reports overall change as safe") &&
    !expLower.includes("identifies this as a fully backward-compatible")
  ) {
    return null;
  }

  const outputLower = output.toLowerCase();
  // For "no slop patterns" checks, require an explicit clean statement.
  // Merely omitting pattern names is not enough — the model must affirmatively say clean.
  if (expLower.includes("no slop patterns") || expLower.includes("states the file is clean")) {
    const slopClean =
      /\bno\s+(slop|weak)\s+patterns?\b|\bfile\s+is\s+clean\b|\bno\s+(slop|weak)\s+(test\s+)?patterns?\s+(found|detected|present)\b|\bnone\s+of\s+these\s+patterns\b|\bclean[.!:]\s/i.test(output);
    // Also check that no slop patterns are flagged as findings
    const slopPatternNames = [
      "empty test body", "empty_test_body",
      "commented out assertions", "commented_out_assertions",
      "tautological assertion", "tautological_assertion",
      "self referential", "self_referential",
      "conditional assertion", "conditional_assertion",
      "truthiness only", "truthiness_only",
      "assert on type", "assert_on_type",
      "duplicate assertion", "duplicate_assertion",
      "no input variation", "no_input_variation",
      "literal roundtrip", "literal_roundtrip",
      "schema success only", "schema_success_only",
      "vacuous property", "vacuous_property",
      "impossible assertion", "impossible_assertion",
    ];
    const mentionsSlopAsFinding = slopPatternNames.some((p) => {
      if (!outputLower.includes(p)) return false;
      // Check if the mention is in a finding context (not a clean verdict)
      const lines = output.split("\n");
      return lines.some((line) => {
        const ll = line.toLowerCase().replace(/[_-]/g, " ");
        if (!ll.includes(p.replace(/_/g, " "))) return false;
        const isClean = ll.includes("clean") || ll.includes("not found") || ll.includes("n/a") || ll.includes("pass") || ll.includes("✅");
        if (/\|\s*clean\s*\|/i.test(line)) return false;
        return !isClean;
      });
    });
    const passed = slopClean && !mentionsSlopAsFinding;
    return {
      passed,
      evidence: passed
        ? "Output explicitly states clean/no slop patterns"
        : !slopClean
          ? "Output does not explicitly state file is clean"
          : "Output mentions slop pattern names as findings",
    };
  }

  const cleanRe =
    /\bno\s+(issues|findings|problems|weak|slop|patterns|breaking)\b|\bfile\s+is\s+clean\b|\bwell[- ]written\b|\bwell[- ]structured\b|\b0\s+issues\b|\bsafe\b|\bbackward[- ]compatible\b|\bnon-breaking\b/i;
  const issueRe =
    /\bissues?\s+found\b|\bfound\s+\d+\s+issue|\bweak\s+test\s+pattern|\bmust-fail\b|\bshould-fail\b|\bbreaking\b.*\b(change|removal|incompatible)\b/i;
  const looksClean = cleanRe.test(output) && !issueRe.test(output);
  return {
    passed: looksClean,
    evidence: looksClean ? "Output indicates clean/safe" : "Output does not clearly indicate clean/safe",
  };
}

function gradeClassifiesVerdict(
  output: string,
  expectation: string,
): { passed: boolean; evidence: string } | null {
  const expLower = expectation.toLowerCase();
  if (!expLower.includes("classifies")) return null;

  // "Classifies X as breaking/safe"
  if (expLower.includes("as breaking") || expLower.includes("as safe")) {
    const verdict = expLower.includes("as breaking") ? "breaking" : "safe";
    const classifiesMatch = expectation.match(/classifies\s+(.+?)\s+as\s+(breaking|safe)/i);
    const subject = classifiesMatch ? classifiesMatch[1] : "";

    const lines = output.split("\n");
    const subjectWords = normalizeWords(subject);
    const subjectIndex = lines.findIndex((line) => {
      const ll = line.toLowerCase().replace(/[_-]/g, " ");
      return subjectWords.filter((w) => ll.includes(w)).length >= Math.ceil(subjectWords.length * 0.5);
    });

    if (subjectIndex === -1) {
      return { passed: false, evidence: `Subject '${subject}' not found in output` };
    }

    const window = lines
      .slice(Math.max(0, subjectIndex - 5), subjectIndex + 6)
      .join(" ")
      .toLowerCase();

    const verdictVariants =
      verdict === "safe"
        ? ["safe", "backward compatible", "backward-compatible", "non-breaking", "not breaking", "✅"]
        : ["breaking", "❌", "incompatible", "will break", "disrupts"];

    const oppositeVariants =
      verdict === "safe"
        ? ["breaking", "❌", "incompatible", "will break"]
        : ["safe", "✅", "non-breaking", "backward compatible"];

    const hasVerdict = verdictVariants.some((v) => window.includes(v));
    const hasOpposite = oppositeVariants.some((v) => window.includes(v));

    if (hasVerdict && hasOpposite) {
      const verdictDist = verdictVariants.reduce((min, v) => {
        const idx = window.indexOf(v);
        return idx >= 0 ? Math.min(min, Math.abs(idx)) : min;
      }, Number.POSITIVE_INFINITY);
      const oppDist = oppositeVariants.reduce((min, v) => {
        const idx = window.indexOf(v);
        return idx >= 0 ? Math.min(min, Math.abs(idx)) : min;
      }, Number.POSITIVE_INFINITY);
      const passed = verdictDist <= oppDist;
      return {
        passed,
        evidence: passed
          ? `'${subject}' classified as '${verdict}' (primary verdict)`
          : `'${subject}' has mixed signals — opposite verdict appears closer`,
      };
    }

    if (hasVerdict && !hasOpposite) {
      return { passed: true, evidence: `'${subject}' classified as '${verdict}'` };
    }
    if (hasOpposite && !hasVerdict) {
      return {
        passed: false,
        evidence: `'${subject}' classified as '${verdict === "safe" ? "breaking" : "safe"}', not '${verdict}'`,
      };
    }
    return { passed: false, evidence: `No clear '${verdict}' classification found near '${subject}'` };
  }

  // "Classifies X as must-fail/should-fail"
  if (expLower.includes("must-fail") || expLower.includes("should-fail")) {
    const severity = expLower.includes("must-fail") ? "must-fail" : "should-fail";
    const classifiesMatch = expectation.match(/classifies\s+(.+?)\s+as\s+(must-fail|should-fail)/i);
    const issueGroup = classifiesMatch ? classifiesMatch[1] : "";
    const severityVariants = [
      severity,
      severity.replace("-", " "),
      ...(severity === "must-fail" ? ["critical", "blocking"] : []),
    ];
    const lines = output.split("\n");
    const issueConcepts = issueGroup
      .split(/\s+and\s+|,\s*/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const missingConcepts: string[] = [];

    for (const concept of issueConcepts) {
      const conceptIndex = lines.findIndex((line) => hasConceptMatch(line, concept));
      if (conceptIndex === -1) {
        missingConcepts.push(concept);
        continue;
      }

      const currentLine = lines[conceptIndex].toLowerCase();
      const prevLine = (lines[conceptIndex - 1] ?? "").toLowerCase();
      const nextLine = (lines[conceptIndex + 1] ?? "").toLowerCase();
      const inlineSeverity = severityVariants.some(
        (variant) => currentLine.includes(variant) || prevLine.includes(variant) || nextLine.includes(variant),
      );
      let headingSeverity = false;
      for (let i = conceptIndex - 1; i >= Math.max(0, conceptIndex - 4); i--) {
        if (!isSeveritySectionLine(lines[i], severityVariants)) continue;
        const intervening = lines.slice(i + 1, conceptIndex);
        if (intervening.every((line) => isIssueListLine(line))) {
          headingSeverity = true;
        }
        break;
      }
      if (!inlineSeverity && !headingSeverity) missingConcepts.push(`${concept} (missing ${severity})`);
    }
    return {
      passed: missingConcepts.length === 0,
      evidence:
        missingConcepts.length === 0
          ? `Severity '${severity}' found for all classified concepts`
          : `Missing severity evidence for: ${missingConcepts.join(", ")}`,
    };
  }

  return null;
}

function gradeExplains(
  output: string,
  expectation: string,
): { passed: boolean; evidence: string } | null {
  const expLower = expectation.toLowerCase();
  if (!expLower.includes("explains that") && !expLower.includes("explains ")) return null;

  const concept = expectation.replace(/^explains?\s+that\s+/i, "").toLowerCase();
  const keywords = concept
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
  const found = keywords.filter((k) => output.toLowerCase().includes(k));
  const threshold = Math.ceil(keywords.length * 0.4);
  const passed = found.length >= threshold;
  return {
    passed,
    evidence: `Matched ${found.length}/${keywords.length} explanation keywords (need ${threshold}): ${found.join(", ")}`,
  };
}

function gradeLineNumbers(
  output: string,
  expectation: string,
): { passed: boolean; evidence: string } | null {
  const expLower = expectation.toLowerCase();
  if (!expLower.includes("line number")) return null;

  const stripped = output.replace(/\*\*/g, "").replace(/`/g, "");

  // Check if the expectation mentions a specific line number
  const specificLineMatch = expectation.match(/line\s+(\d+)/i);
  if (specificLineMatch) {
    const expectedLine = specificLineMatch[1];
    const hasSpecific =
      new RegExp(`\\blines?\\s*:?\\s*~?${expectedLine}\\b`, "i").test(stripped) ||
      stripped.includes(`:${expectedLine}`);
    return {
      passed: hasSpecific,
      evidence: hasSpecific
        ? `Found reference to line ${expectedLine}`
        : `Line ${expectedLine} not referenced in output`,
    };
  }

  // Generic "provides line numbers"
  const hasLineNumbers =
    /\blines?\s*:?\s*~?\d+/i.test(stripped) || /\(lines?\s+\d+\)/i.test(stripped) || /\bL\d+\b/.test(stripped);
  return {
    passed: hasLineNumbers,
    evidence: hasLineNumbers ? "Line numbers present in output" : "No line numbers found",
  };
}

function gradeRecognizesHelpers(
  output: string,
  expectation: string,
): { passed: boolean; evidence: string } | null {
  const expLower = expectation.toLowerCase();
  if (
    !expLower.includes("recognizes") &&
    !expLower.includes("assertion equivalent") &&
    !expLower.includes("assertion helper")
  ) {
    return null;
  }

  const outputLower = output.toLowerCase();
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

function gradeLimitedTo(
  output: string,
  expectation: string,
): { passed: boolean; evidence: string } | null {
  const expLower = expectation.toLowerCase();
  if (!expLower.includes("limited to")) return null;

  const limitMatch = expectation.match(/limited to\s+(.+?)(?:\s*\(|$)/i);
  if (!limitMatch) return { passed: false, evidence: "Could not parse limitation clause" };

  const allowed = limitMatch[1].toLowerCase().trim();
  const issuePatterns =
    /\bissues?\s+found\b|\bfound\s+\d+\s+issue|\bweak\s+test|\bmust-fail\b|\bshould-fail\b|\banti-pattern\b|\bseverity\b/i;
  if (!issuePatterns.test(output)) {
    return { passed: true, evidence: "No issues reported at all" };
  }

  const mentionedRules = findMentionedRules(output);
  const allowedMentions = mentionedRules.filter(
    (rule) => hasConceptMatch(rule, allowed) || hasConceptMatch(allowed, rule),
  );
  const disallowedMentions = mentionedRules.filter((rule) => !allowedMentions.includes(rule));
  const fallbackAllowed = hasConceptMatch(output, allowed);

  return {
    passed: disallowedMentions.length === 0 && (allowedMentions.length > 0 || fallbackAllowed),
    evidence:
      disallowedMentions.length > 0
        ? `Disallowed issue mentions found: ${disallowedMentions.join(", ")}`
        : allowedMentions.length > 0 || fallbackAllowed
          ? `Reported issues are limited to '${allowed}'`
          : `Issues reported but '${allowed}' was not clearly identified`,
  };
}

function gradeNotesAddition(
  output: string,
  expectation: string,
): { passed: boolean; evidence: string } | null {
  const expLower = expectation.toLowerCase();
  if (!expLower.startsWith("notes that") && !expLower.startsWith("notes ")) return null;

  const concept = expectation.replace(/^notes\s+that\s+/i, "").replace(/^notes\s+/i, "").toLowerCase();
  const keywords = concept.split(/\s+/).filter((w) => w.length > 3 && !STOP_WORDS.has(w));
  const found = keywords.filter((k) => output.toLowerCase().includes(k));
  const threshold = Math.ceil(keywords.length * 0.4);
  const passed = found.length >= threshold;
  return {
    passed,
    evidence: `Matched ${found.length}/${keywords.length} keywords (need ${threshold}): ${found.join(", ")}`,
  };
}

// --- Main grading dispatcher ---

const GRADERS = [
  gradeIdentifiesOnPattern,
  gradeIdentifiesThat,
  gradeDoesNotFlag,
  gradeReportsClean,
  gradeClassifiesVerdict,
  gradeExplains,
  gradeLineNumbers,
  gradeRecognizesHelpers,
  gradeLimitedTo,
  gradeNotesAddition,
];

function gradeExpectation(output: string, expectation: string): { passed: boolean; evidence: string } {
  // Try each pattern-specific grader
  for (const grader of GRADERS) {
    const result = grader(output, expectation);
    if (result) return result;
  }

  // Fallback: keyword matching
  const keywords = expectation
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 4 && !STOP_WORDS.has(w));
  const found = keywords.filter((k) => output.toLowerCase().includes(k));
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
      const timingPath = join(runPath, "timing.json");

      if (!existsSync(outputPath)) {
        console.warn(`Skipping ${runPath}: no output.md`);
        continue;
      }

      const output = readFileSync(outputPath, "utf-8");
      const timing = existsSync(timingPath) ? JSON.parse(readFileSync(timingPath, "utf-8")) : {};

      // Skip invalid runs — sessions that failed (max_turns, permission_denials, etc.)
      if (timing.valid === false) {
        console.log(
          `${evalDirName} | ${configDir} | ${runDir} — SKIPPED (invalid: ${timing.invalid_reason})`,
        );
        continue;
      }

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
        duration_ms: timing.duration_ms ?? 0,
        duration_api_ms: timing.duration_api_ms ?? 0,
        usage: {
          input_tokens: timing.usage?.input_tokens ?? 0,
          output_tokens: timing.usage?.output_tokens ?? 0,
          total_cost_usd: timing.usage?.total_cost_usd ?? 0,
        },
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
  tokens: { mean: number; stddev: number };
  cost_usd: { mean: number; total: number };
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
  const tokens = gradings.map((g) => g.usage.input_tokens + g.usage.output_tokens);
  const costs = gradings.map((g) => g.usage.total_cost_usd);
  const tokenStats = computeStats(tokens);
  configSummaries[config] = {
    pass_rate: computeStats(passRates),
    duration_ms: { mean: computeStats(durations).mean, stddev: computeStats(durations).stddev },
    tokens: { mean: tokenStats.mean, stddev: tokenStats.stddev },
    cost_usd: { mean: computeStats(costs).mean, total: costs.reduce((a, b) => a + b, 0) },
    count: gradings.length,
  };
}

const benchmark = {
  skill_name: evalsData.skill_name,
  benchmark_question: evalsData.benchmark_question,
  timestamp: new Date().toISOString(),
  total_runs: allGradings.length,
  config_summary: configSummaries,
  per_eval: [...new Set(allGradings.map((g) => g.eval_name))].map((name) => {
    const evalGradings = allGradings.filter((g) => g.eval_name === name);
    const byEvalConfig: Record<string, { pass_rate: number; duration_ms: number; tokens: number; cost_usd: number }[]> = {};
    for (const g of evalGradings) {
      if (!byEvalConfig[g.configuration]) byEvalConfig[g.configuration] = [];
      byEvalConfig[g.configuration].push({
        pass_rate: g.summary.pass_rate,
        duration_ms: g.duration_ms,
        tokens: g.usage.input_tokens + g.usage.output_tokens,
        cost_usd: g.usage.total_cost_usd,
      });
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
  const sem = stats.count > 1 ? stats.pass_rate.stddev / Math.sqrt(stats.count) : 0;
  console.log(`\n${config} (n=${stats.count}):`);
  console.log(`  Pass rate: ${(stats.pass_rate.mean * 100).toFixed(1)}% ± ${(sem * 100).toFixed(1)}% (SEM)`);
  console.log(`  Range: ${(stats.pass_rate.min * 100).toFixed(0)}% – ${(stats.pass_rate.max * 100).toFixed(0)}%`);
  console.log(`  Avg duration: ${stats.duration_ms.mean.toFixed(0)}ms`);
  console.log(`  Avg tokens: ${stats.tokens.mean.toFixed(0)} ± ${stats.tokens.stddev.toFixed(0)}`);
  console.log(`  Total cost: $${stats.cost_usd.total.toFixed(4)}`);
}

if (configSummaries.with_skill && configSummaries.without_skill) {
  const delta = configSummaries.with_skill.pass_rate.mean - configSummaries.without_skill.pass_rate.mean;
  const timeDelta = configSummaries.with_skill.duration_ms.mean - configSummaries.without_skill.duration_ms.mean;
  const tokenDelta = configSummaries.with_skill.tokens.mean - configSummaries.without_skill.tokens.mean;
  console.log(`\n--- DELTA (with_skill - without_skill) ---`);
  console.log(`  Pass rate: ${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)} percentage points`);
  console.log(`  Duration: ${timeDelta >= 0 ? "+" : ""}${timeDelta.toFixed(0)}ms`);
  console.log(`  Tokens: ${tokenDelta >= 0 ? "+" : ""}${tokenDelta.toFixed(0)}`);
}

console.log(`\nResults saved to ${join(benchmarkDir, "benchmark.json")}`);
