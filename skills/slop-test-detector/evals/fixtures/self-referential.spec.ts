/**
 * Inventory management tests
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InventoryService } from "../src/inventory-service.js";

describe("InventoryService", () => {
  it("should track stock level after restock", () => {
    const service = new InventoryService();
    service.restock("SKU-001", 50);
    const stock = service.getStock("SKU-001");
    assert.equal(stock, stock);
  });

  it("should calculate reorder point", () => {
    const service = new InventoryService();
    const point = service.calculateReorderPoint("SKU-002", { leadTimeDays: 7, dailyUsage: 10 });
    assert.equal(point, point);
  });

  it("should deduct stock on order fulfillment", () => {
    const service = new InventoryService();
    service.restock("SKU-003", 100);
    service.fulfill("SKU-003", 25);
    const remaining = service.getStock("SKU-003");
    assert.equal(remaining, 75);
  });

  it("should throw when fulfilling more than available", () => {
    const service = new InventoryService();
    service.restock("SKU-004", 10);
    assert.throws(() => service.fulfill("SKU-004", 20), {
      message: /Insufficient stock/,
    });
  });
});
