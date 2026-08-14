/**
 * The "was this answer any good?" row under an assistant message: two thumbs,
 * and (after a thumbs-down) a small panel to say what went wrong.
 *
 * The widget re-renders the whole thread on every update, so the row cannot keep
 * its state in the DOM: it reads and writes a {@link MessageFeedbackState} owned
 * by the widget and keyed by message id. Interactions inside the row mutate that
 * state and restyle in place, which is also what keeps a half-typed comment from
 * being wiped by an unrelated re-render.
 *
 * Inline styles only, `ago-` prefixed class names: this markup lands in a
 * third-party page and must not touch anything already there.
 */

import type { FeedbackRating, FeedbackReason } from "../client/types";
import { FEEDBACK_REASONS } from "../client/types";
import {
  ACCENT_COLOR,
  BORDER_COLOR,
  BRAND_COLOR,
  BRAND_TEXT_COLOR,
  css,
  div,
  MESSAGE_RADIUS,
  MUTED_TEXT_COLOR,
  PANEL_BACKGROUND,
  TEXT_COLOR,
} from "./styles";

/** Every string the feedback row shows, so a non-English app can translate it. */
export interface FeedbackLabels {
  /** Accessible name of the thumbs-up button. */
  helpful: string;
  /** Accessible name of the thumbs-down button. */
  notHelpful: string;
  /** Title of the panel opened by a thumbs-down. */
  whatWentWrong: string;
  /** Label of each reason chip. */
  reasons: Record<FeedbackReason, string>;
  /** Placeholder of the free-text field. */
  commentPlaceholder: string;
  /** Label of the panel's submit button. */
  send: string;
  /** Confirmation shown once a report is sent. */
  thanks: string;
}

export const DEFAULT_FEEDBACK_LABELS: FeedbackLabels = {
  helpful: "Helpful",
  notHelpful: "Not helpful",
  whatWentWrong: "What went wrong?",
  reasons: {
    inaccurate: "Inaccurate",
    incomplete: "Incomplete",
    information_not_found: "Information not found",
    technical_issue: "Technical issue",
  },
  commentPlaceholder: "Anything else? (optional)",
  send: "Send",
  thanks: "Thanks, this was reported.",
};

/** Per-message feedback state, kept by the widget across re-renders. */
export interface MessageFeedbackState {
  /** The thumb the user picked, if any. */
  rating?: FeedbackRating;
  /** Whether the "what went wrong?" panel is open. */
  detailsOpen: boolean;
  /** Reasons currently ticked. */
  reasons: Set<FeedbackReason>;
  /** What the user typed so far (survives a re-render). */
  comment: string;
  /** True once a report with reasons/comment went through. */
  reported: boolean;
}

export function createFeedbackState(): MessageFeedbackState {
  return {
    detailsOpen: false,
    reasons: new Set(),
    comment: "",
    reported: false,
  };
}

export interface FeedbackRowOptions {
  state: MessageFeedbackState;
  labels: FeedbackLabels;
  /** Open the details panel after a thumbs-down. */
  askWhy: boolean;
  /** Send a rating on its own (a thumb click). */
  onRate: (rating: FeedbackRating) => void;
  /**
   * Send the details panel. Resolves `true` once the API accepted the report;
   * `false` when it failed, which keeps the panel open with what the user typed
   * rather than thanking them for a report that never landed.
   */
  onReport: (
    rating: FeedbackRating,
    details: { reasons: FeedbackReason[]; comment: string }
  ) => Promise<boolean>;
}

const GHOST_BUTTON = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  // 44px is Apple's HIG minimum touch target, the floor every control in this
  // widget sits at. The glyph stays 16px; only the hit area grows, with negative
  // margins so the row keeps its small, unobtrusive look.
  width: "44px",
  height: "44px",
  margin: "-8px",
  padding: "0",
  border: "none",
  borderRadius: "8px",
  background: "transparent",
  color: MUTED_TEXT_COLOR,
  cursor: "pointer",
  lineHeight: "1",
} satisfies Partial<CSSStyleDeclaration>;

