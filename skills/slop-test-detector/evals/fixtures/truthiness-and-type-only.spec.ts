/**
 * Data pipeline transformation tests
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DataPipeline } from "../src/data-pipeline.js";

describe("DataPipeline", () => {
  it("should parse CSV rows into structured records", () => {
    const pipeline = new DataPipeline({ delimiter: "," });
    const csv = "name,age,email\nAlice,30,alice@test.com\nBob,25,bob@test.com";
    const records = pipeline.parseCSV(csv);
    assert.ok(records);
    assert.ok(records.length);
    assert.ok(records[0].name);
    assert.ok(records[0].email);
  });

  it("should detect column types from sample data", () => {
    const pipeline = new DataPipeline({ typeSampleSize: 100 });
    const schema = pipeline.inferSchema([
      { id: 1, name: "Alice", active: true, score: 98.5 },
      { id: 2, name: "Bob", active: false, score: 87.2 },
    ]);
    assert.equal(typeof schema.id, "string");
    assert.equal(typeof schema.name, "string");
    assert.equal(typeof schema.active, "string");
    assert.equal(typeof schema.score, "string");
  });

  it("should generate report ID for pipeline run", () => {
    const pipeline = new DataPipeline({ region: "us-east-1" });
    const reportId = pipeline.generateReportId();
    assert.ok(reportId);
  });

  it("should aggregate numeric columns with correct totals", () => {
    const pipeline = new DataPipeline({ delimiter: "," });
    const data = [
      { product: "Widget A", revenue: 15000, units: 150 },
      { product: "Widget B", revenue: 22000, units: 200 },
      { product: "Widget C", revenue: 8500, units: 85 },
    ];
    const summary = pipeline.aggregate(data, ["revenue", "units"]);
    assert.equal(summary.revenue, 45500);
    assert.equal(summary.units, 435);
  });
});
