import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  type ParsedTestBlock,
  type SlopConfig,
  analyzeTestFile,
  checkAssertOnTypeNotValue,
  checkAssertReturnTypeOnly,
  checkCommentedOutAssertions,
  checkConditionalAssertion,
  checkDuplicateAssertionSet,
  checkEmptyTestBody,
  checkLiteralRoundtrip,
  checkMissingDefectComment,
  checkNoInputVariation,
  checkNoNegativeTest,
  checkSchemaSuccessOnly,
  checkSelfReferentialAssertion,
  checkTautologicalAssertion,
  checkTrivialDefectComment,
  checkTruthinessOnly,
  formatReport,
  formatReportJSON,
  getPreset,
  isLiteral,
  parseTestFile,
  splitAssertArgs,
  validateTestBlock,
} from "./slop-detector.ts";

// ============================================================================
// PARSER
// ============================================================================

describe("parseTestFile", () => {
  // slop-ignore: no_negative_test, duplicate_assertion_set, no_input_variation — rule-unit tests intentionally reuse assertion shapes and focus on detector behavior, not scenario variation.
  // Defect: if parser miscounts blocks, all rule checkers operate on wrong data, producing false positives/negatives across the board.
  it("extracts describe and it blocks with correct line numbers", () => {
    const source = [
      'describe("MyModule", () => {',
      '  it("does something", () => {',
      "    assert.equal(1, 1);",
      "  });",
      "});",
    ].join("\n");

    const { describes, allTests } = parseTestFile(source);
    assert.equal(describes.length, 1);
    assert.equal(describes[0].name, "MyModule");
    assert.equal(allTests.length, 1);
    assert.equal(allTests[0].name, "does something");
    assert.equal(allTests[0].startLine, 2);
    assert.equal(allTests[0].parentDescribeName, "MyModule");
  });

  // Defect: if parser fails on nested describes, fault-injection.spec.ts (which nests 10 describes) would produce wrong test attribution.
  it("handles nested describe blocks", () => {
    const source = [
      'describe("Outer", () => {',
      '  describe("Inner", () => {',
      '    it("nested test", () => {',
      "      assert.ok(true);",
      "    });",
      "  });",
      "});",
    ].join("\n");

    const { describes, allTests } = parseTestFile(source);
    assert.equal(describes.length, 1);
    assert.equal(describes[0].name, "Outer");
    assert.equal(describes[0].nestedDescribes.length, 1);
    assert.equal(describes[0].nestedDescribes[0].name, "Inner");
    assert.equal(allTests.length, 1);
    assert.equal(allTests[0].parentDescribeName, "Inner");
  });

  // Defect: if parser doesn't extract assertions, every rule that counts assertions (empty_test_body, tautological, etc.) becomes inoperable.
  it("extracts assertions with method and args", () => {
    const source = [
      'describe("X", () => {',
      '  it("checks values", () => {',
      "    assert.equal(result.safe, true);",
      "    assert.ok(value);",
      "    assert.throws(() => fn(), /error/);",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests[0].assertions.length, 3);
    assert.equal(allTests[0].assertions[0].method, "equal");
    assert.equal(allTests[0].assertions[1].method, "ok");
    assert.equal(allTests[0].assertions[2].method, "throws");
  });

  // Defect: if parser miscounts assertion-equivalents, checkEmptyTestBody would false-positive on tests using assertLogEntry() or assertValidInput().
  it("counts assertion-equivalent helper calls", () => {
    const source = [
      'describe("X", () => {',
      '  it("uses helpers", () => {',
      '    assertLogEntry(logger, "info", "message");',
      "    assertValidInput(schema, data);",
      "    const x = testLine.match(/pattern/);",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source, ["assertLogEntry", "assertValidInput"]);
    assert.equal(allTests[0].assertionEquivCount, 2);
    assert.equal(allTests[0].assertions.length, 0);
  });

  // Defect: if parser stores wrong precedingLines, checkMissingDefectComment misses valid Defect comments and produces false should-fail findings.
  it("captures preceding lines for defect comment scanning", () => {
    const source = [
      "// Some context",
      "// Defect: this is important",
      '  it("has defect comment", () => {',
      "    assert.ok(true);",
      "  });",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.ok(allTests[0].precedingLines.some((l) => l.includes("Defect:")));
  });

  // Defect: if parser doesn't detect commented assertions, checkCommentedOutAssertions becomes inoperable on tests where assertions were commented out.
  it("marks commented assertions correctly", () => {
    const source = [
      'describe("X", () => {',
      '  it("has commented assert", () => {',
      "    // assert.equal(result, expected);",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests[0].assertions.length, 1);
    assert.equal(allTests[0].assertions[0].isCommented, true);
  });

  // Defect: if parser breaks on object literals with braces, brace counting misattributes createStateMachine({...}) blocks to wrong test blocks.
  it("handles object literals with braces inside test bodies", () => {
    const source = [
      'describe("X", () => {',
      '  it("has objects", () => {',
      "    const obj = { a: 1, b: { c: 2 } };",
      "    assert.equal(obj.a, 1);",
      "  });",
      '  it("second test", () => {',
      "    assert.ok(true);",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests.length, 2);
    assert.equal(allTests[0].name, "has objects");
    assert.equal(allTests[1].name, "second test");
  });

  // Defect: if parser drops multiline assertion args, rules like tautological_assertion and self_referential_assertion miss obvious slop that spans multiple lines.
  it("extracts args from multiline assertions", () => {
    const source = [
      'describe("X", () => {',
      '  it("test", () => {',
      "    assert.equal(",
      "      1,",
      "      1",
      "    );",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests[0].assertions.length, 1);
    assert.equal(allTests[0].assertions[0].method, "equal");
    const parts = splitAssertArgs(allTests[0].assertions[0].args);
    assert.equal(parts.length, 2);
    assert.equal(parts[0], "1");
    assert.equal(parts[1], "1");
  });

  // Defect: if parser counts braces inside /* */ comments, inline block comments with braces corrupt block boundaries and cause wrong test attribution.
  it("ignores braces inside inline block comments", () => {
    const source = [
      'describe("X", () => {',
      '  it("test 1", () => {',
      "    const x = 1; /* } */",
      "    assert.equal(x, 1);",
      "  });",
      '  it("test 2", () => {',
      "    assert.ok(true);",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests.length, 2);
    assert.equal(allTests[0].name, "test 1");
    assert.equal(allTests[0].assertions.length, 1);
    assert.equal(allTests[0].assertions[0].method, "equal");
  });

  // Defect: if parser treats assertion-like text inside quoted fixtures as real assertions, meta-tests get false positives and score collapse.
  it("ignores assertion-like text inside quoted strings", () => {
    const source = [
      'describe("FixtureText", () => {',
      '  it("parses real asserts only", () => {',
      '    const fixture = "assert.ok(true)";',
      "    const fixture2 = 'assert.equal(1, 1)';",
      "    const result = true;",
      "    assert.equal(result, true);",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests.length, 1);
    assert.equal(allTests[0].assertions.length, 1);
    assert.equal(allTests[0].assertions[0].method, "equal");
  });

  // Defect: if regex literals containing // (like /https?:\/\//) corrupt brace counting, the parser exits early and drops all subsequent test blocks.
  it("handles regex literals with // in assertions without corrupting parse", () => {
    const source = [
      'describe("RegexTests", () => {',
      '  it("test with regex", () => {',
      "    const re = /https?:\\/\\//;",
      "    assert.ok(re.test(url));",
      "  });",
      '  it("second test", () => {',
      "    assert.equal(1, 2);",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests.length, 2, "Both tests should be parsed — regex // must not be treated as line comment");
  });

  // Defect: if parser ignores describe.only/describe.skip, describe-level rules (no_negative_test, duplicate_assertion_set, no_input_variation) silently skip those blocks.
  it("recognizes describe.only and describe.skip", () => {
    const source = [
      'describe.only("Focused", () => {',
      '  it("test 1", () => {',
      "    assert.equal(1, 2);",
      "  });",
      '  it("test 2", () => {',
      "    assert.ok(result);",
      "  });",
      '  it("test 3", () => {',
      "    assert.deepEqual(a, b);",
      "  });",
      "});",
    ].join("\n");

    const { describes, allTests } = parseTestFile(source);
    assert.equal(describes.length, 1);
    assert.equal(describes[0].name, "Focused");
    assert.equal(describes[0].tests.length, 3);
    assert.equal(allTests.length, 3);
    assert.equal(allTests[0].parentDescribeName, "Focused");
  });

  // Defect: if parser ignores it.only/it.skip, those test blocks are silently dropped from analysis — their slop patterns go undetected.
  it("recognizes it.only and it.skip", () => {
    const source = [
      'describe("X", () => {',
      '  it.only("focused test", () => {',
      "    assert.equal(1, 2);",
      "  });",
      '  it.skip("skipped test", () => {',
      "    assert.ok(true);",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests.length, 2);
    assert.equal(allTests[0].name, "focused test");
    assert.equal(allTests[1].name, "skipped test");
  });

  // Defect: if parser ignores test() blocks, Node test runner's primary API is invisible — all test() blocks get score 100 with zero findings.
  it("recognizes test() as alias for it()", () => {
    const source = [
      'describe("X", () => {',
      '  test("first test", () => {',
      "    assert.equal(1, 2);",
      "  });",
      '  test.only("focused", () => {',
      "    assert.ok(true);",
      "  });",
      '  test.skip("skipped", () => {',
      "    assert.ok(value);",
      "  });",
      "});",
    ].join("\n");

    const { describes, allTests } = parseTestFile(source);
    assert.equal(allTests.length, 3);
    assert.equal(allTests[0].name, "first test");
    assert.equal(allTests[1].name, "focused");
    assert.equal(allTests[2].name, "skipped");
    assert.equal(describes[0].tests.length, 3);
  });

  // Defect: if multiline assertions with inline // comments produce corrupted args, tautological_assertion misses assert.equal(1, // comment\n 1) patterns.
  it("strips inline comments from multiline assertion continuation lines", () => {
    const source = [
      'describe("X", () => {',
      '  it("test", () => {',
      "    assert.equal(",
      "      1, // first arg",
      "      1",
      "    );",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests[0].assertions.length, 1);
    const parts = splitAssertArgs(allTests[0].assertions[0].args);
    assert.equal(parts.length, 2);
    assert.equal(parts[0], "1");
    assert.equal(parts[1], "1");
  });
});

// ============================================================================
// PARSER UTILITIES
// ============================================================================

describe("splitAssertArgs", () => {
  // slop-ignore: no_negative_test, duplicate_assertion_set, no_input_variation — rule-unit tests intentionally reuse assertion shapes and focus on detector behavior, not scenario variation.
  // Defect: if arg splitting fails on nested parens, tautological/self-referential detection produces wrong arg comparisons and misses real slop.
  it("splits simple args at top-level comma", () => {
    assert.deepEqual(splitAssertArgs("a, b"), ["a", "b"]);
    assert.deepEqual(splitAssertArgs("result.safe, true"), ["result.safe", "true"]);
  });

  // Defect: if splitting doesn't respect paren depth, assert.equal(fn(a,b), expected) gets split into 3 parts instead of 2.
  it("respects nested parens and brackets", () => {
    assert.deepEqual(splitAssertArgs('fn(a, b), "expected"'), ["fn(a, b)", '"expected"']);
    assert.deepEqual(splitAssertArgs("[1, 2, 3], [4, 5]"), ["[1, 2, 3]", "[4, 5]"]);
  });

  // Defect: if splitting breaks on string contents, assert.equal("a,b", "c,d") gets wrongly split at the commas inside the strings.
  it("handles strings containing commas", () => {
    assert.deepEqual(splitAssertArgs('"a,b", "c,d"'), ['"a,b"', '"c,d"']);
  });

  // Defect: if splitAssertArgs is not regex-aware, /)/.test("") gets split at the ) inside the regex — args are corrupted to "/" and downstream checks lose signal.
  it("handles regex literals containing ) without splitting incorrectly", () => {
    assert.deepEqual(splitAssertArgs('/)/.test(""), true'), ['/)/.test("")', "true"]);
  });

  // Defect: if splitAssertArgs doesn't track regex char classes, /[/]/ exits regex at the / inside [...] — the trailing / then starts a new phantom regex that corrupts all subsequent args.
  it("handles regex char classes containing /", () => {
    assert.deepEqual(splitAssertArgs("/[/]/.test(input), /[/]/.test(input)"), [
      "/[/]/.test(input)",
      "/[/]/.test(input)",
    ]);
  });
});

describe("isLiteral", () => {
  // Defect: if isLiteral misclassifies identifiers as literals, tautological check fires false positives on assert.equal(x, x) which should be self-referential instead.
  it("recognizes literals", () => {
    assert.equal(isLiteral("true"), true);
    assert.equal(isLiteral("false"), true);
    assert.equal(isLiteral("null"), true);
    assert.equal(isLiteral("42"), true);
    assert.equal(isLiteral("-3.14"), true);
    assert.equal(isLiteral('"hello"'), true);
  });

  // Defect: if isLiteral returns true for identifiers, tautological_assertion fires on assert.equal(result, result) — which is self-referential, not tautological.
  it("rejects non-literals", () => {
    assert.equal(isLiteral("result"), false);
    assert.equal(isLiteral("obj.prop"), false);
    assert.equal(isLiteral("fn()"), false);
  });
});

// ============================================================================
// MUST-FAIL RULES
// ============================================================================

describe("checkEmptyTestBody", () => {
  // slop-ignore: no_negative_test, duplicate_assertion_set, no_input_variation — rule-unit tests intentionally reuse assertion shapes and focus on detector behavior, not scenario variation.
  // Defect: if empty_test_body doesn't fire on zero-assertion tests, agents can generate placeholder it() blocks that pass without checking anything.
  it("fires on test with zero assertions", () => {
    const block = makeTestBlock({ bodyLines: ["  it('test', () => {", "    const x = 1;", "  });"] });
    const finding = checkEmptyTestBody(block);
    assert.ok(finding);
    assert.equal(finding.rule, "empty_test_body");
  });

  // Defect: if empty_test_body fires on tests with assertion-equiv helpers, every test using assertLogEntry/testValidInput gets a false must-fail finding.
  it("does not fire when assertion-equivalents are present", () => {
    const block = makeTestBlock({
      assertionEquivCount: 1,
      bodyLines: ["  it('test', () => {", '    assertLogEntry(logger, "info");', "  });"],
    });
    assert.equal(checkEmptyTestBody(block), null);
  });

  // Defect: if empty_test_body fires on tests with real assertions, every valid test gets a false must-fail finding — complete detector failure.
  it("does not fire when assertions exist", () => {
    const block = makeTestBlock({
      assertions: [makeAssertion({ method: "equal", args: "a, b" })],
    });
    assert.equal(checkEmptyTestBody(block), null);
  });

  // Defect: if ASSERT_MODULE_RE excludes assert.match, a test with only assert.match() is treated as having zero assertions — false must-fail.
  it("does not fire when assert.match is the only assertion", () => {
    const block = makeTestBlock({
      assertions: [makeAssertion({ method: "match", args: "output, /expected/" })],
    });
    assert.equal(checkEmptyTestBody(block), null);
  });

  // Defect: if ASSERT_MODULE_RE excludes assert.doesNotReject, a valid async test with only assert.doesNotReject() is flagged as empty_test_body — false must-fail.
  it("does not fire when assert.doesNotReject is the only assertion", () => {
    const block = makeTestBlock({
      assertions: [makeAssertion({ method: "doesNotReject", args: "async () => await fn()" })],
    });
    assert.equal(checkEmptyTestBody(block), null);
  });

  // Defect: if ASSERTION_EQUIV_RE matches testXxx(), a function like testLoginFlow(user) bypasses empty_test_body — inert setup code is treated as an assertion.
  it("fires when only testXxx helpers are present (not assertXxx)", () => {
    const block = makeTestBlock({
      assertionEquivCount: 0,
      bodyLines: ['  it("test", () => {', "    testLoginFlow(user);", "  });"],
    });
    const finding = checkEmptyTestBody(block);
    assert.ok(finding, "testLoginFlow should not count as assertion-equivalent");
    assert.equal(finding.rule, "empty_test_body");
  });
});

describe("checkCommentedOutAssertions", () => {
  // Defect: if commented_out_assertions doesn't fire when all asserts are commented, agents leave commented tests that compile and pass but verify nothing.
  it("fires when all assertions are commented out", () => {
    const block = makeTestBlock({
      assertions: [makeAssertion({ method: "equal", args: "a, b", isCommented: true })],
    });
    const finding = checkCommentedOutAssertions(block);
    assert.ok(finding);
    assert.equal(finding.rule, "commented_out_assertions");
  });

  // Defect: if commented_out_assertions fires when active assertions exist alongside commented ones, it false-positives on tests with explanatory commented-out code.
  it("does not fire when active assertions exist", () => {
    const block = makeTestBlock({
      assertions: [
        makeAssertion({ method: "equal", args: "a, b", isCommented: true }),
        makeAssertion({ method: "ok", args: "x" }),
      ],
    });
    assert.equal(checkCommentedOutAssertions(block), null);
  });
});

describe("checkTautologicalAssertion", () => {
  // slop-ignore: no_negative_test, duplicate_assertion_set, no_input_variation — rule-unit tests intentionally reuse assertion shapes and focus on detector behavior, not scenario variation.
  // Defect: if tautological check misses assert.ok(true), agents generate filler assertions that always pass regardless of code behavior.
  it("fires on assert.ok(true)", () => {
    const block = makeTestBlock({
      assertions: [makeAssertion({ method: "ok", args: "true" })],
    });
    const findings = checkTautologicalAssertion(block);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, "tautological_assertion");
  });

  // Defect: if tautological check misses assert.equal(1, 1), agents generate self-confirming assertions that never fail no matter what the code does.
  it("fires on assert.equal with identical literals", () => {
    const block = makeTestBlock({
      assertions: [makeAssertion({ method: "equal", args: "1, 1" })],
    });
    assert.equal(checkTautologicalAssertion(block).length, 1);
  });

  // Defect: if tautological check fires on assert.equal(result, expected), every valid assertion is flagged as must-fail — detector is useless.
  it("does not fire on different values", () => {
    const block = makeTestBlock({
      assertions: [makeAssertion({ method: "equal", args: "result, expected" })],
    });
    assert.equal(checkTautologicalAssertion(block).length, 0);
  });
});

