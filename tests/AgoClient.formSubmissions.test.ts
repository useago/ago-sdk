// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import { createFormCollector } from "../src/forms/createFormCollector";

const json = (body: unknown) => new Response(JSON.stringify(body), {
  headers: { "Content-Type": "application/json" },
});

afterEach(() => vi.unstubAllGlobals());

it.each(["live", "reopened"])("links submissions to a %s discussion and clears context on reset", async (source) => {
  const submitted: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (String(url).endsWith("/forms/submit")) {
      submitted.push(JSON.parse(String(init?.body)));
      return json({ status: "completed" });
    }
    if (String(url).includes("/conversations/")) {
      return json({ id: "conversation-1", title: "Order", messages: [] });
    }
    if (!String(url).endsWith("/messages")) return json({ status: "completed" });
    return new Response([
      { message_id: "m1", thread: { id: "conversation-1" }, type: "client_function",
        status: "waiting_input", id: "call-1", function_name: "update_order", arguments: { product: "Widget" } },
      { message_id: "m1", thread: { id: "conversation-1" }, content: "Thanks", status: "DONE" },
    ].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join(""));
  }));
  const client = new AgoClient({ baseUrl: "https://example.test" });
  const form = createFormCollector({
    name: "order", description: "Order",
    schema: { type: "object", properties: { product: { type: "string" } }, required: ["product"] },
    submit: { via: "backend" },
  });
  const uninstall = form.install(client);
  if (source === "live") {
    await client.sendMessage("Order a Widget");
  } else {
    await client.getConversation("conversation-1");
    form.setValues({ product: "Widget" });
  }
  await expect.poll(() => form.store.get().submitted).toBe(true);
  form.reset();
  form.setValues({ product: "Widget" });
  await expect.poll(() => form.store.get().submitted).toBe(true);
  expect(submitted).toEqual([
    { name: "order", values: { product: "Widget" }, conversation_id: "conversation-1" },
    { name: "order", values: { product: "Widget" } },
  ]);
  uninstall();
  client.destroy();
});
