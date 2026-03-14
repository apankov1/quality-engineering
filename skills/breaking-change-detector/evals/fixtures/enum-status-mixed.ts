/**
 * Order service API changes — v3
 *
 * Status code changes for POST /api/orders:
 * - Removed 202 Accepted (was used for async processing)
 * - Added 207 Multi-Status (for batch operations)
 * - Kept 200, 400, 401, 404, 500
 *
 * OrderStatus enum changes:
 * - Removed "on_hold" value
 * - Added "archived" value
 * - Kept all other values
 */

export const ORDER_STATUS_CODES_V2 = [200, 202, 400, 401, 404, 500];
export const ORDER_STATUS_CODES_V3 = [200, 207, 400, 401, 404, 500];

export const ORDER_STATUS_ENUM_V2 = ["pending", "confirmed", "shipped", "delivered", "cancelled", "on_hold"];
export const ORDER_STATUS_ENUM_V3 = ["pending", "confirmed", "shipped", "delivered", "cancelled", "archived"];
