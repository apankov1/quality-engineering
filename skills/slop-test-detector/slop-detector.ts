/**
 * Slop Test Detector
 *
 * Static analyzer for test quality. Detects 18 slop patterns in test code
 * that compile and pass but catch zero bugs.
 *
 * Zero dependencies — uses only Node.js built-ins.
 *
 * Consumers:
 * - Agents: analyzeTestFile() or validateTestBlock() during generation
 * - Humans: formatReport(analyzeTestFile(source)) for CLI audit
 */

import { builtinModules } from "node:module";

// ============================================================================
// TYPES
// ============================================================================

export type Severity = "must-fail" | "should-fail";

export type SlopRule =
  | "empty_test_body"
  | "commented_out_assertions"
  | "tautological_assertion"
  | "self_referential_assertion"
  | "missing_defect_comment"
  | "trivial_defect_comment"
  | "assert_on_type_not_value"
  | "truthiness_only"
  | "no_negative_test"
  | "duplicate_assertion_set"
  | "assert_return_type_only"
  | "no_input_variation"
  | "literal_roundtrip"
  | "schema_success_only"
  | "conditional_assertion"
  | "vacuous_property"
  | "no_production_call"
  | "impossible_assertion";

export interface ParsedAssertion {
  lineNumber: number;
  raw: string;
  method: string;
  args: string;
  isCommented: boolean;
}

export interface ParsedTestBlock {
  name: string;
  startLine: number;
  endLine: number;
  assertions: ParsedAssertion[];
  assertionEquivCount: number;
  precedingLines: string[];
  bodyLines: string[];
  parentDescribeName: string | null;
}

export interface ParsedDescribeBlock {
  name: string;
  startLine: number;
  endLine: number;
  tests: ParsedTestBlock[];
  nestedDescribes: ParsedDescribeBlock[];
}

export interface SlopFinding {
  rule: SlopRule;
  severity: Severity;
  testName: string;
  describeName: string | null;
  line: number;
  message: string;
  suggestion: string;
}

export interface SlopReport {
  filePath: string;
  findings: SlopFinding[];
  score: number;
  summary: { total: number; mustFail: number; shouldFail: number; testCount: number };
}

export interface SlopConfig {
  enabledRules: Set<SlopRule>;
  assertionEquivalents: string[];
  scoreThreshold: number;
}

export interface SlopSuppression {
  rule: SlopRule;
  reason: string;
  line: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const ALL_RULES: SlopRule[] = [
  "empty_test_body",
  "commented_out_assertions",
  "tautological_assertion",
  "self_referential_assertion",
  "missing_defect_comment",
  "trivial_defect_comment",
  "assert_on_type_not_value",
  "truthiness_only",
  "no_negative_test",
  "duplicate_assertion_set",
  "assert_return_type_only",
  "no_input_variation",
  "literal_roundtrip",
  "schema_success_only",
  "conditional_assertion",
  "vacuous_property",
  "no_production_call",
  "impossible_assertion",
];

const OPINIONATED_RULES: SlopRule[] = ["missing_defect_comment", "trivial_defect_comment"];

const RULE_SEVERITY: Record<SlopRule, Severity> = {
  empty_test_body: "must-fail",
  commented_out_assertions: "must-fail",
  tautological_assertion: "must-fail",
  self_referential_assertion: "must-fail",
  missing_defect_comment: "should-fail",
  trivial_defect_comment: "should-fail",
  assert_on_type_not_value: "should-fail",
  truthiness_only: "should-fail",
  no_negative_test: "should-fail",
  duplicate_assertion_set: "should-fail",
  assert_return_type_only: "should-fail",
  no_input_variation: "should-fail",
  literal_roundtrip: "should-fail",
  schema_success_only: "should-fail",
  conditional_assertion: "must-fail",
  vacuous_property: "should-fail",
  no_production_call: "should-fail",
  impossible_assertion: "should-fail",
};

// Presets: strict = all 18, balanced = no defect-comment rules, advisory = all rules with threshold 0
export function getPreset(name: "strict" | "balanced" | "advisory"): SlopConfig {
  switch (name) {
    case "strict":
      return { enabledRules: new Set(ALL_RULES), assertionEquivalents: [], scoreThreshold: 90 };
    case "balanced":
      return {
        enabledRules: new Set(ALL_RULES.filter((r) => !OPINIONATED_RULES.includes(r))),
        assertionEquivalents: [],
        scoreThreshold: 80,
      };
    case "advisory":
      return { enabledRules: new Set(ALL_RULES), assertionEquivalents: [], scoreThreshold: 0 };
  }
}

const DEFAULT_CONFIG: SlopConfig = getPreset("balanced");

const SLOP_IGNORE_RE = /\/\/\s*slop-ignore:\s*([\w,\s]+?)\s*—\s*(.+?)\s*$/;

// Vitest/Jest/Chai expect matchers mapped to assert.* equivalents for rule analysis.
// Function-call matchers: expect(x).matcher(y) — both vitest-style (toEqual) and chai-style (equal).
const EXPECT_MATCHER_MAP: Record<string, { method: string; hasArg: boolean }> = {
  // vitest / jest
  toBe: { method: "equal", hasArg: true },
  toEqual: { method: "deepEqual", hasArg: true },
  toStrictEqual: { method: "deepStrictEqual", hasArg: true },
  toBeTruthy: { method: "ok", hasArg: false },
  toBeFalsy: { method: "ok", hasArg: false },
  toBeDefined: { method: "ok", hasArg: false },
  toBeUndefined: { method: "ok", hasArg: false },
  toBeNull: { method: "ok", hasArg: false },
  toBeNaN: { method: "ok", hasArg: false },
  toThrow: { method: "throws", hasArg: false },
  toThrowError: { method: "throws", hasArg: false },
  toMatch: { method: "match", hasArg: true },
  toMatchObject: { method: "deepEqual", hasArg: true },
  toContain: { method: "deepEqual", hasArg: true },
  toContainEqual: { method: "deepEqual", hasArg: true },
  toHaveLength: { method: "equal", hasArg: true },
  toHaveProperty: { method: "equal", hasArg: true },
  toBeGreaterThan: { method: "equal", hasArg: true },
  toBeGreaterThanOrEqual: { method: "equal", hasArg: true },
  toBeLessThan: { method: "equal", hasArg: true },
  toBeLessThanOrEqual: { method: "equal", hasArg: true },
  toBeInstanceOf: { method: "equal", hasArg: true },
  toBeCloseTo: { method: "equal", hasArg: true },
  toHaveBeenCalled: { method: "ok", hasArg: false },
  toHaveBeenCalledWith: { method: "equal", hasArg: true },
  toHaveBeenCalledTimes: { method: "equal", hasArg: true },
  toMatchSnapshot: { method: "ok", hasArg: false },
  toMatchInlineSnapshot: { method: "ok", hasArg: false },
  // chai function-call matchers
  equal: { method: "equal", hasArg: true },
  equals: { method: "equal", hasArg: true },
  eql: { method: "deepEqual", hasArg: true },
  eqls: { method: "deepEqual", hasArg: true },
  above: { method: "equal", hasArg: true },
  below: { method: "equal", hasArg: true },
  least: { method: "equal", hasArg: true },
  most: { method: "equal", hasArg: true },
  within: { method: "equal", hasArg: true },
  instanceof: { method: "equal", hasArg: true },
  property: { method: "equal", hasArg: true },
  lengthOf: { method: "equal", hasArg: true },
  match: { method: "match", hasArg: true },
  matches: { method: "match", hasArg: true },
  throw: { method: "throws", hasArg: false },
  throws: { method: "throws", hasArg: false },
  Throw: { method: "throws", hasArg: false },
  include: { method: "deepEqual", hasArg: true },
  includes: { method: "deepEqual", hasArg: true },
  contain: { method: "deepEqual", hasArg: true },
  contains: { method: "deepEqual", hasArg: true },
  satisfy: { method: "ok", hasArg: true },
  satisfies: { method: "ok", hasArg: true },
  closeTo: { method: "equal", hasArg: true },
  oneOf: { method: "deepEqual", hasArg: true },
};

// Chai property assertions — no parens: expect(x).to.be.true;
const EXPECT_PROPERTY_MAP: Record<string, string> = {
  ok: "ok",
  true: "ok",
  false: "ok",
  null: "ok",
  undefined: "ok",
  NaN: "ok",
  exist: "ok",
  empty: "ok",
  finite: "ok",
  sealed: "ok",
  frozen: "ok",
};

// Chai language chain words — passthrough with no semantic effect (except not/deep/rejects/resolves).
const EXPECT_CHAIN_PASSTHROUGHS = new Set([
  "to",
  "be",
  "been",
  "is",
  "has",
  "have",
  "that",
  "which",
  "and",
  "with",
  "at",
  "of",
  "same",
  "but",
  "does",
  "still",
  "also",
]);

const EXPECT_CALL_RE = /\bexpect\s*\(/;

const ASSERT_METHODS = [
  "equal",
  "ok",
  "throws",
  "deepEqual",
  "rejects",
  "doesNotReject",
  "doesNotThrow",
  "fail",
  "notEqual",
  "deepStrictEqual",
  "strictEqual",
  "match",
  "doesNotMatch",
  "ifError",
  "notDeepEqual",
  "notDeepStrictEqual",
  "notStrictEqual",
] as const;
const ASSERT_METHOD_SET = new Set<string>(ASSERT_METHODS);
const ASSERT_MODULE_RE = new RegExp(`assert\\.(${ASSERT_METHODS.join("|")})\\s*\\(`);

// ============================================================================
// PARSER UTILITIES
// ============================================================================

const REGEX_PREFIX_CHARS = new Set("(,=!|&?:;[{~^%<>+-*");

function isRegexStart(text: string, slashPos: number): boolean {
  let j = slashPos - 1;
  while (j >= 0 && (text[j] === " " || text[j] === "\t")) j--;
  if (j < 0) return true;
  return REGEX_PREFIX_CHARS.has(text[j]);
}

type LexState = "code" | "single" | "double" | "backtick" | "regex" | "block-comment";

// "stop" return halts iteration immediately.
type CodeCharAction = "stop" | undefined;

interface ScanOptions {
  text: string;
  start?: number;
  initialState?: LexState;
  onCode: (ch: string, i: number) => CodeCharAction;
  onLineComment?: (i: number) => CodeCharAction;
  onBlockCommentToggle?: (entering: boolean) => void;
}

function scanCode(opts: ScanOptions): LexState {
  const { text, start = 0, onCode, onLineComment, onBlockCommentToggle } = opts;
  let state: LexState = opts.initialState ?? "code";

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    // Backslash escape inside strings
    if (state !== "code" && state !== "block-comment" && state !== "regex" && ch === "\\") {
      i++;
      continue;
    }

    switch (state) {
      case "code":
        if (ch === "'") state = "single";
        else if (ch === '"') state = "double";
        else if (ch === "`") state = "backtick";
        else if (ch === "/" && text[i + 1] === "*") {
          state = "block-comment";
          onBlockCommentToggle?.(true);
          i++;
        } else if (ch === "/" && text[i + 1] === "/") {
          if (onLineComment?.(i) === "stop") return state;
          return state; // line comments end the line for code purposes
        } else if (ch === "/" && isRegexStart(text, i)) {
          state = "regex";
        } else if (onCode(ch, i) === "stop") {
          return state;
        }
        break;
      case "regex":
        if (ch === "\\") {
          i++;
        } else if (ch === "[") {
          for (i++; i < text.length; i++) {
            if (text[i] === "\\" && i + 1 < text.length) i++;
            else if (text[i] === "]") break;
          }
        } else if (ch === "/") {
          state = "code";
        }
        break;
      case "block-comment":
        if (ch === "*" && text[i + 1] === "/") {
          state = "code";
          onBlockCommentToggle?.(false);
          i++;
        }
        break;
      case "single":
        if (ch === "'") state = "code";
        break;
      case "double":
        if (ch === '"') state = "code";
        break;
      case "backtick":
        if (ch === "`") state = "code";
        break;
    }
  }
  return state;
}

function extractCodeOnly(text: string): string {
  let code = "";
  scanCode({
    text,
    onCode(ch) {
      code += ch;
    },
  });
  return code;
}

function computeBraceDelta(line: string, startsInBlockComment = false): { delta: number; endsInBlockComment: boolean } {
  let delta = 0;
  const endState = scanCode({
    text: line,
    initialState: startsInBlockComment ? "block-comment" : "code",
    onCode(ch) {
      if (ch === "{") delta++;
      else if (ch === "}") delta--;
    },
  });
  return { delta, endsInBlockComment: endState === "block-comment" };
}

function extractArgsFromLine(line: string, startIndex: number): { args: string; complete: boolean } {
  let depth = 1;
  let endPos = -1;
  scanCode({
    text: line,
    start: startIndex,
    onCode(ch, i) {
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          endPos = i;
          return "stop";
        }
      }
    },
  });
  if (endPos >= 0) return { args: line.slice(startIndex, endPos), complete: true };
  return { args: line.slice(startIndex).replace(/,?\s*$/, ""), complete: false };
}

