/**
 * Tiny, dependency-free markdown → DOM renderer for the vanilla chat widget.
 *
 * The React widget renders GitHub-flavored markdown via `react-markdown` +
 * `remark-gfm`; bundling those into the framework-agnostic widget would defeat
 * its "no dependencies" promise, so this is a hand-rolled subset that mirrors
 * the visible styling of `react/components/Markdown.tsx`.
 *
 * Supported: paragraphs (single newline → `<br>`), ATX headings, **bold**,
 * *italic*, ~~strikethrough~~, `inline code`, fenced code blocks, links,
 * images, ordered/unordered (and nested) lists, blockquotes, horizontal rules,
 * and GFM tables.
 *
 * ## Security
 *
 * The widget is embedded into third-party pages, so the agent's message content
 * is untrusted. Every span of message text is HTML-escaped before it reaches the
 * DOM; only a fixed set of safe tags is ever emitted, and `href`/`src` URLs are
 * scheme-validated (see {@link safeUrl}) so `javascript:`/`data:` payloads can't
 * slip through. Callers should append the returned fragment — never feed raw
 * message content to `innerHTML` directly.
 */

const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

/**
 * Allow only schemes that can't execute script. Returns the trimmed URL when it
 * is safe to use as an `href`/`src`, otherwise `null` (the caller then renders
 * the original text inert).
 */
function safeUrl(raw: string): string | null {
  const url = raw.trim();
  // Relative URLs, anchors, and explicit safe schemes only.
  if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(url)) return url;
  // A bare path with no scheme (e.g. "foo/bar") is fine too; reject anything
  // that looks like an unknown scheme ("javascript:", "data:", "vbscript:").
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  return null;
}

const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

// Placeholder delimiter for stashed inline HTML: a Private-Use-Area code
// point that cannot appear in real message text and is not a control
// character (so it doesn't trip eslint's no-control-regex).
const SENTINEL = String.fromCharCode(0xe000);

/**
 * Render inline markdown (bold, italic, strikethrough, code, links, images)
 * to a safe HTML string. Code spans and links/images are stashed as untouched
 * placeholders first so their contents are not re-parsed, then everything else
 * is escaped, formatted, and the placeholders are restored.
 */
function renderInline(text: string): string {
  const stash: string[] = [];
  const keep = (html: string): string => {
    stash.push(html);
    return `${SENTINEL}${stash.length - 1}${SENTINEL}`;
  };

  let s = text;

  // 1. Inline code — raw content, escaped, never further formatted.
  s = s.replace(/`([^`]+)`/g, (_m, code: string) =>
    keep(
      `<code style="background:#f0f2f5;padding:2px 5px;border-radius:4px;font-size:13px;font-family:${MONO}">${escapeHtml(
        code,
      )}</code>`,
    ),
  );

  // 2. Images ![alt](src) — before links so the leading "!" is consumed.
  s = s.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (m, alt: string, src: string) => {
      const url = safeUrl(src);
      if (!url) return m;
      return keep(
        `<img alt="${escapeHtml(alt)}" src="${escapeHtml(
          url,
        )}" style="max-width:100%;border-radius:8px;margin:4px 0" />`,
      );
    },
  );

  // 3. Links [label](url).
  s = s.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (m, label: string, href: string) => {
      const url = safeUrl(href);
      if (!url) return m;
      return keep(
        `<a href="${escapeHtml(
          url,
        )}" target="_blank" rel="noopener noreferrer" style="color:#1b5fc4;text-decoration:underline">${renderInline(
          label,
        )}</a>`,
      );
    },
  );

  // 4. Escape everything that remains (formatting markers survive escaping).
  s = escapeHtml(s);

  // 5. Bold, then strikethrough, then italic.
  s = s
    .replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+?)__/g, "<strong>$1</strong>")
    .replace(/~~([^~]+?)~~/g, "<del>$1</del>")
    .replace(/(^|[^*])\*(?!\s)([^*]+?)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^\w_])_(?!\s)([^_]+?)_/g, "$1<em>$2</em>");

  // 6. Restore the stashed code/link/image HTML.
  s = s.replace(
    new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, "g"),
    (_m, i) => stash[Number(i)],
  );
  return s;
}

