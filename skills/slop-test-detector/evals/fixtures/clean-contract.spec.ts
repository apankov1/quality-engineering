/**
 * Notification service contract tests
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotificationService } from "../src/notification-service.js";

describe("NotificationService", () => {
  it("should deliver email notification with correct subject", () => {
    const service = new NotificationService({ provider: "ses" });
    const result = service.send({
      channel: "email",
      to: "user@example.com",
      subject: "Order Confirmed",
      body: "Your order #1234 has been confirmed.",
    });
    assert.equal(result.status, "delivered");
    assert.equal(result.channel, "email");
    assert.ok(result.messageId.startsWith("msg_"));
  });

  it("should batch multiple recipients in single API call", () => {
    const service = new NotificationService({ provider: "ses", batchSize: 50 });
    const recipients = Array.from({ length: 120 }, (_, i) => `user${i}@example.com`);
    const batches = service.prepareBatches(recipients);
    assert.equal(batches.length, 3);
    assert.equal(batches[0].length, 50);
    assert.equal(batches[1].length, 50);
    assert.equal(batches[2].length, 20);
  });

  it("should throw on unsupported notification channel", () => {
    const service = new NotificationService({ provider: "ses" });
    assert.throws(
      () =>
        service.send({
          channel: "carrier-pigeon" as any,
          to: "user@example.com",
          subject: "test",
          body: "test",
        }),
      { code: "UNSUPPORTED_CHANNEL" },
    );
  });

  it("should respect quiet hours by deferring delivery", () => {
    const service = new NotificationService({
      provider: "ses",
      quietHours: { start: 22, end: 7, timezone: "America/New_York" },
    });
    const result = service.send({
      channel: "push",
      to: "device_token_abc",
      subject: "Reminder",
      body: "Don't forget your appointment",
      sendAt: new Date("2026-03-15T03:00:00-05:00"),
    });
    assert.equal(result.status, "deferred");
    assert.ok(result.scheduledFor);
    assert.ok(new Date(result.scheduledFor).getHours() >= 7);
  });

  it("should redact PII from notification logs", () => {
    const service = new NotificationService({ provider: "ses" });
    service.send({
      channel: "email",
      to: "sensitive@example.com",
      subject: "Password Reset",
      body: "Click here to reset: https://app.com/reset?token=abc123",
    });
    const logs = service.getAuditLog();
    assert.ok(logs.length > 0);
    const lastLog = logs[logs.length - 1];
    assert.equal(lastLog.to, "s*******e@example.com");
    assert.ok(!lastLog.body.includes("abc123"));
  });
});
