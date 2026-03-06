// --- Types ---

export type DefectClass =
  | "off-by-one"
  | "boundary-zero"
  | "empty-collection"
  | "negative-input"
  | "null-undefined"
  | "type-coercion"
  | "division-by-zero"
  | "nan-propagation"
  | "empty-string"
  | "missing-error-path"
  | "swallowed-error"
  | "wrong-error-type"
  | "shared-mutation"
  | "missing-branch"
  | "unhandled-rejection";

export interface FaultEntry {
  line: number;
  code: string;
  pattern: string;
  category: string;
  defectClasses: DefectClass[];
  description: string;
  testStrategy: string;
}

export interface FaultSurface {
  entries: FaultEntry[];
  summary: Record<string, number>;
  coverage: DefectClass[];
}

export interface TestSuggestion {
  name: string;
  defectComment: string;
  targetFaults: number[];
  inputs: string;
  expectedBehavior: string;
}

export interface CoverageGap {
  fault: FaultEntry;
  reason: string;
}

export interface ValidationResult {
  covered: number;
  total: number;
  gaps: CoverageGap[];
  score: number;
}

// --- Internal types ---

interface FaultDetector {
  id: string;
  category: string;
  match: RegExp;
  exclude?: RegExp;
  defectClasses: DefectClass[];
  description: string;
  testStrategy: string;
}

// --- Helpers ---

/**
 * Strips string literal contents (preserves quotes) so patterns don't match
 * inside strings. Also strips trailing line comments.
 */
export function stripNonCode(line: string): string {
  let result = "";
  let inString: string | null = null;
  let escaped = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (escaped) {
      escaped = false;
      if (!inString) result += ch;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      if (!inString) result += ch;
      continue;
    }

    if (inString) {
      if (ch === inString) {
        inString = null;
        result += ch;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      inString = ch;
      result += ch;
      continue;
    }

    result += ch;
  }

  // Strip trailing line comments
  const commentIdx = result.indexOf("//");
  if (commentIdx >= 0) {
    result = result.substring(0, commentIdx);
  }

  return result;
}

// --- Fault pattern table (15 detectors) ---

