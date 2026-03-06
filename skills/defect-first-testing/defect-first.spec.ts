import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DETECTOR_COUNT,
  type FaultSurface,
  analyzeFaultSurface,
  formatTestPlan,
  stripNonCode,
  suggestTests,
  validateCoverage,
} from "./defect-first.ts";

// --- Helper ---

function surfaceHasPattern(surface: FaultSurface, pattern: string): boolean {
  return surface.entries.some((e) => e.pattern === pattern);
}

function surfaceHasDefect(surface: FaultSurface, defect: string): boolean {
  return surface.entries.some((e) => e.defectClasses.includes(defect as never));
}

// --- stripNonCode ---

describe("stripNonCode", () => {
  // Defect: string contents leak through and cause false pattern matches
  it("strips single-quoted string contents", () => {
    const result = stripNonCode("const p = 'path/to/file'");
    assert.equal(result, "const p = ''");
  });

  // Defect: double-quoted strings not stripped, regex matches inside strings
  it("strips double-quoted string contents", () => {
    const result = stripNonCode('const p = "x < 10"');
    assert.equal(result, 'const p = ""');
  });

  // Defect: template literal contents not stripped
  it("strips template literal contents", () => {
    const result = stripNonCode("const p = `arr[i]`");
    assert.equal(result, "const p = ``");
  });

  // Defect: trailing comment not stripped, patterns match in comment text
  it("strips trailing line comments", () => {
    const result = stripNonCode("const x = 1; // arr[i] < 10");
    assert.equal(result, "const x = 1; ");
  });

  // Defect: escaped quote inside string causes premature close
  it("handles escaped quotes in strings", () => {
    const result = stripNonCode("const s = 'it\\'s a test'");
    assert.equal(result, "const s = ''");
  });
});

// --- Detector tests ---

