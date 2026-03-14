/**
 * Product catalog contract — v3 update
 *
 * Changes from v2:
 * - Added optional `metadata` field
 * - Added optional `tags` field
 * - Widened `category` from specific union to `string`
 * - Made `sku` optional (was required)
 */

// v2 (previous version)
export interface ProductV2 {
  id: string;
  name: string;
  sku: string;
  category: "electronics" | "clothing" | "food";
  price: number;
  inStock: boolean;
}

// v3 (current version)
export interface ProductV3 {
  id: string;
  name: string;
  sku?: string;
  category: string;
  price: number;
  inStock: boolean;
  metadata?: Record<string, unknown>;
  tags?: string[];
}
