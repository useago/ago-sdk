import { afterEach, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { AgoClient } from "../src/client/AgoClient";
import type { AgoConfig } from "../src/client/types";
import { useAgo } from "../src/react/hooks/useAgo";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.unstubAllGlobals());

it("updates and removes metadata on rerender without recreating the React client", async () => {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response('data: {"message_id":"m1","thread":{"id":"t1"},"content":"OK","status":"DONE"}\n\n');
  }));
  let client!: AgoClient;
  function Harness({ metadata }: Pick<AgoConfig, "metadata">) {
    client = useAgo({ baseUrl: "https://example.test", metadata }).client;
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Harness metadata={{ plan: "Free" }} />));
    const original = client;
    await client.sendMessage("first");
    await act(async () => root.render(<Harness metadata={{ plan: "Pro" }} />));
    expect(client).toBe(original);
    await client.sendMessage("updated");
    await act(async () => root.render(<Harness />));
    expect(client).toBe(original);
    await client.sendMessage("removed");
    expect(bodies.map(body => body.metadata)).toEqual([{ plan: "Free" }, { plan: "Pro" }, undefined]);
    expect(bodies[2]).not.toHaveProperty("metadata");
  } finally {
    await act(async () => root.unmount());
  }
});