describe("checkSelfReferentialAssertion", () => {
  // slop-ignore: no_negative_test, duplicate_assertion_set, no_input_variation — rule-unit tests intentionally reuse assertion shapes and focus on detector behavior, not scenario variation.
  // Defect: if self-referential check misses assert.equal(x, x), agents generate assertions that compare a value to itself — always passing regardless of correctness.
  it("fires on assert.equal(x, x) with identifier", () => {
    const block = makeTestBlock({
      assertions: [makeAssertion({ method: "equal", args: "result, result" })],
    });
    const findings = checkSelfReferentialAssertion(block);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, "self_referential_assertion");
  });

  // Defect: if self-referential fires on assert.equal(1, 1), it overlaps with tautological — producing duplicate must-fail findings for the same assertion.
  it("does not fire on identical literals (handled by tautological)", () => {
    const block = makeTestBlock({
      assertions: [makeAssertion({ method: "equal", args: "1, 1" })],
    });
    assert.equal(checkSelfReferentialAssertion(block).length, 0);
  });

  // Defect: if self-referential fires on assert.equal(a, b), every valid comparison assertion is flagged — complete false positive.
  it("does not fire on different identifiers", () => {
    const block = makeTestBlock({
      assertions: [makeAssertion({ method: "equal", args: "actual, expected" })],
    });
    assert.equal(checkSelfReferentialAssertion(block).length, 0);
  });
});

