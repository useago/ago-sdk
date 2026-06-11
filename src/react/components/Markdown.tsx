import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ── Markdown renderers ──────────────────────────────────────────────
// Lightweight, dependency-minimal counterpart to the main app's
// `ImprovedMarkdown`. We rely on `remark-gfm` for tables, task lists,
// strikethrough and autolinks, and provide inline-styled element
// renderers so the SDK stays free of external CSS.

const MarkdownLink: React.FC<React.AnchorHTMLAttributes<HTMLAnchorElement>> = ({
  href,
  children,
  ...props
}) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    style={{ color: "#1b5fc4", textDecoration: "underline" }}
    {...props}
  >
    {children}
  </a>
);

const MarkdownParagraph: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({
  children,
  ...props
}) => (
  <p style={{ margin: "0 0 8px 0", lineHeight: "1.6" }} {...props}>
    {children}
  </p>
);

const makeHeading = (
  level: 1 | 2 | 3 | 4 | 5 | 6,
  fontSize: string,
): React.FC<React.HTMLAttributes<HTMLHeadingElement>> => {
  const Heading: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({
    children,
    ...props
  }) =>
    React.createElement(
      `h${level}`,
      {
        style: {
          margin: "16px 0 8px 0",
          fontSize,
          fontWeight: 600,
          lineHeight: "1.3",
        },
        ...props,
      },
      children,
    );
  Heading.displayName = `MarkdownHeading${level}`;
  return Heading;
};

const MarkdownUnorderedList: React.FC<React.HTMLAttributes<HTMLUListElement>> = ({
  children,
  ...props
}) => (
  <ul
    style={{
      margin: "0 0 8px 0",
      paddingLeft: "20px",
      listStyleType: "disc",
      listStylePosition: "outside",
    }}
    {...props}
  >
    {children}
  </ul>
);

const MarkdownOrderedList: React.FC<React.HTMLAttributes<HTMLOListElement>> = ({
  children,
  ...props
}) => (
  <ol
    style={{
      margin: "0 0 8px 0",
      paddingLeft: "20px",
      listStyleType: "decimal",
      listStylePosition: "outside",
    }}
    {...props}
  >
    {children}
  </ol>
);

const MarkdownListItem: React.FC<React.LiHTMLAttributes<HTMLLIElement>> = ({
  children,
  ...props
}) => (
  <li
    style={{ display: "list-item", margin: "2px 0", lineHeight: "1.6" }}
    {...props}
  >
    {children}
  </li>
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MarkdownCode: React.FC<any> = ({ className, children, ...props }) => {
  const isBlock = className !== undefined || String(children).includes("\n");

  return isBlock ? (
    <code
      style={{
        display: "block",
        background: "#f5f5f5",
        padding: "8px 12px",
        borderRadius: "6px",
        fontSize: "13px",
        overflowX: "auto",
        fontFamily: '"IBM Plex Mono", monospace',
      }}
      {...props}
    >
      {children}
    </code>
  ) : (
    <code
      style={{
        background: "#f0f2f5",
        padding: "2px 5px",
        borderRadius: "4px",
        fontSize: "13px",
        fontFamily: '"IBM Plex Mono", monospace',
      }}
      {...props}
    >
      {children}
    </code>
  );
};

// `pre` wraps block code; render transparently so the `code` styles win.
const MarkdownPre: React.FC<React.HTMLAttributes<HTMLPreElement>> = ({
  children,
  ...props
}) => (
  <pre style={{ margin: "0 0 8px 0" }} {...props}>
    {children}
  </pre>
);

const MarkdownBlockquote: React.FC<React.HTMLAttributes<HTMLQuoteElement>> = ({
  children,
  ...props
}) => (
  <blockquote
    style={{
      borderLeft: "4px solid #dee3e8",
      paddingLeft: "12px",
      margin: "0 0 8px 0",
      fontStyle: "italic",
      color: "#6b6d6f",
    }}
    {...props}
  >
    {children}
  </blockquote>
);

const MarkdownTable: React.FC<React.TableHTMLAttributes<HTMLTableElement>> = ({
  children,
  ...props
}) => (
  <div style={{ overflowX: "auto", margin: "0 0 8px 0" }}>
    <table
      style={{
        borderCollapse: "collapse",
        width: "100%",
        fontSize: "13px",
      }}
      {...props}
    >
      {children}
    </table>
  </div>
);

const MarkdownTableHead: React.FC<React.HTMLAttributes<HTMLTableCellElement>> = ({
  children,
  ...props
}) => (
  <th
    style={{
      border: "1px solid #dee3e8",
      padding: "6px 10px",
      textAlign: "left",
      backgroundColor: "#f5f7fa",
      fontWeight: 600,
    }}
    {...props}
  >
    {children}
  </th>
);

const MarkdownTableCell: React.FC<React.HTMLAttributes<HTMLTableCellElement>> = ({
  children,
  ...props
}) => (
  <td
    style={{ border: "1px solid #dee3e8", padding: "6px 10px" }}
    {...props}
  >
    {children}
  </td>
);

const MarkdownImage: React.FC<React.ImgHTMLAttributes<HTMLImageElement>> = ({
  alt,
  ...props
}) => (
  <img
    alt={alt ?? ""}
    style={{ maxWidth: "100%", borderRadius: "8px", margin: "4px 0" }}
    {...props}
  />
);

const MarkdownHr: React.FC<React.HTMLAttributes<HTMLHRElement>> = (props) => (
  <hr
    style={{ border: "none", borderTop: "1px solid #dee3e8", margin: "12px 0" }}
    {...props}
  />
);

const markdownComponents = {
  a: MarkdownLink,
  p: MarkdownParagraph,
  h1: makeHeading(1, "20px"),
  h2: makeHeading(2, "18px"),
  h3: makeHeading(3, "16px"),
  h4: makeHeading(4, "15px"),
  h5: makeHeading(5, "14px"),
  h6: makeHeading(6, "13px"),
  ul: MarkdownUnorderedList,
  ol: MarkdownOrderedList,
  li: MarkdownListItem,
  code: MarkdownCode,
  pre: MarkdownPre,
  blockquote: MarkdownBlockquote,
  table: MarkdownTable,
  th: MarkdownTableHead,
  td: MarkdownTableCell,
  img: MarkdownImage,
  hr: MarkdownHr,
};

const remarkPlugins = [remarkGfm];

export interface MarkdownProps {
  /** Raw markdown string to render. */
  content: string;
}

/**
 * Renders markdown content with GitHub-flavored markdown support
 * (tables, task lists, strikethrough, autolinks) and inline-styled
 * element renderers. Used by {@link Message} but exported so consumers
 * building a custom chat UI can render assistant content the same way.
 */
export const Markdown: React.FC<MarkdownProps> = ({ content }) => (
  <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
    {content}
  </ReactMarkdown>
);
