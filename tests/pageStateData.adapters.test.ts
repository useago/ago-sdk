import { describe, it, expect, vi } from "vitest";
import { defineComponent, h, ref, createApp } from "vue";
import { AgoClient } from "../src/client/AgoClient";
import { AgoService } from "../src/angular/ago.service";
import { useAgoPageState } from "../src/vue/composables/useAgoFunction";
import { AGO_CLIENT_KEY } from "../src/vue/symbols";
import type { FunctionRegistry } from "../src/functions/FunctionRegistry";

function execute(client: AgoClient, name: string, args: Record<string, unknown>) {
  const registry = (client as unknown as { functionRegistry: FunctionRegistry })
    .functionRegistry;
  return registry.execute(name, args);
}

/** Mount a Vue component with the client provided, the way AgoPlugin does. */
function mountVue(client: AgoClient, setup: () => unknown) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp(defineComponent({ setup: () => (setup(), () => h("div")) }));
  app.provide(AGO_CLIENT_KEY, client);
  app.mount(container);
  return () => app.unmount();
}

describe("useAgoPageState (Vue)", () => {
  it("returns the rows the change produced and cleans up both functions", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const query = ref("");
    // A ref-derived snapshot: Vue closures are already live, so the composable
    // forwards the options untouched.
    const unmount = mountVue(client, () => {
      useAgoPageState(
        [
          {
            name: "query",
            description: "Search",
            schema: { type: "string" },
            get: () => query.value,
            set: (v) => {
              query.value = v as string;
            },
          },
        ],
        {
          data: {
            description: "The rows on screen.",
            get: () => (query.value ? [`row-for-${query.value}`] : ["row-initial"]),
          },
        }
      );
    });

    expect(client.getRegisteredFunctions().map((f) => f.name).sort()).toEqual([
      "readPageData",
      "setPageState",
    ]);

    expect(await execute(client, "setPageState", { query: "dupont" })).toEqual({
      success: true,
      applied: { query: "dupont" },
      data: ["row-for-dupont"],
    });

    unmount();
    expect(client.getRegisteredFunctions()).toHaveLength(0);
  });

  it("forwards requiresApproval instead of dropping it", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const spy = vi.spyOn(client, "registerPageStateFunction");
    const unmount = mountVue(client, () => {
      useAgoPageState(
        [
          {
            name: "query",
            description: "Search",
            schema: { type: "string" },
            set: () => {},
          },
        ],
        { requiresApproval: true }
      );
    });

    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requiresApproval: true })
    );
    unmount();
  });
});

describe("AgoService.registerPageStateFunction (Angular)", () => {
  it("passes the data source through to the client", async () => {
    const service = new AgoService({ baseUrl: "https://example.test" });
    let query = "";

    service.registerPageStateFunction(
      [
        {
          name: "query",
          description: "Search",
          schema: { type: "string" },
          get: () => query,
          set: (v) => {
            query = v as string;
          },
        },
      ],
      {
        data: {
          description: "The rows on screen.",
          get: () => (query ? [`row-for-${query}`] : ["row-initial"]),
        },
      }
    );

    const client = service.getClient();
    expect(client.getRegisteredFunctions().map((f) => f.name).sort()).toEqual([
      "readPageData",
      "setPageState",
    ]);

    expect(await execute(client, "setPageState", { query: "dupont" })).toEqual({
      success: true,
      applied: { query: "dupont" },
      data: ["row-for-dupont"],
    });

    service.unregisterPageStateFunction();
    expect(client.getRegisteredFunctions()).toHaveLength(0);
    service.destroy();
  });
});
