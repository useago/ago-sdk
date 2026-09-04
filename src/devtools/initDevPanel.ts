import type { AgoClient } from "../client/AgoClient";
import { AgoError } from "../client/errors";
import type { AgoClientEvents, SSEChunkData } from "../client/types";

/** Options for {@link initDevPanel}. */
export interface DevPanelOptions {
  /**
   * The AGO client to debug. The panel lists its registered functions, logs its
   * function events, and renders the name + data of each entry in its live context
   * snapshot (`client.getContextSnapshot()`)
   */
  client: Pick<
    AgoClient,
    "on" | "off" | "getRegisteredFunctions" | "getContextSnapshot"
  > & {
    executeClientFunction?: AgoClient["executeClientFunction"];
  };
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
  /**
   * Mount a local function runner in the panel. The runner executes registered
   * client functions locally via `client.executeClientFunction` and displays
   * the result. It never submits to the backend. Developer-only.
   */
  enableFunctionRunner?: boolean;
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

let nextPanelId = 0;

export function initDevPanel(options: DevPanelOptions): () => void {
  const { client, target, label, side = "right", enableFunctionRunner = false } = options;

  if (enableFunctionRunner && typeof client.executeClientFunction !== "function") {
    throw new AgoError(
      "initDevPanel: enableFunctionRunner requires client.executeClientFunction. " +
      "Pass a real AgoClient, not a mock that omits it.",
      "dev_panel_missing_capability",
    );
  }

  let disposed = false;

  const panelId = nextPanelId++;
  const suffix = panelId === 0 ? "" : `-${panelId + 1}`;
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
    if (disposed) return;
    if (stateEl) stateEl.textContent = JSON.stringify(getState(), null, 2);
  };
  const logLine = (
    text: string,
    kind: "invoke" | "result" | "error" | "hydrate",
  ): void => {
    if (disposed) return;
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
      <div class="dev-fns">Registered functions: <code></code></div>
      <details class="dev-details" open>
        <summary class="dev-section-label">JSON object (built by the agent)</summary>
        <pre class="dev-state" id="ago-dev-state"></pre>
      </details>
      <details class="dev-details" open>
        <summary class="dev-section-label">Function calls</summary>
        <div class="dev-log" id="ago-dev-log"></div>
      </details>
    </div>
  `;

  // Look up by class, not id: two panels on one page share the same ids, so an
  // id query could resolve to the wrong panel. Each class is unique within a panel.
  stateEl = panel.querySelector<HTMLElement>(".dev-state");
  logEl = panel.querySelector<HTMLElement>(".dev-log");
  const fnsCodeEl = panel.querySelector<HTMLElement>(".dev-fns code");

  // Runner DOM refs (created later if enabled).
  let runnerSelectEl: HTMLSelectElement | null = null;
  let runnerSchemaEl: HTMLElement | null = null;

  // Re-read registered functions, update the summary line, the runner selector,
  // and the displayed schema. Called on init and after events that change the
  // function set (navigation, registration lifecycle, local runner calls).
  let lastSelectedFn = "";
  const renderFunctions = (): void => {
    if (disposed) return;
    const fns = client.getRegisteredFunctions?.() ?? [];
    const names = fns.map((f) => f.name);
    if (fnsCodeEl) fnsCodeEl.textContent = names.join(", ") || "—";

    if (!runnerSelectEl) return;

    // Preserve selection when the function still exists, otherwise pick
    // setPageState, then the first function, then nothing.
    let selected = lastSelectedFn;
    if (!names.includes(selected)) {
      selected = names.includes("setPageState")
        ? "setPageState"
        : names[0] ?? "";
    }
    lastSelectedFn = selected;

    // Rebuild options.
    runnerSelectEl.innerHTML = "";
    if (names.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "(no functions registered)";
      opt.disabled = true;
      runnerSelectEl.appendChild(opt);
    }
    for (const name of names) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      opt.selected = name === selected;
      runnerSelectEl.appendChild(opt);
    }

    // Update displayed schema.
    if (runnerSchemaEl) {
      const fn = fns.find((f) => f.name === selected);
      runnerSchemaEl.textContent = fn
        ? JSON.stringify(fn.parameters ?? {}, null, 2)
        : "";
    }
  };

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

  // Named handlers so they can be removed with client.off on disposal.
  function onStreamMessage(data: SSEChunkData): void {
    if (disposed) return;
    appendLine(eventLogEl, describeChunk(data), "event");
  }

  function onFunctionInvoke({ functionName, arguments: args }: AgoClientEvents["function:invoke"]): void {
    if (disposed) return;
    logLine(`→ ${functionName}(${JSON.stringify(args ?? {})})`, "invoke");
    renderFunctions();
  }

  function onFunctionResult({ result, error }: AgoClientEvents["function:result"]): void {
    if (disposed) return;
    logLine(
      error ? `✗ error: ${error}` : `← ${JSON.stringify(result)}`,
      error ? "error" : "result",
    );
    renderState();
    renderFunctions();
  }

  function onContextChanged(): void {
    if (disposed) return;
    renderState();
    renderFunctions();
  }

  function onFunctionsChanged(): void {
    if (disposed) return;
    renderFunctions();
  }

  function onConversationLoaded(conversation: AgoClientEvents["conversation:loaded"]): void {
    if (disposed) return;
    const toolCalls = (conversation.messages ?? []).flatMap(
      (m) => m.toolCalls ?? [],
    );
    const convLabel = conversation.title || conversation.id;
    logLine(
      `⟳ hydrated "${convLabel}" — replayed ${toolCalls.length} tool call${
        toolCalls.length === 1 ? "" : "s"
      }`,
      "hydrate",
    );
    renderState();
  }

  client.on("stream:message", onStreamMessage);
  client.on("function:invoke", onFunctionInvoke);
  client.on("function:result", onFunctionResult);
  client.on("context:changed", onContextChanged);
  client.on("conversation:loaded", onConversationLoaded);
  // Functions come and go with the page, so repaint as they change rather than
  // only on demand.
  client.on("functions:changed", onFunctionsChanged);

  // --- Optional local function runner ---
  if (enableFunctionRunner) {
    const runner = document.createElement("div");
    runner.className = "dev-runner";

    const heading = document.createElement("div");
    heading.className = "dev-section-label";
    heading.textContent = "LOCAL FUNCTION RUNNER";
    runner.appendChild(heading);

    const warning = document.createElement("div");
    warning.className = "dev-runner-warning";
    warning.textContent = "Executes locally. Does not contact the agent backend.";
    runner.appendChild(warning);

    // Function selector row.
    const selectorRow = document.createElement("div");
    selectorRow.className = "dev-runner-row";
    const select = document.createElement("select");
    select.className = "dev-runner-select";
    selectorRow.appendChild(select);
    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "dev-runner-btn dev-runner-btn-sm";
    refreshBtn.textContent = "Refresh";
    refreshBtn.addEventListener("click", renderFunctions);
    selectorRow.appendChild(refreshBtn);
    runner.appendChild(selectorRow);

    runnerSelectEl = select;

    // Schema display.
    const schemaLabel = document.createElement("div");
    schemaLabel.className = "dev-section-label";
    schemaLabel.textContent = "SCHEMA";
    runner.appendChild(schemaLabel);
    const schemaPre = document.createElement("pre");
    schemaPre.className = "dev-runner-schema";
    runner.appendChild(schemaPre);
    runnerSchemaEl = schemaPre;

    select.addEventListener("change", () => {
      lastSelectedFn = select.value;
      renderFunctions();
    });

    // Arguments textarea.
    const argsLabel = document.createElement("div");
    argsLabel.className = "dev-section-label";
    argsLabel.textContent = "ARGUMENTS (JSON)";
    runner.appendChild(argsLabel);
    const textarea = document.createElement("textarea");
    textarea.className = "dev-runner-args";
    textarea.value = "{}";
    textarea.spellcheck = false;
    runner.appendChild(textarea);

    // Run button.
    const runBtn = document.createElement("button");
    runBtn.type = "button";
    runBtn.className = "dev-runner-btn";
    runBtn.textContent = "Run";
    runner.appendChild(runBtn);

    // Result area.
    const statusEl = document.createElement("div");
    statusEl.className = "dev-runner-status";
    runner.appendChild(statusEl);
    const resultPre = document.createElement("pre");
    resultPre.className = "dev-runner-result";
    runner.appendChild(resultPre);
    const bytesEl = document.createElement("div");
    bytesEl.className = "dev-runner-bytes";
    runner.appendChild(bytesEl);

    const exec = client.executeClientFunction!.bind(client);

    runBtn.addEventListener("click", async () => {
      statusEl.textContent = "";
      resultPre.textContent = "";
      bytesEl.textContent = "";

      let args: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(textarea.value);
        if (
          parsed === null ||
          Array.isArray(parsed) ||
          typeof parsed !== "object"
        ) {
          statusEl.textContent = "Error: arguments must be a JSON object.";
          statusEl.className = "dev-runner-status dev-runner-error";
          return;
        }
        args = parsed as Record<string, unknown>;
      } catch (e) {
        statusEl.textContent = `Parse error: ${e instanceof Error ? e.message : String(e)}`;
        statusEl.className = "dev-runner-status dev-runner-error";
        return;
      }

      const fnName = select.value;
      if (!fnName) return;

      runBtn.disabled = true;
      statusEl.textContent = "Running…";
      statusEl.className = "dev-runner-status";

      let result: unknown;
      let execOk = false;
      try {
        result = await exec(fnName, args);
        execOk = true;
      } catch (err) {
        if (disposed) return;
        statusEl.textContent = "Execution error";
        statusEl.className = "dev-runner-status dev-runner-error";
        resultPre.textContent = err instanceof Error
          ? `${err.constructor.name}: ${err.message}`
          : String(err);
      }

      if (disposed) return;

      if (execOk) {
        statusEl.textContent = "OK";
        statusEl.className = "dev-runner-status dev-runner-ok";
        if (result === undefined) {
          resultPre.textContent = "(undefined)";
        } else {
          try {
            resultPre.textContent = JSON.stringify(result, null, 2);
            const bytes = new TextEncoder().encode(JSON.stringify(result)).length;
            bytesEl.textContent = `${bytes} bytes (UTF-8)`;
          } catch {
            resultPre.textContent = "(result not serializable)";
          }
        }
      }

      runBtn.disabled = false;
      renderState();
      renderFunctions();
    });

    panel.querySelector(".dev-body")!.appendChild(runner);
  }

  // Paint the initial state.
  renderFunctions();
  renderState();

  return () => {
    if (disposed) return;
    disposed = true;

    client.off("stream:message", onStreamMessage);
    client.off("function:invoke", onFunctionInvoke);
    client.off("function:result", onFunctionResult);
    client.off("context:changed", onContextChanged);
    client.off("conversation:loaded", onConversationLoaded);
    client.off("functions:changed", onFunctionsChanged);

    panel.remove();
    eventsPanel.remove();
  };
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
.ago-dev-card .dev-body { display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow-y: auto; }

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
.ago-dev-card .dev-details { margin: 0; }
.ago-dev-card .dev-details > summary { list-style: none; cursor: pointer; }
.ago-dev-card .dev-details > summary::-webkit-details-marker { display: none; }
.ago-dev-card .dev-details > summary::before { content: "▸ "; }
.ago-dev-card .dev-details[open] > summary::before { content: "▾ "; }
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
/* Function runner */
.ago-dev-card .dev-runner { border-top: 1px solid #2a3441; padding-top: 8px; margin-top: 4px; }
.ago-dev-card .dev-runner-warning { color: #f59e0b; font-size: 10px; margin-bottom: 4px; }
.ago-dev-card .dev-runner-row { display: flex; gap: 6px; align-items: center; }
.ago-dev-card .dev-runner-select {
  flex: 1;
  background: #060a0e; color: #d7e0e8; border: 1px solid #2a3441;
  border-radius: 6px; padding: 4px 6px; font: inherit; font-size: 11px;
}
.ago-dev-card .dev-runner-btn {
  background: #1a2633; color: #9ecbff; border: 1px solid #2a3441;
  border-radius: 6px; padding: 4px 10px; font: inherit; font-size: 11px;
  cursor: pointer;
}
.ago-dev-card .dev-runner-btn:hover { background: #243040; }
.ago-dev-card .dev-runner-btn:disabled { opacity: .5; cursor: default; }
.ago-dev-card .dev-runner-btn-sm { padding: 4px 8px; }
.ago-dev-card .dev-runner-schema {
  margin: 0; padding: 6px 8px; background: #060a0e;
  border-radius: 6px; overflow: auto; max-height: 16vh;
  white-space: pre; color: #7c8a99; font-size: 11px;
}
.ago-dev-card .dev-runner-args {
  width: 100%; box-sizing: border-box; min-height: 48px; max-height: 20vh;
  resize: vertical; background: #060a0e; color: #d7e0e8;
  border: 1px solid #2a3441; border-radius: 6px; padding: 6px 8px;
  font: inherit; font-size: 11px;
}
.ago-dev-card .dev-runner-status { font-size: 11px; margin-top: 4px; }
.ago-dev-card .dev-runner-ok { color: #86efac; }
.ago-dev-card .dev-runner-error { color: #fca5a5; }
.ago-dev-card .dev-runner-result {
  margin: 0; padding: 6px 8px; background: #060a0e;
  border-radius: 6px; overflow: auto; max-height: 24vh;
  white-space: pre-wrap; word-break: break-word;
  color: #c8e6c9; font-size: 11px;
}
.ago-dev-card .dev-runner-result:empty { display: none; }
.ago-dev-card .dev-runner-bytes { color: #7c8a99; font-size: 10px; margin-top: 2px; }
.ago-dev-card .dev-runner-bytes:empty { display: none; }
`;