// ============================================================================
// SHOULD-FAIL RULES (BLOCK-LEVEL)
// ============================================================================

describe("checkMissingDefectComment", () => {
  // Defect: if missing_defect_comment doesn't fire when no comment exists, agents generate tests without explaining what bug they catch — no traceability.
  it("fires when no Defect comment in preceding lines", () => {
    const block = makeTestBlock({ precedingLines: ["  });", "", '  it("test", () => {'] });
    const finding = checkMissingDefectComment(block);
    assert.ok(finding);
    assert.equal(finding.rule, "missing_defect_comment");
  });

  // Defect: if missing_defect_comment fires when comment exists, every properly documented test gets a false should-fail finding — discourages good practice.
  it("does not fire when Defect comment exists", () => {
    const block = makeTestBlock({ precedingLines: ["  // Defect: something breaks if this fails"] });
    assert.equal(checkMissingDefectComment(block), null);
  });
});

describe("checkTrivialDefectComment", () => {
  // slop-ignore: no_negative_test, duplicate_assertion_set, no_input_variation — rule-unit tests intentionally reuse assertion shapes and focus on detector behavior, not scenario variation.
  // Defect: if trivial_defect_comment doesn't flag short comments, agents write "Defect: Must pass" which satisfies the letter but not spirit of the convention.
  it("fires when defect comment has fewer than 10 words", () => {
    const block = makeTestBlock({ precedingLines: ["  // Defect: Must work correctly"] });
    const finding = checkTrivialDefectComment(block);
    assert.ok(finding);
    assert.equal(finding.rule, "trivial_defect_comment");
  });

  // Defect: if trivial_defect_comment fires on detailed comments, it penalizes authors who write thorough production-impact explanations.
  it("does not fire when comment has 10+ words", () => {
    const block = makeTestBlock({
      precedingLines: [
        "  // Defect: without this check the parser miscounts blocks and all rules produce wrong results across the board",
      ],
    });
    assert.equal(checkTrivialDefectComment(block), null);
  });

  // Defect: if trivial_defect_comment fires when no comment exists, it overlaps with missing_defect_comment and produces duplicate findings.
  it("does not fire when no defect comment exists", () => {
    const block = makeTestBlock({ precedingLines: ["  // some other comment"] });
    assert.equal(checkTrivialDefectComment(block), null);
  });
});

describe("checkAssertOnTypeNotValue", () => {
  // Defect: if type-only check doesn't fire, agents generate tests that verify typeof but never check actual values — shape passes, behavior untested.
  it("fires when all assertions are typeof checks", () => {
    const block = makeTestBlock({
      assertions: [
        makeAssertion({ method: "equal", args: 'typeof logger.debug, "function"' }),
        makeAssertion({ method: "equal", args: 'typeof logger.info, "function"' }),
      ],
    });
    const finding = checkAssertOnTypeNotValue(block);
    assert.ok(finding);
    assert.equal(finding.rule, "assert_on_type_not_value");
  });

  // Defect: if type-only fires when mixed with value assertions, it false-positives on tests that check both shape and behavior.
  it("does not fire when mixed with value assertions", () => {
    const block = makeTestBlock({
      assertions: [
        makeAssertion({ method: "equal", args: 'typeof logger.debug, "function"' }),
        makeAssertion({ method: "equal", args: "logger.entries.length, 0" }),
      ],
    });
    assert.equal(checkAssertOnTypeNotValue(block), null);
  });
});

describe("checkTruthinessOnly", () => {
  // slop-ignore: no_negative_test, duplicate_assertion_set, no_input_variation — rule-unit tests intentionally reuse assertion shapes and focus on detector behavior, not scenario variation.
  // Defect: if truthiness-only doesn't fire, agents generate assert.ok(result) that passes for any truthy value — wrong values still pass the test.
  it("fires when all assertions are assert.ok(identifier)", () => {
    const block = makeTestBlock({
      assertions: [makeAssertion({ method: "ok", args: "result" }), makeAssertion({ method: "ok", args: "entry" })],
    });
    const finding = checkTruthinessOnly(block);
    assert.ok(finding);
    assert.equal(finding.rule, "truthiness_only");
  });

  // Defect: if truthiness fires when assertion-equiv helpers are present, tests using testValidInput() get false should-fail findings.
  it("does not fire when assertion-equivalents are present", () => {
    const block = makeTestBlock({
      assertions: [makeAssertion({ method: "ok", args: "result" })],
      assertionEquivCount: 1,
    });
    assert.equal(checkTruthinessOnly(block), null);
  });

  // Defect: if truthiness fires on assert.ok(expr > 5), it misidentifies expression-based checks as bare-identifier truthiness checks.
  it("does not fire when ok() has expression args", () => {
    const block = makeTestBlock({
      assertions: [makeAssertion({ method: "ok", args: "result.length > 0" })],
    });
    assert.equal(checkTruthinessOnly(block), null);
  });
});

describe("checkAssertReturnTypeOnly", () => {
  // Defect: if return-type-only doesn't fire, agents write const r = fn(); assert.ok(r) which checks non-null but not whether the return value is correct.
  it("fires on sole assert.ok after variable assignment", () => {
    const block = makeTestBlock({
      assertions: [makeAssertion({ method: "ok", args: "result" })],
      bodyLines: [
        '  it("test", () => {',
        "    const result = testValidInput(schema, data);",
        "    assert.ok(result);",
        "  });",
      ],
    });
    const finding = checkAssertReturnTypeOnly(block);
    assert.ok(finding);
    assert.equal(finding.rule, "assert_return_type_only");
  });

  // Defect: if return-type-only fires when multiple assertions exist, tests with assert.ok + assert.equal get false should-fail findings.
  it("does not fire when multiple assertions exist", () => {
    const block = makeTestBlock({
      assertions: [
        makeAssertion({ method: "ok", args: "result" }),
        makeAssertion({ method: "equal", args: "result.x, 1" }),
      ],
    });
    assert.equal(checkAssertReturnTypeOnly(block), null);
  });
});

// ============================================================================
// SHOULD-FAIL RULES (DESCRIBE-LEVEL)
// ============================================================================

describe("checkNoNegativeTest", () => {
  // slop-ignore: no_negative_test, duplicate_assertion_set, no_input_variation — rule-unit tests intentionally reuse assertion shapes and focus on detector behavior, not scenario variation.
  // Defect: if no-negative-test doesn't fire on describe with only positive assertions, agents skip error-path testing and failures go undetected in production.
  it("fires when describe has 3+ tests and zero throws/rejects", () => {
    const describe = makeDescribeBlock({
      tests: [
        makeTestBlock({ assertions: [makeAssertion({ method: "equal", args: "a, b" })] }),
        makeTestBlock({ assertions: [makeAssertion({ method: "ok", args: "x" })] }),
        makeTestBlock({ assertions: [makeAssertion({ method: "deepEqual", args: "a, b" })] }),
      ],
    });
    const finding = checkNoNegativeTest(describe);
    assert.ok(finding);
    assert.equal(finding.rule, "no_negative_test");
  });

  // Defect: if no-negative-test fires when throws assertions exist, it false-positives on well-tested describe blocks that include error paths.
  it("does not fire when throws exists", () => {
    const describe = makeDescribeBlock({
      tests: [
        makeTestBlock({ assertions: [makeAssertion({ method: "equal", args: "a, b" })] }),
        makeTestBlock({ assertions: [makeAssertion({ method: "ok", args: "x" })] }),
        makeTestBlock({ assertions: [makeAssertion({ method: "throws", args: "() => fn()" })] }),
      ],
    });
    assert.equal(checkNoNegativeTest(describe), null);
  });

  // Defect: if no-negative-test fires on small describe blocks, 2-test describes that legitimately don't need error paths get flagged.
  it("does not fire when fewer than 3 tests", () => {
    const describe = makeDescribeBlock({
      tests: [
        makeTestBlock({ assertions: [makeAssertion({ method: "equal", args: "a, b" })] }),
        makeTestBlock({ assertions: [makeAssertion({ method: "ok", args: "x" })] }),
      ],
    });
    assert.equal(checkNoNegativeTest(describe), null);
  });
});