/** Build the thumbs row (plus its details panel when open) for one message. */
export function renderFeedbackRow(opts: FeedbackRowOptions): HTMLElement {
  const { state, labels, askWhy, onRate, onReport } = opts;

  const wrap = div({ marginTop: "6px", width: "100%", maxWidth: "85%" });
  wrap.className = "ago-feedback";

  const row = div({ display: "flex", alignItems: "center", gap: "2px" });
  row.className = "ago-feedback__actions";

  const up = thumbButton("up", labels.helpful, state.rating === "positive");
  up.addEventListener("click", () => {
    state.rating = "positive";
    state.detailsOpen = false;
    paintThumbs();
    renderPanel();
    onRate("positive");
  });

  const down = thumbButton("down", labels.notHelpful, state.rating === "negative");
  down.addEventListener("click", () => {
    state.rating = "negative";
    // The thumb itself is the report; the panel only asks for detail on top.
    onRate("negative");
    if (askWhy && !state.reported) state.detailsOpen = true;
    paintThumbs();
    renderPanel();
  });

  row.append(up, down);
  wrap.appendChild(row);

  const panelSlot = div();
  panelSlot.className = "ago-feedback__panel-slot";
  wrap.appendChild(panelSlot);

  function paintThumbs(): void {
    setThumbSelected(up, state.rating === "positive");
    setThumbSelected(down, state.rating === "negative");
  }

  function renderPanel(): void {
    panelSlot.replaceChildren();
    if (state.reported) {
      panelSlot.appendChild(thanksNote(labels.thanks));
      return;
    }
    if (!state.detailsOpen) return;
    panelSlot.appendChild(
      buildDetailsPanel(state, labels, async (details) => {
        // Only thank the user once the report is in. A 422 (an over-long
        // comment), a 403, or a dropped connection leaves the panel as it was,
        // text included, so they can send it again.
        const accepted = await onReport(state.rating ?? "negative", details);
        if (!accepted) return false;
        state.reported = true;
        state.detailsOpen = false;
        renderPanel();
        return true;
      })
    );
  }

  paintThumbs();
  renderPanel();

  return wrap;
}

function thumbButton(
  direction: "up" | "down",
  label: string,
  selected: boolean
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `ago-feedback__thumb ago-feedback__thumb--${direction}`;
  btn.setAttribute("aria-label", label);
  btn.title = label;
  css(btn, GHOST_BUTTON);
  btn.appendChild(thumbIcon(direction));
  setThumbSelected(btn, selected);
  btn.addEventListener("mouseenter", () => {
    if (btn.getAttribute("aria-pressed") !== "true") {
      btn.style.color = TEXT_COLOR;
    }
  });
  btn.addEventListener("mouseleave", () => {
    if (btn.getAttribute("aria-pressed") !== "true") {
      btn.style.color = MUTED_TEXT_COLOR;
    }
  });
  return btn;
}

function setThumbSelected(btn: HTMLButtonElement, selected: boolean): void {
  btn.setAttribute("aria-pressed", selected ? "true" : "false");
  btn.style.color = selected ? ACCENT_COLOR : MUTED_TEXT_COLOR;
}

/** A thumbs-up / thumbs-down glyph, drawn so the widget ships no icon font. */
function thumbIcon(direction: "up" | "down"): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute(
    "d",
    "M7 22h9.3a2 2 0 0 0 2-1.7l1.4-9A2 2 0 0 0 17.7 9H14V5a3 3 0 0 0-3-3l-4 10z"
  );
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.8");
  path.setAttribute("stroke-linejoin", "round");
  const base = document.createElementNS(ns, "path");
  base.setAttribute("d", "M7 22V12H4.5A1.5 1.5 0 0 0 3 13.5v7A1.5 1.5 0 0 0 4.5 22z");
  base.setAttribute("stroke", "currentColor");
  base.setAttribute("stroke-width", "1.8");
  base.setAttribute("stroke-linejoin", "round");
  svg.append(path, base);
  if (direction === "down") svg.style.transform = "rotate(180deg)";
  return svg;
}

