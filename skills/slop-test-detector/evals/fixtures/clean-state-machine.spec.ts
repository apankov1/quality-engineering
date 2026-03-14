/**
 * Order lifecycle state machine tests
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OrderStateMachine } from "../src/order-state-machine.js";

describe("OrderStateMachine", () => {
  it("should start in 'pending' state", () => {
    const order = new OrderStateMachine("order_001");
    assert.equal(order.currentState, "pending");
    assert.deepEqual(order.history, [{ state: "pending", timestamp: order.createdAt }]);
  });

  it("should transition pending → confirmed on payment", () => {
    const order = new OrderStateMachine("order_002");
    order.transition("confirm", { paymentId: "pay_abc" });
    assert.equal(order.currentState, "confirmed");
    assert.equal(order.history.length, 2);
    assert.equal(order.metadata.paymentId, "pay_abc");
  });

  it("should transition confirmed → shipped with tracking", () => {
    const order = new OrderStateMachine("order_003");
    order.transition("confirm", { paymentId: "pay_def" });
    order.transition("ship", { trackingNumber: "1Z999AA10123456784", carrier: "UPS" });
    assert.equal(order.currentState, "shipped");
    assert.equal(order.metadata.trackingNumber, "1Z999AA10123456784");
    assert.equal(order.metadata.carrier, "UPS");
  });

  it("should reject invalid transitions", () => {
    const order = new OrderStateMachine("order_004");
    assert.throws(() => order.transition("ship", { trackingNumber: "TRACK123" }), {
      message: /Cannot transition from 'pending' via 'ship'/,
    });
  });

  it("should allow cancellation from pending or confirmed", () => {
    const pendingOrder = new OrderStateMachine("order_005");
    pendingOrder.transition("cancel", { reason: "Customer request" });
    assert.equal(pendingOrder.currentState, "cancelled");

    const confirmedOrder = new OrderStateMachine("order_006");
    confirmedOrder.transition("confirm", { paymentId: "pay_ghi" });
    confirmedOrder.transition("cancel", { reason: "Out of stock" });
    assert.equal(confirmedOrder.currentState, "cancelled");
  });

  it("should reject cancellation of shipped orders", () => {
    const order = new OrderStateMachine("order_007");
    order.transition("confirm", { paymentId: "pay_jkl" });
    order.transition("ship", { trackingNumber: "TRACK789", carrier: "FedEx" });
    assert.throws(() => order.transition("cancel", { reason: "Changed mind" }), {
      message: /Cannot transition from 'shipped' via 'cancel'/,
    });
  });

  it("should record full audit trail of state changes", () => {
    const order = new OrderStateMachine("order_008");
    order.transition("confirm", { paymentId: "pay_mno" });
    order.transition("ship", { trackingNumber: "TRACK456", carrier: "DHL" });
    order.transition("deliver", {});
    assert.equal(order.history.length, 4);
    assert.deepEqual(
      order.history.map((h) => h.state),
      ["pending", "confirmed", "shipped", "delivered"],
    );
  });
});
