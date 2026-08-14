import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import type { AgoMessage } from "../src/client/types";
import { mountChatWidget } from "../src/widget/createChatWidget";

// The widget can load threads on mount; keep every unmocked call off the network.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ count: 0, items: [] }),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeAssistantMessage(overrides: Partial<AgoMessage> = {}): AgoMessage {
  return {
    id: "assistant-1",
    conversationId: "conv-1",
    content: "Hi there!",
    role: "assistant",
    status: "DONE",
    createdAt: new Date(0),
    ...overrides,
  };
}

/** Mount a widget whose turns resolve to `message`, and send one. */
async function mountWithAnswer(
  options: Parameters<typeof mountChatWidget>[1],
  message: AgoMessage = makeAssistantMessage(),
) {
  const client = new AgoClient({ baseUrl: "https://example.test" });
  vi.spyOn(client, "sendMessage").mockResolvedValue(message);
  const feedbackSpy = vi
    .spyOn(client, "submitFeedback")
    .mockResolvedValue(undefined);

  const root = document.createElement("div");
  document.body.appendChild(root);
  const widget = mountChatWidget(root, { client, ...options });
  await widget.sendMessage("hello");

  return {
    root,
    feedbackSpy,
    cleanup: () => {
      widget.destroy();
      root.remove();
      client.destroy();
    },
  };
}

const thumbs = (root: HTMLElement) =>
  root.querySelectorAll<HTMLButtonElement>(".ago-feedback__thumb");

/** Let the report's promise chain settle (the row only repaints once it has). */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

