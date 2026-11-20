import type { RemoteAssistUi, RemoteAssistUiActions } from "./RemoteAssistController";
import type { RemoteAssistSnapshot } from "./types";

/** Texts of the built-in remote-assistance UI (see `UiCatalog.remoteAssist`). */
export interface RemoteAssistLabels {
  requestTitle: string;
  requestTitleAnonymous: string;
  requestIntro: string;
  canSeePage: string;
  canAct: string;
  canScreenshot: string;
  requestFootnote: string;
  accept: string;
  decline: string;
  banner: string;
  bannerAnonymous: string;
  stop: string;
  approvalTitle: string;
  approvalTitleAnonymous: string;
  allow: string;
  deny: string;
}

export const ROOT_ID = "ago-remote-assist";
const FONT = "var(--ago-font, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)";
const BRAND = "var(--ago-brand-color, #03182f)";
const BRAND_TEXT = "var(--ago-brand-text-color, #fff)";
const PANEL = "var(--ago-panel-background, #fff)";
const TEXT = "var(--ago-text-color, #30373e)";
const MUTED = "var(--ago-muted-text-color, #6b6d6f)";
const BORDER = "var(--ago-border-color, #dee3e8)";
const RADIUS = "var(--ago-radius, 16px)";
const Z_INDEX = "2147483001";

