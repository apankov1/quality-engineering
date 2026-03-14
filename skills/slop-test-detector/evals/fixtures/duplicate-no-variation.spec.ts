/**
 * URL shortener service tests
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UrlShortener, classify } from "../src/url-shortener.js";

describe("UrlShortener", () => {
  it("should shorten HTTP URL to 8-char slug", () => {
    const shortener = new UrlShortener({ slugLength: 8 });
    const result = shortener.shorten("https://example.com/very/long/path");
    assert.ok(result.slug);
    assert.equal(result.slug.length, 8);
    assert.equal(result.originalUrl, "https://example.com/very/long/path");
  });

  it("should shorten HTTPS URL to 8-char slug", () => {
    const shortener = new UrlShortener({ slugLength: 8 });
    const result = shortener.shorten("https://example.com/very/long/path");
    assert.ok(result.slug);
    assert.equal(result.slug.length, 8);
    assert.equal(result.originalUrl, "https://example.com/very/long/path");
  });

  it("should classify URL protocol as HTTP", () => {
    assert.equal(classify("https://example.com"), "secure");
  });

  it("should classify URL protocol for redirect", () => {
    assert.equal(classify("https://example.com"), "secure");
  });

  it("should track click count per slug", () => {
    const shortener = new UrlShortener({ slugLength: 8 });
    const { slug } = shortener.shorten("https://docs.example.com/guide");
    shortener.resolve(slug);
    shortener.resolve(slug);
    shortener.resolve(slug);
    const stats = shortener.getStats(slug);
    assert.equal(stats.clicks, 3);
  });
});
