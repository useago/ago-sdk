import { describe, expect, it, vi } from "vitest";
import type { AgoMessage } from "../src/client/types";
import { renderEmbedMessage } from "../src/widget/renderEmbedMessage";

const labels = {
  errorTitle: "Something went wrong",
  errorDescription: "Please try again.",
};

function msg(overrides: Partial<AgoMessage> = {}): AgoMessage {
  return {
    id: "m-1",
    conversationId: "c-1",
    content: "Hello **world**",
    role: "assistant",
    status: "DONE",
    createdAt: new Date(0),
    ...overrides,
  };
}

function render(
  message: AgoMessage,
  extra: Partial<Parameters<typeof renderEmbedMessage>[1]> = {},
): HTMLElement {
  return renderEmbedMessage(message, {
    isLast: true,
    followUpEnabled: true,
    agentRowTinted: false,
    agentRowTextTinted: false,
    labels,
    ...extra,
  });
}

describe("renderEmbedMessage: user", () => {
  it("renders a right-aligned 70% card with raw text and line breaks", () => {
    const node = render(msg({ role: "user", content: "line one\nline **two**" }));
    expect(node.className).toContain("ago-message--user");
    const row = node.firstElementChild as HTMLElement;
    expect(row.style.justifyContent).toBe("flex-end");
    const card = node.querySelector<HTMLElement>(".ago-message__content")!;
    expect(card.style.maxWidth).toBe("70%");
    expect(card.style.borderRadius).toBe("16px");
    expect(card.textContent).toBe("line one\nline **two**");
    expect(card.querySelector("strong")).toBeNull();
  });

  it("renders a safe image inline and other files as download links", () => {
    const node = render(
      msg({
        role: "user",
        content: "see attached",
        attachments: [
          {
            id: "a1",
            name: "photo.png",
            contentType: "image/png",
            fileSize: 2048,
            url: "https://cdn.example.test/photo.png",
            isSafeImage: true,
          },
          {
            id: "a2",
            name: "report.pdf",
            contentType: "application/pdf",
            fileSize: 4096,
            url: "https://cdn.example.test/report.pdf",
            isSafeImage: false,
          },
        ],
      }),
    );
    const img = node.querySelector("img")!;
    expect(img.style.height).toBe("128px");
    const links = node.querySelectorAll("a");
    expect(links).toHaveLength(2);
    expect(links[1].textContent).toContain("report.pdf");
    expect(links[1].textContent).toContain("KB");
    expect(links[1].target).toBe("_blank");
  });
});

describe("renderEmbedMessage: assistant", () => {
  it("shows the spinner and a skeleton before the first token, no thumbs", () => {
    const actions = document.createElement("div");
    actions.className = "ago-feedback";
    const node = render(
      msg({ status: "IN_PROGRESS", content: "" }),
      { actionsRow: actions },
    );
    expect(node.querySelector(".ago-message__spinner")).not.toBeNull();
    expect(node.querySelector(".ago-message__skeleton")).not.toBeNull();
    expect(node.querySelector(".ago-feedback")).toBeNull();
  });

  it("renders markdown, the thumbs row and follow-ups on the last finished answer", () => {
    const actions = document.createElement("div");
    actions.className = "ago-feedback";
    const onFollowUp = vi.fn();
    const node = render(
      msg({ followUpReplies: ["More?", "Thanks"] }),
      { actionsRow: actions, followUpHandler: onFollowUp },
    );
    expect(node.querySelector(".ago-message__markdown strong")!.textContent).toBe(
      "world",
    );
    expect(node.querySelector(".ago-feedback")).not.toBeNull();
    const chips = node.querySelectorAll<HTMLButtonElement>(".ago-message__followup-btn");
    expect(chips).toHaveLength(2);
    expect(chips[0].style.borderRadius).toBe("12px");
    chips[1].click();
    expect(onFollowUp).toHaveBeenCalledWith("Thanks");
  });

  it("hides follow-ups on an earlier message", () => {
    const node = render(msg({ followUpReplies: ["More?"] }), { isLast: false });
    expect(node.querySelector(".ago-message__followups")).toBeNull();
  });

  it("renders sources as a two-column grid of numbered cards", () => {
    const node = render(
      msg({
        sources: [
          { id: "s1", title: "Pricing page", url: "https://example.test/pricing" },
          { id: "s2", title: "FAQ" },
        ],
      }),
    );
    const grid = node.querySelector<HTMLElement>(".ago-message__sources")!;
    expect(grid.style.gridTemplateColumns).toBe("1fr 1fr");
    const cards = grid.children;
    expect(cards).toHaveLength(2);
    expect(cards[0].tagName).toBe("A");
    expect((cards[0] as HTMLAnchorElement).target).toBe("_blank");
    expect(cards[0].textContent).toContain("1");
    expect(cards[1].tagName).toBe("DIV");
    expect(cards[1].textContent).toContain("2");
  });

  it("renders a destructive alert on ERROR instead of the content", () => {
    const node = render(msg({ status: "ERROR", content: "partial" }));
    const alert = node.querySelector<HTMLElement>(".ago-message__error")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain(labels.errorTitle);
    expect(alert.textContent).toContain(labels.errorDescription);
    expect(node.querySelector(".ago-message__markdown")).toBeNull();
  });

  it("inserts tool-call nodes between the sources and the answer", () => {
    const renderToolCall = vi.fn((call) => {
      const el = document.createElement("div");
      el.className = "ago-toolcall-stub";
      el.textContent = call.id;
      return el;
    });
    const node = render(
      msg({
        sources: [{ id: "s1", title: "Doc" }],
        toolCalls: [
          { id: "tc-1", type: "form", status: "waiting_input", toolName: "x" },
          { id: "tc-2", type: "status_message", status: "done", toolName: "y" },
        ],
      }),
      { renderToolCall },
    );
    expect(renderToolCall).toHaveBeenCalledTimes(2);
    const body = node.querySelector<HTMLElement>(".ago-message__body")!;
    const order = Array.from(body.children).map((c) => c.className);
    expect(order.indexOf("ago-message__sources")).toBeLessThan(
      order.indexOf("ago-toolcall-stub"),
    );
    expect(order.lastIndexOf("ago-toolcall-stub")).toBeLessThan(
      order.findIndex((c) => c.includes("ago-message__markdown")),
    );
  });

  it("tints the row only when the host set agent colors", () => {
    const plain = render(msg());
    expect(
      plain.querySelector<HTMLElement>(".ago-message__row")!.style.backgroundColor,
    ).toBe("");
    const tinted = render(msg(), { agentRowTinted: true, agentRowTextTinted: true });
    const row = tinted.querySelector<HTMLElement>(".ago-message__row")!;
    expect(row.style.backgroundColor).toContain("--ago-agent-bubble-background");
    expect(row.style.color).toContain("--ago-agent-bubble-text-color");
  });
});
