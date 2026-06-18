import type { AgoClient } from "../client/AgoClient";
import type { SSEChunkData } from "../client/types";

/** Options for {@link initDevPanel}. */
export interface DevPanelOptions {
  /**
   * The AGO client to debug. The panel lists its registered functions, logs its
   * function events, and renders the name + data of each entry in its live context
   * snapshot (`client.getContextSnapshot()`)
   */
  client: Pick<
    AgoClient,
    "on" | "getRegisteredFunctions" | "getContextSnapshot"
  >;
  /** Where to mount: a CSS selector, an Element, or `document.body` (default). */
  target?: string | Element;
  /**
   * Which screen edge the panels pin to: `"right"` (default) or `"left"`. With
   * several widgets on a page, give each panel the same side as its widget. Panels
   * on the same side stack beside each other automatically.
   */
  side?: "left" | "right";
  /**
   * Optional caption shown in the panel header. Handy when several panels share a
   * page (one per widget): pass e.g. the agent or widget name to tell them apart.
   */
  label?: string;
}

// Append one timestamped line to a log pane (the function-call log or the SSE
// event log) and keep it scrolled to the newest entry.
function appendLine(
  el: HTMLElement | null,
  text: string,
  kind: string,
): void {
  if (!el) return;
  const line = document.createElement("div");
  line.className = `dev-log-line dev-log-${kind}`;
  const time = new Date().toLocaleTimeString();
  line.textContent = `${time}  ${text}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

// One-line summary of a raw SSE chunk: a leading tag (its `type`, or what it
// carries) plus the verbatim JSON, so the exact wire payload stays inspectable.
function describeChunk(data: SSEChunkData): string {
  let tag: string;
  if (data.type) tag = data.type;
  else if (data.content !== undefined) tag = "content";
  else if (data.full_content !== undefined) tag = "full_content";
  else if (data.status) tag = `status:${data.status}`;
  else tag = "event";
  return `${tag}  ${JSON.stringify(data)}`;
}

const COLLAPSE_KEY = "ago_dev_panel_collapsed";
const EVENTS_COLLAPSE_KEY = "ago_dev_events_collapsed";

function setCollapsed(
  panel: HTMLElement,
  collapsed: boolean,
  storageKey: string,
  label: string,
): void {
  panel.classList.toggle("collapsed", collapsed);
  const toggle = panel.querySelector<HTMLButtonElement>(".dev-toggle");
  if (toggle) {
    toggle.textContent = collapsed ? "▢" : "—";
    toggle.title = collapsed ? `Expand ${label}` : `Collapse ${label}`;
    toggle.setAttribute("aria-expanded", String(!collapsed));
  }
  try {
    localStorage.setItem(storageKey, collapsed ? "1" : "0");
  } catch {
    // localStorage may be unavailable; collapse state just won't persist.
  }
}

// Wire a panel's toggle button + click-to-expand, and restore its persisted
// collapse state. Shared by the main dev panel and the SSE events panel so each
// collapses independently under its own storage key.
function wireCollapse(
  panel: HTMLElement,
  storageKey: string,
  label: string,
): void {
  const toggle = panel.querySelector<HTMLButtonElement>(".dev-toggle");
  toggle?.addEventListener("click", (e) => {
    e.stopPropagation();
    setCollapsed(panel, !panel.classList.contains("collapsed"), storageKey, label);
  });
  // When collapsed, the whole widget acts as an expand button.
  panel.addEventListener("click", () => {
    if (panel.classList.contains("collapsed"))
      setCollapsed(panel, false, storageKey, label);
  });

  let startCollapsed = false;
  try {
    startCollapsed = localStorage.getItem(storageKey) === "1";
  } catch {
    // ignore
  }
  setCollapsed(panel, startCollapsed, storageKey, label);
}

export function initDevPanel(options: DevPanelOptions): void {
  const { client, target, label, side = "right" } = options;

  // Count the panels already mounted by reading the DOM (not a module-level
  // counter), so initDevPanel keeps no shared state: two widgets on one page each
  // get an independent panel instead of clobbering each other.
  const mounted = document.querySelectorAll("#ago-dev-panel").length;
  // Unique collapse-key suffix per panel; the first/only panel keeps the bare keys.
  const suffix = mounted === 0 ? "" : `-${mounted + 1}`;
  // How many panels already pin to this side, so a second one on the same side
  // shifts over (card width 360 + 16 gap) instead of stacking on top of it.
  const sideIndex = document.querySelectorAll(
    `#ago-dev-panel[data-ago-dev-side="${side}"]`,
  ).length;
  const inset = sideIndex > 0 ? `${16 + sideIndex * 376}px` : "";

  // Per-instance DOM refs: a second panel never overwrites the first's elements.
  let stateEl: HTMLElement | null = null;
  let logEl: HTMLElement | null = null;
  let eventLogEl: HTMLElement | null = null;

  // Live JSON pane: the client's context snapshot.
  const getState = () => {
    const entries = client.getContextSnapshot()?.entries ?? {};
    return Object.fromEntries(
      Object.entries(entries).map(([key, { name, data }]) => [
        key,
        { name, data },
      ]),
    );
  };
  // Re-render the JSON pane. Painted on init and after each function event.
  const renderState = (): void => {
    if (stateEl) stateEl.textContent = JSON.stringify(getState(), null, 2);
  };
  const logLine = (
    text: string,
    kind: "invoke" | "result" | "error" | "hydrate",
  ): void => {
    appendLine(logEl, text, kind);
  };

  injectStyles();
  const host =
    typeof target === "string"
      ? document.querySelector(target)
      : target instanceof Element
        ? target
        : document.body;
  // Pin a panel to the chosen side. The CSS default is right:16px, so a first
  // right-side panel needs no inline style; left or stacked panels set it inline.
  // The data attribute lets the next call count panels already on this side.
  const place = (el: HTMLElement): void => {
    el.dataset.agoDevSide = side;
    if (side === "left") {
      el.style.right = "auto";
      el.style.left = inset || "16px";
    } else if (inset) {
      el.style.right = inset;
    }
  };

  const panel = document.createElement("aside");
  panel.id = "ago-dev-panel";
  panel.className = "ago-dev-card";
  place(panel);
  (host ?? document.body).appendChild(panel);

  const registered = client.getRegisteredFunctions?.() ?? [];
  const fnNames = registered.map((f) => f.name).join(", ") || "—";

  // A label (e.g. the agent/widget name) replaces the default caption so two
  // panels on one page are tellable apart.
  const mainTitle = label
    ? `DEV TOOLS · ${label}`
    : "DEV TOOLS · client-side function state — not for production";

  panel.innerHTML = `
    <div class="dev-head">
      <span class="dev-badge">DEV</span>
      <span class="dev-title">${mainTitle}</span>
      <button type="button" class="dev-toggle" aria-label="Toggle dev tools">—</button>
    </div>
    <div class="dev-body">
      <div class="dev-fns">Registered functions: <code>${fnNames}</code></div>
      <div class="dev-section-label">JSON object (built by the agent)</div>
      <pre class="dev-state" id="ago-dev-state"></pre>
      <div class="dev-section-label">Function calls</div>
      <div class="dev-log" id="ago-dev-log"></div>
    </div>
  `;

  // Look up by class, not id: two panels on one page share the same ids, so an
  // id query could resolve to the wrong panel. Each class is unique within a panel.
  stateEl = panel.querySelector<HTMLElement>(".dev-state");
  logEl = panel.querySelector<HTMLElement>(".dev-log");
  wireCollapse(panel, COLLAPSE_KEY + suffix, "dev tools");

  // Separate panel for the raw SSE stream: it's high-volume, so keeping it out of
  // the main panel stops it crowding the function/state views. Collapses on its own.
  const eventsPanel = document.createElement("aside");
  eventsPanel.id = "ago-dev-events";
  eventsPanel.className = "ago-dev-card";
  place(eventsPanel);
  (host ?? document.body).appendChild(eventsPanel);
  const sseTitle = label
    ? `SSE EVENT LOG · ${label}`
    : "SSE EVENT LOG · raw stream messages";
  eventsPanel.innerHTML = `
    <div class="dev-head">
      <span class="dev-badge">SSE</span>
      <span class="dev-title">${sseTitle}</span>
      <button type="button" class="dev-toggle" aria-label="Toggle SSE event log">—</button>
    </div>
    <div class="dev-body">
      <div class="dev-log" id="ago-dev-event-log"></div>
    </div>
  `;
  eventLogEl = eventsPanel.querySelector<HTMLElement>(".dev-log");
  wireCollapse(eventsPanel, EVENTS_COLLAPSE_KEY + suffix, "SSE event log");

  // Log every raw SSE message as it arrives off the stream, so the exact wire
  // payload behind each higher-level event is traceable.
  client.on("stream:message", (data) => {
    appendLine(eventLogEl, describeChunk(data), "event");
  });

  client.on("function:invoke", ({ functionName, arguments: args }) => {
    logLine(`→ ${functionName}(${JSON.stringify(args ?? {})})`, "invoke");
  });
  client.on("function:result", ({ result, error }) => {
    logLine(
      error ? `✗ error: ${error}` : `← ${JSON.stringify(result)}`,
      error ? "error" : "result",
    );
    // A function may mutate any dynamic provider's data as a side effect.
    renderState();
  });
  // Repaint whenever the context changes: a form collector installing (its initial
  // missing fields), hydration on conversation reload, agent update_<form> calls, or
  // any other context registration. Covers the start of a conversation, before any
  // function has run.
  client.on("context:changed", renderState);
  // A loaded conversation replays its persisted tool calls into stateful helpers
  // (e.g. form collectors), restoring their stores after a page reload. Log it so the
  // restored state in the JSON pane is traceable to a hydration, not a live call.
  client.on("conversation:loaded", (conversation) => {
    const toolCalls = (conversation.messages ?? []).flatMap(
      (m) => m.toolCalls ?? [],
    );
    const label = conversation.title || conversation.id;
    logLine(
      `⟳ hydrated "${label}" — replayed ${toolCalls.length} tool call${
        toolCalls.length === 1 ? "" : "s"
      }`,
      "hydrate",
    );
    // Helpers mutate their stores synchronously during replay; repaint to be sure
    // the snapshot reflects the post-hydration state even if no context:changed fired.
    renderState();
  });

  // Paint the initial context snapshot.
  renderState();
}