describe("checkDuplicateAssertionSet", () => {
  // slop-ignore: no_negative_test, duplicate_assertion_set, no_input_variation — rule-unit tests intentionally reuse assertion shapes and focus on detector behavior, not scenario variation.
  // Defect: if duplicate detection doesn't fire, agents copy-paste test blocks and change only the name — assertions are identical, catching the same bug twice.
  it("fires when two tests have identical normalized assertion sequences", () => {
    const describe = makeDescribeBlock({
      tests: [
        makeTestBlock({
          name: "test A",
          assertions: [makeAssertion({ method: "equal", args: "result.safe, true" })],
        }),
        makeTestBlock({
          name: "test B",
          assertions: [makeAssertion({ method: "equal", args: "result.safe, true" })],
        }),
      ],
    });
    const findings = checkDuplicateAssertionSet(describe);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, "duplicate_assertion_set");
  });

  // Defect: if duplicate detection fires on different assertion values, tests checking different expected values get false should-fail findings.
  it("does not fire when assertion values differ", () => {
    const describe = makeDescribeBlock({
      tests: [
        makeTestBlock({
          name: "test A",
          assertions: [makeAssertion({ method: "equal", args: "result.safe, true" })],
        }),
        makeTestBlock({
          name: "test B",
          assertions: [makeAssertion({ method: "equal", args: "result.safe, false" })],
        }),
      ],
    });
    assert.equal(checkDuplicateAssertionSet(describe).length, 0);
  });

  // Defect: if normalizeSequence replaces numbers with NUM, assert.equal(result.count, 1) vs assert.equal(result.count, 2) are treated as duplicates — false positive on tests that check distinct numeric values.
  it("does not flag tests that differ only by numeric expected value", () => {
    const describe = makeDescribeBlock({
      tests: [
        makeTestBlock({
          name: "test A",
          assertions: [makeAssertion({ method: "equal", args: "result.count, 1" })],
        }),
        makeTestBlock({
          name: "test B",
          assertions: [makeAssertion({ method: "equal", args: "result.count, 2" })],
        }),
      ],
    });
    assert.equal(checkDuplicateAssertionSet(describe).length, 0);
  });
});

describe("checkNoInputVariation", () => {
  // slop-ignore: no_negative_test, duplicate_assertion_set, no_input_variation — rule-unit tests intentionally reuse assertion shapes and focus on detector behavior, not scenario variation.
  // Defect: if no-input-variation doesn't fire, agents call the same function with identical args in multiple tests — testing the same path repeatedly.
  it("fires when same function called with identical args", () => {
    const describe = makeDescribeBlock({
      tests: [
        makeTestBlock({
          name: "test A",
          assertions: [makeAssertion({ method: "equal", args: 'classify("error"), "high"' })],
        }),
        makeTestBlock({
          name: "test B",
          assertions: [makeAssertion({ method: "ok", args: 'classify("error")' })],
        }),
      ],
    });
    const findings = checkNoInputVariation(describe);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, "no_input_variation");
  });

  // Defect: if no-input-variation fires on different args, it false-positives on tests that correctly vary inputs to test different code paths.
  it("does not fire when args differ", () => {
    const describe = makeDescribeBlock({
      tests: [
        makeTestBlock({
          name: "test A",
          assertions: [makeAssertion({ method: "equal", args: 'classify("error"), "high"' })],
        }),
        makeTestBlock({
          name: "test B",
          assertions: [makeAssertion({ method: "equal", args: 'classify("info"), "low"' })],
        }),
      ],
    });
    assert.equal(checkNoInputVariation(describe).length, 0);
  });

  // Defect: if no_input_variation doesn't handle await prefix, async test calls like await classify("error") are invisible — identical async inputs go undetected.
  it("detects identical args through await prefix", () => {
    const describe = makeDescribeBlock({
      tests: [
        makeTestBlock({
          name: "test A",
          assertions: [makeAssertion({ method: "equal", args: 'await classify("error"), "high"' })],
        }),
        makeTestBlock({
          name: "test B",
          assertions: [makeAssertion({ method: "ok", args: 'await classify("error")' })],
        }),
      ],
    });
    const findings = checkNoInputVariation(describe);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, "no_input_variation");
  });

  // Defect: if no_input_variation uses Map<string, string> instead of string[], calling the same function twice in one test overwrites the first call — missing identical args detection.
  it("detects identical args when same function called multiple times in one test", () => {
    const describe = makeDescribeBlock({
      tests: [
        makeTestBlock({
          name: "test A",
          assertions: [
            makeAssertion({ method: "equal", args: 'classify("error"), "high"' }),
            makeAssertion({ method: "equal", args: 'classify("info"), "low"' }),
          ],
        }),
        makeTestBlock({
          name: "test B",
          assertions: [makeAssertion({ method: "equal", args: 'classify("error"), "critical"' })],
        }),
      ],
    });
    const findings = checkNoInputVariation(describe);
    assert.equal(findings.length, 1, 'Should detect classify("error") is used in both tests');
  });

  // Defect: if no_input_variation only checks the first assert arg, reversed args like assert.equal("high", classify("error")) make the function call invisible — false negative.
  it("detects identical args in reversed assertion position", () => {
    const describe = makeDescribeBlock({
      tests: [
        makeTestBlock({
          name: "test A",
          assertions: [makeAssertion({ method: "equal", args: '"high", classify("error")' })],
        }),
        makeTestBlock({
          name: "test B",
          assertions: [makeAssertion({ method: "equal", args: '"low", classify("error")' })],
        }),
      ],
    });
    const findings = checkNoInputVariation(describe);
    assert.equal(findings.length, 1, 'Should detect classify("error") in second arg position');
  });

  // Defect: if no_input_variation truncates at first ), nested calls like classify(normalize("x")) get wrong args — false positives on different nested inputs.
  it("does not false-positive on nested calls with different inner args", () => {
    const describe = makeDescribeBlock({
      tests: [
        makeTestBlock({
          name: "test A",
          assertions: [makeAssertion({ method: "equal", args: 'classify(normalize("error")), "high"' })],
        }),
        makeTestBlock({
          name: "test B",
          assertions: [makeAssertion({ method: "equal", args: 'classify(normalize("info")), "low"' })],
        }),
      ],
    });
    assert.equal(checkNoInputVariation(describe).length, 0);
  });
});

// ============================================================================
// ORCHESTRATORS
// ============================================================================

describe("analyzeTestFile", () => {
  // slop-ignore: no_negative_test, duplicate_assertion_set, no_input_variation — rule-unit tests intentionally reuse assertion shapes and focus on detector behavior, not scenario variation.
  // Defect: if analyzeTestFile doesn't aggregate block and describe rules, the report misses findings from one category — users get an incomplete audit.
  it("produces report with findings and score", () => {
    const source = ['describe("X", () => {', '  it("test 1", () => {', "    assert.ok(true);", "  });", "});"].join(
      "\n",
    );

    const report = analyzeTestFile(source, "test.ts", getPreset("strict"));
    assert.equal(report.filePath, "test.ts");
    assert.equal(report.summary.testCount, 1);
    assert.ok(report.findings.some((f) => f.rule === "tautological_assertion"));
    assert.ok(report.findings.some((f) => f.rule === "missing_defect_comment"));
  });

  // Defect: if score formula doesn't weight must-fail higher, a file with 1 empty_test_body gets the same score as 1 missing_defect_comment — severity is lost.
  it("scores 100 for clean tests", () => {
    const source = [
      'describe("X", () => {',
      "  // Defect: if the parser miscounts blocks then all rule checkers produce wrong results across the board",
      '  it("test 1", () => {',
      "    assert.equal(1 + 1, 2);",
      "  });",
      "  // Defect: if the calculator returns negative values then production billing shows credits instead of charges",
      '  it("test 2", () => {',
      "    assert.equal(2 * 3, 6);",
      "  });",
      "  // Defect: if the error path doesn't throw, invalid input silently corrupts downstream data",
      '  it("test 3", () => {',
      "    assert.throws(() => { throw new Error(); });",
      "  });",
      "});",
    ].join("\n");

    const report = analyzeTestFile(source);
    assert.equal(report.score, 100);
    assert.equal(report.summary.mustFail, 0);
  });

  // Defect: if multiline assertion args are dropped, tautological_assertion misses assert.equal(1, 1) split across lines — agents evade detection by formatting.
  it("detects tautological assertion in multiline format", () => {
    const source = [
      'describe("X", () => {',
      "  // Defect: placeholder comment with enough words to pass the minimum word count check here",
      '  it("test", () => {',
      "    assert.equal(",
      "      1,",
      "      1",
      "    );",
      "  });",
      "});",
    ].join("\n");

    const report = analyzeTestFile(source);
    assert.ok(report.findings.some((f) => f.rule === "tautological_assertion"));
  });

  // Defect: if stripTrailingLineComment treats // inside regex as a comment, multiline assertion args containing regex literals get truncated — assertion args are corrupted.
  it("does not corrupt assertion args containing regex with //", () => {
    const source = [
      'describe("Regex", () => {',
      "  // Defect: placeholder comment with enough words to pass the minimum word count check here",
      '  it("validates URL", () => {',
      "    assert.equal(",
      "      url.match(/https?:\\/\\//),",
      '      "match"',
      "    );",
      "  });",
      "});",
    ].join("\n");

    const report = analyzeTestFile(source);
    const taut = report.findings.filter((f) => f.rule === "tautological_assertion");
    assert.equal(taut.length, 0, "Regex with // must not corrupt args into a tautology false positive");
  });

  // Defect: if regex char classes containing / break arg parsing, assert.equal(/[/]/.test(x), /[/]/.test(x)) is not detected as self-referential — the identical args are invisible.
  it("detects self-referential assertion with regex char class containing /", () => {
    const source = [
      'describe("X", () => {',
      "  // Defect: placeholder comment with enough words to pass the minimum word count check here",
      '  it("regex charclass test", () => {',
      "    assert.equal(/[/]/.test(input), /[/]/.test(input));",
      "  });",
      "});",
    ].join("\n");

    const report = analyzeTestFile(source);
    assert.ok(
      report.findings.some((f) => f.rule === "self_referential_assertion"),
      "Identical regex args with char class / must be detected as self-referential",
    );
  });

  // Defect: if test() blocks are invisible to the analyzer, describe blocks using Node's test() API get score 100 with testCount 0 — complete false negative.
  it("detects slop in test() blocks", () => {
    const source = [
      'describe("X", () => {',
      '  test("has tautology", () => {',
      "    assert.ok(true);",
      "  });",
      "});",
    ].join("\n");

    const report = analyzeTestFile(source);
    assert.equal(report.summary.testCount, 1);
    assert.ok(report.findings.some((f) => f.rule === "tautological_assertion"));
  });

  // Defect: if multiline assertions with inline comments bypass tautology detection, agents evade the detector by adding // comments between args.
  it("detects tautological assertion through inline comments in multiline format", () => {
    const source = [
      'describe("X", () => {',
      "  // Defect: placeholder comment with enough words to pass the minimum word count check here",
      '  it("test", () => {',
      "    assert.equal(",
      "      1, // same value",
      "      1",
      "    );",
      "  });",
      "});",
    ].join("\n");

    const report = analyzeTestFile(source);
    assert.ok(report.findings.some((f) => f.rule === "tautological_assertion"));
  });

  // Defect: if assert.match is not in ASSERT_MODULE_RE, a valid test with only assert.match() is flagged as empty_test_body — false must-fail on a valid test.
  it("does not flag empty_test_body when assert.match is the only assertion", () => {
    const source = [
      'describe("X", () => {',
      "  // Defect: placeholder comment with enough words to pass the minimum word count check here",
      '  it("matches pattern", () => {',
      "    assert.match(output, /expected/);",
      "  });",
      "});",
    ].join("\n");

    const report = analyzeTestFile(source);
    const mustFails = report.findings.filter((f) => f.severity === "must-fail");
    assert.equal(mustFails.length, 0, "assert.match should be recognized as a valid assertion");
  });

  // Defect: if extractArgsFromLine is not regex-aware, assert.equal(/)/.test("x"), true) has its args truncated at the ) inside the regex — downstream rules see corrupted args.
  it("parses assertion args correctly when regex contains )", () => {
    const source = [
      'describe("X", () => {',
      "  // Defect: placeholder comment with enough words to pass the minimum word count check here",
      '  it("regex test", () => {',
      '    assert.equal(/)/.test("x"), true);',
      "  });",
      "});",
    ].join("\n");

    const report = analyzeTestFile(source);
    const taut = report.findings.filter((f) => f.rule === "tautological_assertion");
    assert.equal(taut.length, 0, "Regex ) must not corrupt arg parsing into a false tautology");
    assert.equal(report.summary.testCount, 1);
  });

  // Defect: if testXxx() is treated as assertion-equivalent, a test calling testLoginFlow(user) with no real assertions is invisible to empty_test_body — complete false negative.
  it("flags empty_test_body when only testXxx helpers are present", () => {
    const source = [
      'describe("X", () => {',
      "  // Defect: placeholder comment with enough words to pass the minimum word count check here",
      '  it("logs in", () => {',
      "    testLoginFlow(user);",
      "  });",
      "});",
    ].join("\n");

    const report = analyzeTestFile(source);
    assert.ok(
      report.findings.some((f) => f.rule === "empty_test_body"),
      "testLoginFlow should not count as assertion-equivalent",
    );
  });
});

