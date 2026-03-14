/**
 * Cache eviction policy tests
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LRUCache } from "../src/lru-cache.js";

describe("LRUCache", () => {
  it("should evict least recently used entry when at capacity", () => {
    const cache = new LRUCache<string>({ maxSize: 3 });
    cache.set("a", "alpha");
    cache.set("b", "bravo");
    cache.set("c", "charlie");
    cache.get("a"); // access 'a' to make 'b' the LRU
    cache.set("d", "delta"); // should evict 'b'
    assert.equal(cache.get("b"), undefined);
    assert.equal(cache.get("a"), "alpha");
    assert.equal(cache.get("d"), "delta");
  });

  it("should respect max size limit", () => {
    const cache = new LRUCache<number>({ maxSize: 2 });
    cache.set("x", 1);
    cache.set("y", 2);
    cache.set("z", 3);
    assert.equal(cache.size, 2);
    assert.equal(cache.has("x"), false);
  });

  // Defect: TTL bug
  it("should handle TTL expiry correctly", () => {
    const cache = new LRUCache<string>({ maxSize: 10, ttlMs: 100 });
    cache.set("temp", "value");
    // Simulate time passage
    cache._advanceClock(150);
    assert.equal(cache.get("temp"), undefined);
    assert.equal(cache.size, 0);
  });

  // Defect: get() must update eviction order to most-recently-used, otherwise hot keys
  // get evicted and hit rate degrades under load — breaks LRU invariant.
  it("should update access order on get to maintain LRU invariant", () => {
    const cache = new LRUCache<string>({ maxSize: 3 });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    cache.get("a"); // touch 'a', making 'b' the LRU
    cache.set("d", "4"); // evicts 'b', not 'a'
    assert.equal(cache.has("a"), true);
    assert.equal(cache.has("b"), false);
    assert.equal(cache.has("c"), true);
    assert.equal(cache.has("d"), true);
  });
});
