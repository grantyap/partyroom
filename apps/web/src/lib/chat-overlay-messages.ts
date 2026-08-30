import type { ChatMessage, OverlayMessage } from "$lib/components/room/types";
import { getMemberColor } from "$lib/member-colors";

/**
 * Converts chat query data into messages for the video overlay.
 *
 * Returns `undefined` while the chat query has not returned its first result.
 * Returns `[]` after the query has loaded when the chat has no messages.
 * Returns a populated array after the query has loaded when messages exist.
 * The overlay uses the first defined result as its history baseline and only
 * displays messages added after that result.
 */
export function toChatOverlayMessages(
  messages: ChatMessage[] | undefined,
): OverlayMessage[] | undefined {
  return messages?.map((message) => ({
    id: message.clientMessageId,
    body: message.body,
    color: getMemberColor(message.user._id),
  }));
}
