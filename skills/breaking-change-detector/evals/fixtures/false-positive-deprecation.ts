/**
 * Billing service contract — v5 migration
 * (Response contract: server returns this to API consumers)
 *
 * This change looks breaking at first glance but is actually safe:
 * - `legacyPlanId` is deprecated but still present and optional
 * - `planName` was renamed to `planDisplayName` BUT `planName` is
 *   kept as an optional alias (not removed)
 * - New `billingCycle` field is optional
 * - `currency` widened from union to string
 * - `discount` made optional (was required with default 0)
 */

// v4 (previous version)
export interface BillingAccountV4 {
  id: string;
  planName: string;
  legacyPlanId: string;
  currency: "USD" | "EUR" | "GBP";
  discount: number;
  monthlyAmount: number;
  status: "active" | "past_due" | "cancelled";
}

// v5 (current version — backward compatible despite looking scary)
export interface BillingAccountV5 {
  id: string;
  /** @deprecated Use planDisplayName instead */
  planName?: string;
  planDisplayName: string;
  /** @deprecated Will be removed in v7 */
  legacyPlanId?: string;
  currency: string;
  discount?: number;
  monthlyAmount: number;
  status: "active" | "past_due" | "cancelled";
  billingCycle?: "monthly" | "annual";
}
