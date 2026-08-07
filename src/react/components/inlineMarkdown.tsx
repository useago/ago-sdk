import React from "react";

// `**bold**`, `*italic*` / `_italic_`, `` `code` ``. One capture group per form,
// so `split` keeps the delimiters and every other piece is a match.
const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|_[^_\n]+_)/g;

/**
 * Render the small subset of Markdown that makes sense on a single status line.
 *
 * The full {@link Markdown} component emits block elements (paragraphs with
 * margins, headings, tables), which would break a one-line pill. This keeps
 * everything inline and does not inject any CSS. Anything it does not
 * recognise, including HTML, stays literal text: React escapes it.
 */
export function renderInlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(INLINE);
  if (parts.length === 1) return text;

  return parts.map((part, i) => {
    // Odd indices are the captured delimiters; even ones are plain text.
    if (i % 2 === 0 || !part) return part;

    if (part.startsWith("`")) {
      return (
        <code
          key={i}
          style={{
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: "0.92em",
            padding: "0 3px",
            borderRadius: "3px",
            backgroundColor: "rgba(0, 0, 0, 0.06)",
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**")) {
      return (
        <strong key={i} style={{ fontWeight: 600 }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <em key={i}>{part.slice(1, -1)}</em>;
  });
}
