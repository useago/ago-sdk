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

  it("appends an event line for each raw SSE message", () => {
    const client = createMockClient();

    initDevPanel({ client });

    client.__emitEvent("stream:message", {
      type: "client_function",
      function_name: "doThing",
      arguments: { a: 1 },
    });
    client.__emitEvent("stream:message", { content: "Hello" });

    const lines = document.querySelectorAll("#ago-dev-event-log .dev-log-event");
    expect(lines).toHaveLength(2);
    // The leading tag plus the verbatim payload are both shown.
    expect(lines[0].textContent).toContain("client_function");
    expect(lines[0].textContent).toContain("doThing");
    expect(lines[1].textContent).toContain("content");
    expect(lines[1].textContent).toContain("Hello");
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
});
