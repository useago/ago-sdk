/**
 * The bubble widget's conversation screen layout (`Chat` + `ChatPanel` in the
 * hosted widget): the scrolling message column on top, the composer dock at
 * the bottom, and the scroll-to-bottom button floating just above the dock.
 *
 * Pure layout: the widget keeps ownership of the messages pane, the jump
 * button's behavior, and the composer. This only arranges them.
 */

import { css, div } from "../styles";

export interface ChatScreenOptions {
  /** The messages pane (scroll container) built by the widget. */
  messagesWrap: HTMLElement;
  /** The widget's jump-to-latest button; re-parented into the dock. */
  jumpBtn: HTMLElement;
}

export interface ChatScreenHandle {
  el: HTMLDivElement;
  /** Where the composer lives while this screen is shown. */
  composerSlot: HTMLDivElement;
}

export function buildChatScreen(opts: ChatScreenOptions): ChatScreenHandle {
  const root = div({
    display: "flex",
    flexDirection: "column",
    flex: "1",
    width: "100%",
    overflow: "auto",
    minHeight: "0",
  });
  root.className = "ago-chat-widget__chat";

  // `container relative isolate ... pb-2`: centered, capped at 768px.
  const dock = div({
    position: "relative",
    isolation: "isolate",
    width: "100%",
    maxWidth: "768px",
    margin: "0 auto",
    padding: "0 8px 8px",
    boxSizing: "border-box",
    flexShrink: "0",
  });
  dock.className = "ago-chat-widget__dock";
  const composerSlot = div({ width: "100%" });
  composerSlot.className = "ago-chat-widget__chat-composer";

  // `absolute bottom-full mb-4 right-1/2`: hangs above the dock, centered.
  css(opts.jumpBtn, {
    position: "absolute",
    bottom: "100%",
    top: "auto",
    left: "auto",
    right: "50%",
    marginBottom: "16px",
    transform: "translateX(50%)",
    zIndex: "50",
  });

  dock.append(opts.jumpBtn, composerSlot);
  root.append(opts.messagesWrap, dock);

  return { el: root, composerSlot };
}
