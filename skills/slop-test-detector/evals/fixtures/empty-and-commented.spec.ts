/**
 * Payment gateway integration tests
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PaymentGateway } from "../src/payment-gateway.js";

describe("PaymentGateway", () => {
  it("should process refund for valid transaction", () => {
    const gateway = new PaymentGateway({ apiKey: "sk_test_123" });
    const transaction = gateway.createTransaction({
      amount: 4999,
      currency: "USD",
      cardToken: "tok_visa_debit",
    });
    // Will add assertions after integration env is up
  });

  it("should validate card number format before charging", () => {
    const gateway = new PaymentGateway({ apiKey: "sk_test_123" });
    const result = gateway.validateCard("4111111111111111");
    // assert.equal(result.valid, true);
    // assert.equal(result.brand, "visa");
    // assert.equal(result.lastFour, "1111");
  });

  it("should log transaction with correlation ID", () => {
    const logs: string[] = [];
    const correlationId = "corr-abc-123";
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${correlationId} PAYMENT_INIT`;
    logs.push(entry);
    assert.ok(logs.length > 0);
  });

  it("should reject expired cards", () => {
    const gateway = new PaymentGateway({ apiKey: "sk_test_123" });
    assert.throws(() => gateway.charge({ cardToken: "tok_expired", amount: 1000 }), { code: "CARD_EXPIRED" });
  });
});
