import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../src/widget/renderMarkdown";

/** Render markdown and return the resulting HTML string for assertions. */
function html(md: string): string {
  const host = document.createElement("div");
  host.appendChild(renderMarkdown(md));
  return host.innerHTML;
}

describe("renderMarkdown", () => {
  describe("inline formatting", () => {
    it("renders bold (** and __)", () => {
      expect(html("**bold**")).toContain("<strong>bold</strong>");
      expect(html("__bold__")).toContain("<strong>bold</strong>");
    });

    it("renders italic (* and _)", () => {
      expect(html("an *italic* word")).toContain("<em>italic</em>");
      expect(html("an _italic_ word")).toContain("<em>italic</em>");
    });

    it("renders strikethrough", () => {
      expect(html("~~gone~~")).toContain("<del>gone</del>");
    });

    it("renders inline code without further formatting", () => {
      const out = html("use `**not bold**` here");
      expect(out).toContain("<code");
      expect(out).toContain("**not bold**");
      expect(out).not.toContain("<strong>");
    });

    it("does not treat intra-word underscores as italic", () => {
      expect(html("some_long_name")).toContain("some_long_name");
      expect(html("some_long_name")).not.toContain("<em>");
    });
  });

  describe("links and images", () => {
    it("renders a link opening in a new tab", () => {
      const out = html("[AGO](https://useago.com)");
      expect(out).toContain('href="https://useago.com"');
      expect(out).toContain('target="_blank"');
      expect(out).toContain('rel="noopener noreferrer"');
      expect(out).toContain(">AGO</a>");
    });

    it("renders an image with a safe src", () => {
      const out = html("![logo](https://useago.com/logo.png)");
      expect(out).toContain('<img alt="logo"');
      expect(out).toContain('src="https://useago.com/logo.png"');
    });

    it("strips javascript: links, keeping the label as text", () => {
      const out = html("[click](javascript:alert(1))");
      // No anchor element and, crucially, no executable href attribute.
      expect(out).not.toContain("<a ");
      expect(out).not.toContain('href="javascript:');
      expect(out).toContain("click");
    });

    it("strips data: image sources", () => {
      const out = html("![x](data:text/html,<script>alert(1)</script>)");
      expect(out).not.toContain("<img");
      expect(out).not.toContain('src="data:');
      // The raw <script> in the (rejected) src is still escaped to inert text.
      expect(out).not.toContain("<script>");
    });
  });

  describe("blocks", () => {
    it("renders headings h1–h6", () => {
      expect(html("# Title")).toContain("<h1");
      expect(html("###### Small")).toContain("<h6");
      expect(html("# Title")).toContain(">Title</h1>");
    });

    it("renders an unordered list", () => {
      const out = html("- one\n- two");
      expect(out).toContain("<ul");
      expect(out).toContain("<li");
      expect(out).toContain(">one</li>");
      expect(out).toContain(">two</li>");
    });

    it("renders an ordered list", () => {
      const out = html("1. first\n2. second");
      expect(out).toContain("<ol");
      expect(out).toContain("first");
      expect(out).toContain("second");
    });

    it("renders nested lists", () => {
      const out = html("- parent\n  - child");
      expect(out).toContain("child");
      // The nested <ul> lives inside an <li>.
      expect(out).toMatch(/<li[^>]*>[\s\S]*<ul/);
    });

    it("renders a fenced code block, escaping its contents", () => {
      const out = html("```\n<script>alert(1)</script>\n```");
      expect(out).toContain("<pre");
      expect(out).toContain("&lt;script&gt;");
      expect(out).not.toContain("<script>");
    });

    it("renders a blockquote", () => {
      const out = html("> quoted");
      expect(out).toContain("<blockquote");
      expect(out).toContain("quoted");
    });

    it("renders a horizontal rule", () => {
      expect(html("---")).toContain("<hr");
    });

    it("renders a GFM table", () => {
      const out = html("| a | b |\n| - | - |\n| 1 | 2 |");
      expect(out).toContain("<table");
      expect(out).toContain("<th");
      expect(out).toContain("<td");
      expect(out).toContain(">a</th>");
      expect(out).toContain(">1</td>");
    });

    it("keeps single newlines inside a paragraph as <br>", () => {
      const out = html("line one\nline two");
      expect(out).toContain("line one<br>line two");
    });

    it("separates paragraphs split by a blank line", () => {
      const out = html("para one\n\npara two");
      expect(out.match(/<p/g)?.length).toBe(2);
    });
  });

  describe("security", () => {
    it("escapes raw HTML in message text", () => {
      const out = html("<img src=x onerror=alert(1)>");
      expect(out).not.toContain("<img src=x");
      expect(out).toContain("&lt;img");
    });

    it("escapes HTML inside link labels", () => {
      const out = html("[<b>x</b>](https://useago.com)");
      expect(out).not.toContain("<b>x</b>");
      expect(out).toContain("&lt;b&gt;");
    });

    it("escapes ampersands", () => {
      // (Quotes in text context are re-serialized as bare `"` by the DOM, which
      // is safe; quote-escaping only matters inside attributes — covered above.)
      expect(html("Tom & Jerry")).toContain("&amp;");
    });

    it("escapes quotes inside link hrefs", () => {
      const out = html('[x](https://useago.com/?q="a")');
      expect(out).not.toContain('href="https://useago.com/?q="a"');
    });
  });

  it("returns an empty fragment for empty input", () => {
    expect(html("")).toBe("");
  });
});
