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

  it("returns the rows produced by the agent's own change, no re-registration", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const registerSpy = vi.spyOn(client, "registerPageStateFunction");

    function Harness() {
      const [query, setQuery] = React.useState("");
      // Derived on every render: the closure the hook registered at mount is
      // already stale by the time the agent's call comes back.
      const rows = query ? [`row-for-${query}`] : ["row-initial"];
      useAgoPageState(
        [
          {
            name: "query",
            description: "Search",
            schema: { type: "string" },
            get: () => query,
            set: (v) => setQuery(v as string),
          },
        ],
        { data: { description: "The rows on screen.", get: () => rows } }
      );
      return <span>{rows.join(",")}</span>;
    }

    const { root, container } = await mount(client, Harness);
    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(client.getRegisteredFunctions().map((s) => s.name).sort()).toEqual([
      "readPageData",
      "setPageState",
    ]);

    // Start the call inside act() but await it outside: act only commits
    // pending work when its scope exits, so awaiting in there would read the
    // pre-commit render. In a browser React commits within the first poll tick
    // — which is the whole reason the settle loop waits at all.
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = execute(client, "setPageState", { query: "dupont" });
    });
    const result = await pending;

    expect(container.textContent).toBe("row-for-dupont");
    expect(result).toEqual({
      success: true,
      applied: { query: "dupont" },
      data: ["row-for-dupont"],
    });
    // The stale-closure rows would have been ["row-initial"].
    expect(registerSpy).toHaveBeenCalledTimes(1);

    // readPageData sees the same fresh render, and changes nothing.
    expect(await execute(client, "readPageData", {})).toEqual({
      data: ["row-for-dupont"],
    });
    expect(container.textContent).toBe("row-for-dupont");

    await act(async () => {
      root.unmount();
    });
    expect(client.getRegisteredFunctions()).toHaveLength(0);
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

// Two components alive under one `setPageState` at once. This is NOT a keyed
// route swap (React destroys the old subtree before creating the new one, so
// those never overlap) — it is an overlapping mount: an animated route
// transition that keeps the outgoing page in the tree, a modal or drawer over a
// page, or a layout with two panels. Before the LIFO stack, the first component
// to unmount deleted whichever registration was newest, so the surviving
// component silently lost its page state.
describe("useAgoPageState with two overlapping owners", () => {
  const control = (name: string) => ({
    name,
    description: `${name} control`,
    schema: { type: "string" as const },
    get: () => "x",
    set: () => {},
  });

  function schemaOf(client: AgoClient, name: string) {
    return client.getRegisteredFunctions().find((s) => s.name === name);
  }

  function Page({ name, data }: { name: string; data?: boolean }) {
    useAgoPageState(
      [control(name)],
      data ? { data: { description: `${name} rows`, get: () => [name] } } : undefined
    );
    return <span>{name}</span>;
  }

  it("the outgoing owner unmounting leaves the incoming owner registered", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    // Both mounted: the incoming page overlaps the outgoing one.
    await act(async () => {
      root.render(
        <AgoProvider client={client}>
          <Page key="sort" name="sort" />
          <Page key="lactose" name="lactose" />
        </AgoProvider>
      );
    });

    // The outgoing page leaves; the incoming one stays.
    await act(async () => {
      root.render(
        <AgoProvider client={client}>
          <Page key="lactose" name="lactose" />
        </AgoProvider>
      );
    });

    const after = schemaOf(client, "setPageState");
    expect(after).toBeDefined();
    expect(Object.keys(after!.parameters.properties)).toEqual(["lactose"]);

    await act(async () => root.unmount());
    expect(schemaOf(client, "setPageState")).toBeUndefined();
  });

  it("keeps the surviving owner's readPageData companion", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AgoProvider client={client}>
          <Page key="sort" name="sort" data />
          <Page key="lactose" name="lactose" data />
        </AgoProvider>
      );
    });
    await act(async () => {
      root.render(
        <AgoProvider client={client}>
          <Page key="lactose" name="lactose" data />
        </AgoProvider>
      );
    });

    expect(schemaOf(client, "readPageData")?.description).toContain("lactose rows");

    await act(async () => root.unmount());
    expect(schemaOf(client, "readPageData")).toBeUndefined();
  });
});