export function splitAssertArgs(args: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  // Manual scan — we need to accumulate characters including those inside strings/regex
  let state: "code" | "single" | "double" | "backtick" | "regex" = "code";
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (state !== "code" && state !== "regex" && ch === "\\") {
      current += ch + (args[i + 1] ?? "");
      i++;
      continue;
    }
    switch (state) {
      case "code":
        if (ch === "'") {
          state = "single";
          current += ch;
        } else if (ch === '"') {
          state = "double";
          current += ch;
        } else if (ch === "`") {
          state = "backtick";
          current += ch;
        } else if (ch === "/" && isRegexStart(args, i)) {
          state = "regex";
          current += ch;
        } else if (ch === "(" || ch === "[" || ch === "{") {
          depth++;
          current += ch;
        } else if (ch === ")" || ch === "]" || ch === "}") {
          depth--;
          current += ch;
        } else if (ch === "," && depth === 0) {
          parts.push(current.trim());
          current = "";
        } else {
          current += ch;
        }
        break;
      case "regex":
        current += ch;
        if (ch === "\\") {
          current += args[i + 1] ?? "";
          i++;
        } else if (ch === "[") {
          for (i++; i < args.length; i++) {
            current += args[i];
            if (args[i] === "\\" && i + 1 < args.length) {
              i++;
              current += args[i];
            } else if (args[i] === "]") break;
          }
        } else if (ch === "/") {
          state = "code";
        }
        break;
      case "single":
        current += ch;
        if (ch === "'") state = "code";
        break;
      case "double":
        current += ch;
        if (ch === '"') state = "code";
        break;
      case "backtick":
        current += ch;
        if (ch === "`") state = "code";
        break;
      default:
        break;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export function isLiteral(s: string): boolean {
  return /^(true|false|null|undefined|-?\d+(\.\d+)?|"[^"]*"|'[^']*')$/.test(s);
}

function stripTrailingLineComment(line: string): string {
  let commentStart = -1;
  scanCode({
    text: line,
    onCode() {},
    onLineComment(i) {
      commentStart = i;
      return "stop";
    },
  });
  return commentStart >= 0 ? line.slice(0, commentStart).trimEnd() : line;
}

function findAssertCallInCode(line: string): { method: string; argsStart: number } | null {
  let found: { method: string; argsStart: number } | null = null;
  const identChar = /[A-Za-z0-9_$]/;

  scanCode({
    text: line,
    onCode(_ch, i) {
      if (!line.startsWith("assert.", i)) return;

      const prev = i > 0 ? line[i - 1] : "";
      if (prev && identChar.test(prev)) return;

      let j = i + "assert.".length;
      while (j < line.length && /[A-Za-z]/.test(line[j])) j++;
      const method = line.slice(i + "assert.".length, j);
      if (!ASSERT_METHOD_SET.has(method)) return;

      while (line[j] === " " || line[j] === "\t") j++;
      if (line[j] !== "(") return;

      found = { method, argsStart: j + 1 };
      return "stop";
    },
    onLineComment() {
      return "stop";
    },
  });

  return found;
}

function findExpectInCode(line: string): { openParenPos: number } | null {
  let found: { openParenPos: number } | null = null;
  const identChar = /[A-Za-z0-9_$]/;

  scanCode({
    text: line,
    onCode(_ch, i) {
      if (!line.startsWith("expect", i)) return;
      const prev = i > 0 ? line[i - 1] : "";
      if (prev && identChar.test(prev)) return;
      let j = i + "expect".length;
      while (line[j] === " " || line[j] === "\t") j++;
      if (line[j] !== "(") return;
      found = { openParenPos: j };
      return "stop";
    },
    onLineComment() {
      return "stop";
    },
  });

  return found;
}

function parseExpectExpression(text: string, openParenPos: number): { method: string; args: string } | null {
  // 1. Extract actual arg via paren balancing
  let depth = 1;
  let closeParen = -1;
  scanCode({
    text,
    start: openParenPos + 1,
    onCode(ch, i) {
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          closeParen = i;
          return "stop";
        }
      }
    },
  });
  if (closeParen < 0) return null;

  const actualExpr = text.slice(openParenPos + 1, closeParen).trim();

  // 2. Parse chain after closing paren: modifiers then .matcher(args) or .property
  let pos = closeParen + 1;
  let isRejects = false;
  let isDeep = false;
  const identRe = /[a-zA-Z0-9_$]/;

  while (pos < text.length) {
    // Skip whitespace (including newlines in combined text)
    while (pos < text.length && /\s/.test(text[pos])) pos++;
    if (pos >= text.length || text[pos] !== ".") return null;
    pos++; // skip dot
    while (pos < text.length && /\s/.test(text[pos])) pos++;

    // Read identifier
    const identStart = pos;
    while (pos < text.length && identRe.test(text[pos])) pos++;
    const ident = text.slice(identStart, pos);

    // Chain modifiers: not, resolves, rejects, deep, and chai language chains
    if (ident === "not" || EXPECT_CHAIN_PASSTHROUGHS.has(ident)) continue;
    if (ident === "resolves") continue;
    if (ident === "rejects") {
      isRejects = true;
      continue;
    }
    if (
      ident === "deep" ||
      ident === "nested" ||
      ident === "ordered" ||
      ident === "own" ||
      ident === "any" ||
      ident === "all"
    ) {
      if (ident === "deep") isDeep = true;
      continue;
    }

    // Check for function-call matcher: .matcher(args)
    const matcherInfo = EXPECT_MATCHER_MAP[ident];
    // Skip whitespace before potential (
    let peekPos = pos;
    while (peekPos < text.length && /\s/.test(text[peekPos])) peekPos++;

    if (matcherInfo && peekPos < text.length && text[peekPos] === "(") {
      pos = peekPos + 1; // skip (
      const { args: matcherArgs, complete } = extractArgsFromLine(text, pos);
      if (!complete) return null;

      // If chai .deep.equal → map to deepEqual instead of equal
      let method = matcherInfo.method;
      if (isDeep && method === "equal") method = "deepEqual";
      if (isRejects && (method === "throws" || method === "ok")) method = "rejects";

      let mappedArgs: string;
      if (method === "throws" || method === "rejects") {
        mappedArgs = actualExpr;
      } else if (matcherInfo.hasArg && matcherArgs.trim()) {
        mappedArgs = `${actualExpr}, ${matcherArgs}`;
      } else {
        mappedArgs = actualExpr;
      }

      return { method, args: mappedArgs };
    }

    // Check for chai property assertion (no parens): expect(x).to.be.true;
    const propertyMethod = EXPECT_PROPERTY_MAP[ident];
    if (propertyMethod) {
      return { method: propertyMethod, args: actualExpr };
    }

    return null;
  }

  return null;
}

