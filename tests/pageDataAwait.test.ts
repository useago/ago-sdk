import { describe, it, expect, vi, afterEach } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import { readWhenSettled } from "../src/functions/pageData";
import type { FunctionRegistry } from "../src/functions/FunctionRegistry";
import type { AgoPageStateResult } from "../src/functions/types";

function execute(client: AgoClient, name: string, args: Record<string, unknown>) {
  const registry = (client as unknown as { functionRegistry: FunctionRegistry })
    .functionRegistry;
  return registry.execute(name, args);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("awaiting the work the change triggered", () => {
  it("resolves exactly when get()'s promise resolves, however late", async () => {
    vi.useFakeTimers();
    let rows = ["anciennes"];
    // The page owns the await: a debounce of 300 ms then a 400 ms request. The
    // polling heuristic misses this entirely (the flag is still down at the
    // 100 ms mark); the promise cannot miss it.
    const source = {
      description: "d",
      get: () =>
        new Promise<string[]>((resolve) => {
          setTimeout(() => {
            rows = ["fraiches"];
            resolve(rows);
          }, 700);
        }),
    };

    const pending = readWhenSettled(() => source, 10_000);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(await pending).toEqual(["fraiches"]);
  });

  it("does not poll at all when get() is async: no isLoading needed", async () => {
    vi.useFakeTimers();
    const isLoading = vi.fn(() => false);
    const source = {
      description: "d",
      get: async () => ["ok"],
      isLoading,
    };

    const pending = readWhenSettled(() => source, 10_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;

    // The commit window still runs (React may not have committed), so the flag
    // is read a couple of times, but the ANSWER comes from the promise.
    expect(isLoading.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("gives up on a promise that never settles, at settleTimeoutMs", async () => {
    vi.useFakeTimers();
    const source = {
      description: "d",
      // A request that hangs: without a deadline this would hold the turn open
      // forever, which is worse than stale data.
      get: () => new Promise<string[]>(() => {}),
    };

    const pending = readWhenSettled(() => source, 800);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await pending).toBeUndefined();
  });

  it("propagates a rejected get() so the handler can report it", async () => {
    vi.useFakeTimers();
    const source = {
      description: "d",
      get: () => Promise.reject(new Error("le service de prix est tombé")),
    };

    const pending = readWhenSettled(() => source, 5_000);
    // Attach the expectation BEFORE advancing the clock: the rejection lands
    // during the advance, and a promise that rejects with no handler yet is an
    // unhandled rejection, which Vitest fails the whole run on.
    const rejects = expect(pending).rejects.toThrow(
      "le service de prix est tombé"
    );
    await vi.advanceTimersByTimeAsync(1_000);

    await rejects;
  });

  it("does not leak an unhandled rejection when it gives up on a slow get()", async () => {
    vi.useFakeTimers();
    const unhandled: unknown[] = [];
    // Node reports these at the process level, which is also how Vitest fails
    // the run on them. Listening on `window` catches nothing here.
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      // Slower than the timeout, and it fails. The first promise is abandoned
      // at the deadline and the retry is abandoned immediately; neither may
      // reach the host page as an unhandled rejection.
      const source = {
        description: "d",
        get: () =>
          new Promise<string[]>((_, reject) => {
            setTimeout(() => reject(new Error("HTTP 503")), 2_000);
          }),
      };

      const pending = readWhenSettled(() => source, 400);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await pending).toBeUndefined();

      // Give Node a real turn of the loop to report anything unhandled.
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("setPageState with an async data source", () => {
  it("applies the change, awaits the work, returns the result", async () => {
    vi.useFakeTimers();
    const client = new AgoClient({ baseUrl: "https://example.test" });
    let query = "";
    // Deliberately debounced: the flag-polling path would read stale rows here.
    const loadRows = (q: string) =>
      new Promise<string[]>((resolve) => {
        setTimeout(() => resolve([`resultat-pour-${q}`]), 600);
      });

    client.registerPageStateFunction(
      [
        {
          name: "query",
          description: "Recherche",
          schema: { type: "string" },
          get: () => query,
          set: (v) => {
            query = String(v);
          },
        },
      ],
      {
        data: {
          description: "Les lignes affichées.",
          get: () => loadRows(query),
        },
      }
    );

    const pending = execute(client, "setPageState", { query: "dupont" });
    await vi.advanceTimersByTimeAsync(3_000);

    expect(await pending).toEqual({
      success: true,
      applied: ["query"],
      unchanged: [],
      data: ["resultat-pour-dupont"],
    });
  });

  it("reports a failed load instead of pretending the page is empty", async () => {
    vi.useFakeTimers();
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction(
      [
        {
          name: "query",
          description: "Recherche",
          schema: { type: "string" },
          set: () => {},
        },
      ],
      {
        data: {
          description: "Les lignes affichées.",
          get: () => Promise.reject(new Error("HTTP 503")),
        },
      }
    );

    const pending = execute(client, "setPageState", { query: "dupont" });
    await vi.advanceTimersByTimeAsync(1_000);
    const result = (await pending) as Required<
      AgoPageStateResult<{ error: string; message: string }>
    >;

    // The filter WAS applied; say so, and say the read failed.
    expect(result.success).toBe(true);
    expect(result.applied).toEqual(["query"]);
    expect(result.unchanged).toEqual([]);
    expect(result.data.error).toBe("page_data_unavailable");
    expect(result.data.message).toContain("HTTP 503");
  });
});
