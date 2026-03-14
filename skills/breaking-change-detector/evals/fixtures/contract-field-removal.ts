/**
 * User session contract — v2 migration
 *
 * Changes from v1:
 * - Removed `score` field (replaced by `points`)
 * - Renamed `userName` to `displayName`
 * - Narrowed `status` from string to union type
 * - Added required field `tenantId`
 */

// v1 (previous version)
export interface UserSessionV1 {
  id: string;
  userName: string;
  score: number;
  status: string;
  lastActive: Date;
  preferences: Record<string, unknown>;
}

// v2 (current version)
export interface UserSessionV2 {
  id: string;
  displayName: string;
  points: number;
  status: "active" | "idle" | "disconnected";
  lastActive: Date;
  preferences: Record<string, unknown>;
  tenantId: string;
}