const STYLE_ID = "ago-dev-panel-styles";

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);
}

const PANEL_CSS = `
.ago-dev-card {
  position: fixed;
  right: 16px;
  width: min(360px, calc(100vw - 32px));
  max-width: calc(100vw - 32px);
  box-sizing: border-box;
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  background: #0f1419;
  color: #d7e0e8;
  border: 1px solid #2a3441;
  border-radius: 12px;
  box-shadow: 0 20px 50px -20px rgba(0,0,0,.6);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  z-index: 1000;
}
/* The main panel pins to the top, the SSE log to the bottom, so they don't overlap. */
#ago-dev-panel { top: 16px; }
#ago-dev-events { bottom: 16px; }
.ago-dev-card .dev-head { display: flex; align-items: center; gap: 8px; }
.ago-dev-card .dev-toggle {
  margin-left: auto;
  flex: none;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: #7c8a99;
  border: 1px solid #2a3441;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
.ago-dev-card .dev-toggle:hover { color: #d7e0e8; border-color: #3a4655; }
.ago-dev-card .dev-body { display: flex; flex-direction: column; gap: 8px; }

/* Collapsed: shrink to a small clickable widget showing only the badge. */
.ago-dev-card.collapsed {
  width: auto;
  cursor: pointer;
  padding: 8px 10px;
}
.ago-dev-card.collapsed .dev-title,
.ago-dev-card.collapsed .dev-body { display: none; }
.ago-dev-card.collapsed .dev-toggle { margin-left: 6px; }
.ago-dev-card .dev-badge {
  background: #f59e0b;
  color: #1c1206;
  font-weight: 700;
  font-size: 10px;
  letter-spacing: .08em;
  padding: 2px 6px;
  border-radius: 5px;
}
.ago-dev-card .dev-title { color: #f59e0b; font-size: 11px; line-height: 1.3; }
.ago-dev-card .dev-fns { color: #7c8a99; font-size: 11px; }
.ago-dev-card .dev-fns code { color: #9ecbff; }
.ago-dev-card .dev-section-label {
  color: #7c8a99;
  text-transform: uppercase;
  letter-spacing: .08em;
  font-size: 10px;
  margin-top: 4px;
}
.ago-dev-card .dev-state {
  margin: 0;
  padding: 8px;
  background: #060a0e;
  border-radius: 8px;
  overflow: auto;
  max-height: 40vh;
  white-space: pre;
  color: #c8e6c9;
}
.ago-dev-card .dev-log {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  max-height: 24vh;
  background: #060a0e;
  border-radius: 8px;
  padding: 6px 8px;
}
/* The SSE log is the events panel's only content, so give it more room. */
#ago-dev-events .dev-log { max-height: 60vh; }
.ago-dev-card .dev-log-line { white-space: pre-wrap; word-break: break-word; line-height: 1.4; }
.ago-dev-card .dev-log-invoke { color: #9ecbff; }
.ago-dev-card .dev-log-result { color: #86efac; }
.ago-dev-card .dev-log-error { color: #fca5a5; }
.ago-dev-card .dev-log-hydrate { color: #d8b4fe; }
.ago-dev-card .dev-log-event { color: #7c8a99; }
`;
