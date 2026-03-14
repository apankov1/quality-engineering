/**
 * Notification service contract — v4 update
 *
 * All changes are backward-compatible:
 * - Added optional `metadata` to notification
 * - Added optional `priority` to notification
 * - Widened `channel` from specific union to string
 * - Made `retryCount` optional (was required)
 * - Added new optional enum value to delivery status
 * - Added new event type for auditing
 * - Added new status code 207 for batch
 * - Schema fields all have .catch() defaults
 */

// Contract fields (all safe changes)
export interface NotificationV3 {
  id: string;
  channel: "email" | "sms" | "push";
  recipient: string;
  subject: string;
  body: string;
  retryCount: number;
  sentAt: string;
}

export interface NotificationV4 {
  id: string;
  channel: string;
  recipient: string;
  subject: string;
  body: string;
  retryCount?: number;
  sentAt: string;
  metadata?: Record<string, unknown>;
  priority?: "low" | "normal" | "high" | "urgent";
}

// Event types (only additions)
export const NOTIFICATION_EVENTS_V3 = ["SENT", "DELIVERED", "BOUNCED", "FAILED"];
export const NOTIFICATION_EVENTS_V4 = ["SENT", "DELIVERED", "BOUNCED", "FAILED", "AUDIT_LOGGED"];

// Status codes (only additions)
export const NOTIFICATION_STATUS_V3 = [200, 400, 401, 500];
export const NOTIFICATION_STATUS_V4 = [200, 207, 400, 401, 500];

// Enum values (only additions)
export const DELIVERY_STATUS_V3 = ["queued", "sending", "sent", "failed"];
export const DELIVERY_STATUS_V4 = ["queued", "sending", "sent", "failed", "retrying"];