describe("analyzeFaultSurface detectors", () => {
  describe("comparison-boundary", () => {
    // Defect: detector misses numeric comparison, off-by-one fault not identified
    it("fires on numeric comparison", () => {
      const surface = analyzeFaultSurface("if (i < arr.length) {}");
      assert.ok(surfaceHasPattern(surface, "comparison-boundary"));
    });

    // Defect: false positive on comparison chars inside strings
    it("does not fire inside string literals", () => {
      const surface = analyzeFaultSurface('const msg = "x < 10";');
      assert.ok(!surfaceHasPattern(surface, "comparison-boundary"));
    });

    // Defect: detector misses constant comparison
    it("fires on constant comparison", () => {
      const surface = analyzeFaultSurface("while (count >= 0) {}");
      assert.ok(surfaceHasPattern(surface, "comparison-boundary"));
    });
  });

  describe("array-index", () => {
    // Defect: detector misses dynamic array access, empty-collection fault not identified
    it("fires on dynamic index access", () => {
      const surface = analyzeFaultSurface("const val = items[idx];");
      assert.ok(surfaceHasPattern(surface, "array-index"));
    });

    // Defect: false positive on object property access with string key
    it("does not fire on string key access", () => {
      const surface = analyzeFaultSurface('const val = obj["key"];');
      assert.ok(!surfaceHasPattern(surface, "array-index"));
    });

    // Defect: detector misses index arithmetic (i + 1, i - 1)
    it("fires on index arithmetic", () => {
      const surface = analyzeFaultSurface("const prev = arr[i - 1];");
      assert.ok(surfaceHasPattern(surface, "array-index"));
    });
  });

  describe("string-split", () => {
    // Defect: detector misses .split() call, empty-string fault not identified
    it("fires on split call", () => {
      const surface = analyzeFaultSurface('const parts = input.split(",");');
      assert.ok(surfaceHasPattern(surface, "string-split"));
    });

    // Defect: false positive on split-like method name
    it("does not fire on unrelated method", () => {
      const surface = analyzeFaultSurface("const x = splitView(data);");
      assert.ok(!surfaceHasPattern(surface, "string-split"));
    });
  });

  describe("string-slice", () => {
    // Defect: detector misses .substring() call, off-by-one fault not identified
    it("fires on substring call", () => {
      const surface = analyzeFaultSurface("const sub = s.substring(0, 5);");
      assert.ok(surfaceHasPattern(surface, "string-slice"));
    });

    // Defect: detector misses .slice() variant
    it("fires on slice call", () => {
      const surface = analyzeFaultSurface("const sub = s.slice(1, -1);");
      assert.ok(surfaceHasPattern(surface, "string-slice"));
    });
  });

  describe("optional-chain", () => {
    // Defect: detector misses optional chaining, null-undefined fault not identified
    it("fires on optional chaining", () => {
      const surface = analyzeFaultSurface("const name = user?.profile?.name;");
      assert.ok(surfaceHasPattern(surface, "optional-chain"));
    });

    // Defect: false positive on ternary with dot
    it("does not fire on ternary", () => {
      const surface = analyzeFaultSurface("const x = a ? b : c;");
      assert.ok(!surfaceHasPattern(surface, "optional-chain"));
    });
  });

  describe("nullish-coalesce", () => {
    // Defect: detector misses nullish coalescing operator
    it("fires on nullish coalescing", () => {
      const surface = analyzeFaultSurface('const val = input ?? "default";');
      assert.ok(surfaceHasPattern(surface, "nullish-coalesce"));
    });
  });

  describe("explicit-null-check", () => {
    // Defect: detector misses null comparison, missing-branch fault not identified
    it("fires on null check", () => {
      const surface = analyzeFaultSurface("if (x === null) return;");
      assert.ok(surfaceHasPattern(surface, "explicit-null-check"));
    });

    // Defect: detector misses undefined check
    it("fires on undefined check", () => {
      const surface = analyzeFaultSurface("if (value !== undefined) {}");
      assert.ok(surfaceHasPattern(surface, "explicit-null-check"));
    });
  });

  describe("try-catch", () => {
    // Defect: detector misses try block, error-handling faults not identified
    it("fires on try-catch", () => {
      const surface = analyzeFaultSurface("try { riskyCall(); } catch (e) {}");
      assert.ok(surfaceHasPattern(surface, "try-catch"));
      assert.ok(surfaceHasDefect(surface, "swallowed-error"));
    });
  });

  describe("promise-catch", () => {
    // Defect: detector misses .catch() call, unhandled-rejection fault not identified
    it("fires on promise catch", () => {
      const surface = analyzeFaultSurface("fetchData().catch(handleError);");
      assert.ok(surfaceHasPattern(surface, "promise-catch"));
    });
  });

  describe("throw-statement", () => {
    // Defect: detector misses throw, callers don't test error path
    it("fires on throw new Error", () => {
      const surface = analyzeFaultSurface('throw new Error("invalid");');
      assert.ok(surfaceHasPattern(surface, "throw-statement"));
    });

    // Defect: detector misses throw with existing variable
    it("fires on throw variable", () => {
      const surface = analyzeFaultSurface("throw err;");
      assert.ok(surfaceHasPattern(surface, "throw-statement"));
    });
  });

  describe("division-op", () => {
    // Defect: detector misses division, division-by-zero fault not identified
    it("fires on division with spaces", () => {
      const surface = analyzeFaultSurface("const avg = total / count;");
      assert.ok(surfaceHasPattern(surface, "division-op"));
    });

    // Defect: detector misses compact division syntax without spaces
    it("fires on division without spaces", () => {
      const surface = analyzeFaultSurface("const avg=sum/count;");
      assert.ok(surfaceHasPattern(surface, "division-op"));
    });

    // Defect: false positive on import/from statements
    it("does not fire on import statement", () => {
      const surface = analyzeFaultSurface('import { x } from "./module";');
      assert.ok(!surfaceHasPattern(surface, "division-op"));
    });

    // Defect: false positive on path strings
    it("does not fire on path in string", () => {
      const surface = analyzeFaultSurface('const p = "path/to/file";');
      assert.ok(!surfaceHasPattern(surface, "division-op"));
    });
  });

  describe("type-conversion", () => {
    // Defect: detector misses parseInt, NaN-propagation fault not identified
    it("fires on parseInt", () => {
      const surface = analyzeFaultSurface("const n = parseInt(input, 10);");
      assert.ok(surfaceHasPattern(surface, "type-conversion"));
      assert.ok(surfaceHasDefect(surface, "nan-propagation"));
    });

    // Defect: detector misses Number() constructor
    it("fires on Number constructor", () => {
      const surface = analyzeFaultSurface("const n = Number(value);");
      assert.ok(surfaceHasPattern(surface, "type-conversion"));
    });
  });

  describe("array-mutation", () => {
    // Defect: detector misses in-place mutation, shared-mutation fault not identified
    it("fires on push", () => {
      const surface = analyzeFaultSurface("items.push(newItem);");
      assert.ok(surfaceHasPattern(surface, "array-mutation"));
      assert.ok(surfaceHasDefect(surface, "shared-mutation"));
    });

    // Defect: detector misses sort (commonly overlooked in-place mutation)
    it("fires on sort", () => {
      const surface = analyzeFaultSurface("arr.sort((a, b) => a - b);");
      assert.ok(surfaceHasPattern(surface, "array-mutation"));
    });
  });

  describe("promise-all", () => {
    // Defect: detector misses Promise.all, unhandled-rejection fault not identified
    it("fires on Promise.all", () => {
      const surface = analyzeFaultSurface("const results = await Promise.all(promises);");
      assert.ok(surfaceHasPattern(surface, "promise-all"));
    });

    // Defect: detector misses Promise.race
    it("fires on Promise.race", () => {
      const surface = analyzeFaultSurface("const first = await Promise.race(tasks);");
      assert.ok(surfaceHasPattern(surface, "promise-all"));
    });
  });

  describe("switch-statement", () => {
    // Defect: detector misses switch, missing-branch fault not identified
    it("fires on switch statement", () => {
      const surface = analyzeFaultSurface("switch (action.type) {");
      assert.ok(surfaceHasPattern(surface, "switch-statement"));
      assert.ok(surfaceHasDefect(surface, "missing-branch"));
    });
  });

  describe("math-domain", () => {
    // Defect: detector misses Math.sqrt, negative-input fault not identified
    it("fires on Math.sqrt", () => {
      const surface = analyzeFaultSurface("const r = Math.sqrt(value);");
      assert.ok(surfaceHasPattern(surface, "math-domain"));
      assert.ok(surfaceHasDefect(surface, "negative-input"));
    });

    // Defect: detector misses Math.log
    it("fires on Math.log", () => {
      const surface = analyzeFaultSurface("const l = Math.log(x);");
      assert.ok(surfaceHasPattern(surface, "math-domain"));
    });
  });
});