// ============================================================================
// CONFIG, PRESETS, SUPPRESSIONS
// ============================================================================

describe("getPreset", () => {
  // slop-ignore: no_negative_test, duplicate_assertion_set, no_input_variation — rule-unit tests intentionally reuse assertion shapes and focus on detector behavior, not scenario variation.
  // Defect: if balanced preset includes opinionated rules, open-source adopters hit missing_defect_comment noise on first run and disable the tool.
  it("balanced preset excludes opinionated rules", () => {
    const config = getPreset("balanced");
    assert.equal(config.enabledRules.has("missing_defect_comment"), false);
    assert.equal(config.enabledRules.has("trivial_defect_comment"), false);
    assert.equal(config.enabledRules.has("tautological_assertion"), true);
    assert.equal(config.enabledRules.has("empty_test_body"), true);
  });

  // Defect: if strict preset misses any rule, teams opting in to full enforcement still have blind spots.
  it("strict preset includes all 15 rules", () => {
    const config = getPreset("strict");
    assert.equal(config.enabledRules.size, 15);
  });

  // Defect: if advisory preset doesn't include all rules, teams lose visibility into patterns they haven't opted into enforcing.
  it("advisory preset includes all rules with zero threshold", () => {
    const config = getPreset("advisory");
    assert.equal(config.enabledRules.size, 15);
    assert.equal(config.scoreThreshold, 0);
  });
});

describe("suppression comments", () => {
  // slop-ignore: no_negative_test, duplicate_assertion_set, no_input_variation — rule-unit tests intentionally reuse assertion shapes and focus on detector behavior, not scenario variation.
  // Defect: if slop-ignore comments don't suppress findings, teams can't silence known false positives and the tool generates unresolvable noise.
  it("suppresses a finding with slop-ignore comment", () => {
    const source = [
      'describe("X", () => {',
      "  // slop-ignore: tautological_assertion — intentional canary test",
      '  it("canary", () => {',
      "    assert.ok(true);",
      "  });",
      "});",
    ].join("\n");

    const report = analyzeTestFile(source, "test.ts", getPreset("strict"));
    assert.equal(
      report.findings.some((f) => f.rule === "tautological_assertion"),
      false,
      "tautological_assertion should be suppressed",
    );
  });

  // Defect: if slop-ignore without a reason is accepted, teams suppress findings silently and debt becomes invisible.
  it("does not suppress when reason is missing", () => {
    const source = [
      'describe("X", () => {',
      "  // slop-ignore: tautological_assertion",
      '  it("canary", () => {',
      "    assert.ok(true);",
      "  });",
      "});",
    ].join("\n");

    const report = analyzeTestFile(source, "test.ts", getPreset("strict"));
    assert.ok(
      report.findings.some((f) => f.rule === "tautological_assertion"),
      "Suppression without reason should not be applied",
    );
  });

  // Defect: if slop-ignore isn't applied to describe-level rules, teams cannot suppress known noisy no_negative_test findings even with documented rationale.
  it("suppresses describe-level no_negative_test when slop-ignore comment is present", () => {
    const source = [
      'describe("X", () => {',
      "  // slop-ignore: no_negative_test — legacy module intentionally has no explicit error-path assertions yet",
      '  it("a", () => { assert.equal(1, 2); });',
      '  it("b", () => { assert.equal(2, 3); });',
      '  it("c", () => { assert.equal(3, 4); });',
      "});",
    ].join("\n");

    const report = analyzeTestFile(source, "test.ts", getPreset("strict"));
    assert.equal(
      report.findings.some((f) => f.rule === "no_negative_test"),
      false,
      "no_negative_test should be suppressed at describe level",
    );
  });

  // Defect: if disabling one rule via config still produces findings for it, teams can't customize the detector without forking.
  it("respects enabledRules — disabled rules produce no findings", () => {
    const source = ['describe("X", () => {', '  it("test", () => {', "    assert.ok(true);", "  });", "});"].join("\n");

    const onlyTautology: SlopConfig = {
      enabledRules: new Set(["tautological_assertion"]),
      assertionEquivalents: [],
      scoreThreshold: 0,
    };
    const report = analyzeTestFile(source, "test.ts", onlyTautology);
    assert.ok(report.findings.some((f) => f.rule === "tautological_assertion"));
    assert.equal(
      report.findings.some((f) => f.rule === "empty_test_body"),
      false,
      "Disabled rules must not produce findings",
    );
  });
});

describe("assertionEquivalents allowlist", () => {
  // slop-ignore: no_negative_test, duplicate_assertion_set, no_input_variation — rule-unit tests intentionally reuse assertion shapes and focus on detector behavior, not scenario variation.
  // Defect: if assertion-equiv allowlist doesn't work, teams with custom helpers get false empty_test_body on every test that uses them.
  it("allowlisted helpers prevent empty_test_body", () => {
    const source = [
      'describe("X", () => {',
      "  // Defect: placeholder comment with enough words to pass the minimum word count check here",
      '  it("test", () => {',
      "    assertLogEntry(logger, level, message);",
      "  });",
      "});",
    ].join("\n");

    const config: SlopConfig = { ...getPreset("strict"), assertionEquivalents: ["assertLogEntry"] };
    const report = analyzeTestFile(source, "test.ts", config);
    assert.equal(
      report.findings.some((f) => f.rule === "empty_test_body"),
      false,
      "assertLogEntry should be recognized via allowlist",
    );
  });

  // Defect: if allowlist matching uses plain text includes(), a string like "assertLogEntry(" bypasses empty_test_body with zero real assertions.
  it("does not count helper name inside string literal as assertion-equivalent", () => {
    const source = [
      'describe("X", () => {',
      "  // Defect: if this check is wrong then tests with no assertions can appear valid in CI and ship regressions",
      '  it("string spoof", () => {',
      '    const note = "assertLogEntry(";',
      "  });",
      "});",
    ].join("\n");

    const config: SlopConfig = { ...getPreset("strict"), assertionEquivalents: ["assertLogEntry"] };
    const report = analyzeTestFile(source, "test.ts", config);
    assert.ok(
      report.findings.some((f) => f.rule === "empty_test_body"),
      "String literal mentioning allowlisted helper must not count as assertion-equivalent",
    );
  });
});

// ============================================================================
// JSON OUTPUT
// ============================================================================

describe("formatReportJSON", () => {
  // Defect: if JSON output is malformed, CI integrations that parse machine-readable output silently fail to report findings.
  it("produces valid parseable JSON with all fields", () => {
    const report = analyzeTestFile(
      ['describe("X", () => {', '  it("t", () => { assert.ok(true); });', "});"].join("\n"),
      "test.ts",
      getPreset("strict"),
    );
    const json = formatReportJSON(report);
    const parsed = JSON.parse(json);
    assert.equal(parsed.filePath, "test.ts");
    assert.equal(typeof parsed.score, "number");
    assert.ok(Array.isArray(parsed.findings));
    assert.ok(parsed.findings.length > 0);
    assert.ok(parsed.findings[0].rule);
    assert.ok(parsed.findings[0].severity);
    assert.ok(parsed.findings[0].line);
  });
});

