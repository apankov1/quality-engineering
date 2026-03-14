/**
 * Durable Object snapshot schema for game session state.
 * Used with @Persist decorator for hibernation/wake cycles.
 */

import { z } from "zod";

export const GameSessionSchema = z.object({
  version: z.number(),
  playerId: z.string(),
  level: z.number(),
  inventory: z.array(z.string()),
  achievements: z.array(
    z.object({
      id: z.string(),
      unlockedAt: z.string(),
    }),
  ),
  settings: z.object({
    volume: z.number(),
    difficulty: z.string(),
    language: z.string().catch("en"),
  }),
  lastCheckpoint: z.string().nullable(),
});

export type GameSession = z.infer<typeof GameSessionSchema>;
