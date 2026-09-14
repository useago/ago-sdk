import { describe, expect, it, vi } from "vitest";
import { createMockClient } from "../src/testing/createMockClient";
import { mountChatWidget } from "../src/widget/createChatWidget";

describe("widget attachment messages", () => {
  it.each(["", " \n\t "])("ignores blank content %j without sending or adding messages", async (content) => {
    const client = createMockClient();
    const root = document.createElement("div");
    document.body.append(root);
    const onMessageSent = vi.fn();
    const widget = mountChatWidget(root, {
      client,
      allowFiles: true,
      persistConversation: false,
      loadThreads: false,
      autoResume: false,
      prompt: false,
      feedback: false,
      onMessageSent,
    });
    try {
      const initialMarkup = root.innerHTML;
      await widget.sendMessage(content, [new File(["hello"], "note.txt", { type: "text/plain" })]);
      expect(client.__callsFor("sendMessage")).toHaveLength(0);
      expect(onMessageSent).not.toHaveBeenCalled();
      expect(root.innerHTML).toBe(initialMarkup);
    } finally {
      widget.destroy();
      client.destroy();
      root.remove();
    }
  });
});
