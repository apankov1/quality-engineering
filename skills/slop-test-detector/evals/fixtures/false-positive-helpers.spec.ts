/**
 * Event bus integration tests with custom assertion helpers
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EventBus } from "../src/event-bus.js";

function assertEventEmitted(bus: EventBus, eventName: string, count: number): void {
  const events = bus.getEmittedEvents(eventName);
  assert.equal(events.length, count, `Expected ${count} '${eventName}' events, got ${events.length}`);
}

function assertPayloadContains(bus: EventBus, eventName: string, key: string, value: unknown): void {
  const events = bus.getEmittedEvents(eventName);
  const last = events[events.length - 1];
  assert.ok(last, `No '${eventName}' events found`);
  assert.deepEqual(last.payload[key], value);
}

function testDeliveryOrder(bus: EventBus, expectedOrder: string[]): void {
  const delivered = bus.getDeliveryLog().map((e) => e.name);
  assert.deepEqual(delivered, expectedOrder);
}

describe("EventBus", () => {
  it("should emit user.created event on registration", () => {
    const bus = new EventBus();
    bus.register({ name: "Alice", email: "alice@test.com" });
    assertEventEmitted(bus, "user.created", 1);
    assertPayloadContains(bus, "user.created", "email", "alice@test.com");
  });

  it("should emit events in correct order during checkout", () => {
    const bus = new EventBus();
    bus.checkout({ userId: "u_1", items: ["item_a", "item_b"], total: 5999 });
    testDeliveryOrder(bus, [
      "cart.validated",
      "payment.initiated",
      "payment.completed",
      "order.created",
      "inventory.reserved",
    ]);
  });

  it("should not emit duplicate events for idempotent operations", () => {
    const bus = new EventBus({ idempotencyKey: "op_123" });
    bus.register({ name: "Bob", email: "bob@test.com" });
    bus.register({ name: "Bob", email: "bob@test.com" });
    assertEventEmitted(bus, "user.created", 1);
  });

  it("should propagate error events to dead letter queue", () => {
    const bus = new EventBus();
    bus.on("order.created", () => {
      throw new Error("Handler failed");
    });
    bus.checkout({ userId: "u_2", items: ["item_c"], total: 1999 });
    assertEventEmitted(bus, "dlq.enqueued", 1);
    assertPayloadContains(bus, "dlq.enqueued", "originalEvent", "order.created");
  });
});
