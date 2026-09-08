import { describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { AgoClient } from "../src/client/AgoClient";
import { AgoProvider } from "../src/react/context/AgoContext";
import { useAgoFunction } from "../src/react/hooks/useAgoFunction";

// React's act() requires this flag outside of @testing-library.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PARAMS = { type: "object" as const, properties: {} };

async function mount(client: AgoClient, Component: React.FC) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <AgoProvider client={client}>
        <Component />
      </AgoProvider>
    );
  });
  return root;
}

function settingsOf(client: AgoClient, name: string) {
  return client.getFunctionRegistrations().find((f) => f.name === name);
}

describe("useAgoFunction webmcp settings", () => {
  it("forwards webmcp metadata to the registry", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });

    function Harness() {
      useAgoFunction({
        name: "openOrder",
        description: "Open one order's detail page",
        parameters: PARAMS,
        handler: () => "ok",
        webmcp: { navigates: true, annotations: { readOnlyHint: true } },
      });
      return <span>ok</span>;
    }

    await mount(client, Harness);

    expect(settingsOf(client, "openOrder")?.webmcp).toEqual({
      navigates: true,
      annotations: { readOnlyHint: true },
    });
  });

  it("forwards the webmcp: false opt-out", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });

    function Harness() {
      useAgoFunction({
        name: "deleteAccount",
        description: "Delete the account",
        parameters: PARAMS,
        handler: () => "gone",
        webmcp: false,
      });
      return <span>ok</span>;
    }

    await mount(client, Harness);

    expect(settingsOf(client, "deleteAccount")?.webmcp).toBe(false);
  });

  it("forwards requiresApproval alongside it", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });

    function Harness() {
      useAgoFunction({
        name: "refund",
        description: "Refund an order",
        parameters: PARAMS,
        handler: () => "refunded",
        requiresApproval: true,
      });
      return <span>ok</span>;
    }

    await mount(client, Harness);

    expect(settingsOf(client, "refund")?.requiresApproval).toBe(true);
  });

  it("does not re-register when webmcp is written inline", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const register = vi.spyOn(client, "registerFunction");
    let rerender = () => {};

    function Harness() {
      const [, setTick] = React.useState(0);
      rerender = () => setTick((n) => n + 1);
      useAgoFunction({
        name: "openOrder",
        description: "Open one order's detail page",
        parameters: PARAMS,
        handler: () => "ok",
        // A fresh object every render: compared by value, not identity.
        webmcp: { navigates: true },
      });
      return <span>ok</span>;
    }

    await mount(client, Harness);
    expect(register).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender();
    });
    expect(register).toHaveBeenCalledTimes(1);
  });
});
