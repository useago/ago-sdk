import { describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { AgoClient } from "../src/client/AgoClient";
import { AgoProvider } from "../src/react/context/AgoContext";
import {
  useFormCollector,
  type UseFormCollectorResult,
} from "../src/react/hooks/useFormCollector";
import type { FormCollectorSchema } from "../src/forms/createFormCollector";

// React's act() requires this flag outside of @testing-library.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const schema: FormCollectorSchema = {
  type: "object",
  properties: {
    product: { type: "string" },
    quantity: { type: "number" },
  },
  required: ["product", "quantity"],
};

describe("useFormCollector", () => {
  it("installs on mount, reflects store updates, and uninstalls on unmount", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    let captured: UseFormCollectorResult | null = null;

    function Harness() {
      captured = useFormCollector({ name: "order", description: "An order.", schema });
      return <span>{captured.state.complete ? "complete" : "incomplete"}</span>;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AgoProvider client={client}>
          <Harness />
        </AgoProvider>
      );
    });

    // install() ran inside the effect
    expect(client.getRegisteredFunctions().map((s) => s.name)).toContain("update_order");
    expect(container.textContent).toBe("incomplete");

    // Driving the store via the update function re-renders the component
    await act(async () => {
      await captured!.functions[0].handler({ product: "Widget", quantity: 2 });
    });
    expect(container.textContent).toBe("complete");

    await act(async () => {
      root.unmount();
    });
    expect(client.getRegisteredFunctions()).toHaveLength(0);

    container.remove();
    client.destroy();
  });

  it("fetches the definition from the backend when given only a name", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    vi.spyOn(client, "getFormCollector").mockResolvedValue({
      name: "order",
      description: "An order.",
      schema,
    });
    let captured: UseFormCollectorResult | null = null;

    function Harness() {
      captured = useFormCollector({ name: "order" });
      return (
        <span>
          {captured.loading ? "loading" : captured.state.complete ? "complete" : "incomplete"}
        </span>
      );
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AgoProvider client={client}>
          <Harness />
        </AgoProvider>
      );
    });

    // The fetch resolves and the collector installs.
    expect(client.getFormCollector).toHaveBeenCalledWith("order");
    expect(captured!.loading).toBe(false);
    expect(client.getRegisteredFunctions().map((s) => s.name)).toContain("update_order");
    expect(container.textContent).toBe("incomplete");

    await act(async () => {
      await captured!.functions[0].handler({ product: "Widget", quantity: 2 });
    });
    expect(container.textContent).toBe("complete");

    await act(async () => {
      root.unmount();
    });
    expect(client.getRegisteredFunctions()).toHaveLength(0);

    container.remove();
    client.destroy();
  });
});
