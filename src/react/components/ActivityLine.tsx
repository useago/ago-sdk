import React from "react";
import { renderInlineMarkdown } from "./inlineMarkdown";

// Scoped under `.ago-activity`, with `ago-`-prefixed keyframes and custom
// properties, so nothing here can reach the host page's own styles.
const ACTIVITY_CSS = `
@keyframes ago-activity-enter {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}
@keyframes ago-activity-sweep {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
.ago-activity__label {
  animation: ago-activity-enter 260ms ease-out both;
}
@supports ((background-clip: text) or (-webkit-background-clip: text)) {
  .ago-activity__label {
    background-image: linear-gradient(
      90deg,
      var(--ago-activity-color, #5b5d5f) 0%,
      var(--ago-activity-color, #5b5d5f) 35%,
      var(--ago-activity-sheen, #adb1b5) 50%,
      var(--ago-activity-color, #5b5d5f) 65%,
      var(--ago-activity-color, #5b5d5f) 100%
    );
    background-size: 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation:
      ago-activity-enter 260ms ease-out both,
      ago-activity-sweep 2.4s linear infinite;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ago-activity__label {
    animation: none;
    color: var(--ago-activity-color, #5b5d5f);
  }
}
`;

export interface ActivityLineProps {
  /** What the agent is doing right now. Simple inline Markdown is rendered. */
  label: string;
}

/**
 * The "what the agent is doing" line.
 *
 * Two things are deliberate. The label is keyed on its own text, so React
 * remounts it when the step changes and the enter animation replays: one step
 * visibly gives way to the next instead of the text swapping in place, which
 * read as a glitch. And a slow sheen keeps travelling across it, so a step that
 * sits there for several seconds (a fetch, a settle wait) still looks alive
 * rather than stuck.
 *
 * Colours come from `--ago-activity-color` / `--ago-activity-sheen` so a host
 * can re-skin it; the sheen degrades to plain text where `background-clip: text`
 * is unsupported, and stops entirely under `prefers-reduced-motion`.
 */
export const ActivityLine: React.FC<ActivityLineProps> = ({ label }) => (
  <div
    className="ago-activity"
    role="status"
    aria-live="polite"
    style={{
      display: "block",
      margin: "4px 0 0",
      padding: "6px 12px",
      borderRadius: "999px",
      width: "fit-content",
      maxWidth: "100%",
      fontSize: "13px",
      lineHeight: 1.5,
      color: "var(--ago-activity-color, #5b5d5f)",
      backgroundColor: "var(--ago-activity-bg, #f1f2f3)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    }}
  >
    <span key={label} className="ago-activity__label">
      {renderInlineMarkdown(label)}
    </span>
    <style>{ACTIVITY_CSS}</style>
  </div>
);