describe("widget feedback row", () => {
  it("is off by default", async () => {
    const { root, cleanup } = await mountWithAnswer({});

    expect(root.querySelector(".ago-feedback")).toBeNull();

    cleanup();
  });

  it("sends the thumb as soon as it is clicked", async () => {
    const { root, feedbackSpy, cleanup } = await mountWithAnswer({
      feedback: true,
    });

    const [up, down] = thumbs(root);
    expect(up).toBeDefined();
    expect(down).toBeDefined();

    up.click();
    await Promise.resolve();

    expect(feedbackSpy).toHaveBeenCalledWith("assistant-1", "positive", undefined);
    expect(up.getAttribute("aria-pressed")).toBe("true");

    cleanup();
  });

  it("asks what went wrong after a thumbs-down, then files the detailed report", async () => {
    const onSubmit = vi.fn();
    const { root, feedbackSpy, cleanup } = await mountWithAnswer({
      feedback: { onSubmit },
    });

    const [, down] = thumbs(root);
    down.click();
    await Promise.resolve();

    // The thumb goes out on its own, so the signal survives an ignored panel.
    expect(feedbackSpy).toHaveBeenCalledWith("assistant-1", "negative", undefined);

    const panel = root.querySelector(".ago-feedback__panel");
    expect(panel).not.toBeNull();

    const reasons = root.querySelectorAll<HTMLButtonElement>(
      ".ago-feedback__reason",
    );
    expect(reasons).toHaveLength(4);
    reasons[0].click();
    expect(reasons[0].getAttribute("aria-pressed")).toBe("true");

    const comment = root.querySelector<HTMLTextAreaElement>(
      ".ago-feedback__comment",
    )!;
    comment.value = "The price is from last year.";
    comment.dispatchEvent(new Event("input"));

    root.querySelector<HTMLButtonElement>(".ago-feedback__send")!.click();
    await flush();

    expect(feedbackSpy).toHaveBeenLastCalledWith("assistant-1", "negative", {
      reasons: ["inaccurate"],
      comment: "The price is from last year.",
    });
    expect(onSubmit).toHaveBeenCalledWith({
      messageId: "assistant-1",
      rating: "negative",
      reasons: ["inaccurate"],
      comment: "The price is from last year.",
    });
    // The panel gives way to the confirmation.
    expect(root.querySelector(".ago-feedback__panel")).toBeNull();
    expect(root.querySelector(".ago-feedback__thanks")).not.toBeNull();

    cleanup();
  });

  it("will not send an empty report", async () => {
    const { root, feedbackSpy, cleanup } = await mountWithAnswer({
      feedback: true,
    });

    thumbs(root)[1].click();
    await Promise.resolve();
    expect(feedbackSpy).toHaveBeenCalledTimes(1);

    const send = root.querySelector<HTMLButtonElement>(".ago-feedback__send")!;
    expect(send.disabled).toBe(true);
    send.click();
    await Promise.resolve();

    // Still just the thumb: no second call, and no premature "thanks".
    expect(feedbackSpy).toHaveBeenCalledTimes(1);
    expect(root.querySelector(".ago-feedback__thanks")).toBeNull();

    root.querySelector<HTMLButtonElement>(".ago-feedback__reason")!.click();
    expect(send.disabled).toBe(false);

    cleanup();
  });

  it("collects thumbs only when askWhy is off", async () => {
    const { root, cleanup } = await mountWithAnswer({
      feedback: { askWhy: false },
    });

    thumbs(root)[1].click();
    await Promise.resolve();

    expect(root.querySelector(".ago-feedback__panel")).toBeNull();

    cleanup();
  });

  it("translates every string it shows", async () => {
    const { root, cleanup } = await mountWithAnswer({
      feedback: {
        labels: {
          helpful: "Utile",
          notHelpful: "Pas utile",
          whatWentWrong: "Qu'est-ce qui n'a pas marché ?",
          send: "Envoyer",
          reasons: { inaccurate: "Inexact" },
        },
      },
    });

    const [up, down] = thumbs(root);
    expect(up.getAttribute("aria-label")).toBe("Utile");
    expect(down.getAttribute("aria-label")).toBe("Pas utile");

    down.click();
    await Promise.resolve();

    expect(root.textContent).toContain("Qu'est-ce qui n'a pas marché ?");
    expect(root.textContent).toContain("Inexact");
    expect(root.textContent).toContain("Envoyer");
    // Unset labels keep their English default.
    expect(root.textContent).toContain("Incomplete");

    cleanup();
  });

  it("reports a failure instead of pretending the report went through", async () => {
    const onError = vi.fn();
    const client = new AgoClient({ baseUrl: "https://example.test" });
    vi.spyOn(client, "sendMessage").mockResolvedValue(makeAssistantMessage());
    vi.spyOn(client, "submitFeedback").mockRejectedValue(new Error("boom"));

    const root = document.createElement("div");
    document.body.appendChild(root);
    const widget = mountChatWidget(root, { client, feedback: { onError } });
    await widget.sendMessage("hello");

    thumbs(root)[0].click();
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(expect.any(Error));

    widget.destroy();
    root.remove();
    client.destroy();
  });

  it("keeps the panel and the typed text when the report fails", async () => {
    const onError = vi.fn();
    const client = new AgoClient({ baseUrl: "https://example.test" });
    vi.spyOn(client, "sendMessage").mockResolvedValue(makeAssistantMessage());
    const feedbackSpy = vi
      .spyOn(client, "submitFeedback")
      .mockResolvedValueOnce(undefined) // the thumb goes through
      .mockRejectedValue(new Error("boom")); // the detailed report does not

    const root = document.createElement("div");
    document.body.appendChild(root);
    const widget = mountChatWidget(root, { client, feedback: { onError } });
    await widget.sendMessage("hello");

    thumbs(root)[1].click();
    await flush();

    root.querySelector<HTMLButtonElement>(".ago-feedback__reason")!.click();
    const comment = root.querySelector<HTMLTextAreaElement>(
      ".ago-feedback__comment",
    )!;
    comment.value = "The price is from last year.";
    comment.dispatchEvent(new Event("input"));

    root.querySelector<HTMLButtonElement>(".ago-feedback__send")!.click();
    await flush();

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    // No "thanks" for a report that never landed: the panel stays, text and all,
    // and Send is live again so the user can retry.
    expect(root.querySelector(".ago-feedback__thanks")).toBeNull();
    expect(root.querySelector(".ago-feedback__panel")).not.toBeNull();
    expect(
      root.querySelector<HTMLTextAreaElement>(".ago-feedback__comment")!.value,
    ).toBe("The price is from last year.");
    const send = root.querySelector<HTMLButtonElement>(".ago-feedback__send")!;
    expect(send.disabled).toBe(false);

    send.click();
    await flush();
    expect(feedbackSpy).toHaveBeenCalledTimes(3);

    widget.destroy();
    root.remove();
    client.destroy();
  });

  it("shows no row on an answer that cannot be reported", async () => {
    // A streaming answer has nothing to judge yet...
    const streaming = await mountWithAnswer(
      { feedback: true },
      makeAssistantMessage({ status: "IN_PROGRESS", content: "" }),
    );
    expect(streaming.root.querySelector(".ago-feedback")).toBeNull();
    streaming.cleanup();

    // ...and a local greeting has no server-side message behind it.
    const local = await mountWithAnswer(
      { feedback: true },
      makeAssistantMessage({ conversationId: "" }),
    );
    expect(local.root.querySelector(".ago-feedback")).toBeNull();
    local.cleanup();
  });

  it("keeps an open panel and its half-typed comment across a re-render", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    let turn = 0;
    vi.spyOn(client, "sendMessage").mockImplementation(async () => {
      turn += 1;
      return makeAssistantMessage({ id: `assistant-${turn}` });
    });
    vi.spyOn(client, "submitFeedback").mockResolvedValue(undefined);

    const root = document.createElement("div");
    document.body.appendChild(root);
    const widget = mountChatWidget(root, { client, feedback: true });
    await widget.sendMessage("hello");

    thumbs(root)[1].click();
    await Promise.resolve();
    const comment = root.querySelector<HTMLTextAreaElement>(
      ".ago-feedback__comment",
    )!;
    comment.value = "half a thought";
    comment.dispatchEvent(new Event("input"));

    // The next turn rebuilds every bubble, including the one being reported.
    await widget.sendMessage("and another thing");

    const panels = root.querySelectorAll(".ago-feedback__panel");
    expect(panels).toHaveLength(1);
    expect(
      root.querySelector<HTMLTextAreaElement>(".ago-feedback__comment")!.value,
    ).toBe("half a thought");
    // The thumb the user picked survives too.
    expect(thumbs(root)[1].getAttribute("aria-pressed")).toBe("true");

    widget.destroy();
    root.remove();
    client.destroy();
  });
});
