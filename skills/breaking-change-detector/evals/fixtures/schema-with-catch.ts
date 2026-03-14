/**
 * Durable Object snapshot schema for workspace configuration.
 * All fields have .catch() defaults for safe hibernation wake.
 */

import { z } from "zod";

export const WorkspaceConfigSchema = z.object({
  version: z.number().catch(1),
  name: z.string().catch("Untitled Workspace"),
  ownerId: z.string().catch(""),
  members: z
    .array(
      z.object({
        userId: z.string().catch(""),
        role: z.enum(["owner", "editor", "viewer"]).catch("viewer"),
        joinedAt: z.string().catch(""),
      }),
    )
    .catch([]),
  settings: z
    .object({
      theme: z.enum(["light", "dark", "system"]).catch("system"),
      notifications: z.boolean().catch(true),
      autoSave: z.boolean().catch(true),
      retentionDays: z.number().catch(30),
    })
    .catch({ theme: "system", notifications: true, autoSave: true, retentionDays: 30 }),
  createdAt: z.string().catch(""),
  updatedAt: z.string().catch(""),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;
