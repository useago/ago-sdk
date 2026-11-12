import { describe, expect, it, vi } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import { mountChatWidget } from "../src/widget/createChatWidget";
// @ts-expect-error The independent simulator is plain Node JavaScript.
import { createSimulator } from "../examples/background-agent-simulator/server.mjs";

const id = "11111111-1111-4111-8111-111111111111";

describe("vanilla widget with literal simulator", () => {
  it.each(["inline", "bubble"] as const)(
    "hydrates running work, approves, and renders the final file in %s",
    async (placement) => {
      const simulator = createSimulator();
      const origin = await simulator.start();
      const client = new AgoClient({ baseUrl: origin, userJwt: "synthetic" });
      const root = document.createElement("div");
      document.body.append(root);
      const widget = mountChatWidget(root, {
        client,
        placement,
        defaultOpen: true,
        loadThreads: false,
        conversationId: id,
        welcomeMessage: "",
      });
      try {
        await vi.waitFor(
          () => expect(root.textContent).toContain("Waiting for approval"),
          { timeout: 5000 },
        );
        expect(root.querySelector("textarea")?.disabled).toBe(true);
        const approve = [
          ...root.querySelectorAll(".ago-response-state button"),
        ].find((b) => b.textContent === "Approve") as HTMLButtonElement;
        expect(approve).toBeTruthy();
        approve.click();
        await vi.waitFor(() => expect(simulator.phase).toBe("final"), {
          timeout: 5000,
        });
        await vi.waitFor(
          () => expect(root.textContent).toContain("background-report.csv"),
          { timeout: 5000 },
        );
        expect(root.querySelector("textarea")?.disabled).toBe(false);
        expect(root.textContent).toContain("Approved");
        expect(
          root.querySelectorAll(".ago-response-state__approval button"),
        ).toHaveLength(0);
      } finally {
        widget.destroy();
        client.destroy();
        root.remove();
        await simulator.close();
      }
    },
  );
  it("renders visitor waiting without review arguments or decision controls", async () => {
    const simulator = createSimulator({
      caseName: "history-approval-redacted",
    });
    const origin = await simulator.start();
    const client = new AgoClient({ baseUrl: origin, userJwt: "visitor" });
    const root = document.createElement("div");
    document.body.append(root);
    const widget = mountChatWidget(root, {
      client,
      conversationId: id,
      welcomeMessage: "",
    });
    try {
      await vi.waitFor(
        () => expect(root.textContent).toContain("Waiting for approval"),
        { timeout: 5000 },
      );
      expect(root.textContent).not.toContain("record-42");
      expect(
        root.querySelectorAll(".ago-response-state__approval button"),
      ).toHaveLength(0);
      expect(root.querySelector("textarea")?.disabled).toBe(true);
    } finally {
      widget.destroy();
      client.destroy();
      root.remove();
      await simulator.close();
    }
  });
});
