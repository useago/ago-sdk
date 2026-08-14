import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { AgoClient } from "../src/client/AgoClient";
import { AgoProvider } from "../src/react/context/AgoContext";
import { MessageFeedback } from "../src/react/components/MessageFeedback";

// React's act() requires this flag outside of @testing-library.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(ui: React.ReactElement, client: AgoClient) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<AgoProvider client={client}>{ui}</AgoProvider>);
  });
  return {
    container,
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
      client.destroy();
    },
  };
}

const thumbs = (container: HTMLElement) =>
  container.querySelectorAll<HTMLButtonElement>(".ago-feedback__thumb");

describe("MessageFeedback", () => {
  it("sends the thumb as soon as it is clicked", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const spy = vi.spyOn(client, "submitFeedback").mockResolvedValue(undefined);

    const { container, cleanup } = await mount(
      <MessageFeedback messageId="m1" />,
      client,
    );

    await act(async () => {
      thumbs(container)[0].click();
    });

    expect(spy).toHaveBeenCalledWith("m1", "positive", undefined);
    expect(thumbs(container)[0].getAttribute("aria-pressed")).toBe("true");
    // A thumbs-up asks no questions.
    expect(container.querySelector(".ago-feedback__panel")).toBeNull();

    await cleanup();
  });

  it("asks what went wrong after a thumbs-down, then files the detailed report", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const spy = vi.spyOn(client, "submitFeedback").mockResolvedValue(undefined);
    const onSubmit = vi.fn();

    const { container, cleanup } = await mount(
      <MessageFeedback messageId="m1" onSubmit={onSubmit} />,
      client,
    );

    await act(async () => {
      thumbs(container)[1].click();
    });
    expect(spy).toHaveBeenCalledWith("m1", "negative", undefined);
    expect(container.querySelector(".ago-feedback__panel")).not.toBeNull();

    const reasons = container.querySelectorAll<HTMLButtonElement>(
      ".ago-feedback__reason",
    );
    expect(reasons).toHaveLength(4);
    await act(async () => {
      reasons[3].click();
    });

    const comment = container.querySelector<HTMLTextAreaElement>(
      ".ago-feedback__comment",
    )!;
    await act(async () => {
      // React tracks the value setter, so set it the way the DOM would.
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(comment, "The widget froze.");
      comment.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".ago-feedback__send")!.click();
    });

    expect(spy).toHaveBeenLastCalledWith("m1", "negative", {
      reasons: ["technical_issue"],
      comment: "The widget froze.",
    });
    expect(onSubmit).toHaveBeenCalledWith({
      messageId: "m1",
      rating: "negative",
      reasons: ["technical_issue"],
      comment: "The widget froze.",
    });
    expect(container.querySelector(".ago-feedback__panel")).toBeNull();
    expect(container.querySelector(".ago-feedback__thanks")).not.toBeNull();

    await cleanup();
  });

  it("will not send an empty report", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const spy = vi.spyOn(client, "submitFeedback").mockResolvedValue(undefined);

    const { container, cleanup } = await mount(
      <MessageFeedback messageId="m1" />,
      client,
    );

    await act(async () => {
      thumbs(container)[1].click();
    });
    expect(spy).toHaveBeenCalledTimes(1);

    const send = container.querySelector<HTMLButtonElement>(
      ".ago-feedback__send",
    )!;
    expect(send.disabled).toBe(true);
    await act(async () => {
      send.click();
    });

    // Still just the thumb: no second call, and no premature "thanks".
    expect(spy).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".ago-feedback__thanks")).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".ago-feedback__reason")!.click();
    });
    expect(
      container.querySelector<HTMLButtonElement>(".ago-feedback__send")!.disabled,
    ).toBe(false);

    await cleanup();
  });

  it("shows the last thumb clicked, not the last response to land", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const resolvers: Array<() => void> = [];
    vi.spyOn(client, "submitFeedback").mockImplementation(
      () => new Promise<void>((resolve) => resolvers.push(resolve)),
    );

    const { container, cleanup } = await mount(
      <MessageFeedback messageId="m1" askWhy={false} />,
      client,
    );

    // Both clicks are in flight; the first one answers last.
    await act(async () => {
      thumbs(container)[1].click();
    });
    await act(async () => {
      thumbs(container)[0].click();
    });
    await act(async () => {
      resolvers[1]();
      resolvers[0]();
    });

    const [up, down] = thumbs(container);
    expect(up.getAttribute("aria-pressed")).toBe("true");
    expect(down.getAttribute("aria-pressed")).toBe("false");

    await cleanup();
  });

  it("keeps the panel and the typed text when the report fails", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    vi.spyOn(client, "submitFeedback")
      .mockResolvedValueOnce(undefined) // the thumb goes through
      .mockRejectedValue(new Error("boom")); // the detailed report does not
    const onError = vi.fn();

    const { container, cleanup } = await mount(
      <MessageFeedback messageId="m1" onError={onError} />,
      client,
    );

    await act(async () => {
      thumbs(container)[1].click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".ago-feedback__reason")!.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".ago-feedback__send")!.click();
    });

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    // No "thanks" for a report that never landed: the panel stays so the user
    // can retry without retyping.
    expect(container.querySelector(".ago-feedback__thanks")).toBeNull();
    expect(container.querySelector(".ago-feedback__panel")).not.toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>(".ago-feedback__send")!.disabled,
    ).toBe(false);

    await cleanup();
  });

  it("translates every string it shows", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    vi.spyOn(client, "submitFeedback").mockResolvedValue(undefined);

    const { container, cleanup } = await mount(
      <MessageFeedback
        messageId="m1"
        labels={{
          notHelpful: "Pas utile",
          whatWentWrong: "Qu'est-ce qui n'a pas marché ?",
          reasons: { inaccurate: "Inexact" },
        }}
      />,
      client,
    );

    expect(thumbs(container)[1].getAttribute("aria-label")).toBe("Pas utile");

    await act(async () => {
      thumbs(container)[1].click();
    });

    expect(container.textContent).toContain("Qu'est-ce qui n'a pas marché ?");
    expect(container.textContent).toContain("Inexact");
    // Unset labels keep their English default.
    expect(container.textContent).toContain("Incomplete");

    await cleanup();
  });

  it("reports a failure instead of pretending the report went through", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    vi.spyOn(client, "submitFeedback").mockRejectedValue(new Error("boom"));
    const onError = vi.fn();

    const { container, cleanup } = await mount(
      <MessageFeedback messageId="m1" onError={onError} />,
      client,
    );

    await act(async () => {
      thumbs(container)[0].click();
    });

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    // Nothing was recorded, so the thumb does not light up.
    expect(thumbs(container)[0].getAttribute("aria-pressed")).toBe("false");

    await cleanup();
  });
});
