import { describe, it, expect, vi, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { AgoClient } from "../src/client/AgoClient";
import { AgoProvider } from "../src/react/context/AgoContext";
import { useAgoPageState } from "../src/react/hooks/useAgoFunction";
import type { AgoPageStateResult } from "../src/functions/types";
// The real modules the glacier example ships, not a re-creation of them.
import {
  marketPriceOf,
  useMarketPrices,
} from "../examples/glacier/src/marketPrices";
import { FLAVORS } from "../examples/glacier/src/flavors";

// React's act() requires this flag outside of @testing-library.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function execute(client: AgoClient, name: string, args: Record<string, unknown>) {
  return client.executeClientFunction(name, args);
}

/** The payload the live endpoint actually serves, trimmed to what we map. */
const REMOTE_PRICES = {
  vanilla: 3.5,
  chocolate: 3.8,
  strawberry: 3.6,
  pistachio: 4.2,
  salted_caramel: 4.0,
  lemon: 3.4,
  mango: 3.9,
  raspberry: 3.8,
  coffee: 3.7,
  mint_chocolate_chip: 4.1,
};

/** Stand-in for the network, with a latency the settle wait has to absorb. */
function stubFetch(latencyMs: number) {
  const fetchMock = vi.fn(
    () =>
      new Promise((resolve) => {
        setTimeout(
          () => resolve({ ok: true, json: async () => REMOTE_PRICES } as Response),
          latencyMs
        );
      })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The flavors page reduced to the wiring under test. */
function FlavorsHarness() {
  const [priceSource, setPriceSource] = React.useState<"maison" | "marche">(
    "maison"
  );
  const { ensure } = useMarketPrices(priceSource === "marche");

  useAgoPageState(
    [
      {
        name: "priceSource",
        description: "Prix affichés : maison ou cours du jour.",
        schema: { type: "string", enum: ["maison", "marche"] },
        get: () => priceSource,
        set: (v) => setPriceSource(v as "maison" | "marche"),
      },
    ],
    {
      data: {
        description: "Les parfums affichés avec leur prix.",
        // La promesse EST le signal de fin: pas de sondage, pas de isLoading.
        get: async () => {
          const live = priceSource === "marche" ? await ensure() : null;
          return {
            priceSource,
            parfums: Object.values(FLAVORS).map((f) => ({
              id: f.id,
              nom: f.name,
              prixMaisonEuros: f.pricePerScoop,
              coursDuJourEuros: marketPriceOf(f.id, live),
            })),
          };
        },
      },
    }
  );

  return <span>{priceSource}</span>;
}

describe("glacier: switching to live market prices", () => {
  it("hands the agent the fetched prices, not the ones on screen when it called", async () => {
    // 700 ms: far past the ~100 ms window the isLoading poll would have given
    // it. Only the awaited promise can catch this.
    const fetchMock = stubFetch(700);
    const client = new AgoClient({ baseUrl: "https://example.test" });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <AgoProvider client={client}>
          <FlavorsHarness />
        </AgoProvider>
      );
    });

    // Nothing fetched yet: the page is on the house tariff.
    expect(fetchMock).not.toHaveBeenCalled();

    // The agent flips the control. Start inside act, await outside, so React
    // commits (act only flushes pending work when its scope exits).
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = execute(client, "setPageState", { priceSource: "marche" });
    });
    const result = (await pending) as Required<
      AgoPageStateResult<{
        priceSource: string;
        parfums: { id: string; coursDuJourEuros: number | null }[];
      }>
    >;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.applied).toEqual(["priceSource"]);
    expect(result.unchanged).toEqual([]);
    expect(result.data.priceSource).toBe("marche");

    const byId = Object.fromEntries(
      result.data.parfums.map((f) => [f.id, f.coursDuJourEuros])
    );
    // The whole point: the agent sees the fetched cours, not the nulls that
    // were on screen at the instant it called setPageState.
    expect(byId.vanilla).toBe(3.5);
    expect(byId.pistachio).toBe(4.2);
    // Our "caramel" maps to the service's "salted_caramel".
    expect(byId.caramel).toBe(4.0);
    // "mint" is not quoted by the service, and stays honestly null.
    expect(byId.mint).toBeNull();

    // The agent can now answer "cheapest at today's rate" from this alone.
    const quoted = result.data.parfums.filter((f) => f.coursDuJourEuros !== null);
    expect(quoted).toHaveLength(9);
    const cheapest = quoted.reduce((a, b) =>
      (a.coursDuJourEuros as number) <= (b.coursDuJourEuros as number) ? a : b
    );
    expect(cheapest.id).toBe("lemon");

    await act(async () => {
      root.unmount();
    });
  });

  it("readPageData answers 'what is on screen' without changing anything", async () => {
    stubFetch(20);
    const client = new AgoClient({ baseUrl: "https://example.test" });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <AgoProvider client={client}>
          <FlavorsHarness />
        </AgoProvider>
      );
    });

    const read = (await execute(client, "readPageData", {})) as {
      data: { priceSource: string; parfums: unknown[] };
    };

    expect(read.data.priceSource).toBe("maison");
    expect(read.data.parfums).toHaveLength(Object.keys(FLAVORS).length);
    expect(container.textContent).toBe("maison");

    await act(async () => {
      root.unmount();
    });
  });
});
