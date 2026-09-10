import { afterEach, expect, it, vi } from "vitest";
import React, { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { AgoClient } from "../src/client/AgoClient";
import type { AgoConfig } from "../src/client/types";
import { AgoProvider, useAgoClient } from "../src/react/context/AgoContext";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.unstubAllGlobals());

it("follows the interface language prop without losing the React client or its conversation", async () => {
  const requests: { headers: Headers; body: Record<string, any> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    requests.push({ headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
    return new Response('data: {"message_id":"m1","thread":{"id":"t1"},"content":"OK","status":"DONE"}\n\n');
  }));
  let client!: AgoClient;
  function Child() {
    client = useAgoClient();
    return null;
  }
  function Harness({ language }: Pick<AgoConfig, "language">) {
    return <StrictMode><AgoProvider baseUrl="https://example.test" language={language}><Child /></AgoProvider></StrictMode>;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Harness language="fr" />));
    const original = client;
    await client.sendMessage("first");
    await act(async () => root.render(<Harness language="de" />));
    expect(client).toBe(original);
    await client.sendMessage("updated", { conversationId: "t1" });
    await act(async () => root.render(<Harness />));
    expect(client).toBe(original);
    await client.sendMessage("removed", { conversationId: "t1" });
    expect(requests.map(r => r.headers.get("Accept-Language"))).toEqual(["fr", "de", null]);
    for (const request of requests) expect(request.body.client_context).toBeUndefined();
    expect(requests[1].body.conversation_id).toBe("t1");
    expect(requests[2].body.conversation_id).toBe("t1");
  } finally {
    await act(async () => root.unmount());
  }
});
