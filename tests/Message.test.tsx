import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { Message } from "../src/react/components/Message";
import type { AgoMessage } from "../src/client/types";

// React's act() requires this flag outside of @testing-library.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeMessage(overrides: Partial<AgoMessage> = {}): AgoMessage {
  return {
    id: "m1",
    conversationId: "c1",
    content: "",
    role: "assistant",
    status: "DONE",
    createdAt: new Date(0),
    ...overrides,
  };
}

describe("Message markdown rendering", () => {
  it("renders bold and italic markdown", () => {
    const html = renderToStaticMarkup(
      <Message message={makeMessage({ content: "**bold** and *italic*" })} />,
    );
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("renders links with target=_blank", () => {
    const html = renderToStaticMarkup(
      <Message message={makeMessage({ content: "[AGO](https://useago.com)" })} />,
    );
    expect(html).toContain('href="https://useago.com"');
    expect(html).toContain('target="_blank"');
  });

  it("renders GFM tables via remark-gfm", () => {
    const content = ["| A | B |", "| - | - |", "| 1 | 2 |"].join("\n");
    const html = renderToStaticMarkup(
      <Message message={makeMessage({ content })} />,
    );
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("<td");
  });

  it("renders GFM strikethrough", () => {
    const html = renderToStaticMarkup(
      <Message message={makeMessage({ content: "~~gone~~" })} />,
    );
    expect(html).toContain("<del>gone</del>");
  });

  it("renders headings and lists", () => {
    const content = ["# Title", "", "- one", "- two"].join("\n");
    const html = renderToStaticMarkup(
      <Message message={makeMessage({ content })} />,
    );
    expect(html).toContain("<h1");
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
  });

  it("renders an unordered list with one <li> per item", () => {
    const content = ["- apples", "- bananas", "- cherries"].join("\n");
    const html = renderToStaticMarkup(
      <Message message={makeMessage({ content })} />,
    );
    expect(html).toContain("<ul");
    expect(html).toContain("list-style-type:disc");
    expect(html).toContain("display:list-item");
    expect(html.match(/<li/g) ?? []).toHaveLength(3);
    expect(html).toContain("apples");
    expect(html).toContain("bananas");
    expect(html).toContain("cherries");
  });

  it("keeps bullet markers visible for widget answers with multiple sections", () => {
    const content = [
      "Hello! AGO helps teams deploy AI agents for customer support, internal support, and pre-sales directly inside their product or website.",
      "",
      "A few things AGO is strong at:",
      "- In-product AI chat via widget or SDK",
      "- Smart ticketing with escalation to Zendesk, Intercom, Help Scout, and others",
      "- Custom integrations and client-side functions",
      "- AI-ready documentation and knowledge connectors",
      "- 24/7 multilingual support",
      "",
      "If useful, I can help with:",
      "- pricing",
      "- integrations",
      "- SDK/widget setup",
      "- use cases like support, internal ops, or pre-sales",
    ].join("\n");
    const html = renderToStaticMarkup(
      <Message message={makeMessage({ content })} />,
    );

    expect(html.match(/<ul/g) ?? []).toHaveLength(2);
    expect(html.match(/<li/g) ?? []).toHaveLength(9);
    expect(html).toContain("list-style-type:disc");
    expect(html).toContain("list-style-position:outside");
    expect(html).toContain("In-product AI chat via widget or SDK");
    expect(html).toContain("use cases like support, internal ops, or pre-sales");
  });

  it("renders an ordered list as <ol>", () => {
    const content = ["1. first", "2. second"].join("\n");
    const html = renderToStaticMarkup(
      <Message message={makeMessage({ content })} />,
    );
    expect(html).toContain("<ol");
    expect(html).toContain("list-style-type:decimal");
    expect(html).not.toContain("<ul");
    expect(html.match(/<li/g) ?? []).toHaveLength(2);
  });

  it("renders nested lists", () => {
    const content = ["- parent", "  - child", "  - child two"].join("\n");
    const html = renderToStaticMarkup(
      <Message message={makeMessage({ content })} />,
    );
    // Outer list plus the nested list -> at least two <ul> openings.
    expect((html.match(/<ul/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("parent");
    expect(html).toContain("child two");
  });

  it("renders GFM task lists as checkboxes", () => {
    const content = ["- [x] done", "- [ ] todo"].join("\n");
    const html = renderToStaticMarkup(
      <Message message={makeMessage({ content })} />,
    );
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
    expect(html).toContain("done");
    expect(html).toContain("todo");
  });
});

describe("Message agent name visibility", () => {
  const withAgent = makeMessage({
    content: "hello",
    agent: { id: "a1", name: "Support", displayName: "Support Bot" },
  });

  it("hides the agent name by default", () => {
    const html = renderToStaticMarkup(<Message message={withAgent} />);
    expect(html).not.toContain("Support Bot");
    // Message content should still render.
    expect(html).toContain("hello");
  });

  it("shows the agent display name when showAgentName is true", () => {
    const html = renderToStaticMarkup(
      <Message message={withAgent} showAgentName />,
    );
    expect(html).toContain("Support Bot");
  });
});

describe("Message follow-up replies", () => {
  const withReplies = makeMessage({
    content: "How can I help?",
    followUpReplies: ["Pricing", "Book a demo"],
  });

  it("renders a button per follow-up reply", () => {
    const html = renderToStaticMarkup(<Message message={withReplies} isLast />);
    expect(html).toContain("Pricing");
    expect(html).toContain("Book a demo");
    expect((html.match(/ago-message__followup-btn/g) ?? []).length).toBe(2);
  });

  it("hides follow-up replies by default when not the last message", () => {
    const html = renderToStaticMarkup(<Message message={withReplies} />);
    expect(html).not.toContain("ago-message__followup-btn");
    expect(html).not.toContain("Book a demo");
  });

  it("disables the buttons when no onFollowUpClick is provided", () => {
    const html = renderToStaticMarkup(<Message message={withReplies} isLast />);
    expect((html.match(/disabled/g) ?? []).length).toBe(2);
  });

  it("calls onFollowUpClick with the reply text when a button is clicked", async () => {
    const clicked: string[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <Message
          message={withReplies}
          isLast
          onFollowUpClick={(reply) => clicked.push(reply)}
        />,
      );
    });

    const buttons = container.querySelectorAll<HTMLButtonElement>(
      ".ago-message__followup-btn",
    );
    expect(buttons).toHaveLength(2);
    expect(buttons[0].disabled).toBe(false);

    await act(async () => {
      buttons[1].click();
    });
    expect(clicked).toEqual(["Book a demo"]);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

describe("Message attachments", () => {
  it("embeds a backend-verified safe image inline as an <img>", () => {
    const html = renderToStaticMarkup(
      <Message
        message={makeMessage({
          role: "user",
          attachments: [
            {
              id: "a1",
              name: "photo.png",
              contentType: "image/png",
              fileSize: 2048,
              url: "https://files.example.com/photo.png?sig=abc",
              isSafeImage: true,
            },
          ],
        })}
      />,
    );
    expect(html).toContain("<img");
    expect(html).toContain('src="https://files.example.com/photo.png?sig=abc"');
    expect(html).toContain('alt="photo.png"');
  });

  it("renders a download link (not an <img>) for an unverified image", () => {
    const html = renderToStaticMarkup(
      <Message
        message={makeMessage({
          role: "user",
          attachments: [
            {
              id: "a1",
              name: "photo.png",
              contentType: "image/png",
              fileSize: 2048,
              url: "https://files.example.com/photo.png",
              isSafeImage: false,
            },
          ],
        })}
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain('href="https://files.example.com/photo.png"');
    expect(html).toContain("photo.png");
  });

  it("renders a download link for a non-image file", () => {
    const html = renderToStaticMarkup(
      <Message
        message={makeMessage({
          role: "user",
          attachments: [
            {
              id: "a1",
              name: "report.pdf",
              contentType: "application/pdf",
              fileSize: 1024 * 1024,
              url: "https://files.example.com/report.pdf",
              isSafeImage: false,
            },
          ],
        })}
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("report.pdf");
    expect(html).toContain("1.0 MB");
  });

  it("does not render an empty bubble for an attachment-only message", () => {
    const html = renderToStaticMarkup(
      <Message
        message={makeMessage({
          role: "user",
          content: "",
          attachments: [
            {
              id: "a1",
              name: "photo.png",
              contentType: "image/png",
              url: "https://files.example.com/photo.png?sig=abc",
              isSafeImage: true,
            },
          ],
        })}
      />,
    );
    expect(html).not.toContain("ago-message__content");
    expect(html).toContain("ago-message__attachments");
  });
});
