import { describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { AgoClient } from "../src/client/AgoClient";
import { AgoProvider } from "../src/react/context/AgoContext";
import { useAgoPageState } from "../src/react/hooks/useAgoFunction";
import type { FunctionRegistry } from "../src/functions/FunctionRegistry";

// React's act() requires this flag outside of @testing-library.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function execute(client: AgoClient, name: string, args: Record<string, unknown>) {
  const registry = (client as unknown as { functionRegistry: FunctionRegistry })
    .functionRegistry;
  return registry.execute(name, args);
}

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
  return { root, container };
}

describe("useAgoPageState", () => {
  it("registers setPageState on mount and cleans up on unmount", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });

    function Harness() {
      useAgoPageState([
        { name: "statusFilter", description: "Filter", schema: { type: "string" }, get: () => "all", set: () => {} },
      ]);
      return <span>ok</span>;
    }

    const { root } = await mount(client, Harness);

    expect(client.getRegisteredFunctions().map((s) => s.name)).toContain("setPageState");
    expect(client.getContextSnapshot()?.entries["page-state:setPageState"]).toBeDefined();

    await act(async () => {
      root.unmount();
    });

    expect(client.getRegisteredFunctions()).toHaveLength(0);
    expect(client.getContextSnapshot()).toBeNull();
  });

  it("routes set() to the freshest closure without re-registering", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const registerSpy = vi.spyOn(client, "registerPageStateFunction");

    function Harness() {
      const [status, setStatus] = React.useState("all");
      useAgoPageState([
        {
          name: "statusFilter",
          description: "Filter",
          schema: { type: "string" },
          get: () => status,
          set: (v) => setStatus(v as string),
        },
      ]);
      return <span>{status}</span>;
    }

    const { root, container } = await mount(client, Harness);
    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("all");

    // The agent invokes the synthesized function; the latest set() closure runs
    // and the component re-renders — without re-registering.
    await act(async () => {
      await execute(client, "setPageState", { statusFilter: "pending" });
    });
    expect(container.textContent).toBe("pending");
    expect(registerSpy).toHaveBeenCalledTimes(1);

    // The live getter reflects the new value too.
    expect(client.getContextSnapshot()?.entries["page-state:setPageState"].data).toEqual({
      statusFilter: "pending",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("honours a custom functionName", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });

    function Harness() {
      useAgoPageState(
        [{ name: "sort", description: "Sort", schema: { type: "string" }, set: () => {} }],
        { functionName: "applyView" }
      );
      return <span>ok</span>;
    }

    const { root } = await mount(client, Harness);
    expect(client.getRegisteredFunctions().map((s) => s.name)).toContain("applyView");

    await act(async () => {
      root.unmount();
    });
    expect(client.getRegisteredFunctions()).toHaveLength(0);
  });
});