const FAULT_DETECTORS: FaultDetector[] = [
  {
    id: "comparison-boundary",
    category: "boundary",
    match: /[<>]=?\s*(\d+|\w+\.length)/,
    defectClasses: ["off-by-one", "boundary-zero"],
    description: "Numeric comparison may have off-by-one or boundary error",
    testStrategy: "Test exact boundary value, one above, one below, and zero",
  },
  {
    id: "array-index",
    category: "boundary",
    match: /\w+\[\s*\w+\s*([+-]\s*\d+)?\s*\]/,
    exclude: /\[\s*['"`]/,
    defectClasses: ["off-by-one", "empty-collection"],
    description: "Array index access may fail on empty arrays or boundary indices",
    testStrategy: "Test with empty array, single element, and index at array length",
  },
  {
    id: "string-split",
    category: "boundary",
    match: /\.split\s*\(/,
    defectClasses: ["empty-string", "empty-collection"],
    description: "String split on empty string or missing delimiter produces unexpected results",
    testStrategy: "Test with empty string, string without delimiter, and consecutive delimiters",
  },
  {
    id: "string-slice",
    category: "boundary",
    match: /\.(substring|slice|substr)\s*\(/,
    defectClasses: ["off-by-one", "empty-string", "negative-input"],
    description: "String slicing may have off-by-one or behave unexpectedly with negative indices",
    testStrategy: "Test with empty string, negative start, start > length, and start === end",
  },
  {
    id: "optional-chain",
    category: "null-safety",
    match: /\?\./,
    defectClasses: ["null-undefined"],
    description: "Optional chaining indicates a potentially null/undefined path",
    testStrategy: "Test with null, undefined, and valid object to verify fallback behavior",
  },
  {
    id: "nullish-coalesce",
    category: "null-safety",
    match: /\?\?/,
    defectClasses: ["null-undefined"],
    description: "Nullish coalescing indicates a fallback for null/undefined",
    testStrategy:
      "Test with null, undefined, empty string, zero, and false to verify only null/undefined triggers fallback",
  },
  {
    id: "explicit-null-check",
    category: "null-safety",
    match: /[!=]==?\s*(null|undefined)\b/,
    defectClasses: ["null-undefined", "missing-branch"],
    description: "Explicit null check — verify both branches are tested",
    testStrategy: "Test with null, undefined, and valid value; verify the else-branch handles valid input correctly",
  },
  {
    id: "try-catch",
    category: "error-handling",
    match: /\btry\s*\{/,
    defectClasses: ["missing-error-path", "swallowed-error", "wrong-error-type"],
    description: "Try-catch block — errors may be swallowed, wrong type caught, or recovery incorrect",
    testStrategy:
      "Test that caught errors are handled (not swallowed), verify error type discrimination, test recovery logic",
  },
  {
    id: "promise-catch",
    category: "error-handling",
    match: /\.catch\s*\(/,
    defectClasses: ["unhandled-rejection", "swallowed-error"],
    description: "Promise catch — rejection may be swallowed or error information lost",
    testStrategy: "Test that rejection propagates or is handled correctly, verify error details are preserved",
  },
  {
    id: "throw-statement",
    category: "error-handling",
    match: /\bthrow\s+(new\s+)?\w/,
    defectClasses: ["missing-error-path", "wrong-error-type"],
    description: "Throw statement — callers must handle this error type",
    testStrategy: "Test that the error is thrown for invalid inputs, verify error type and message",
  },
  {
    id: "division-op",
    category: "math",
    match: /\w\s+\/\s+\w/,
    exclude: /import|from|require/,
    defectClasses: ["division-by-zero", "nan-propagation"],
    description: "Division operation — divisor may be zero or NaN",
    testStrategy: "Test with divisor = 0, NaN, Infinity, and negative values",
  },
  {
    id: "type-conversion",
    category: "type-safety",
    match: /\b(parseInt|parseFloat|Number)\s*\(/,
    defectClasses: ["nan-propagation", "type-coercion"],
    description: "Type conversion may produce NaN or unexpected coercion",
    testStrategy:
      "Test with non-numeric strings, empty string, null, undefined, and numeric strings with trailing chars",
  },
  {
    id: "array-mutation",
    category: "mutation",
    match: /\.(push|pop|shift|unshift|splice|sort|reverse)\s*\(/,
    defectClasses: ["shared-mutation"],
    description: "In-place array mutation may affect shared references",
    testStrategy:
      "Test that original array is/isn't modified as expected; test with frozen arrays if mutation should be prevented",
  },
  {
    id: "promise-all",
    category: "async",
    match: /Promise\.(all|race|any|allSettled)\s*\(/,
    defectClasses: ["unhandled-rejection"],
    description: "Promise.all rejects on first failure — partial results are lost",
    testStrategy: "Test with one failing promise, all failing, empty array, and verify partial failure handling",
  },
  {
    id: "switch-statement",
    category: "branching",
    match: /\bswitch\s*\(/,
    defectClasses: ["missing-branch"],
    description: "Switch statement may lack default case or fall-through handling",
    testStrategy: "Test each case value and an unlisted value to verify default handling",
  },
  {
    id: "math-domain",
    category: "math",
    match: /Math\.(sqrt|log|log2|log10|asin|acos)\s*\(/,
    defectClasses: ["negative-input", "nan-propagation"],
    description: "Math function with restricted domain — negative/zero input produces NaN",
    testStrategy: "Test with zero, negative values, and NaN input",
  },
];

// --- Test suggestion templates per defect class ---

const DEFECT_TEMPLATES: Record<DefectClass, { name: string; inputs: string; expectedBehavior: string }> = {
  "off-by-one": {
    name: "handles exact boundary value",
    inputs: "Value at boundary, boundary-1, boundary+1",
    expectedBehavior: "Correct result at each boundary; no out-of-range access",
  },
  "boundary-zero": {
    name: "handles zero boundary",
    inputs: "Zero, negative, and positive values",
    expectedBehavior: "Correct behavior at zero; no sign confusion",
  },
  "empty-collection": {
    name: "handles empty collection",
    inputs: "Empty array/string, single element, large collection",
    expectedBehavior: "Returns appropriate empty result; no undefined access",
  },
  "negative-input": {
    name: "handles negative input",
    inputs: "Negative values, -1, -Infinity",
    expectedBehavior: "Returns NaN/throws/handles gracefully per spec",
  },
  "null-undefined": {
    name: "handles null and undefined",
    inputs: "null, undefined, and valid object",
    expectedBehavior: "Fallback behavior for null/undefined; no TypeError",
  },
  "type-coercion": {
    name: "rejects invalid type coercion",
    inputs: "Non-numeric string, empty string, boolean, null",
    expectedBehavior: "NaN detected or type error thrown; no silent coercion",
  },
  "division-by-zero": {
    name: "handles division by zero",
    inputs: "Divisor = 0, NaN, Infinity",
    expectedBehavior: "Returns Infinity/NaN or throws; no silent corruption",
  },
  "nan-propagation": {
    name: "detects NaN propagation",
    inputs: "NaN input, undefined coerced to NaN",
    expectedBehavior: "NaN does not silently propagate through calculations",
  },
  "empty-string": {
    name: "handles empty string input",
    inputs: "Empty string, whitespace-only, null",
    expectedBehavior: "Returns appropriate default; no unexpected split/slice results",
  },
  "missing-error-path": {
    name: "tests error throwing path",
    inputs: "Invalid input that triggers throw/reject",
    expectedBehavior: "Correct error type thrown with descriptive message",
  },
  "swallowed-error": {
    name: "verifies error is not swallowed",
    inputs: "Input that triggers catch/rejection handler",
    expectedBehavior: "Error is logged/rethrown/handled, not silently ignored",
  },
  "wrong-error-type": {
    name: "catches correct error type",
    inputs: "Inputs triggering different error types",
    expectedBehavior: "Catch block discriminates error types correctly",
  },
  "shared-mutation": {
    name: "verifies mutation safety",
    inputs: "Shared reference passed to function",
    expectedBehavior: "Original object is/isn't mutated as documented",
  },
  "missing-branch": {
    name: "covers all branches",
    inputs: "Value matching each case/branch, plus unmatched value",
    expectedBehavior: "Each branch produces correct output; default handles unknown",
  },
  "unhandled-rejection": {
    name: "handles promise rejection",
    inputs: "Promise that rejects, partial failure in Promise.all",
    expectedBehavior: "Rejection is caught; partial results handled correctly",
  },
};

// --- Exported detector count for tests ---

export const DETECTOR_COUNT = FAULT_DETECTORS.length;

// --- Core API ---

export function analyzeFaultSurface(source: string): FaultSurface {
  const lines = source.split("\n");
  const entries: FaultEntry[] = [];
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Track block comments
    if (inBlockComment) {
      if (trimmed.includes("*/")) {
        inBlockComment = false;
      }
      continue;
    }
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) {
        inBlockComment = true;
      }
      continue;
    }

    // Skip pure comment lines and empty lines
    if (trimmed.startsWith("//") || trimmed === "") continue;

    // Strip string contents and trailing comments for pattern matching
    const cleaned = stripNonCode(trimmed);
    if (cleaned.trim() === "") continue;

    for (const detector of FAULT_DETECTORS) {
      if (!detector.match.test(cleaned)) continue;
      if (detector.exclude?.test(cleaned)) continue;

      // Deduplicate: same pattern on same line
      const alreadyReported = entries.some((e) => e.line === i + 1 && e.pattern === detector.id);
      if (alreadyReported) continue;

      entries.push({
        line: i + 1,
        code: trimmed,
        pattern: detector.id,
        category: detector.category,
        defectClasses: [...detector.defectClasses],
        description: detector.description,
        testStrategy: detector.testStrategy,
      });
    }
  }

  // Build summary and coverage
  const summary: Record<string, number> = {};
  const coverageSet = new Set<DefectClass>();
  for (const entry of entries) {
    summary[entry.category] = (summary[entry.category] ?? 0) + 1;
    for (const dc of entry.defectClasses) {
      coverageSet.add(dc);
    }
  }

  return {
    entries,
    summary,
    coverage: [...coverageSet],
  };
}

function buildSuggestion(dc: DefectClass, entry: FaultEntry, targetFaults: number[]): TestSuggestion {
  const template = DEFECT_TEMPLATES[dc];
  return {
    name: template.name,
    defectComment: `// Defect: ${dc} at line ${entry.line} — ${entry.description}`,
    targetFaults,
    inputs: template.inputs,
    expectedBehavior: template.expectedBehavior,
  };
}

export function suggestTests(surface: FaultSurface): TestSuggestion[] {
  const suggestions: TestSuggestion[] = [];

  for (const dc of surface.coverage) {
    // Find all entries with this defect class
    const relevantIndices: number[] = [];
    for (let i = 0; i < surface.entries.length; i++) {
      if (surface.entries[i].defectClasses.includes(dc)) {
        relevantIndices.push(i);
      }
    }

    if (relevantIndices.length === 0) continue;

    const firstEntry = surface.entries[relevantIndices[0]];
    suggestions.push(buildSuggestion(dc, firstEntry, relevantIndices));
  }

  return suggestions;
}

function isDefectCovered(dc: DefectClass, comments: string[]): boolean {
  const dcLower = dc.toLowerCase();
  const dcSpaced = dcLower.replace(/-/g, " ");
  const words = dcLower.split("-").filter((w) => w.length > 3);

  return comments.some((comment) => {
    if (comment.includes(dcLower)) return true;
    if (comment.includes(dcSpaced)) return true;
    return words.some((word) => comment.includes(word));
  });
}

export function validateCoverage(testSource: string, surface: FaultSurface): ValidationResult {
  // Extract defect comments from test source
  const comments: string[] = [];
  for (const line of testSource.split("\n")) {
    const match = line.match(/\/\/\s*Defect:\s*(.*)/i);
    if (match) {
      comments.push(match[1].toLowerCase());
    }
  }

  const gaps: CoverageGap[] = [];
  let covered = 0;
  const total = surface.coverage.length;

  for (const dc of surface.coverage) {
    if (isDefectCovered(dc, comments)) {
      covered++;
    } else {
      const entry = surface.entries.find((e) => e.defectClasses.includes(dc));
      if (entry) {
        gaps.push({
          fault: entry,
          reason: `No test targets defect class "${dc}"`,
        });
      }
    }
  }

  const score = total === 0 ? 100 : Math.round((covered / total) * 100);

  return { covered, total, gaps, score };
}

export function formatTestPlan(surface: FaultSurface): string {
  if (surface.entries.length === 0) {
    return "No fault-prone patterns detected.";
  }

  const lines: string[] = [
    "# Fault Surface Analysis",
    "",
    `Found **${surface.entries.length}** fault-prone patterns across **${surface.coverage.length}** defect classes.`,
    "",
    "## Detected Faults",
    "",
    "| Line | Pattern | Defect Classes | Test Strategy |",
    "|------|---------|----------------|---------------|",
  ];

  for (const entry of surface.entries) {
    lines.push(`| ${entry.line} | ${entry.pattern} | ${entry.defectClasses.join(", ")} | ${entry.testStrategy} |`);
  }

  lines.push("");
  lines.push("## Summary");
  lines.push("");
  for (const [category, count] of Object.entries(surface.summary)) {
    lines.push(`- **${category}**: ${count} pattern${count !== 1 ? "s" : ""}`);
  }

  return lines.join("\n");
}