type Style = Partial<Record<string, string>>;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Style,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(style)) {
    if (value !== undefined) node.style.setProperty(name, value);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

function withName(template: string, anonymous: string, name: string | null): string {
  return name ? template.replace("{name}", () => name) : anonymous;
}

function button(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
  const node = el("button", {
    "min-height": "44px",
    padding: "0 18px",
    "border-radius": "999px",
    border: primary ? "1px solid transparent" : `1px solid ${BORDER}`,
    background: primary ? BRAND : PANEL,
    color: primary ? BRAND_TEXT : TEXT,
    font: `600 14px/1.2 ${FONT}`,
    cursor: "pointer",
    "flex": "1 1 auto",
  }, label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

function card(labelledBy: string, describedBy: string): HTMLDivElement {
  const node = el("div", {
    position: "fixed",
    left: "50%",
    bottom: "16px",
    transform: "translateX(-50%)",
    width: "min(420px, calc(100vw - 16px))",
    "max-height": "calc(100vh - 32px)",
    "overflow-y": "auto",
    "box-sizing": "border-box",
    padding: "20px",
    background: PANEL,
    color: TEXT,
    border: `1px solid ${BORDER}`,
    "border-radius": RADIUS,
    "box-shadow": "rgba(15, 15, 15, 0.2) 0px 8px 40px 0px",
    font: `14px/1.5 ${FONT}`,
    "text-align": "left",
    "z-index": Z_INDEX,
  });
  node.setAttribute("role", "alertdialog");
  node.setAttribute("aria-modal", "false");
  node.setAttribute("aria-labelledby", labelledBy);
  node.setAttribute("aria-describedby", describedBy);
  // Focus lands on the card, never on Accept: a visitor typing in the page
  // must not consent by pressing Enter.
  node.tabIndex = -1;
  return node;
}

function actions(...buttons: HTMLButtonElement[]): HTMLDivElement {
  const row = el("div", { display: "flex", gap: "8px", "flex-wrap": "wrap", "margin-top": "16px" });
  row.append(...buttons);
  return row;
}

/**
 * The SDK's own consent prompt, session banner and approval prompt, mounted on
 * the host page (independent of the chat panel). Inline styles only, themed by
 * the `--ago-*` tokens, under one `#ago-remote-assist` root.
 */
export function createRemoteAssistUi(
  handlers: RemoteAssistUiActions,
  labels: RemoteAssistLabels,
): RemoteAssistUi {
  const root = el("div", {});
  root.id = ROOT_ID;
  document.body.appendChild(root);
  let shown: string | null = null;
  let previousFocus: Element | null = null;

  const focusInto = (node: HTMLElement): void => {
    previousFocus = document.activeElement;
    node.focus({ preventScroll: true });
  };

  const restoreFocus = (): void => {
    const active = document.activeElement;
    const lost = !active || active === document.body || root.contains(active);
    if (lost && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
      previousFocus.focus({ preventScroll: true });
    }
    previousFocus = null;
  };

  const onEscape = (handler: () => void) => (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      handler();
    }
  };

  function renderPrompt(snapshot: RemoteAssistSnapshot): HTMLElement {
    const session = snapshot.session!;
    const node = card("ago-remote-assist-title", "ago-remote-assist-body");
    const title = el("h2", { margin: "0 0 8px", font: `600 16px/1.4 ${FONT}`, color: TEXT },
      withName(labels.requestTitle, labels.requestTitleAnonymous, session.agentName));
    title.id = "ago-remote-assist-title";
    const body = el("div", {});
    body.id = "ago-remote-assist-body";
    body.appendChild(el("p", { margin: "0 0 6px" }, labels.requestIntro));
    const list = el("ul", { margin: "0 0 8px", padding: "0 0 0 20px" });
    const items = [labels.canSeePage, labels.canAct];
    if (session.screenshot) items.push(labels.canScreenshot);
    for (const item of items) list.appendChild(el("li", { margin: "2px 0" }, item));
    body.appendChild(list);
    body.appendChild(el("p", { margin: "0", color: MUTED, "font-size": "13px" }, labels.requestFootnote));
    const accept = button(labels.accept, true, () => handlers.accept());
    const decline = button(labels.decline, false, () => handlers.decline());
    accept.disabled = snapshot.accepting;
    decline.disabled = snapshot.accepting;
    node.append(title, body, actions(decline, accept));
    node.addEventListener("keydown", onEscape(() => handlers.decline()));
    return node;
  }

  function renderApproval(snapshot: RemoteAssistSnapshot): HTMLElement {
    const request = snapshot.pendingApproval!;
    const node = card("ago-remote-assist-approval-title", "ago-remote-assist-approval-body");
    const title = el("h2", { margin: "0 0 8px", font: `600 16px/1.4 ${FONT}`, color: TEXT },
      withName(labels.approvalTitle, labels.approvalTitleAnonymous, request.agentName));
    title.id = "ago-remote-assist-approval-title";
    const body = el("div", {});
    body.id = "ago-remote-assist-approval-body";
    body.appendChild(el("p", { margin: "0 0 6px", "font-weight": "600" }, request.functionName));
    const args = JSON.stringify(request.arguments ?? {});
    if (args && args !== "{}") {
      body.appendChild(el("pre", {
        margin: "0",
        padding: "8px",
        background: "rgba(0,0,0,0.04)",
        "border-radius": "8px",
        "white-space": "pre-wrap",
        "word-break": "break-word",
        "font-size": "12px",
        "max-height": "160px",
        overflow: "auto",
      }, args.length > 500 ? `${args.slice(0, 500)}…` : args));
    }
    node.append(title, body, actions(
      button(labels.deny, false, () => handlers.reject(request.commandId)),
      button(labels.allow, true, () => handlers.approve(request.commandId)),
    ));
    node.addEventListener("keydown", onEscape(() => handlers.reject(request.commandId)));
    return node;
  }

  function renderBanner(snapshot: RemoteAssistSnapshot): HTMLElement {
    const session = snapshot.session!;
    const bar = el("div", {
      position: "fixed",
      top: "8px",
      // left/right + auto margins center it without halving the width it can use.
      left: "0",
      right: "0",
      margin: "0 auto",
      width: "max-content",
      "max-width": "calc(100vw - 16px)",
      "box-sizing": "border-box",
      display: "flex",
      "align-items": "center",
      gap: "12px",
      padding: "6px 6px 6px 16px",
      background: BRAND,
      color: BRAND_TEXT,
      "border-radius": "999px",
      "box-shadow": "rgba(15, 15, 15, 0.25) 0px 4px 20px 0px",
      font: `500 14px/1.3 ${FONT}`,
      "z-index": Z_INDEX,
    });
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", withName(labels.banner, labels.bannerAnonymous, session.agentName));
    const dot = el("span", {
      width: "8px",
      height: "8px",
      "border-radius": "50%",
      background: "#22c55e",
      "flex-shrink": "0",
    });
    dot.setAttribute("aria-hidden", "true");
    const text = el("span", { "min-width": "0", "overflow-wrap": "break-word" },
      withName(labels.banner, labels.bannerAnonymous, session.agentName));
    text.setAttribute("role", "status");
    const stop = el("button", {
      "min-height": "36px",
      "min-width": "44px",
      padding: "0 14px",
      "border-radius": "999px",
      border: "none",
      background: BRAND_TEXT,
      color: BRAND,
      font: `600 13px/1 ${FONT}`,
      cursor: "pointer",
      "flex-shrink": "0",
    }, labels.stop);
    stop.type = "button";
    stop.addEventListener("click", () => handlers.stop());
    bar.append(dot, text, stop);
    return bar;
  }

  return {
    render(snapshot) {
      const key = snapshot.pendingApproval
        ? `approval:${snapshot.pendingApproval.commandId}`
        : snapshot.state === "requested" && snapshot.session
          ? `prompt:${snapshot.session.id}:${snapshot.accepting}`
          : snapshot.state === "active" && snapshot.session
            ? `banner:${snapshot.session.id}:${snapshot.session.agentName ?? ""}`
            : null;
      if (key === shown) return;
      const wasDialog = shown?.startsWith("prompt:") || shown?.startsWith("approval:");
      shown = key;
      root.replaceChildren();
      if (snapshot.state === "active" && snapshot.session) root.appendChild(renderBanner(snapshot));
      const dialog = snapshot.pendingApproval
        ? renderApproval(snapshot)
        : snapshot.state === "requested" && snapshot.session
          ? renderPrompt(snapshot)
          : null;
      if (dialog) {
        root.appendChild(dialog);
        if (wasDialog) dialog.focus({ preventScroll: true });
        else focusInto(dialog);
      } else if (wasDialog) {
        restoreFocus();
      }
    },
    owns(node) {
      return node === root || root.contains(node);
    },
    destroy() {
      restoreFocus();
      root.remove();
    },
  };
}