/** Create an element, apply inline styles, and set already-safe inner HTML. */
function el(
  tag: string,
  styles: Partial<CSSStyleDeclaration>,
  innerHtml?: string,
): HTMLElement {
  const node = document.createElement(tag);
  Object.assign(node.style, styles);
  if (innerHtml !== undefined) node.innerHTML = innerHtml;
  return node;
}

const HR_RE = /^ {0,3}([-*_])( *\1){2,} *$/;
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE_RE = /^ {0,3}(```+|~~~+)/;
const QUOTE_RE = /^ {0,3}>\s?/;
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const HEADING_SIZES = ["20px", "18px", "16px", "15px", "14px", "13px"];

const indentOf = (line: string): number => line.match(/^\s*/)?.[0].length ?? 0;

/** True when a line begins a non-paragraph block (used to end a paragraph run). */
function startsBlock(line: string): boolean {
  return (
    line.trim() === "" ||
    HR_RE.test(line) ||
    HEADING_RE.test(line) ||
    FENCE_RE.test(line) ||
    QUOTE_RE.test(line) ||
    LIST_RE.test(line)
  );
}

/** Build a `<ul>`/`<ol>` from a slice of list lines, recursing for nested items. */
function renderList(lines: string[]): HTMLElement {
  const first = lines[0].match(LIST_RE)!;
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const list = el(ordered ? "ol" : "ul", {
    margin: "0 0 8px 0",
    paddingLeft: "20px",
    listStyleType: ordered ? "decimal" : "disc",
    listStylePosition: "outside",
  });

  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(LIST_RE)!;
    // Gather this item's own text plus any deeper-indented continuation lines.
    const childLines: string[] = [];
    i++;
    while (i < lines.length && indentOf(lines[i]) > baseIndent) {
      childLines.push(lines[i]);
      i++;
    }

    const li = el("li", {
      display: "list-item",
      margin: "2px 0",
      lineHeight: "1.6",
    });
    // GFM task-list checkbox: "[ ] " / "[x] ".
    const task = m[3].match(/^\[([ xX])\]\s+(.*)$/);
    if (task) {
      li.style.listStyleType = "none";
      li.style.marginLeft = "-20px";
      const mark = task[1].toLowerCase() === "x" ? "☑" : "☐";
      li.innerHTML = `<span style="margin-right:6px">${mark}</span>${renderInline(
        task[2],
      )}`;
    } else {
      li.innerHTML = renderInline(m[3]);
    }

    const nested = childLines.filter((l) => LIST_RE.test(l));
    if (nested.length > 0) {
      // Re-indent nested lines to the child level so the recursion sees a fresh list.
      li.appendChild(renderList(childLines.filter((l) => l.trim() !== "")));
    }
    list.appendChild(li);
  }
  return list;
}

/** Parse a GFM table block (header, delimiter, rows) into a styled `<table>`. */
function renderTable(lines: string[]): HTMLElement {
  const cells = (row: string): string[] =>
    row
      .replace(/^\s*\|?/, "")
      .replace(/\|?\s*$/, "")
      .split("|")
      .map((c) => c.trim());

  const wrapper = el("div", { overflowX: "auto", margin: "0 0 8px 0" });
  const table = el("table", {
    borderCollapse: "collapse",
    width: "100%",
    fontSize: "13px",
  });

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const head of cells(lines[0])) {
    headRow.appendChild(
      el(
        "th",
        {
          border: "1px solid #dee3e8",
          padding: "6px 10px",
          textAlign: "left",
          backgroundColor: "#f5f7fa",
          fontWeight: "600",
        },
        renderInline(head),
      ),
    );
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const line of lines.slice(2)) {
    const row = document.createElement("tr");
    for (const cell of cells(line)) {
      row.appendChild(
        el(
          "td",
          { border: "1px solid #dee3e8", padding: "6px 10px" },
          renderInline(cell),
        ),
      );
    }
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  wrapper.appendChild(table);
  return wrapper;
}

const isTableDelimiter = (line: string | undefined): boolean =>
  !!line && /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line);

/**
 * Parse a markdown string into a {@link DocumentFragment} of safely-built block
 * elements. Append it to the message bubble; do not stringify it back to HTML.
 */
export function renderMarkdown(source: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line.
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code block.
    const fence = line.match(FENCE_RE);
    if (fence) {
      const marker = fence[1][0];
      const body: string[] = [];
      i++;
      while (
        i < lines.length &&
        !new RegExp(`^ {0,3}${marker === "`" ? "`{3,}" : "~{3,}"}\\s*$`).test(
          lines[i],
        )
      ) {
        body.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      const pre = el("pre", { margin: "0 0 8px 0" });
      pre.appendChild(
        el(
          "code",
          {
            display: "block",
            background: "#f5f5f5",
            padding: "8px 12px",
            borderRadius: "6px",
            fontSize: "13px",
            overflowX: "auto",
            fontFamily: MONO,
            whiteSpace: "pre",
          },
          escapeHtml(body.join("\n")),
        ),
      );
      frag.appendChild(pre);
      continue;
    }

    // Horizontal rule.
    if (HR_RE.test(line)) {
      frag.appendChild(
        el("hr", {
          border: "none",
          borderTop: "1px solid #dee3e8",
          margin: "12px 0",
        }),
      );
      i++;
      continue;
    }

    // ATX heading.
    const heading = line.match(HEADING_RE);
    if (heading) {
      const level = heading[1].length;
      frag.appendChild(
        el(
          `h${level}`,
          {
            margin: "16px 0 8px 0",
            fontSize: HEADING_SIZES[level - 1],
            fontWeight: "600",
            lineHeight: "1.3",
          },
          renderInline(heading[2]),
        ),
      );
      i++;
      continue;
    }

    // Blockquote — gather consecutive quoted lines and recurse on the inner text.
    if (QUOTE_RE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        inner.push(lines[i].replace(QUOTE_RE, ""));
        i++;
      }
      const quote = el("blockquote", {
        borderLeft: "4px solid #dee3e8",
        paddingLeft: "12px",
        margin: "0 0 8px 0",
        fontStyle: "italic",
        color: "#6b6d6f",
      });
      quote.appendChild(renderMarkdown(inner.join("\n")));
      frag.appendChild(quote);
      continue;
    }

    // GFM table — header row followed by a delimiter row.
    if (line.includes("|") && isTableDelimiter(lines[i + 1])) {
      const tableLines: string[] = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        tableLines.push(lines[i]);
        i++;
      }
      frag.appendChild(renderTable(tableLines));
      continue;
    }

    // List — gather items plus their indented continuations.
    if (LIST_RE.test(line)) {
      const listLines: string[] = [];
      const baseIndent = indentOf(line);
      while (i < lines.length) {
        if (lines[i].trim() === "") break;
        if (LIST_RE.test(lines[i]) || indentOf(lines[i]) > baseIndent) {
          listLines.push(lines[i]);
          i++;
        } else {
          break;
        }
      }
      frag.appendChild(renderList(listLines));
      continue;
    }

    // Paragraph — gather until a blank line or the start of another block.
    const para: string[] = [line];
    i++;
    while (i < lines.length && !startsBlock(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    frag.appendChild(
      el(
        "p",
        { margin: "0 0 8px 0", lineHeight: "1.6" },
        para.map((l) => renderInline(l)).join("<br>"),
      ),
    );
  }

  // Trim the trailing bottom margin so the bubble doesn't gain stray space.
  const last = frag.lastElementChild as HTMLElement | null;
  if (last) last.style.marginBottom = "0";

  return frag;
}