function buildDetailsPanel(
  state: MessageFeedbackState,
  labels: FeedbackLabels,
  onSend: (details: {
    reasons: FeedbackReason[];
    comment: string;
  }) => Promise<boolean>
): HTMLElement {
  const panel = div({
    marginTop: "8px",
    padding: "12px",
    border: `1px solid ${BORDER_COLOR}`,
    borderRadius: MESSAGE_RADIUS,
    backgroundColor: PANEL_BACKGROUND,
  });
  panel.className = "ago-feedback__panel";
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", labels.whatWentWrong);

  const title = div({
    fontSize: "13px",
    fontWeight: "500",
    color: TEXT_COLOR,
    marginBottom: "8px",
  });
  title.textContent = labels.whatWentWrong;
  panel.appendChild(title);

  const chips = div({
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    marginBottom: "8px",
  });
  chips.className = "ago-feedback__reasons";
  for (const reason of FEEDBACK_REASONS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "ago-feedback__reason";
    chip.textContent = labels.reasons[reason];
    css(chip, {
      // Same 44px floor as the suggested-reply pills these look like.
      minHeight: "44px",
      padding: "4px 12px",
      fontSize: "13px",
      fontFamily: "inherit",
      borderRadius: "999px",
      border: `1px solid ${BORDER_COLOR}`,
      backgroundColor: "transparent",
      color: TEXT_COLOR,
      cursor: "pointer",
    });
    const paint = (): void => {
      const on = state.reasons.has(reason);
      chip.setAttribute("aria-pressed", on ? "true" : "false");
      chip.style.borderColor = on ? ACCENT_COLOR : BORDER_COLOR;
      chip.style.color = on ? ACCENT_COLOR : TEXT_COLOR;
    };
    chip.addEventListener("click", () => {
      if (state.reasons.has(reason)) state.reasons.delete(reason);
      else state.reasons.add(reason);
      paint();
      paintSend();
    });
    paint();
    chips.appendChild(chip);
  }
  panel.appendChild(chips);

  const comment = document.createElement("textarea");
  comment.className = "ago-feedback__comment";
  comment.rows = 2;
  comment.placeholder = labels.commentPlaceholder;
  comment.value = state.comment;
  comment.setAttribute("aria-label", labels.commentPlaceholder);
  css(comment, {
    width: "100%",
    boxSizing: "border-box",
    padding: "8px 10px",
    fontSize: "14px",
    fontFamily: "inherit",
    color: TEXT_COLOR,
    border: `1px solid ${BORDER_COLOR}`,
    borderRadius: "10px",
    backgroundColor: "transparent",
    resize: "vertical",
  });
  comment.addEventListener("input", () => {
    state.comment = comment.value;
    paintSend();
  });
  panel.appendChild(comment);

  const send = document.createElement("button");
  send.type = "button";
  send.className = "ago-feedback__send";
  send.textContent = labels.send;
  css(send, {
    marginTop: "8px",
    minHeight: "44px",
    padding: "6px 16px",
    fontSize: "14px",
    fontFamily: "inherit",
    borderRadius: "10px",
    border: "none",
    backgroundColor: BRAND_COLOR,
    color: BRAND_TEXT_COLOR,
    cursor: "pointer",
  });
  send.addEventListener("click", () => {
    if (send.disabled) return;
    // Held down for the round-trip so one impatient double-click cannot file the
    // same report twice; released if it failed, since the panel stays put.
    send.disabled = true;
    void onSend({
      reasons: [...state.reasons],
      comment: state.comment.trim(),
    }).then((accepted) => {
      if (!accepted) paintSend();
    });
  });
  panel.appendChild(send);
  paintSend();

  return panel;

  /**
   * Nothing ticked and nothing typed would re-send the thumb that already went
   * out, and answer "thanks, this was reported" to an empty report.
   */
  function paintSend(): void {
    const hasDetails = state.reasons.size > 0 || state.comment.trim().length > 0;
    send.disabled = !hasDetails;
    send.style.opacity = hasDetails ? "1" : "0.5";
    send.style.cursor = hasDetails ? "pointer" : "default";
  }
}

function thanksNote(text: string): HTMLElement {
  const note = div({
    marginTop: "6px",
    fontSize: "13px",
    color: MUTED_TEXT_COLOR,
  });
  note.className = "ago-feedback__thanks";
  note.setAttribute("role", "status");
  note.textContent = text;
  return note;
}