// --- Comment and block comment handling ---

describe("analyzeFaultSurface comment handling", () => {
  // Defect: patterns detected inside line comments produce false faults
  it("skips line comments", () => {
    const surface = analyzeFaultSurface("// if (i < arr.length) {}");
    assert.equal(surface.entries.length, 0);
  });

  // Defect: patterns detected inside block comments produce false faults
  it("skips block comments", () => {
    const source = [
      "/* start of comment",
      "if (i < arr.length) {}",
      "arr.push(1);",
      "end of comment */",
      "const x = 1;",
    ].join("\n");
    const surface = analyzeFaultSurface(source);
    assert.equal(surface.entries.length, 0);
  });

  // Defect: line with /* ... */ and trailing code is skipped entirely
  it("detects code after single-line block comment", () => {
    const surface = analyzeFaultSurface("/* comment */ if (x < 0) {}");
    assert.ok(surfaceHasPattern(surface, "comparison-boundary"));
  });

  // Defect: inline block comment text is parsed as executable code
  it("ignores patterns inside inline block comments", () => {
    const surface = analyzeFaultSurface("const x = 1; /* if (i < arr.length) {} */");
    assert.equal(surface.entries.length, 0);
  });

  // Defect: empty input causes crash
  it("handles empty source", () => {
    const surface = analyzeFaultSurface("");
    assert.equal(surface.entries.length, 0);
    assert.equal(surface.coverage.length, 0);
  });
});

// --- Overall analysis ---

describe("analyzeFaultSurface structure", () => {
  // Defect: summary counts diverge from entry counts due to counting bug
  it("summary matches entry category counts", () => {
    const source = ["if (i < 10) { items[i] = x; }", "try { throw new Error(); } catch (e) {}"].join("\n");
    const surface = analyzeFaultSurface(source);
    const totalFromSummary = Object.values(surface.summary).reduce((a, b) => a + b, 0);
    assert.equal(totalFromSummary, surface.entries.length);
  });

  // Defect: coverage list misses defect classes that appear in entries
  it("coverage includes all defect classes from entries", () => {
    const source = "if (x < 0) { arr.push(1); }";
    const surface = analyzeFaultSurface(source);
    const allClasses = new Set(surface.entries.flatMap((e) => e.defectClasses));
    for (const dc of allClasses) {
      assert.ok(surface.coverage.includes(dc), `Missing defect class: ${dc}`);
    }
  });

  // Defect: detector count mismatch between code and constant
  it("has expected detector count", () => {
    assert.equal(DETECTOR_COUNT, 16);
  });

  // Defect: duplicate entries on same line for same pattern
  it("deduplicates same pattern on same line", () => {
    const surface = analyzeFaultSurface("if (i < arr.length && j < arr.length) {}");
    const boundaryEntries = surface.entries.filter((e) => e.pattern === "comparison-boundary");
    // The regex matches once per test() call — line-level dedup ensures max 1
    assert.equal(boundaryEntries.length, 1);
  });
});

