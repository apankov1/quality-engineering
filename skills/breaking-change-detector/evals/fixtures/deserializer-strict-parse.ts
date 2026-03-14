/**
 * Chat room Durable Object with persistent state.
 * Handles message history and participant tracking.
 */

import { z } from "zod";

const ParticipantSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  joinedAt: z.string(),
  role: z.enum(["host", "participant", "observer"]),
});

const MessageSchema = z.object({
  id: z.string(),
  senderId: z.string(),
  content: z.string(),
  timestamp: z.string(),
  edited: z.boolean().optional(),
});

const ChatRoomStateSchema = z.object({
  roomId: z.string(),
  participants: z.array(ParticipantSchema),
  messages: z.array(MessageSchema),
  createdAt: z.string(),
  maxParticipants: z.number(),
});

export type ChatRoomState = z.infer<typeof ChatRoomStateSchema>;

export class ChatRoom {
  private state: ChatRoomState;

  constructor(initialState: ChatRoomState) {
    this.state = initialState;
  }

  static fromJSON(raw: unknown): ChatRoom {
    const parsed = ChatRoomStateSchema.parse(raw);
    return new ChatRoom(parsed);
  }

  toJSON(): ChatRoomState {
    return { ...this.state };
  }

  addParticipant(userId: string, displayName: string): void {
    if (this.state.participants.length >= this.state.maxParticipants) {
      throw new Error("Room is full");
    }
    this.state.participants.push({
      userId,
      displayName,
      joinedAt: new Date().toISOString(),
      role: "participant",
    });
  }

  sendMessage(senderId: string, content: string): string {
    const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.state.messages.push({
      id,
      senderId,
      content,
      timestamp: new Date().toISOString(),
    });
    return id;
  }
}
