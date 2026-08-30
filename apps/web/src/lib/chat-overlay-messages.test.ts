import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "$lib/components/room/types";
import { getMemberColor } from "$lib/member-colors";
import { toChatOverlayMessages } from "./chat-overlay-messages";

describe("toChatOverlayMessages", () => {
  test("preserves the unresolved query state", () => {
    expect(toChatOverlayMessages(undefined)).toBeUndefined();
  });

  test("preserves a loaded empty chat", () => {
    expect(toChatOverlayMessages([])).toEqual([]);
  });

  test("maps loaded chat messages", () => {
    const message = {
      _id: "message" as ChatMessage["_id"],
      _creationTime: 1,
      room: "room" as ChatMessage["room"],
      clientMessageId: "client-message",
      body: "Hello",
      user: {
        _id: "user" as ChatMessage["user"]["_id"],
        name: "Grant",
      },
    } satisfies ChatMessage;

    expect(toChatOverlayMessages([message])).toEqual([
      {
        id: "client-message",
        body: "Hello",
        color: getMemberColor(message.user._id),
      },
    ]);
  });
});