function tryExtractExpect(
  testLine: string,
  isCommented: boolean,
  bodyLines: string[],
  lineIndex: number,
  baseLineNumber: number,
  rawTrimmed: string,
): ParsedAssertion | null {
  // Find expect( — use code-aware scan for active lines, regex for commented
  let openParenPos: number;
  if (isCommented) {
    const match = EXPECT_CALL_RE.exec(testLine);
    if (!match) return null;
    openParenPos = match.index + match[0].length - 1;
  } else {
    const result = findExpectInCode(testLine);
    if (!result) return null;
    openParenPos = result.openParenPos;
  }

  // Try parsing on current line
  let parsed = parseExpectExpression(testLine, openParenPos);

  if (!parsed) {
    // Combine with subsequent lines until chain is complete
    let combined = stripTrailingLineComment(testLine);
    for (let j = lineIndex + 1; j < bodyLines.length; j++) {
      const nextTrimmed = bodyLines[j].trimStart();
      const nextLine = isCommented && nextTrimmed.startsWith("//") ? nextTrimmed.slice(2).trimStart() : nextTrimmed;
      combined += ` ${stripTrailingLineComment(nextLine)}`;
      parsed = parseExpectExpression(combined, openParenPos);
      if (parsed) break;
    }
  }

  if (!parsed) return null;

  return {
    lineNumber: baseLineNumber + lineIndex,
    raw: rawTrimmed,
    method: parsed.method,
    args: parsed.args,
    isCommented,
  };
}

function extractAssertions(bodyLines: string[], baseLineNumber: number): ParsedAssertion[] {
  const results: ParsedAssertion[] = [];

  for (let i = 0; i < bodyLines.length; i++) {
    const raw = bodyLines[i];
    const trimmed = raw.trimStart();
    const isCommented = trimmed.startsWith("//");
    const testLine = isCommented ? trimmed.slice(2).trimStart() : trimmed;

    let method = "";
    let argsStart = -1;

    if (isCommented) {
      const match = ASSERT_MODULE_RE.exec(testLine);
      if (!match) {
        // Try expect() for commented lines
        const expectAssertion = tryExtractExpect(testLine, true, bodyLines, i, baseLineNumber, trimmed);
        if (expectAssertion) results.push(expectAssertion);
        continue;
      }
      method = match[1];
      argsStart = match.index + match[0].length;
    } else {
      const call = findAssertCallInCode(testLine);
      if (!call) {
        // Try expect() for active lines
        const expectAssertion = tryExtractExpect(testLine, false, bodyLines, i, baseLineNumber, trimmed);
        if (expectAssertion) results.push(expectAssertion);
        continue;
      }
      method = call.method;
      argsStart = call.argsStart;
    }

    let { args, complete } = extractArgsFromLine(testLine, argsStart);

    if (!complete) {
      let combined = stripTrailingLineComment(testLine);
      for (let j = i + 1; j < bodyLines.length; j++) {
        const nextTrimmed = bodyLines[j].trimStart();
        const nextLine = isCommented && nextTrimmed.startsWith("//") ? nextTrimmed.slice(2).trimStart() : nextTrimmed;
        combined += ` ${stripTrailingLineComment(nextLine)}`;
        const result = extractArgsFromLine(combined, argsStart);
        args = result.args;
        if (result.complete) break;
      }
    }

    results.push({ lineNumber: baseLineNumber + i, raw: trimmed, method, args, isCommented });
  }

  return results;
}

function countAssertionEquivs(bodyLines: string[], allowlist: string[]): number {
  if (allowlist.length === 0) return 0;

  function hasAllowlistedCall(line: string): boolean {
    let found = false;
    const identChar = /[A-Za-z0-9_$]/;

    scanCode({
      text: line,
      onCode(_ch, i) {
        for (const name of allowlist) {
          if (!line.startsWith(name, i)) continue;
          const prev = i > 0 ? line[i - 1] : "";
          if (prev && identChar.test(prev)) continue;

          let j = i + name.length;
          while (line[j] === " " || line[j] === "\t") j++;
          if (line[j] !== "(") continue;

          found = true;
          return "stop";
        }
      },
      onLineComment() {
        return "stop";
      },
    });

    return found;
  }

  let count = 0;
  for (const line of bodyLines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//")) continue;
    if (ASSERT_MODULE_RE.test(trimmed)) continue;
    if (EXPECT_CALL_RE.test(trimmed)) continue;
    if (hasAllowlistedCall(line)) count++;
  }
  return count;
}

