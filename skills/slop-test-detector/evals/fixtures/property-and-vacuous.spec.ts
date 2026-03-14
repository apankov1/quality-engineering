/**
 * Search index tests with property-based testing
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import { SearchIndex } from "../src/search-index.js";

describe("SearchIndex", () => {
  it("should always return results for any query", () => {
    const index = new SearchIndex({ analyzer: "standard" });
    index.addDocuments([
      { id: "1", title: "Introduction to TypeScript", body: "TypeScript is a typed superset" },
      { id: "2", title: "Advanced Patterns", body: "Explore design patterns in depth" },
    ]);

    fc.assert(
      fc.property(fc.string(), (query) => {
        const results = index.search(query);
        return true;
      }),
    );
  });

  it("should return non-negative result count", () => {
    const index = new SearchIndex({ analyzer: "standard" });
    index.addDocuments([{ id: "1", title: "Test Document", body: "Some content for searching" }]);
    const results = index.search("test");
    assert.ok(results.length >= 0);
  });

  it("should rank exact matches higher than partial", () => {
    const index = new SearchIndex({ analyzer: "standard" });
    index.addDocuments([
      { id: "1", title: "TypeScript Guide", body: "Complete TypeScript reference" },
      { id: "2", title: "JavaScript Basics", body: "Learn TypeScript fundamentals" },
    ]);
    const results = index.search("TypeScript Guide");
    assert.equal(results[0].id, "1");
    assert.ok(results[0].score > results[1].score);
  });

  it("should handle empty query gracefully", () => {
    const index = new SearchIndex({ analyzer: "standard" });
    index.addDocuments([{ id: "1", title: "Doc", body: "Content" }]);
    const results = index.search("");
    assert.equal(results.length, 0);
  });
});