// --- suggestTests ---

describe("suggestTests", () => {
  // Defect: suggestions miss defect classes present in surface coverage
  it("covers all defect classes in surface", () => {
    const surface = analyzeFaultSurface("if (i < 10) { items[i] = x; }");
    const suggestions = suggestTests(surface);
    const suggestedClasses = new Set<string>();
    for (const s of suggestions) {
      for (const dc of surface.coverage) {
        if (s.defectComment.includes(dc)) {
          suggestedClasses.add(dc);
        }
      }
    }
    for (const dc of surface.coverage) {
      assert.ok(suggestedClasses.has(dc), `No suggestion for: ${dc}`);
    }
  });

  // Defect: empty surface produces spurious suggestions
  it("returns empty for no faults", () => {
    const surface = analyzeFaultSurface("const x = 1;");
    const suggestions = suggestTests(surface);
    assert.equal(suggestions.length, 0);
  });

  // Defect: suggestion has empty targetFaults array
  it("every suggestion has non-empty targetFaults", () => {
    const surface = analyzeFaultSurface("try { parseInt(x); } catch (e) {}");
    const suggestions = suggestTests(surface);
    for (const s of suggestions) {
      assert.ok(s.targetFaults.length > 0, `Empty targetFaults for: ${s.name}`);
    }
  });

  // Defect: defectComment format doesn't match expected pattern
  it("defectComment starts with // Defect:", () => {
    const surface = analyzeFaultSurface("const avg = total / count;");
    const suggestions = suggestTests(surface);
    for (const s of suggestions) {
      assert.ok(s.defectComment.startsWith("// Defect:"), `Bad comment format: ${s.defectComment}`);
    }
  });
});

// --- validateCoverage ---

describe("validateCoverage", () => {
  // Defect: covered defect class falsely reported as gap
  it("recognizes covered defect class by exact name", () => {
    const surface = analyzeFaultSurface("if (x < 0) {}");
    const testSource = '// Defect: off-by-one boundary check\nit("test", () => {});';
    const result = validateCoverage(testSource, surface);
    assert.ok(result.covered > 0);
  });

  // Defect: covered defect class with spaced name not recognized
  it("recognizes defect class with spaces", () => {
    const surface = analyzeFaultSurface("if (x < 0) {}");
    const testSource = '// Defect: off by one boundary check\nit("test", () => {});';
    const result = validateCoverage(testSource, surface);
    assert.ok(result.covered > 0);
  });

  // Defect: covered defect class by keyword not recognized
  it("recognizes defect class by keyword", () => {
    const surface = analyzeFaultSurface("arr.push(1);");
    const testSource = '// Defect: shared mutation when array is passed by reference\nit("test", () => {});';
    const result = validateCoverage(testSource, surface);
    assert.ok(result.covered > 0);
    assert.equal(result.gaps.length, 0);
  });

  // Defect: uncovered fault not reported as gap
  it("reports uncovered defect classes as gaps", () => {
    const surface = analyzeFaultSurface("try { x(); } catch (e) {}");
    const testSource = 'it("test", () => {});';
    const result = validateCoverage(testSource, surface);
    assert.ok(result.gaps.length > 0);
    assert.equal(result.covered, 0);
  });

  // Defect: generic wording ("error") falsely marks multiple error-path classes covered
  it("does not overcount generic error wording", () => {
    const surface = analyzeFaultSurface("try { x(); } catch (e) {}");
    const testSource = '// Defect: verify error is logged\nit("test", () => {});';
    const result = validateCoverage(testSource, surface);
    assert.equal(result.covered, 0);
    assert.equal(result.gaps.length, surface.coverage.length);
  });

  // Defect: score calculation wrong when no faults exist
  it("returns score 100 for empty surface", () => {
    const surface = analyzeFaultSurface("const x = 1;");
    const result = validateCoverage("", surface);
    assert.equal(result.score, 100);
  });

  // Defect: score calculation produces negative or >100 value
  it("score is between 0 and 100", () => {
    const surface = analyzeFaultSurface("if (x < 0) { try { y(); } catch (e) {} }");
    const result = validateCoverage("", surface);
    assert.ok(result.score >= 0);
    assert.ok(result.score <= 100);
  });

  // Defect: total doesn't match surface coverage count
  it("total matches surface coverage length", () => {
    const surface = analyzeFaultSurface("if (x < 0) { arr.push(1); }");
    const result = validateCoverage("", surface);
    assert.equal(result.total, surface.coverage.length);
  });
});

