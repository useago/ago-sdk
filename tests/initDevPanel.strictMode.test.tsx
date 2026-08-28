import { describe, it, expect, afterEach } from "vitest";
import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AgoProvider, useAgoClient } from "../src/react";
import { initDevPanel } from "../src/devtools";
import { createMockClient, type MockAgoClient } from "../src/testing";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    root.unmount();
    root = null;
  }
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

async function renderStrictMode(ui: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root!.render(<React.StrictMode>{ui}</React.StrictMode>);
  });
}

describe("initDevPanel under React StrictMode", () => {
  it("leaves exactly one main panel and one SSE panel with an internally-created client", async () => {
    function Bridge() {
      const client = useAgoClient();
      useEffect(() => initDevPanel({ client }), [client]);
      return null;
    }

    await renderStrictMode(
      <AgoProvider baseUrl="https://example.test">
        <Bridge />
      </AgoProvider>,
    );

    expect(document.querySelectorAll("#ago-dev-panel")).toHaveLength(1);
    expect(document.querySelectorAll("#ago-dev-events")).toHaveLength(1);
  });

  it("SSE events reach the surviving panel after StrictMode settles", async () => {
    const client = createMockClient();

    function Bridge({ mock }: { mock: MockAgoClient }) {
      useEffect(() => initDevPanel({ client: mock }), [mock]);
      return null;
    }

    await renderStrictMode(
      <AgoProvider client={client}>
        <Bridge mock={client} />
      </AgoProvider>,
    );

    expect(document.querySelectorAll("#ago-dev-panel")).toHaveLength(1);

    client.__emitEvent("stream:message", { type: "content", content: "hello-from-sse" });

    const eventLog = document.querySelector("#ago-dev-event-log");
    const lines = eventLog?.querySelectorAll(".dev-log-line") ?? [];
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toContain("hello-from-sse");
  });
});