// ============================================================================
// PARSER
// ============================================================================

interface StackEntry {
  type: "describe" | "it";
  name: string;
  startLine: number;
  braceDepthAtOpen: number;
  precedingLines: string[];
  childTests: ParsedTestBlock[];
  childDescribes: ParsedDescribeBlock[];
}

export function parseTestFile(
  source: string,
  assertionEquivalents: string[] = [],
): { describes: ParsedDescribeBlock[]; allTests: ParsedTestBlock[] } {
  const lines = source.split("\n");
  const allTests: ParsedTestBlock[] = [];
  const topLevelDescribes: ParsedDescribeBlock[] = [];

  const stack: StackEntry[] = [];
  let braceDepth = 0;
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    const { delta, endsInBlockComment } = computeBraceDelta(line, inBlockComment);
    const wasInBlockComment = inBlockComment;
    inBlockComment = endsInBlockComment;

    const descMatch = wasInBlockComment ? null : trimmed.match(/^describe(?:\.(?:only|skip))?\(\s*["'`]([^"'`]+)["'`]/);
    const itMatch =
      wasInBlockComment || descMatch ? null : trimmed.match(/^(?:it|test)(?:\.(?:only|skip))?\(\s*["'`]([^"'`]+)["'`]/);

    const prevDepth = braceDepth;
    braceDepth += delta;

    if (descMatch) {
      stack.push({
        type: "describe",
        name: descMatch[1],
        startLine: i + 1,
        braceDepthAtOpen: prevDepth + 1,
        precedingLines: [],
        childTests: [],
        childDescribes: [],
      });
    } else if (itMatch) {
      stack.push({
        type: "it",
        name: itMatch[1],
        startLine: i + 1,
        braceDepthAtOpen: prevDepth + 1,
        precedingLines: lines.slice(Math.max(0, i - 3), i),
        childTests: [],
        childDescribes: [],
      });
    }

    while (stack.length > 0 && braceDepth < stack[stack.length - 1].braceDepthAtOpen) {
      const entry = stack.pop();
      if (!entry) break;
      const endLine = i + 1;

      if (entry.type === "it") {
        const bodyLines = lines.slice(entry.startLine - 1, endLine);
        const assertions = extractAssertions(bodyLines, entry.startLine);
        const assertionEquivCount = countAssertionEquivs(bodyLines, assertionEquivalents);

        const parentDesc = stack.findLast((e) => e.type === "describe");
        const test: ParsedTestBlock = {
          name: entry.name,
          startLine: entry.startLine,
          endLine,
          assertions,
          assertionEquivCount,
          precedingLines: entry.precedingLines,
          bodyLines,
          parentDescribeName: parentDesc?.name ?? null,
        };

        allTests.push(test);
        if (parentDesc) parentDesc.childTests.push(test);
      }

      if (entry.type === "describe") {
        const desc: ParsedDescribeBlock = {
          name: entry.name,
          startLine: entry.startLine,
          endLine,
          tests: entry.childTests,
          nestedDescribes: entry.childDescribes,
        };

        const parentDesc = stack.findLast((e) => e.type === "describe");
        if (parentDesc) {
          parentDesc.childDescribes.push(desc);
        } else {
          topLevelDescribes.push(desc);
        }
      }
    }
  }

  return { describes: topLevelDescribes, allTests };
}

// ============================================================================
// HELPERS
// ============================================================================

function makeFinding(
  rule: SlopRule,
  block: { name: string; parentDescribeName: string | null },
  line: number,
  message: string,
  suggestion: string,
): SlopFinding {
  return {
    rule,
    severity: RULE_SEVERITY[rule],
    testName: block.name,
    describeName: block.parentDescribeName,
    line,
    message,
    suggestion,
  };
}

function activeAssertions(block: ParsedTestBlock): ParsedAssertion[] {
  return block.assertions.filter((a) => !a.isCommented);
}

// ============================================================================
// RULE CHECKERS: MUST-FAIL
// ============================================================================

export function checkEmptyTestBody(block: ParsedTestBlock): SlopFinding | null {
  const active = activeAssertions(block);
  if (active.length === 0 && block.assertionEquivCount === 0) {
    return makeFinding(
      "empty_test_body",
      block,
      block.startLine,
      "Test body contains zero assertions — passes regardless of behavior",
      "Add at least one assert.* call or assertion-equivalent helper",
    );
  }
  return null;
}

export function checkCommentedOutAssertions(block: ParsedTestBlock): SlopFinding | null {
  const active = activeAssertions(block);
  const commented = block.assertions.filter((a) => a.isCommented);
  if (active.length === 0 && commented.length > 0 && block.assertionEquivCount === 0) {
    return makeFinding(
      "commented_out_assertions",
      block,
      commented[0].lineNumber,
      `All ${commented.length} assertion(s) are commented out — test is inert`,
      "Uncomment assertions or delete the test",
    );
  }
  return null;
}

export function checkTautologicalAssertion(block: ParsedTestBlock): SlopFinding[] {
  const findings: SlopFinding[] = [];

  for (const a of activeAssertions(block)) {
    if (a.method === "ok") {
      const arg = a.args.trim();
      if (/^(true|1)$/.test(arg)) {
        findings.push(
          makeFinding(
            "tautological_assertion",
            block,
            a.lineNumber,
            `assert.ok(${arg}) always passes — does not verify behavior`,
            "Replace with assertion on actual computed value",
          ),
        );
      }
    }

    if (a.method === "equal" || a.method === "strictEqual") {
      const parts = splitAssertArgs(a.args);
      if (parts.length >= 2 && parts[0] === parts[1] && isLiteral(parts[0])) {
        findings.push(
          makeFinding(
            "tautological_assertion",
            block,
            a.lineNumber,
            `assert.${a.method}(${parts[0]}, ${parts[1]}) compares identical literals — always passes`,
            "Replace with assertion comparing computed value to expected literal",
          ),
        );
      }
    }
  }

  return findings;
}

export function checkSelfReferentialAssertion(block: ParsedTestBlock): SlopFinding[] {
  const findings: SlopFinding[] = [];
  const methods = new Set(["equal", "deepEqual", "strictEqual", "deepStrictEqual"]);

  for (const a of activeAssertions(block)) {
    if (!methods.has(a.method)) continue;
    const parts = splitAssertArgs(a.args);
    if (parts.length >= 2 && parts[0] === parts[1] && parts[0].length > 0 && !isLiteral(parts[0])) {
      findings.push(
        makeFinding(
          "self_referential_assertion",
          block,
          a.lineNumber,
          `assert.${a.method}(${parts[0]}, ${parts[0]}) compares value to itself — always passes`,
          "Compare against an expected value, not the same expression",
        ),
      );
    }
  }

  return findings;
}

// ============================================================================
// RULE CHECKERS: SHOULD-FAIL (BLOCK-LEVEL)
// ============================================================================

export function checkMissingDefectComment(block: ParsedTestBlock): SlopFinding | null {
  const hasDefect = block.precedingLines.some((line) => /\/\/\s*Defect:/i.test(line));
  if (!hasDefect) {
    return makeFinding(
      "missing_defect_comment",
      block,
      block.startLine,
      "No // Defect: comment explaining what bug this test catches",
      "Add a comment like: // Defect: if X is broken, then Y fails in production",
    );
  }
  return null;
}

export function checkTrivialDefectComment(block: ParsedTestBlock): SlopFinding | null {
  for (const line of block.precedingLines) {
    const match = line.match(/\/\/\s*Defect:\s*(.*)/i);
    if (match) {
      const text = match[1].trim();
      const words = text.split(/\s+/).filter((w) => w.length > 0);
      if (words.length < 10) {
        return makeFinding(
          "trivial_defect_comment",
          block,
          block.startLine,
          `Defect comment has ${words.length} words (minimum 10) — too brief to explain production impact`,
          "Expand: what breaks, for whom, and what the consequence is",
        );
      }
      return null;
    }
  }
  return null;
}

export function checkAssertOnTypeNotValue(block: ParsedTestBlock): SlopFinding | null {
  const active = activeAssertions(block);
  if (active.length === 0) return null;

  const allTypeChecks = active.every((a) => a.method === "equal" && /typeof\s+\w+/.test(a.args));
  if (allTypeChecks) {
    return makeFinding(
      "assert_on_type_not_value",
      block,
      block.startLine,
      "All assertions check typeof — verifies shape but not behavior",
      "Add at least one assertion on a computed value",
    );
  }
  return null;
}

export function checkTruthinessOnly(block: ParsedTestBlock): SlopFinding | null {
  const active = activeAssertions(block);
  if (active.length === 0 || block.assertionEquivCount > 0) return null;

  const allTruthiness = active.every((a) => a.method === "ok" && /^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(a.args.trim()));
  if (allTruthiness) {
    return makeFinding(
      "truthiness_only",
      block,
      block.startLine,
      "All assertions are assert.ok(identifier) — checks existence but not correctness",
      "Add assert.equal or assert.deepEqual to verify specific values",
    );
  }
  return null;
}

export function checkAssertReturnTypeOnly(block: ParsedTestBlock): SlopFinding | null {
  const active = activeAssertions(block);
  if (active.length !== 1 || block.assertionEquivCount > 0) return null;

  const a = active[0];
  if (a.method !== "ok") return null;

  const argIdent = a.args.trim();
  if (!/^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(argIdent)) return null;

  const assignmentRe = new RegExp(`(?:const|let|var)\\s+${escapeRegExpLiteral(argIdent)}\\s*=`);
  const hasAssignment = block.bodyLines.some((line) => assignmentRe.test(line.trimStart()));

  if (hasAssignment) {
    return makeFinding(
      "assert_return_type_only",
      block,
      a.lineNumber,
      `Only assertion is assert.ok(${argIdent}) on a return value — checks non-null but not correctness`,
      "Assert on specific properties or values of the result",
    );
  }
  return null;
}

// ============================================================================
// RULE CHECKERS: NEW BLOCK-LEVEL RULES
// ============================================================================

export function checkLiteralRoundtrip(block: ParsedTestBlock): SlopFinding[] {
  const findings: SlopFinding[] = [];
  const active = activeAssertions(block);
  if (active.length === 0) return findings;

  // Collect object literal assignments: const x = { key: "literal", ... };
  // Map from variable name → Map<field, literal value>
  const objLiterals = new Map<string, Map<string, string>>();
  const assignRe = /(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*(?::[^=]+=|=)\s*\{/;

  for (const line of block.bodyLines) {
    const trimmed = line.trimStart();
    const match = assignRe.exec(trimmed);
    if (!match) continue;

    const varName = match[1];
    const fields = new Map<string, string>();

    // Simple field extraction: find `key: literal,` patterns in subsequent lines
    const startIdx = block.bodyLines.indexOf(line);
    for (let j = startIdx; j < block.bodyLines.length; j++) {
      const fLine = block.bodyLines[j].trimStart();
      // Match: fieldName: 'literal' or fieldName: "literal" or fieldName: number or fieldName: true/false
      const fieldMatch = fLine.match(/^(\w+)\s*:\s*('([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?)|true|false)\s*[,}]/);
      if (fieldMatch) {
        const fieldName = fieldMatch[1];
        const literalValue = fieldMatch[2];
        fields.set(fieldName, literalValue);
      }
      // Stop at closing brace of the object
      if (fLine.includes("};")) break;
    }

    if (fields.size > 0) objLiterals.set(varName, fields);
  }

  if (objLiterals.size === 0) return findings;

  // Check if assertions compare obj.field to the same literal from construction
  for (const a of active) {
    if (a.method !== "equal" && a.method !== "deepStrictEqual" && a.method !== "strictEqual") continue;
    const parts = splitAssertArgs(a.args);
    if (parts.length < 2) continue;

    // Check both arg positions: assert.equal(obj.field, literal) or expect(obj.field).toBe(literal)
    for (let argIdx = 0; argIdx < 2; argIdx++) {
      const accessPart = parts[argIdx].trim();
      const literalPart = parts[1 - argIdx].trim();

      // Match obj.field or obj.field.subfield
      const accessMatch = accessPart.match(/^([a-zA-Z_$][\w$]*)\.(\w+)$/);
      if (!accessMatch) continue;

      const [, varName, fieldName] = accessMatch;
      const fields = objLiterals.get(varName);
      if (!fields) continue;

      const constructedLiteral = fields.get(fieldName);
      if (constructedLiteral !== undefined && constructedLiteral === literalPart) {
        findings.push(
          makeFinding(
            "literal_roundtrip",
            block,
            a.lineNumber,
            `Asserts ${accessPart} === ${literalPart} — same literal used to construct ${varName}.${fieldName}`,
            "Call a production function between construction and assertion, or assert on computed properties",
          ),
        );
        break; // one finding per assertion
      }
    }
  }

  return findings;
}

export function checkSchemaSuccessOnly(block: ParsedTestBlock): SlopFinding | null {
  const active = activeAssertions(block);
  if (active.length === 0) return null;

  // Check if test body contains .safeParse( or .safeParseAsync(
  const hasSafeParse = block.bodyLines.some((line) => /\.safeParse(?:Async)?\s*\(/.test(line));
  if (!hasSafeParse) return null;
  const bodyText = block.bodyLines.join("\n");

  // Track variables bound to safeParse/safeParseAsync results.
  // This allows detection of meaningful branch guards such as:
  // if (!result.success) assert.fail(...)
  const safeParseVars = new Set<string>();
  for (const line of block.bodyLines) {
    const match = line.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*.*\.safeParse(?:Async)?\s*\(/);
    if (match) safeParseVars.add(match[1]);
  }

  // Check if any assertion verifies .data or .error.issues content
  const hasDataOrErrorCheck = active.some((a) => {
    const args = a.args;
    return (
      /\.data[.\[]/.test(args) ||
      /\.data\s*[,)]/.test(args) ||
      /\.error\.issues/.test(args) ||
      /\.error\.message/.test(args)
    );
  });
  if (hasDataOrErrorCheck) return null;

  const hasFailGuardOnSuccess = [...safeParseVars].some((resultVar) => {
    const escaped = escapeRegExpLiteral(resultVar);
    const negativeGuard = new RegExp(
      `if\\s*\\(\\s*!\\s*${escaped}\\.success\\s*\\)[\\s\\S]{0,300}?assert\\.fail\\s*\\(`,
    );
    const positiveElseGuard = new RegExp(
      `if\\s*\\(\\s*${escaped}\\.success\\s*\\)[\\s\\S]{0,200}?else\\s*\\{[\\s\\S]{0,300}?assert\\.fail\\s*\\(`,
    );
    return negativeGuard.test(bodyText) || positiveElseGuard.test(bodyText);
  });
  if (hasFailGuardOnSuccess) return null;

  // Check that there IS a .success assertion (to confirm this is a safeParse test pattern)
  const hasSuccessCheck = active.some((a) => /\.success/.test(a.args));
  if (!hasSuccessCheck) return null;

  return makeFinding(
    "schema_success_only",
    block,
    block.startLine,
    "safeParse test only checks .success — does not verify .data fields or .error.issues content",
    "Add assertions on result.data properties (acceptance) or result.error.issues (rejection)",
  );
}

export function checkConditionalAssertion(block: ParsedTestBlock): SlopFinding | null {
  const active = activeAssertions(block);
  if (active.length === 0) return null;

  // Check if ALL assertions are inside if/switch blocks by examining brace depth.
  // If the line containing the assertion has higher brace depth than the test's opening line,
  // AND the test body contains an if/switch statement that increases depth, flag it.

  // Find lines with if/switch (not inside strings/comments)
  const conditionalLines = new Set<number>();
  for (let i = 0; i < block.bodyLines.length; i++) {
    const trimmed = block.bodyLines[i].trimStart();
    if (/^(?:if|switch)\s*\(/.test(trimmed) || /}\s*else\s*\{/.test(trimmed) || /}\s*else\s+if\s*\(/.test(trimmed)) {
      conditionalLines.add(i);
    }
  }

  if (conditionalLines.size === 0) return null;

  // Track brace depth relative to test body opening
  let inBlockComment = false;
  const lineDepths: number[] = [];
  let depth = 0;
  for (let i = 0; i < block.bodyLines.length; i++) {
    const { delta, endsInBlockComment } = computeBraceDelta(block.bodyLines[i], inBlockComment);
    lineDepths.push(depth);
    depth += delta;
    inBlockComment = endsInBlockComment;
  }

  // The test body's base depth is at the opening line (first line, typically `it("...", () => {`)
  // Assertions at depth > baseDepth+1 are inside nested blocks
  const baseDepth = lineDepths[0] ?? 0;

  // Check each assertion's line depth
  const allConditional = active.every((a) => {
    const relLine = a.lineNumber - block.startLine;
    if (relLine < 0 || relLine >= lineDepths.length) return false;
    return lineDepths[relLine] > baseDepth + 1;
  });

  if (allConditional) {
    return makeFinding(
      "conditional_assertion",
      block,
      block.startLine,
      "All assertions are inside conditional blocks — test may execute zero assertions and pass vacuously",
      "Move at least one assertion outside the if/switch, or assert on the condition itself",
    );
  }

  return null;
}

// ============================================================================
// RULE CHECKERS: ISSUE #17 RULES
// ============================================================================

export function checkVacuousProperty(block: ParsedTestBlock): SlopFinding | null {
  const codeLines = block.bodyLines.map((line) => extractCodeOnly(line));

  // Only applies to tests using fast-check's fc.property
  const hasFcProperty = codeLines.some((line) => /\bfc\.property\s*\(/.test(line));
  if (!hasFcProperty) return null;

  // Sub-pattern 2b: all generators are fc.constant(...) → zero variation
  // Find the fc.property( call and check if all generator args before the callback are fc.constant
  for (const line of codeLines) {
    const trimmed = line.trimStart();
    const propMatch = trimmed.match(/\bfc\.property\s*\(\s*fc\.constant\s*\(/);
    if (propMatch) {
      // Check if ALL generators in this property call are fc.constant
      // Scan the bodyLines for the fc.property call and its arguments
      const allFcConstant = codeLines.every((lineText) => {
        const t = lineText.trimStart();
        // Lines with generator args (before the callback) should all be fc.constant
        if (/^\s*fc\.\w+\s*\(/.test(t) && !/\bfc\.property\s*\(/.test(t) && !/\bfc\.assert\s*\(/.test(t)) {
          return /\bfc\.constant\s*\(/.test(t);
        }
        return true;
      });
      if (allFcConstant) {
        return makeFinding(
          "vacuous_property",
          block,
          block.startLine,
          "All fc.property generators are fc.constant — zero input variation, same test every run",
          "Use a plain unit test instead, or add generators that produce varying inputs",
        );
      }
    }
  }

  // Sub-pattern 2a: return true that bypasses assertions
  // Track brace depth to find return true statements at various depths
  let inBlockComment = false;
  const lineDepths: number[] = [];
  let depth = 0;
  for (let i = 0; i < block.bodyLines.length; i++) {
    const { delta, endsInBlockComment } = computeBraceDelta(block.bodyLines[i], inBlockComment);
    lineDepths.push(depth);
    depth += delta;
    inBlockComment = endsInBlockComment;
  }

  // Find return true statements and check if any are at a depth where no assertion exists at the same depth
  const returnTrueLines: number[] = [];
  for (let i = 0; i < codeLines.length; i++) {
    const trimmed = codeLines[i].trimStart();
    if (/^return\s+true\s*;?\s*$/.test(trimmed)) {
      returnTrueLines.push(i);
    }
  }

  if (returnTrueLines.length === 0) return null;

  // Get active assertion line indices
  const active = activeAssertions(block);
  const assertionLineIndices = new Set(active.map((a) => a.lineNumber - block.startLine));

  // Check if any return true is at a depth where no assertion exists at the same or deeper level
  // in the same brace scope. Simplified: if there's a return true at a depth that has no assertion
  // at the same depth in the lines leading up to it within its scope → vacuous path.
  for (const rtLine of returnTrueLines) {
    const rtDepth = lineDepths[rtLine];
    // Check if there's an assertion on this path — must be at same or shallower depth
    // (assertions inside deeper conditional blocks don't necessarily execute on this path)
    let hasAssertionInScope = false;
    for (const aIdx of assertionLineIndices) {
      if (aIdx < rtLine && lineDepths[aIdx] <= rtDepth) {
        hasAssertionInScope = true;
        break;
      }
    }
    if (!hasAssertionInScope) {
      return makeFinding(
        "vacuous_property",
        block,
        block.startLine + rtLine,
        "fc.property callback has a `return true` path with zero assertions — test passes vacuously for most inputs",
        "Remove the early return and assert unconditionally, or add assertions before the return",
      );
    }
  }

  return null;
}

const TEST_FRAMEWORK_IDENTS = new Set([
  "assert",
  "expect",
  "describe",
  "it",
  "test",
  "beforeEach",
  "afterEach",
  "beforeAll",
  "afterAll",
  "vi",
  "jest",
  "fc",
  "mock",
  "spy",
  "suite",
  "bench",
]);

interface ImportBinding {
  identifier: string;
  source: string;
}

const IMPORT_STMT_RE = /^\s*import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']\s*;?/gm;
const TEST_FRAMEWORK_MODULES = new Set([
  "node:assert",
  "node:assert/strict",
  "node:test",
  "vitest",
  "@jest/globals",
  "jest",
  "chai",
  "fast-check",
  "bun:test",
  "uvu",
  "tap",
]);
const NODE_BUILTIN_MODULES = new Set(
  builtinModules.flatMap((m) => (m.startsWith("node:") ? [m, m.slice(5)] : [m, `node:${m}`])),
);

function escapeRegExpLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitTopLevelComma(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let braceDepth = 0;
  let inString: "'" | '"' | "`" | null = null;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString !== null) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "{") {
      braceDepth++;
      continue;
    }
    if (ch === "}" && braceDepth > 0) {
      braceDepth--;
      continue;
    }
    if (ch === "," && braceDepth === 0) {
      const part = text.slice(start, i).trim();
      if (part.length > 0) parts.push(part);
      start = i + 1;
    }
  }

  const tail = text.slice(start).trim();
  if (tail.length > 0) parts.push(tail);
  return parts;
}

function parseImportBindings(source: string): ImportBinding[] {
  const bindings: ImportBinding[] = [];
  IMPORT_STMT_RE.lastIndex = 0;
  let match: RegExpExecArray | null = IMPORT_STMT_RE.exec(source);

  while (match !== null) {
    const clause = match[1].trim();
    const moduleSource = match[2];
    if (clause.startsWith("type ")) {
      match = IMPORT_STMT_RE.exec(source);
      continue;
    }

    const parts = splitTopLevelComma(clause);
    for (const part of parts) {
      if (part.startsWith("{")) {
        const inner = part.replace(/^\{\s*|\s*\}$/g, "");
        for (const spec of inner.split(",")) {
          let token = spec.trim();
          if (token.length === 0) continue;
          if (token.startsWith("type ")) token = token.slice(5).trimStart();
          const namedMatch = token.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
          if (!namedMatch) continue;
          bindings.push({ identifier: namedMatch[2] ?? namedMatch[1], source: moduleSource });
        }
        continue;
      }

      const nsMatch = part.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (nsMatch) {
        bindings.push({ identifier: nsMatch[1], source: moduleSource });
        continue;
      }

      let defaultPart = part;
      if (defaultPart.startsWith("type ")) defaultPart = defaultPart.slice(5).trimStart();
      const defaultMatch = defaultPart.match(/^([A-Za-z_$][\w$]*)$/);
      if (defaultMatch) {
        bindings.push({ identifier: defaultMatch[1], source: moduleSource });
      }
    }
    match = IMPORT_STMT_RE.exec(source);
  }

  return bindings;
}

function isNodeBuiltinModule(source: string): boolean {
  if (NODE_BUILTIN_MODULES.has(source)) return true;
  const normalized = source.startsWith("node:") ? source.slice(5) : source;
  if (NODE_BUILTIN_MODULES.has(normalized) || NODE_BUILTIN_MODULES.has(`node:${normalized}`)) return true;
  const root = normalized.split("/")[0];
  return NODE_BUILTIN_MODULES.has(root) || NODE_BUILTIN_MODULES.has(`node:${root}`);
}

function isNonProductionImportSource(source: string): boolean {
  if (isNodeBuiltinModule(source)) return true;
  for (const moduleName of TEST_FRAMEWORK_MODULES) {
    if (source === moduleName || source.startsWith(`${moduleName}/`)) return true;
  }
  return false;
}

export function parseImports(source: string): string[] {
  return parseImportBindings(source).map((b) => b.identifier);
}

export function checkNoProductionCall(block: ParsedTestBlock, productionImports: string[]): SlopFinding | null {
  if (productionImports.length === 0) return null;

  const bodyText = block.bodyLines.join("\n");
  const identChar = /[A-Za-z0-9_$]/;

  for (const ident of productionImports) {
    // Check if the identifier appears as a function call or constructor (new Ident) or property access (ident.method)
    const re = new RegExp(`\\b${escapeRegExpLiteral(ident)}\\b`);
    if (!re.test(bodyText)) continue;

    // Verify it's actually used in code (not just in a string or comment)
    for (const line of block.bodyLines) {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//")) continue;

      let found = false;
      scanCode({
        text: trimmed,
        onCode(_ch, i) {
          if (!trimmed.startsWith(ident, i)) return;
          const prev = i > 0 ? trimmed[i - 1] : "";
          if (prev && identChar.test(prev)) return;
          const next = trimmed[i + ident.length] ?? "";
          if (next && identChar.test(next)) return;
          found = true;
          return "stop";
        },
        onLineComment() {
          return "stop";
        },
      });

      if (found) return null; // Production import IS used — no finding
    }
  }

  return makeFinding(
    "no_production_call",
    block,
    block.startLine,
    "Test body calls no imported production function — tests only builtins or language guarantees",
    "Call a function from the module under test and assert on its result",
  );
}

const IMPOSSIBLE_PATTERNS: Array<{ re: RegExp; message: string }> = [
  {
    re: /\.toBeGreaterThanOrEqual\s*\(\s*0\s*\)/,
    message: ".length is always >= 0 — assertion cannot fail",
  },
  {
    re: /\.not\s*\.\s*toBeLessThan\s*\(\s*0\s*\)/,
    message: ".length is always >= 0 — negated assertion cannot fail",
  },
  {
    re: /assert\.ok\s*\(\s*[\w$.]+\.length\s*>=\s*0\s*\)/,
    message: ".length >= 0 is always true — assertion cannot fail",
  },
];

export function checkImpossibleAssertion(block: ParsedTestBlock): SlopFinding[] {
  const findings: SlopFinding[] = [];

  for (let i = 0; i < block.bodyLines.length; i++) {
    const trimmed = extractCodeOnly(block.bodyLines[i]).trimStart();
    if (trimmed.startsWith("//")) continue;

    // Check for .length combined with impossible comparison
    if (!/\.length\b/.test(trimmed)) continue;

    for (const pattern of IMPOSSIBLE_PATTERNS) {
      if (pattern.re.test(trimmed)) {
        findings.push(
          makeFinding(
            "impossible_assertion",
            block,
            block.startLine + i,
            pattern.message,
            "Assert on a specific expected length, or remove the tautological check",
          ),
        );
        break;
      }
    }
  }

  return findings;
}

// ============================================================================
// RULE CHECKERS: SHOULD-FAIL (DESCRIBE-LEVEL)
// ============================================================================

function collectAllTests(describe: ParsedDescribeBlock): ParsedTestBlock[] {
  const tests = [...describe.tests];
  for (const nested of describe.nestedDescribes) {
    tests.push(...collectAllTests(nested));
  }
  return tests;
}

export function checkNoNegativeTest(describe: ParsedDescribeBlock): SlopFinding | null {
  const allTests = collectAllTests(describe);
  if (allTests.length < 3) return null;

  const hasNegative = allTests.some((t) =>
    t.assertions.some((a) => !a.isCommented && (a.method === "throws" || a.method === "rejects")),
  );

  if (!hasNegative) {
    return {
      rule: "no_negative_test",
      severity: "should-fail",
      testName: "",
      describeName: describe.name,
      line: describe.startLine,
      message: `describe("${describe.name}") has ${allTests.length} tests but zero assert.throws/rejects`,
      suggestion: "Add at least one test for error/rejection paths",
    };
  }
  return null;
}

export function checkDuplicateAssertionSet(describe: ParsedDescribeBlock): SlopFinding[] {
  const findings: SlopFinding[] = [];

  function normalizeSequence(test: ParsedTestBlock): string {
    return activeAssertions(test)
      .map((a) => {
        const normArgs = a.args
          .replace(/"[^"]*"/g, "STR")
          .replace(/'[^']*'/g, "STR")
          .replace(/`[^`]*`/g, "STR");
        return `${a.method}(${normArgs})`;
      })
      .join("|");
  }

  const tests = describe.tests;
  const seen = new Map<string, ParsedTestBlock>();

  for (const test of tests) {
    const active = activeAssertions(test);
    if (active.length === 0) continue;

    const seq = normalizeSequence(test);
    const existing = seen.get(seq);
    if (existing) {
      findings.push({
        rule: "duplicate_assertion_set",
        severity: "should-fail",
        testName: test.name,
        describeName: describe.name,
        line: test.startLine,
        message: `Identical assertion sequence as "${existing.name}" (line ${existing.startLine})`,
        suggestion: "Verify these tests check different behaviors — if so, differentiate assertions",
      });
    } else {
      seen.set(seq, test);
    }
  }

  return findings;
}

export function checkNoInputVariation(describe: ParsedDescribeBlock): SlopFinding[] {
  const findings: SlopFinding[] = [];
  const tests = describe.tests;
  if (tests.length < 2) return findings;

  function extractAssertedCalls(test: ParsedTestBlock): Map<string, string[]> {
    const calls = new Map<string, string[]>();
    for (const a of activeAssertions(test)) {
      const parts = splitAssertArgs(a.args);
      for (const part of parts) {
        let text = part.trim();
        if (text.startsWith("await ")) text = text.slice(6).trimStart();
        const fnMatch = text.match(/^([a-zA-Z_$][\w.]*)\(/);
        if (!fnMatch) continue;
        const fnName = fnMatch[1];
        const argsStart = fnMatch[0].length;
        const { args } = extractArgsFromLine(text, argsStart);
        const existing = calls.get(fnName) ?? [];
        existing.push(args);
        calls.set(fnName, existing);
      }
    }
    return calls;
  }

  for (let i = 0; i < tests.length; i++) {
    const calls1 = extractAssertedCalls(tests[i]);
    for (let j = i + 1; j < tests.length; j++) {
      const calls2 = extractAssertedCalls(tests[j]);
      for (const [fn, argsList1] of calls1) {
        const argsList2 = calls2.get(fn);
        if (!argsList2) continue;
        const matchedArg = argsList1.find((a1) => a1.length > 0 && argsList2.some((a2) => a1 === a2));
        if (matchedArg !== undefined) {
          findings.push({
            rule: "no_input_variation",
            severity: "should-fail",
            testName: tests[j].name,
            describeName: describe.name,
            line: tests[j].startLine,
            message: `Same args to ${fn}() as "${tests[i].name}" — no input variation`,
            suggestion: "Use different inputs to test different behaviors",
          });
        }
      }
    }
  }

  return findings;
}

// ============================================================================
// ORCHESTRATORS
// ============================================================================

function parseSuppressedRules(lines: string[]): Set<SlopRule> {
  const suppressed = new Set<SlopRule>();
  for (const line of lines) {
    const match = SLOP_IGNORE_RE.exec(line);
    if (!match) continue;
    const rules = match[1]
      .split(",")
      .map((r) => r.trim())
      .filter((r) => ALL_RULES.includes(r as SlopRule)) as SlopRule[];
    for (const rule of rules) suppressed.add(rule);
  }
  return suppressed;
}

function runBlockRules(block: ParsedTestBlock, enabled: Set<SlopRule>): SlopFinding[] {
  const findings: SlopFinding[] = [];
  const blockRules: Array<[SlopRule, () => SlopFinding | SlopFinding[] | null]> = [
    ["empty_test_body", () => checkEmptyTestBody(block)],
    ["commented_out_assertions", () => checkCommentedOutAssertions(block)],
    ["tautological_assertion", () => checkTautologicalAssertion(block)],
    ["self_referential_assertion", () => checkSelfReferentialAssertion(block)],
    ["missing_defect_comment", () => checkMissingDefectComment(block)],
    ["trivial_defect_comment", () => checkTrivialDefectComment(block)],
    ["assert_on_type_not_value", () => checkAssertOnTypeNotValue(block)],
    ["truthiness_only", () => checkTruthinessOnly(block)],
    ["assert_return_type_only", () => checkAssertReturnTypeOnly(block)],
    ["literal_roundtrip", () => checkLiteralRoundtrip(block)],
    ["schema_success_only", () => checkSchemaSuccessOnly(block)],
    ["conditional_assertion", () => checkConditionalAssertion(block)],
    ["vacuous_property", () => checkVacuousProperty(block)],
    ["impossible_assertion", () => checkImpossibleAssertion(block)],
  ];
  for (const [rule, check] of blockRules) {
    if (!enabled.has(rule)) continue;
    const result = check();
    if (result === null) continue;
    if (Array.isArray(result)) findings.push(...result);
    else findings.push(result);
  }
  return findings;
}

function runDescribeRules(describe: ParsedDescribeBlock, enabled: Set<SlopRule>, sourceLines: string[]): SlopFinding[] {
  const findings: SlopFinding[] = [];
  const suppressed = parseSuppressedRules(sourceLines.slice(describe.startLine - 1, describe.endLine));

  if (enabled.has("no_negative_test") && !suppressed.has("no_negative_test")) {
    const noNeg = checkNoNegativeTest(describe);
    if (noNeg) findings.push(noNeg);
  }
  if (enabled.has("duplicate_assertion_set") && !suppressed.has("duplicate_assertion_set")) {
    findings.push(...checkDuplicateAssertionSet(describe));
  }
  if (enabled.has("no_input_variation") && !suppressed.has("no_input_variation")) {
    findings.push(...checkNoInputVariation(describe));
  }
  for (const nested of describe.nestedDescribes) {
    findings.push(...runDescribeRules(nested, enabled, sourceLines));
  }
  return findings;
}

function calculateScore(findings: SlopFinding[], testCount: number): number {
  if (testCount === 0) return 100;
  const mustFailCount = findings.filter((f) => f.severity === "must-fail").length;
  const shouldFailCount = findings.filter((f) => f.severity === "should-fail").length;
  const weighted = mustFailCount * 1.0 + shouldFailCount * 0.3;
  const slopRatio = weighted / testCount;
  return Math.max(0, Math.min(100, Math.round(100 * (1 - slopRatio))));
}

export function analyzeTestFile(
  source: string,
  filePath = "<unknown>",
  config: SlopConfig = DEFAULT_CONFIG,
): SlopReport {
  const sourceLines = source.split("\n");
  const { describes, allTests } = parseTestFile(source, config.assertionEquivalents);
  const findings: SlopFinding[] = [];

  // Parse imports once for no_production_call rule
  const productionImports = config.enabledRules.has("no_production_call")
    ? [
        ...new Set(
          parseImportBindings(source)
            .filter((binding) => !TEST_FRAMEWORK_IDENTS.has(binding.identifier))
            .filter((binding) => !isNonProductionImportSource(binding.source))
            .map((binding) => binding.identifier),
        ),
      ]
    : [];

  for (const test of allTests) {
    const suppressed = parseSuppressedRules([...test.precedingLines, ...test.bodyLines]);
    const blockFindings = runBlockRules(test, config.enabledRules);
    findings.push(...blockFindings.filter((f) => !suppressed.has(f.rule)));

    // no_production_call runs separately (needs file-level imports)
    if (config.enabledRules.has("no_production_call") && !suppressed.has("no_production_call")) {
      const npc = checkNoProductionCall(test, productionImports);
      if (npc) findings.push(npc);
    }
  }

  for (const desc of describes) {
    findings.push(...runDescribeRules(desc, config.enabledRules, sourceLines));
  }

  findings.sort((a, b) => a.line - b.line);

  const mustFail = findings.filter((f) => f.severity === "must-fail").length;
  const shouldFail = findings.filter((f) => f.severity === "should-fail").length;

  return {
    filePath,
    findings,
    score: calculateScore(findings, allTests.length),
    summary: { total: findings.length, mustFail, shouldFail, testCount: allTests.length },
  };
}

export function validateTestBlock(testSource: string, config: SlopConfig = DEFAULT_CONFIG): SlopFinding[] {
  const wrapped = `describe("__validate__", () => {\n${testSource}\n});`;
  const { allTests } = parseTestFile(wrapped, config.assertionEquivalents);
  const findings: SlopFinding[] = [];
  for (const test of allTests) {
    findings.push(...runBlockRules(test, config.enabledRules));
  }
  return findings;
}

// ============================================================================
// FORMATTER
// ============================================================================

export function formatReport(report: SlopReport): string {
  const { filePath, findings, score, summary } = report;
  const lines: string[] = [];

  lines.push(`## Slop Report: ${filePath}`);
  lines.push("");
  lines.push(
    `**Score: ${score}/100** | ${summary.testCount} tests | ${summary.mustFail} must-fail | ${summary.shouldFail} should-fail`,
  );

  if (findings.length === 0) {
    lines.push("");
    lines.push("No slop detected.");
    return lines.join("\n");
  }

  const mustFails = findings.filter((f) => f.severity === "must-fail");
  const shouldFails = findings.filter((f) => f.severity === "should-fail");

  if (mustFails.length > 0) {
    lines.push("");
    lines.push(`### MUST-FAIL (${mustFails.length})`);
    for (const f of mustFails) {
      lines.push("");
      lines.push(`- **${f.rule}** (line ${f.line}): ${f.message}`);
      lines.push(`  Fix: ${f.suggestion}`);
    }
  }

  if (shouldFails.length > 0) {
    lines.push("");
    lines.push(`### SHOULD-FAIL (${shouldFails.length})`);
    for (const f of shouldFails) {
      lines.push("");
      lines.push(`- **${f.rule}** (line ${f.line}): ${f.message}`);
      lines.push(`  Fix: ${f.suggestion}`);
    }
  }

  return lines.join("\n");
}

export function formatReportJSON(report: SlopReport): string {
  return JSON.stringify(
    {
      filePath: report.filePath,
      score: report.score,
      summary: report.summary,
      findings: report.findings.map((f) => ({
        rule: f.rule,
        severity: f.severity,
        line: f.line,
        testName: f.testName,
        describeName: f.describeName,
        message: f.message,
        suggestion: f.suggestion,
      })),
    },
    null,
    2,
  );
}
