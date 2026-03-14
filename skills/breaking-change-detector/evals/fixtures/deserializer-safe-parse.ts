/**
 * Counter Durable Object with persistent state.
 * Uses safeParse with graceful fallback for hibernation safety.
 */

import { z } from "zod";

const CounterStateSchema = z.object({
  value: z.number().catch(0),
  lastUpdatedBy: z.string().catch("system"),
  history: z
    .array(
      z.object({
        delta: z.number().catch(0),
        timestamp: z.string().catch(""),
        actor: z.string().catch("unknown"),
      }),
    )
    .catch([]),
  metadata: z
    .object({
      createdAt: z.string().catch(""),
      resetCount: z.number().catch(0),
    })
    .catch({ createdAt: "", resetCount: 0 }),
});

export type CounterState = z.infer<typeof CounterStateSchema>;

export class Counter {
  private state: CounterState;

  constructor(state: CounterState) {
    this.state = state;
  }

  static fromJSON(raw: unknown): Counter {
    const result = CounterStateSchema.safeParse(raw);
    if (!result.success) {
      console.warn("Counter state migration: using defaults", result.error.issues);
      return new Counter({
        value: 0,
        lastUpdatedBy: "system",
        history: [],
        metadata: { createdAt: new Date().toISOString(), resetCount: 0 },
      });
    }
    return new Counter(result.data);
  }

  toJSON(): CounterState {
    return { ...this.state };
  }

  increment(actor: string, delta = 1): number {
    this.state.value += delta;
    this.state.lastUpdatedBy = actor;
    this.state.history.push({
      delta,
      timestamp: new Date().toISOString(),
      actor,
    });
    return this.state.value;
  }
}
