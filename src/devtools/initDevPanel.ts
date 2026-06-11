import type { AgoClient } from "../client/AgoClient";

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
}

let stateEl: HTMLElement | null;
let logEl: HTMLElement | null;
let getStateFn: () => unknown = () => ({});

// Re-render the JSON pane. Painted on init and after each function event.
function renderState(): void {
  if (!stateEl) return;
  stateEl.textContent = JSON.stringify(getStateFn(), null, 2);
}

function logLine(
  text: string,
  kind: "invoke" | "result" | "error" | "hydrate",
): void {
  if (!logEl) return;
  const line = document.createElement("div");
  line.className = `dev-log-line dev-log-${kind}`;
  const time = new Date().toLocaleTimeString();
  line.textContent = `${time}  ${text}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

const COLLAPSE_KEY = "ago_dev_panel_collapsed";

function setCollapsed(panel: HTMLElement, collapsed: boolean): void {
  panel.classList.toggle("collapsed", collapsed);
  const toggle = panel.querySelector<HTMLButtonElement>(".dev-toggle");
  if (toggle) {
    toggle.textContent = collapsed ? "▢" : "—";
    toggle.title = collapsed ? "Expand dev tools" : "Collapse dev tools";
    toggle.setAttribute("aria-expanded", String(!collapsed));
  }
  try {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  } catch {
    // localStorage may be unavailable; collapse state just won't persist.
  }
}

export function initDevPanel(options: DevPanelOptions): void {
  const { client, target } = options;
  // Live JSON pane: the client's context snapshot
  getStateFn = () => {
    const entries = client.getContextSnapshot()?.entries ?? {};
    return Object.fromEntries(
      Object.entries(entries).map(([key, { name, data }]) => [
        key,
        { name, data },
      ]),
    );
  };
  injectStyles();
  const host =
    typeof target === "string"
      ? document.querySelector(target)
      : target instanceof Element
        ? target
        : document.body;
  const panel = document.createElement("aside");
  panel.id = "ago-dev-panel";
  (host ?? document.body).appendChild(panel);

  const registered = client.getRegisteredFunctions?.() ?? [];
  const fnNames = registered.map((f) => f.name).join(", ") || "—";

  panel.innerHTML = `
    <div class="dev-head">
      <span class="dev-badge">DEV</span>
      <span class="dev-title">DEV TOOLS · client-side function state — not for production</span>
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

  stateEl = panel.querySelector<HTMLElement>("#ago-dev-state");
  logEl = panel.querySelector<HTMLElement>("#ago-dev-log");

  const toggle = panel.querySelector<HTMLButtonElement>(".dev-toggle");
  toggle?.addEventListener("click", (e) => {
    e.stopPropagation();
    setCollapsed(panel, !panel.classList.contains("collapsed"));
  });
  // When collapsed, the whole widget acts as an expand button.
  panel.addEventListener("click", () => {
    if (panel.classList.contains("collapsed")) setCollapsed(panel, false);
  });

  let startCollapsed = false;
  try {
    startCollapsed = localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    // ignore
  }
  setCollapsed(panel, startCollapsed);

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
#ago-dev-panel {
  position: fixed;
  top: 16px;
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
#ago-dev-panel .dev-head { display: flex; align-items: center; gap: 8px; }
#ago-dev-panel .dev-toggle {
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
#ago-dev-panel .dev-toggle:hover { color: #d7e0e8; border-color: #3a4655; }
#ago-dev-panel .dev-body { display: flex; flex-direction: column; gap: 8px; }

/* Collapsed: shrink to a small clickable widget showing only the DEV badge. */
#ago-dev-panel.collapsed {
  width: auto;
  cursor: pointer;
  padding: 8px 10px;
}
#ago-dev-panel.collapsed .dev-title,
#ago-dev-panel.collapsed .dev-body { display: none; }
#ago-dev-panel.collapsed .dev-toggle { margin-left: 6px; }
#ago-dev-panel .dev-badge {
  background: #f59e0b;
  color: #1c1206;
  font-weight: 700;
  font-size: 10px;
  letter-spacing: .08em;
  padding: 2px 6px;
  border-radius: 5px;
}
#ago-dev-panel .dev-title { color: #f59e0b; font-size: 11px; line-height: 1.3; }
#ago-dev-panel .dev-fns { color: #7c8a99; font-size: 11px; }
#ago-dev-panel .dev-fns code { color: #9ecbff; }
#ago-dev-panel .dev-section-label {
  color: #7c8a99;
  text-transform: uppercase;
  letter-spacing: .08em;
  font-size: 10px;
  margin-top: 4px;
}
#ago-dev-panel .dev-state {
  margin: 0;
  padding: 8px;
  background: #060a0e;
  border-radius: 8px;
  overflow: auto;
  max-height: 40vh;
  white-space: pre;
  color: #c8e6c9;
}
#ago-dev-panel .dev-log {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  max-height: 24vh;
  background: #060a0e;
  border-radius: 8px;
  padding: 6px 8px;
}
#ago-dev-panel .dev-log-line { white-space: pre-wrap; word-break: break-word; line-height: 1.4; }
#ago-dev-panel .dev-log-invoke { color: #9ecbff; }
#ago-dev-panel .dev-log-result { color: #86efac; }
#ago-dev-panel .dev-log-error { color: #fca5a5; }
#ago-dev-panel .dev-log-hydrate { color: #d8b4fe; }
`;
