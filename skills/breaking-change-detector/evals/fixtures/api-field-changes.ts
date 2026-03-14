/**
 * User API response contract — /api/v2/users/:id
 *
 * Changes from v1:
 * - Removed `avatar` field
 * - Changed `age` type from number to string
 * - Made `email` required (was optional)
 * - Changed `role` semantic from "permission level" to "department"
 * - Added optional `phone` field
 * - Added optional `timezone` field
 */

// v1 response fields
export const USER_FIELDS_V1 = [
  { name: "id", type: "string", required: true },
  { name: "name", type: "string", required: true },
  { name: "email", type: "string", required: false },
  { name: "avatar", type: "string", required: false },
  { name: "age", type: "number", required: false },
  { name: "role", type: "string", required: true, semantic: "permission level" },
  { name: "createdAt", type: "string", required: true },
];

// v2 response fields
export const USER_FIELDS_V2 = [
  { name: "id", type: "string", required: true },
  { name: "name", type: "string", required: true },
  { name: "email", type: "string", required: true },
  { name: "age", type: "string", required: false },
  { name: "role", type: "string", required: true, semantic: "department" },
  { name: "createdAt", type: "string", required: true },
  { name: "phone", type: "string", required: false },
  { name: "timezone", type: "string", required: false },
];
