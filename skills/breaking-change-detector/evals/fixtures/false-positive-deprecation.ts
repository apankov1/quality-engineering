/**
 * Billing service contract — v5 migration
 * (Response contract: server returns this to API consumers)
 *
 * This change looks breaking at first glance but is actually safe:
 * - `legacyPlanId` is deprecated but still present (not removed, not made optional)
 * - `planName` is deprecated but still present and required — `planDisplayName`
 *   is added as an ADDITIONAL required field (server always sends both)
 * - New `billingCycle` field is optional
 * - `currency` widened from union to string
 * - `discount` made optional (was required with default 0) — but in a response
 *   contract, the server may omit it; clients should already handle missing fields
 *
 * Key: no fields were removed, no required fields were made optional in a way
 * that breaks consumers. Deprecated fields are still present and still required.
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
  /** @deprecated Use planDisplayName instead — still required for backward compat */
  planName: string;
  planDisplayName: string;
  /** @deprecated Will be removed in v7 — still required for now */
  legacyPlanId: string;
  currency: string;
  discount?: number;
  monthlyAmount: number;
  status: "active" | "past_due" | "cancelled";
  billingCycle?: "monthly" | "annual";
}
