import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initDevPanel } from "../src/devtools";
import { createMockClient } from "../src/testing";

describe("initDevPanel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  });

  it("mounts a #ago-dev-panel into document.body by default", () => {
    const client = createMockClient();

    initDevPanel({ client });

    const panel = document.getElementById("ago-dev-panel");
    expect(panel).not.toBeNull();
    expect(panel?.parentElement).toBe(document.body);
  });

  it("renders the client's context snapshot", () => {
    const client = createMockClient({
      overrides: {
        getContextSnapshot: () => ({
          entries: {
            "form:credit": {
              name: "Form: credit",
              data: { values: { locataire: "1" }, missing: [], complete: true },
            },
          },
        }),
      },
    });

    initDevPanel({ client });

    const stateEl = document.querySelector("#ago-dev-state");
    expect(stateEl?.textContent).toContain("form:credit");
    expect(stateEl?.textContent).toContain('"locataire": "1"');
  });

  it("re-renders the client context after each function:result", () => {
    let values: Record<string, unknown> = {};
    const client = createMockClient({
      overrides: {
        getContextSnapshot: () => ({ entries: { "form:credit": { data: { values } } } }),
      },
    });

    initDevPanel({ client });

    const stateEl = document.querySelector("#ago-dev-state");
    expect(stateEl?.textContent).not.toContain("locataire");

    // The agent fills a field → update_credit runs → function:result fires.
    values = { locataire: "1" };
    client.__emitEvent("function:result", { invocationId: "inv-1", result: { ok: true } });

    expect(stateEl?.textContent).toContain('"locataire": "1"');
  });

  it("re-renders the client context on context:changed", () => {
    // The form collector registers its provider after the panel mounts (or its
    // store hydrates), so the initial snapshot is empty until context:changed fires.
    let installed = false;
    const client = createMockClient({
      overrides: {
        getContextSnapshot: () =>
          installed
            ? { entries: { "form:credit": { data: { values: {}, missing: ["locataire"] } } } }
            : null,
      },
    });

    initDevPanel({ client });

    const stateEl = document.querySelector("#ago-dev-state");
    expect(stateEl?.textContent).not.toContain("locataire");

    // The form collector installs → its dynamic provider registers → context:changed fires.
    installed = true;
    client.__emitEvent("context:changed", {
      entries: { "form:credit": { data: { values: {}, missing: ["locataire"] } } },
    });

    // Missing fields now show, before any function has run.
    expect(stateEl?.textContent).toContain('"missing"');
    expect(stateEl?.textContent).toContain("locataire");
  });

  it("lists registered functions in the header", () => {
    const client = createMockClient({
      overrides: {
        getRegisteredFunctions: () => [
          { name: "doThing", description: "", parameters: { type: "object", properties: {} } },
        ],
      },
    });

    initDevPanel({ client });

    expect(document.querySelector(".dev-fns")?.textContent).toContain("doThing");
  });

  it("appends a log line on function:invoke", () => {
    const client = createMockClient();

    initDevPanel({ client });

    client.__emitEvent("function:invoke", {
      invocationId: "inv-1",
      functionName: "doThing",
      arguments: { a: 1 },
      conversationId: "conv-1",
    });

    const lines = document.querySelectorAll("#ago-dev-log .dev-log-line");
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toContain("doThing");
  });

  it("logs an error line on function:result with an error", () => {
    const client = createMockClient();

    initDevPanel({ client });

    client.__emitEvent("function:result", {
      invocationId: "inv-1",
      result: undefined,
      error: "boom",
    });

    const errorLine = document.querySelector("#ago-dev-log .dev-log-error");
    expect(errorLine?.textContent).toContain("boom");
  });

  it("logs a hydration line on conversation:loaded", () => {
    const client = createMockClient();

    initDevPanel({ client });

    client.__emitEvent("conversation:loaded", {
      id: "conv-1",
      title: "Crédit immo",
      lastMessageDate: new Date(),
      messages: [
        {
          id: "m1",
          conversationId: "conv-1",
          content: "",
          role: "assistant",
          status: "DONE",
          createdAt: new Date(),
          toolCalls: [
            { id: "t1", type: "client_function", status: "done", toolName: "client__update_credit" },
            { id: "t2", type: "client_function", status: "done", toolName: "client__update_credit" },
          ],
        },
      ],
    });

    const hydrateLine = document.querySelector("#ago-dev-log .dev-log-hydrate");
    expect(hydrateLine?.textContent).toContain("hydrated");
    expect(hydrateLine?.textContent).toContain("Crédit immo");
    expect(hydrateLine?.textContent).toContain("2 tool calls");
  });

  it("mounts the SSE event log in its own panel, separate from the main panel", () => {
    initDevPanel({ client: createMockClient() });

    const eventsPanel = document.getElementById("ago-dev-events");
    expect(eventsPanel).not.toBeNull();
    // The event log lives inside the dedicated panel, not the main one.
    expect(eventsPanel?.querySelector("#ago-dev-event-log")).not.toBeNull();
    expect(
      document.getElementById("ago-dev-panel")?.querySelector("#ago-dev-event-log"),
    ).toBeNull();
  });

  it("appends an event line for each raw SSE message", () => {
    const client = createMockClient();

    initDevPanel({ client });

    client.__emitEvent("stream:message", {
      type: "client_function",
      function_name: "doThing",
      arguments: { a: 1 },
    });
    client.__emitEvent("stream:message", { content: "Hello" });

    const lines = document.querySelectorAll(
      "#ago-dev-events #ago-dev-event-log .dev-log-event",
    );
    expect(lines).toHaveLength(2);
    // The leading tag plus the verbatim payload are both shown.
    expect(lines[0].textContent).toContain("client_function");
    expect(lines[0].textContent).toContain("doThing");
    expect(lines[1].textContent).toContain("content");
    expect(lines[1].textContent).toContain("Hello");
  });

  it("collapses the SSE events panel independently of the main panel", () => {
    localStorage.setItem("ago_dev_events_collapsed", "1");

    initDevPanel({ client: createMockClient() });

    // The events panel restores its own collapsed state; the main panel stays open.
    expect(document.getElementById("ago-dev-events")?.classList.contains("collapsed")).toBe(true);
    expect(document.getElementById("ago-dev-panel")?.classList.contains("collapsed")).toBe(false);
  });

  it("mounts into a target given as a CSS selector", () => {
    const host = document.createElement("div");
    host.id = "host";
    document.body.appendChild(host);

    initDevPanel({ client: createMockClient(), target: "#host" });

    expect(document.getElementById("ago-dev-panel")?.parentElement).toBe(host);
  });

  it("mounts into a target given as an Element", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    initDevPanel({ client: createMockClient(), target: host });

    expect(document.getElementById("ago-dev-panel")?.parentElement).toBe(host);
  });

  it("mounts two independent panels, each bound to its own client", () => {
    const a = createMockClient({
      overrides: {
        getContextSnapshot: () => ({ entries: { x: { name: "x", data: { v: "A" } } } }),
      },
    });
    const b = createMockClient({
      overrides: {
        getContextSnapshot: () => ({ entries: { x: { name: "x", data: { v: "B" } } } }),
      },
    });

    initDevPanel({ client: a, label: "A" });
    initDevPanel({ client: b, label: "B" });

    // Two main panels + two SSE panels, in mount order: [mainA, sseA, mainB, sseB].
    const panels = document.querySelectorAll<HTMLElement>("aside.ago-dev-card");
    expect(panels).toHaveLength(4);
    expect(panels[0].querySelector(".dev-state")?.textContent).toContain('"v": "A"');
    expect(panels[2].querySelector(".dev-state")?.textContent).toContain('"v": "B"');
    // The labels surface in each header; the second panel is offset so it does
    // not stack on top of the first.
    expect(panels[0].querySelector(".dev-title")?.textContent).toContain("A");
    expect(panels[2].querySelector(".dev-title")?.textContent).toContain("B");
    expect(panels[0].style.right).toBe("");
    expect(panels[2].style.right).not.toBe("");
  });

  it("re-renders only the panel whose client fired the event", () => {
    let aValues: Record<string, unknown> = {};
    const a = createMockClient({
      overrides: { getContextSnapshot: () => ({ entries: { x: { data: aValues } } }) },
    });
    const b = createMockClient({
      overrides: { getContextSnapshot: () => ({ entries: { x: { data: {} } } }) },
    });

    initDevPanel({ client: a, label: "A" });
    initDevPanel({ client: b, label: "B" });

    const panels = document.querySelectorAll<HTMLElement>("aside.ago-dev-card");
    const mainA = panels[0];
    const mainB = panels[2];

    aValues = { filled: 1 };
    a.__emitEvent("context:changed", {});

    // Only A's panel repaints; B's stays put. (The old singleton bug would have
    // leaked A's state into B's panel and frozen A's.)
    expect(mainA.querySelector(".dev-state")?.textContent).toContain("filled");
    expect(mainB.querySelector(".dev-state")?.textContent).not.toContain("filled");
  });

  it("pins to the left edge when side is \"left\"", () => {
    initDevPanel({ client: createMockClient(), side: "left" });

    const panel = document.getElementById("ago-dev-panel")!;
    const events = document.getElementById("ago-dev-events")!;
    expect(panel.style.left).toBe("16px");
    expect(panel.style.right).toBe("auto");
    expect(events.style.left).toBe("16px");
    expect(events.style.right).toBe("auto");
  });

  it("keeps the default right edge without inline positioning", () => {
    // side defaults to right, where the CSS already pins to right:16px, so the
    // first/only panel needs no inline override.
    initDevPanel({ client: createMockClient() });

    const panel = document.getElementById("ago-dev-panel")!;
    expect(panel.style.left).toBe("");
    expect(panel.style.right).toBe("");
  });

  it("docks each widget on its own side without offsetting", () => {
    // One panel left, one right: each is the first on its side, so neither shifts.
    initDevPanel({ client: createMockClient(), side: "left", label: "A" });
    initDevPanel({ client: createMockClient(), side: "right", label: "B" });

    const panels = document.querySelectorAll<HTMLElement>("aside.ago-dev-card");
    expect(panels[0].style.left).toBe("16px"); // mainA, left edge
    expect(panels[2].style.right).toBe(""); // mainB, default right edge (no offset)
    expect(panels[2].style.left).toBe("");
  });

  it("shifts a second panel over when both land on the same side", () => {
    initDevPanel({ client: createMockClient(), side: "left" });
    initDevPanel({ client: createMockClient(), side: "left" });

    const panels = document.querySelectorAll<HTMLElement>("aside.ago-dev-card");
    expect(panels[0].style.left).toBe("16px"); // first left panel
    expect(panels[2].style.left).toBe("392px"); // second left panel shifts over
  });
});
