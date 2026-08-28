import { describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { AgoClient } from "../src/client/AgoClient";
import { AgoProvider } from "../src/react/context/AgoContext";
import { useAgoPageState } from "../src/react/hooks/useAgoFunction";

// React's act() requires this flag outside of @testing-library.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function execute(client: AgoClient, name: string, args: Record<string, unknown>) {
  return client.executeClientFunction(name, args);
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
      applied: ["query"],
      unchanged: [],
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

  it("forwards clearable through to the synthesised schema and handler", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    let stored = "hello";

    function Harness() {
      useAgoPageState([
        {
          name: "greeting",
          description: "A greeting",
          schema: { type: "string", enum: ["hello", "hi"] },
          clearable: true,
          get: () => stored,
          set: (v) => { stored = v as string; },
        },
      ]);
      return <span>ok</span>;
    }

    const { root } = await mount(client, Harness);

    // The advertised schema should include "" in the enum and the clear hint.
    const fn = client.getRegisteredFunctions().find((f) => f.name === "setPageState")!;
    const prop = fn.parameters.properties["greeting"];
    expect(prop.enum).toContain("");
    expect(prop.description).toContain('Pass "" to clear it.');

    // Sending "" should APPLY (not DROP).
    const result = await execute(client, "setPageState", { greeting: "" });
    expect(result).toEqual({
      success: true,
      applied: ["greeting"],
      unchanged: [],
    });
    expect(stored).toBe("");

    await act(async () => { root.unmount(); });
  });

  it("re-registers when a control's enum is populated after mount", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const registerSpy = vi.spyOn(client, "registerPageStateFunction");
    let stored = "";
    let triggerRerender!: () => void;

    function Harness() {
      const [models, setModels] = React.useState<string[]>([]);
      triggerRerender = () => setModels(["gpt-4", "claude-3"]);
      useAgoPageState([
        {
          name: "model",
          description: "The model",
          schema: { type: "string", enum: models },
          get: () => stored,
          set: (v) => { stored = v as string; },
        },
      ]);
      return <span>{models.join(",")}</span>;
    }

    const { root, container } = await mount(client, Harness);
    expect(registerSpy).toHaveBeenCalledTimes(1);

    // At mount the enum is empty, so any value should be rejected.
    const fn0 = client.getRegisteredFunctions().find((f) => f.name === "setPageState")!;
    expect(fn0.parameters.properties["model"].enum).toEqual([]);

    const r0 = await execute(client, "setPageState", { model: "gpt-4" });
    expect(r0).toMatchObject({ success: false, rejected: { model: expect.stringContaining("not an allowed value") } });

    // Simulate async load completing — enum populated.
    await act(async () => { triggerRerender(); });
    expect(container.textContent).toBe("gpt-4,claude-3");

    // The hook should have re-registered with the new enum.
    expect(registerSpy.mock.calls.length).toBeGreaterThan(1);
    const fn1 = client.getRegisteredFunctions().find((f) => f.name === "setPageState")!;
    expect(fn1.parameters.properties["model"].enum).toEqual(["gpt-4", "claude-3"]);

    // Now the value should be accepted.
    const r1 = await execute(client, "setPageState", { model: "gpt-4" });
    expect(r1).toMatchObject({ success: true, applied: ["model"] });
    expect(stored).toBe("gpt-4");

    await act(async () => { root.unmount(); });
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