// --- formatTestPlan ---

describe("formatTestPlan", () => {
  // Defect: format produces invalid markdown table (missing headers/separators)
  it("produces valid markdown table", () => {
    const surface = analyzeFaultSurface("if (x < 10) {}");
    const plan = formatTestPlan(surface);
    assert.ok(plan.includes("| Line |"));
    assert.ok(plan.includes("|---"));
    assert.ok(plan.includes("comparison-boundary"));
  });

  // Defect: empty surface produces table instead of "no patterns" message
  it("handles empty surface", () => {
    const surface = analyzeFaultSurface("const x = 1;");
    const plan = formatTestPlan(surface);
    assert.ok(plan.includes("No fault-prone patterns"));
  });

  // Defect: summary section missing category counts
  it("includes summary with category counts", () => {
    const source = ["if (i < 10) {}", "try { x(); } catch (e) {}"].join("\n");
    const surface = analyzeFaultSurface(source);
    const plan = formatTestPlan(surface);
    assert.ok(plan.includes("## Summary"));
    assert.ok(plan.includes("**boundary**"));
    assert.ok(plan.includes("**error-handling**"));
  });
});

// --- Integration: real-world-like source ---

describe("integration", () => {
  // Defect: analyzer crashes or misses patterns in realistic multi-line code
  it("analyzes realistic production function", () => {
    const source = `
function processItems(items, options) {
	if (options === null || options === undefined) {
		options = {};
	}
	const limit = parseInt(options.limit, 10);
	if (items.length < limit) {
		return items.slice(0, limit);
	}
	const result = [];
	for (let i = 0; i < items.length; i++) {
		const value = items[i];
		const score = value.points / value.weight;
		result.push({ ...value, score });
	}
	try {
		result.sort((a, b) => a.score - b.score);
		return result;
	} catch (err) {
		throw new Error("Sort failed");
	}
}`;
    const surface = analyzeFaultSurface(source);
    // Should detect multiple fault categories
    assert.ok(surface.entries.length >= 5, `Only ${surface.entries.length} entries`);
    assert.ok(surface.coverage.length >= 4, `Only ${surface.coverage.length} defect classes`);

    // Specific patterns we expect
    assert.ok(surfaceHasPattern(surface, "explicit-null-check"));
    assert.ok(surfaceHasPattern(surface, "type-conversion"));
    assert.ok(surfaceHasPattern(surface, "comparison-boundary"));
    assert.ok(surfaceHasPattern(surface, "array-index"));
    assert.ok(surfaceHasPattern(surface, "division-op"));
    assert.ok(surfaceHasPattern(surface, "array-mutation"));
    assert.ok(surfaceHasPattern(surface, "try-catch"));
    assert.ok(surfaceHasPattern(surface, "throw-statement"));

    // Full workflow: analyze → suggest → validate → format
    const suggestions = suggestTests(surface);
    assert.ok(suggestions.length > 0);

    const plan = formatTestPlan(surface);
    assert.ok(plan.includes("Fault Surface Analysis"));

    // Validate with no tests → low score
    const emptyValidation = validateCoverage("", surface);
    assert.equal(emptyValidation.score, 0);
    assert.ok(emptyValidation.gaps.length > 0);

    // Validate with targeting tests → higher score
    const testSource = suggestions.map((s) => `${s.defectComment}\nit("${s.name}", () => {});`).join("\n");
    const fullValidation = validateCoverage(testSource, surface);
    assert.ok(fullValidation.score > 50, `Score too low: ${fullValidation.score}`);
  });
});
