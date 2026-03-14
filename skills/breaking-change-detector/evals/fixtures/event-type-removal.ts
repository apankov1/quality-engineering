/**
 * Order processing event types — v2 migration
 *
 * Changes from v1:
 * - Removed `ORDER_UPDATED` (merged into ORDER_MODIFIED)
 * - Removed `PAYMENT_PENDING` (replaced by PAYMENT_INITIATED)
 * - Added `ORDER_MODIFIED`
 * - Added `PAYMENT_INITIATED`
 * - Added `ORDER_ARCHIVED`
 * - Kept all other event types unchanged
 */

// v1 event types
export const ORDER_EVENTS_V1 = [
  "ORDER_CREATED",
  "ORDER_UPDATED",
  "ORDER_CANCELLED",
  "ORDER_COMPLETED",
  "PAYMENT_PENDING",
  "PAYMENT_COMPLETED",
  "PAYMENT_FAILED",
  "REFUND_INITIATED",
  "REFUND_COMPLETED",
  "SHIPPING_STARTED",
  "SHIPPING_DELIVERED",
] as const;

// v2 event types
export const ORDER_EVENTS_V2 = [
  "ORDER_CREATED",
  "ORDER_MODIFIED",
  "ORDER_CANCELLED",
  "ORDER_COMPLETED",
  "ORDER_ARCHIVED",
  "PAYMENT_INITIATED",
  "PAYMENT_COMPLETED",
  "PAYMENT_FAILED",
  "REFUND_INITIATED",
  "REFUND_COMPLETED",
  "SHIPPING_STARTED",
  "SHIPPING_DELIVERED",
] as const;
