import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import type { ContextSnapshot } from "../src/state/ClientContextRegistry";
import type { PageStateChange } from "../src/state/pageStateDelta";

// buildSendContext is private; drive it directly for the wiring test.
const send = (client: AgoClient): ContextSnapshot | null =>
  (client as unknown as { buildSendContext(): ContextSnapshot | null }).buildSendContext();

const delta = (snap: ContextSnapshot | null): PageStateChange[] | undefined =>
  (snap?.entries["state:delta"]?.data as { changes: PageStateChange[] } | undefined)?.changes;

describe("AgoClient page-state delta", () => {
  let client: AgoClient;
  let filter = "all";
  let page = "a";

  beforeEach(() => {
    filter = "all";
    page = "a";
    client = new AgoClient({ baseUrl: "https://example.test" });
    client.addDynamicContext("current-page", () => ({ data: { page } }));
    client.addDynamicContext("page-state:list", () => ({ data: { filter } }));
  });

  afterEach(() => client.destroy());

  it("emits no delta on the first send", () => {
    expect(delta(send(client))).toBeUndefined();
  });

  it("emits a delta when a field changes since the last send", () => {
    send(client);
    filter = "pending";
    expect(delta(send(client))).toEqual([
      { field: "filter", from: "all", to: "pending" },
    ]);
  });

  it("emits no delta when nothing changed", () => {
    send(client);
    expect(delta(send(client))).toBeUndefined();
  });

  it("emits no delta across a navigation", () => {
    send(client);
    page = "b";
    filter = "shipped";
    expect(delta(send(client))).toBeUndefined();
  });
});