describe("validateTestBlock", () => {
  // Defect: if validateTestBlock doesn't run block-level rules, agents bypass quality checks by not calling analyzeTestFile during generation.
  it("detects slop in a single test block", () => {
    const source = [
      "// Defect: placeholder comment that is long enough to pass the word count check here",
      '  it("placeholder", () => {',
      "    assert.ok(true);",
      "  });",
    ].join("\n");

    const findings = validateTestBlock(source);
    assert.ok(findings.some((f) => f.rule === "tautological_assertion"));
  });

  // Defect: if validateTestBlock reports findings on clean blocks, agents enter an infinite fix loop trying to resolve phantom violations.
  it("returns empty for clean test block", () => {
    const source = [
      "  // Defect: if the parser miscounts blocks then all rule checkers produce wrong results across the full board",
      '  it("good test", () => {',
      "    assert.equal(1 + 1, 2);",
      "  });",
    ].join("\n");

    const findings = validateTestBlock(source);
    const mustFails = findings.filter((f) => f.severity === "must-fail");
    assert.equal(mustFails.length, 0);
  });
});

// ============================================================================
// NEW RULES: literal_roundtrip, schema_success_only, conditional_assertion
// ============================================================================

describe("checkLiteralRoundtrip", () => {
  // slop-ignore: no_negative_test, duplicate_assertion_set, no_input_variation — rule-unit tests intentionally reuse assertion shapes.

  // Defect: if literal_roundtrip doesn't fire when a test constructs an object and asserts the same literals back, agents generate tests that verify their own setup — catching zero production bugs.
  it("fires when test asserts same literal used to construct object", () => {
    const source = [
      'describe("X", () => {',
      '  it("roundtrip", () => {',
      "    const block = {",
      "      type: 'image',",
      "      layout: 'full',",
      "    };",
      "    assert.equal(block.type, 'image');",
      "    assert.equal(block.layout, 'full');",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    const findings = checkLiteralRoundtrip(allTests[0]);
    assert.equal(findings.length, 2);
    assert.equal(findings[0].rule, "literal_roundtrip");
  });

  // Defect: if literal_roundtrip fires on assertions comparing to different values than construction, it false-positives on tests that verify computed changes.
  it("does not fire when asserted value differs from constructed value", () => {
    const source = [
      'describe("X", () => {',
      '  it("transformed", () => {',
      "    const block = {",
      "      type: 'image',",
      "      layout: 'full',",
      "    };",
      "    const result = transform(block);",
      "    assert.equal(result.type, 'transformed');",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    const findings = checkLiteralRoundtrip(allTests[0]);
    assert.equal(findings.length, 0);
  });

  // Defect: if literal_roundtrip fires when a production function is called between construction and assertion, it false-positives on legitimate integration tests.
  it("does not fire when field is not from a literal construction", () => {
    const source = [
      'describe("X", () => {',
      '  it("api result", () => {',
      "    const result = fetchData();",
      "    assert.equal(result.type, 'image');",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    const findings = checkLiteralRoundtrip(allTests[0]);
    assert.equal(findings.length, 0);
  });

  // Defect: if literal_roundtrip doesn't detect the pattern through analyzeTestFile, the rule is wired wrong and never fires in practice.
  it("fires through analyzeTestFile", () => {
    const source = [
      'describe("X", () => {',
      '  it("roundtrip", () => {',
      "    const config = {",
      "      gameKind: 'lines98/strict',",
      "    };",
      "    assert.equal(config.gameKind, 'lines98/strict');",
      "  });",
      "});",
    ].join("\n");

    const report = analyzeTestFile(source, "test.ts");
    assert.ok(report.findings.some((f) => f.rule === "literal_roundtrip"));
  });

  // Defect: if literal_roundtrip fires on numeric comparisons like count > 0 after construction, it false-positives on boundary checks.
  it("fires on numeric literal roundtrip", () => {
    const source = [
      'describe("X", () => {',
      '  it("numeric", () => {',
      "    const obj = {",
      "      count: 42,",
      "    };",
      "    assert.equal(obj.count, 42);",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    const findings = checkLiteralRoundtrip(allTests[0]);
    assert.equal(findings.length, 1);
  });
});

describe("checkSchemaSuccessOnly", () => {
  // slop-ignore: no_negative_test, duplicate_assertion_set, no_input_variation — rule-unit tests intentionally reuse assertion shapes.

  // Defect: if schema_success_only doesn't fire when safeParse test only checks .success, schema coercion/stripping bugs go undetected — the test passes regardless of what .data contains.
  it("fires when safeParse test only checks .success", () => {
    const source = [
      'describe("X", () => {',
      '  it("accepts valid", () => {',
      "    const result = schema.safeParse({ name: 'test' });",
      "    assert.equal(result.success, true);",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    const finding = checkSchemaSuccessOnly(allTests[0]);
    assert.ok(finding);
    assert.equal(finding.rule, "schema_success_only");
  });

  // Defect: if schema_success_only fires when .data is checked, it false-positives on thorough safeParse tests that verify the parsed output.
  it("does not fire when .data fields are checked", () => {
    const source = [
      'describe("X", () => {',
      '  it("checks data", () => {',
      "    const result = schema.safeParse({ name: 'test' });",
      "    assert.equal(result.success, true);",
      "    assert.equal(result.data.name, 'test');",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(checkSchemaSuccessOnly(allTests[0]), null);
  });

  // Defect: if schema_success_only fires when .error.issues is checked, it false-positives on rejection tests that verify the specific error reason.
  it("does not fire when .error.issues is checked", () => {
    const source = [
      'describe("X", () => {',
      '  it("checks error", () => {',
      "    const result = schema.safeParse({ name: '' });",
      "    assert.equal(result.success, false);",
      "    assert.equal(result.error.issues[0].code, 'too_small');",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(checkSchemaSuccessOnly(allTests[0]), null);
  });

  // Defect: if schema_success_only fires on non-safeParse tests, it false-positives on tests that happen to check a .success property unrelated to Zod.
  it("does not fire on tests without safeParse", () => {
    const source = [
      'describe("X", () => {',
      '  it("unrelated", () => {',
      "    const result = { success: true };",
      "    assert.equal(result.success, true);",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(checkSchemaSuccessOnly(allTests[0]), null);
  });

  // Defect: if schema_success_only doesn't fire through analyzeTestFile, the rule is wired wrong and never appears in reports.
  it("fires through analyzeTestFile", () => {
    const source = [
      'describe("X", () => {',
      '  it("parse only", () => {',
      "    const result = MoveSchema.safeParse({ index: 4 });",
      "    assert.equal(result.success, true);",
      "  });",
      "});",
    ].join("\n");

    const report = analyzeTestFile(source, "test.ts");
    assert.ok(report.findings.some((f) => f.rule === "schema_success_only"));
  });

  // Defect: if schema_success_only works with vitest expect() patterns, the rule catches the most common safeParse slop in vitest codebases.
  it("fires with expect() syntax", () => {
    const source = [
      'describe("X", () => {',
      '  it("parse only", () => {',
      "    const result = schema.safeParse(data);",
      "    expect(result.success).toBe(true);",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    const finding = checkSchemaSuccessOnly(allTests[0]);
    assert.ok(finding);
  });
});

describe("checkConditionalAssertion", () => {
  // slop-ignore: no_negative_test, duplicate_assertion_set, no_input_variation — rule-unit tests intentionally reuse assertion shapes.

  // Defect: if conditional_assertion doesn't fire when all assertions are inside if blocks, tests with false conditions execute zero assertions and pass vacuously — a must-fail scenario.
  it("fires when all assertions are inside if block", () => {
    const source = [
      'describe("X", () => {',
      '  it("conditional", () => {',
      "    const result = analyze(config);",
      "    if (result.score < 0.3) {",
      '      assert.ok(result.recommendations.some((r) => r.includes("low")));',
      "    }",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    const finding = checkConditionalAssertion(allTests[0]);
    assert.ok(finding);
    assert.equal(finding.rule, "conditional_assertion");
    assert.equal(finding.severity, "must-fail");
  });

  // Defect: if conditional_assertion fires when assertions exist outside if blocks, it false-positives on tests that have both conditional and unconditional assertions.
  it("does not fire when assertions exist outside conditionals", () => {
    const source = [
      'describe("X", () => {',
      '  it("mixed", () => {',
      "    const result = analyze(config);",
      "    assert.ok(result);",
      "    if (result.score < 0.3) {",
      '      assert.ok(result.recommendations.some((r) => r.includes("low")));',
      "    }",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(checkConditionalAssertion(allTests[0]), null);
  });

  // Defect: if conditional_assertion fires on tests with no conditionals at all, every normal test gets flagged — complete false positive.
  it("does not fire when no conditional blocks exist", () => {
    const source = [
      'describe("X", () => {',
      '  it("normal", () => {',
      "    const result = compute();",
      "    assert.equal(result, 42);",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(checkConditionalAssertion(allTests[0]), null);
  });

  // Defect: if conditional_assertion doesn't fire through analyzeTestFile, the rule is wired wrong and invisible in reports.
  it("fires through analyzeTestFile", () => {
    const source = [
      'describe("X", () => {',
      '  it("vacuous", () => {',
      "    const x = getValue();",
      "    if (x > 10) {",
      "      assert.equal(x, 11);",
      "    }",
      "  });",
      "});",
    ].join("\n");

    const report = analyzeTestFile(source, "test.ts");
    assert.ok(report.findings.some((f) => f.rule === "conditional_assertion"));
    assert.ok(report.findings.some((f) => f.rule === "conditional_assertion" && f.severity === "must-fail"));
  });
});

// ============================================================================
// VITEST/JEST expect() SUPPORT
// ============================================================================

describe("expect() parsing", () => {
  // slop-ignore: no_negative_test, duplicate_assertion_set, no_input_variation — rule-unit tests for expect() support intentionally reuse assertion shapes.

  // Defect: if parser doesn't recognize expect().toBe(), vitest tests are invisible to the detector — all 12 rules produce wrong results on vitest codebases.
  it("parses expect(x).toBe(y) as method=equal", () => {
    const source = [
      'describe("X", () => {',
      '  it("checks value", () => {',
      "    expect(result).toBe(42);",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests[0].assertions.length, 1);
    assert.equal(allTests[0].assertions[0].method, "equal");
    assert.equal(allTests[0].assertions[0].args, "result, 42");
    assert.equal(allTests[0].assertions[0].isCommented, false);
  });

  // Defect: if parser doesn't recognize toEqual, deep equality checks in vitest are invisible and duplicate_assertion_set normalization fails.
  it("parses expect(x).toEqual(y) as method=deepEqual", () => {
    const source = [
      'describe("X", () => {',
      '  it("deep check", () => {',
      "    expect(result).toEqual({ a: 1 });",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests[0].assertions[0].method, "deepEqual");
    assert.equal(allTests[0].assertions[0].args, "result, { a: 1 }");
  });

  // Defect: if parser doesn't map toBeTruthy to ok, truthiness_only rule cannot fire on vitest code.
  it("parses expect(x).toBeTruthy() as method=ok", () => {
    const source = [
      'describe("X", () => {',
      '  it("truthy check", () => {',
      "    expect(result).toBeTruthy();",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests[0].assertions[0].method, "ok");
    assert.equal(allTests[0].assertions[0].args, "result");
  });

  // Defect: if parser doesn't recognize toThrow, no_negative_test rule cannot detect vitest error-path tests.
  it("parses expect(() => fn()).toThrow() as method=throws", () => {
    const source = [
      'describe("X", () => {',
      '  it("throws check", () => {',
      "    expect(() => riskyFn()).toThrow();",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests[0].assertions[0].method, "throws");
    assert.equal(allTests[0].assertions[0].args, "() => riskyFn()");
  });

  // Defect: if parser doesn't handle .rejects chain, async error-path tests in vitest are invisible to no_negative_test.
  it("parses expect(promise).rejects.toThrow() as method=rejects", () => {
    const source = [
      'describe("X", () => {',
      '  it("rejects check", () => {',
      "    expect(promise).rejects.toThrow();",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests[0].assertions[0].method, "rejects");
  });

  // Defect: if parser doesn't handle .not chain, negated matchers are not counted as assertions and trigger false empty_test_body.
  it("parses expect(x).not.toBe(y) as assertion", () => {
    const source = [
      'describe("X", () => {',
      '  it("not check", () => {',
      "    expect(result).not.toBe(null);",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests[0].assertions.length, 1);
    assert.equal(allTests[0].assertions[0].method, "equal");
  });

  // Defect: if parser can't handle multiline expect chains, tests with chain on next line are invisible.
  it("handles expect chain split across lines", () => {
    const source = [
      'describe("X", () => {',
      '  it("multiline", () => {',
      "    expect(result)",
      "      .toBe(42);",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests[0].assertions.length, 1);
    assert.equal(allTests[0].assertions[0].method, "equal");
    assert.equal(allTests[0].assertions[0].args, "result, 42");
  });

  // Defect: if parser doesn't detect commented expect(), checkCommentedOutAssertions misses vitest commented assertions entirely.
  it("detects commented-out expect() as commented assertion", () => {
    const source = [
      'describe("X", () => {',
      '  it("commented", () => {',
      "    // expect(result).toBe(42);",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests[0].assertions.length, 1);
    assert.equal(allTests[0].assertions[0].isCommented, true);
    assert.equal(allTests[0].assertions[0].method, "equal");
  });

  // Defect: if expect inside a string literal is counted as assertion, tests that mention expect in strings get false negative on empty_test_body.
  it("does not count expect inside string literal", () => {
    const source = [
      'describe("X", () => {',
      '  it("string mention", () => {',
      '    const msg = "expect(x).toBe(y)";',
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests[0].assertions.length, 0);
  });

  // Defect: if mixed assert + expect aren't both counted, tests using both APIs have incorrect assertion count.
  it("handles mixed assert.* and expect() in same test", () => {
    const source = [
      'describe("X", () => {',
      '  it("mixed", () => {',
      "    assert.equal(a, 1);",
      "    expect(b).toBe(2);",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests[0].assertions.length, 2);
    assert.equal(allTests[0].assertions[0].method, "equal");
    assert.equal(allTests[0].assertions[1].method, "equal");
  });
});

describe("chai expect() parsing", () => {
  // slop-ignore: no_negative_test, duplicate_assertion_set, no_input_variation — rule-unit tests for chai support intentionally reuse assertion shapes.

  // Defect: if parser doesn't handle chai .to.equal() chains, chai codebases are invisible to the detector — same impact as #13 vitest blindness.
  it("parses expect(x).to.equal(y) as method=equal", () => {
    const source = [
      'describe("X", () => {',
      '  it("chai equal", () => {',
      "    expect(result).to.equal(42);",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests[0].assertions.length, 1);
    assert.equal(allTests[0].assertions[0].method, "equal");
    assert.equal(allTests[0].assertions[0].args, "result, 42");
  });

  // Defect: if parser doesn't handle .to.deep.equal(), chai deep equality checks are invisible — duplicate_assertion_set can't normalize them.
  it("parses expect(x).to.deep.equal(y) as method=deepEqual", () => {
    const source = [
      'describe("X", () => {',
      '  it("chai deep equal", () => {',
      "    expect(result).to.deep.equal({ a: 1 });",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests[0].assertions[0].method, "deepEqual");
    assert.equal(allTests[0].assertions[0].args, "result, { a: 1 }");
  });

  // Defect: if parser doesn't handle chai .to.throw(), no_negative_test can't detect chai error-path tests.
  it("parses expect(fn).to.throw() as method=throws", () => {
    const source = [
      'describe("X", () => {',
      '  it("chai throw", () => {',
      "    expect(() => riskyFn()).to.throw();",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests[0].assertions[0].method, "throws");
  });

  // Defect: if parser doesn't handle chai property assertions (no parens), expect(x).to.be.true is invisible — zero assertions detected.
  it("parses chai property assertion expect(x).to.be.true", () => {
    const source = [
      'describe("X", () => {',
      '  it("chai property", () => {',
      "    expect(result).to.be.true;",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests[0].assertions.length, 1);
    assert.equal(allTests[0].assertions[0].method, "ok");
    assert.equal(allTests[0].assertions[0].args, "result");
  });

  // Defect: if parser doesn't handle expect(x).to.be.ok, chai truthiness checks are invisible to truthiness_only rule.
  it("parses expect(x).to.be.ok as method=ok", () => {
    const source = [
      'describe("X", () => {',
      '  it("chai ok", () => {',
      "    expect(result).to.be.ok;",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests[0].assertions[0].method, "ok");
  });

  // Defect: if parser doesn't handle .not.to.equal(), chai negated assertions trigger false empty_test_body.
  it("parses expect(x).to.not.equal(y) with not modifier", () => {
    const source = [
      'describe("X", () => {',
      '  it("chai not equal", () => {',
      "    expect(result).to.not.equal(42);",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests[0].assertions.length, 1);
    assert.equal(allTests[0].assertions[0].method, "equal");
  });

  // Defect: if parser doesn't handle expect(x).to.be.null, tests checking null via chai property assertion are invisible.
  it("parses expect(x).to.be.null as assertion", () => {
    const source = [
      'describe("X", () => {',
      '  it("chai null check", () => {',
      "    expect(result).to.be.null;",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests[0].assertions.length, 1);
    assert.equal(allTests[0].assertions[0].method, "ok");
  });

  // Defect: if chai .to.include() isn't recognized, chai containment assertions are invisible to the detector.
  it("parses expect(x).to.include(y) as assertion", () => {
    const source = [
      'describe("X", () => {',
      '  it("chai include", () => {',
      "    expect(arr).to.include(42);",
      "  });",
      "});",
    ].join("\n");

    const { allTests } = parseTestFile(source);
    assert.equal(allTests[0].assertions.length, 1);
    assert.equal(allTests[0].assertions[0].method, "deepEqual");
  });
});

describe("expect() rule integration", () => {
  // slop-ignore: no_negative_test, duplicate_assertion_set, no_input_variation — rule-unit tests for expect() support intentionally reuse assertion shapes.

  // Defect: if tautological_assertion doesn't fire on expect(true).toBe(true), vitest codebases silently ship tautological tests.
  it("detects tautological expect(true).toBe(true)", () => {
    const source = [
      'describe("X", () => {',
      '  it("tautological", () => {',
      "    expect(true).toBe(true);",
      "  });",
      "});",
    ].join("\n");

    const report = analyzeTestFile(source, "test.ts");
    assert.ok(report.findings.some((f) => f.rule === "tautological_assertion"));
  });

  // Defect: if tautological_assertion doesn't fire on expect(true).toBeTruthy(), a common vitest canary pattern goes undetected.
  it("detects tautological expect(true).toBeTruthy()", () => {
    const source = [
      'describe("X", () => {',
      '  it("truthy canary", () => {',
      "    expect(true).toBeTruthy();",
      "  });",
      "});",
    ].join("\n");

    const report = analyzeTestFile(source, "test.ts");
    assert.ok(report.findings.some((f) => f.rule === "tautological_assertion"));
  });

  // Defect: if self_referential_assertion doesn't fire on expect(x).toBe(x), vitest codebases silently ship always-passing comparisons.
  it("detects self-referential expect(x).toBe(x)", () => {
    const source = [
      'describe("X", () => {',
      '  it("self-ref", () => {',
      "    expect(value).toBe(value);",
      "  });",
      "});",
    ].join("\n");

    const report = analyzeTestFile(source, "test.ts");
    assert.ok(report.findings.some((f) => f.rule === "self_referential_assertion"));
  });

  // Defect: if truthiness_only doesn't fire when all assertions are expect(x).toBeTruthy(), vitest tests pass for any truthy value.
  it("detects truthiness_only with all expect().toBeTruthy()", () => {
    const source = [
      'describe("X", () => {',
      '  it("truthy only", () => {',
      "    expect(result).toBeTruthy();",
      "    expect(other).toBeTruthy();",
      "  });",
      "});",
    ].join("\n");

    const report = analyzeTestFile(source, "test.ts");
    assert.ok(report.findings.some((f) => f.rule === "truthiness_only"));
  });

  // Defect: if no_negative_test doesn't recognize expect().toThrow(), vitest describes with only happy-path tests are not flagged.
  it("recognizes expect().toThrow() as negative test", () => {
    const source = [
      'describe("X", () => {',
      '  it("a", () => { expect(1).toBe(1); });',
      '  it("b", () => { expect(2).toBe(2); });',
      '  it("c", () => { expect(() => fn()).toThrow(); });',
      "});",
    ].join("\n");

    const report = analyzeTestFile(source, "test.ts");
    assert.equal(
      report.findings.some((f) => f.rule === "no_negative_test"),
      false,
      "toThrow() should count as negative test",
    );
  });

  // Defect: if assert_on_type_not_value doesn't detect expect(typeof x).toBe("string"), vitest type-only tests go undetected.
  it("detects assert_on_type_not_value with expect(typeof x).toBe()", () => {
    const source = [
      'describe("X", () => {',
      '  it("type only", () => {',
      '    expect(typeof result).toBe("string");',
      "  });",
      "});",
    ].join("\n");

    const report = analyzeTestFile(source, "test.ts");
    assert.ok(report.findings.some((f) => f.rule === "assert_on_type_not_value"));
  });

  // Defect: if assert_return_type_only doesn't fire on const r = fn(); expect(r).toBeTruthy(), vitest tests that only check non-null go undetected.
  it("detects assert_return_type_only with expect(r).toBeTruthy()", () => {
    const source = [
      'describe("X", () => {',
      '  it("return only", () => {',
      "    const r = compute();",
      "    expect(r).toBeTruthy();",
      "  });",
      "});",
    ].join("\n");

    const report = analyzeTestFile(source, "test.ts");
    assert.ok(report.findings.some((f) => f.rule === "assert_return_type_only"));
  });

  // Defect: if commented_out_assertions doesn't detect commented expect(), vitest tests with all assertions commented out are invisible.
  it("detects commented_out_assertions for expect()", () => {
    const source = [
      'describe("X", () => {',
      '  it("all commented", () => {',
      "    // expect(result).toBe(42);",
      "  });",
      "});",
    ].join("\n");

    const report = analyzeTestFile(source, "test.ts");
    assert.ok(report.findings.some((f) => f.rule === "commented_out_assertions"));
  });

  // Defect: if expect() tests don't register as non-empty, every vitest test falsely triggers empty_test_body.
  it("does not flag empty_test_body when expect() is present", () => {
    const source = [
      'describe("X", () => {',
      '  it("valid", () => {',
      "    expect(result).toBe(42);",
      "  });",
      "});",
    ].join("\n");

    const report = analyzeTestFile(source, "test.ts");
    assert.equal(
      report.findings.some((f) => f.rule === "empty_test_body"),
      false,
      "expect() should count as assertion",
    );
  });

  // Defect: reproduction case from issue #13 — verifies the detector produces correct findings on vitest code.
  it("issue #13 reproduction: correct findings for vitest code", () => {
    const source = [
      'describe("example", () => {',
      '  it("tautological", () => {',
      "    expect(true).toBe(true);",
      "  });",
      '  it("self-referential", () => {',
      "    const x = getValue();",
      "    expect(x).toBe(x);",
      "  });",
      '  it("truthiness only", () => {',
      "    const result = compute();",
      "    expect(result).toBeTruthy();",
      "  });",
      "});",
    ].join("\n");

    const report = analyzeTestFile(source, "example.spec.ts");
    assert.ok(
      report.findings.some((f) => f.rule === "tautological_assertion"),
      "should detect tautological",
    );
    assert.ok(
      report.findings.some((f) => f.rule === "self_referential_assertion"),
      "should detect self-referential",
    );
    assert.ok(
      report.findings.some((f) => f.rule === "truthiness_only" || f.rule === "assert_return_type_only"),
      "should detect truthiness/return-type slop",
    );
    assert.equal(
      report.findings.some((f) => f.rule === "empty_test_body"),
      false,
      "should NOT flag empty_test_body — expect() calls are present",
    );
  });
});

// ============================================================================
// FORMATTER
// ============================================================================

describe("formatReport", () => {
  // Defect: if formatReport omits must-fail section when findings exist, human reviewers miss critical slop that should block merge.
  it("formats report with findings grouped by severity", () => {
    const report: ReturnType<typeof analyzeTestFile> = {
      filePath: "test.ts",
      findings: [
        {
          rule: "empty_test_body",
          severity: "must-fail",
          testName: "bad test",
          describeName: "X",
          line: 5,
          message: "Test body contains zero assertions",
          suggestion: "Add assertions",
        },
        {
          rule: "missing_defect_comment",
          severity: "should-fail",
          testName: "test",
          describeName: "X",
          line: 10,
          message: "No defect comment",
          suggestion: "Add comment",
        },
      ],
      score: 70,
      summary: { total: 2, mustFail: 1, shouldFail: 1, testCount: 5 },
    };

    const output = formatReport(report);
    assert.ok(output.includes("Score: 70/100"));
    assert.ok(output.includes("MUST-FAIL (1)"));
    assert.ok(output.includes("SHOULD-FAIL (1)"));
    assert.ok(output.includes("empty_test_body"));
  });

  // Defect: if formatReport shows findings when none exist, human reviewers investigate phantom issues that don't exist — wasted time.
  it("shows no-slop message for clean report", () => {
    const report: ReturnType<typeof analyzeTestFile> = {
      filePath: "clean.ts",
      findings: [],
      score: 100,
      summary: { total: 0, mustFail: 0, shouldFail: 0, testCount: 10 },
    };

    const output = formatReport(report);
    assert.ok(output.includes("No slop detected"));
    assert.ok(output.includes("Score: 100/100"));
  });
});

// ============================================================================
// VALIDATION: ZERO MUST-FAIL ON EXISTING REPO
// ============================================================================

describe("zero must-fail on existing spec files", () => {
  const specFiles = [
    "barrier-concurrency-testing/test-fixtures.spec.ts",
    "breaking-change-detector/breaking-change.spec.ts",
    "fault-injection-testing/fault-injection.spec.ts",
    "model-based-testing/state-machine.spec.ts",
    "observability-testing/structured-logger.spec.ts",
    "pairwise-test-coverage/pairwise.spec.ts",
    "websocket-client-resilience/resilience.spec.ts",
    "zod-contract-testing/schema-boundary.spec.ts",
  ];

  // Config matching this repo's assertion-equivalent helpers
  const repoConfig: SlopConfig = {
    ...getPreset("balanced"),
    assertionEquivalents: [
      "assertLogEntry",
      "assertNoLogsAbove",
      "assertHasLogLevel",
      "assertErrorLogged",
      "assertTransition",
      "assertGuardTruthTable",
      "assertContextMutation",
      "assertQueuePreserved",
      "assertQueueTrimmed",
      "assertVersionCompatibility",
    ],
  };

  for (const file of specFiles) {
    // Defect: if the detector false-positives on existing well-tested files, every adoption produces noise that discredits the tool and gets it disabled.
    it(`produces zero must-fail for ${file}`, () => {
      const fullPath = resolve(import.meta.dirname, "..", file);
      const source = readFileSync(fullPath, "utf-8");
      const report = analyzeTestFile(source, file, repoConfig);
      const mustFails = report.findings.filter((f) => f.severity === "must-fail");
      assert.equal(
        mustFails.length,
        0,
        `Found must-fail in ${file}:\n${mustFails.map((f) => `  ${f.rule} at line ${f.line}: ${f.message}`).join("\n")}`,
      );
    });
  }
});

// ============================================================================
// TEST HELPERS
// ============================================================================

function makeAssertion(overrides: Partial<ParsedAssertion> = {}): ParsedAssertion {
  return {
    lineNumber: 1,
    raw: "",
    method: "equal",
    args: "a, b",
    isCommented: false,
    ...overrides,
  };
}

function makeTestBlock(overrides: Partial<ParsedTestBlock> = {}): ParsedTestBlock {
  return {
    name: "test",
    startLine: 1,
    endLine: 5,
    assertions: [],
    assertionEquivCount: 0,
    precedingLines: [],
    bodyLines: [],
    parentDescribeName: null,
    ...overrides,
  };
}

function makeDescribeBlock(overrides: Partial<ParsedDescribeBlock> = {}): ParsedDescribeBlock {
  return {
    name: "TestModule",
    startLine: 1,
    endLine: 100,
    tests: [],
    nestedDescribes: [],
    ...overrides,
  };
}
