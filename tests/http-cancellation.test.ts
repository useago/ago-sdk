import { describe, expect, it, vi } from "vitest";
import { HttpClient } from "../src/api/HttpClient";

describe("HTTP request cancellation", () => {
  it("cancels pending requests independently and permits later requests", async () => {
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn((_url: string, init?: RequestInit) => {
      const signal = init!.signal!;
      signals.push(signal);
      return new Promise<Response>((resolve, reject) => {
        if (signals.length === 3) return resolve(new Response(null, { status: 204 }));
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetcher });
    const external = new AbortController();
    const first = http.post("/first", {}, { signal: external.signal });
    const second = http.get("/second");
    const firstResult = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const secondResult = expect(second).rejects.toMatchObject({ name: "AbortError" });

    external.abort();
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    http.abortPendingRequests();
    await Promise.all([firstResult, secondResult]);
    await expect(http.get("/later")).resolves.toBeUndefined();
    http.abortPendingRequests();
    expect(signals[2].aborted).toBe(false);
  });

  it.each([200, 400])("tracks the response body until it settles (HTTP %i)", async (status) => {
    let requestSignal: AbortSignal | undefined;
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: async (_url, init) => {
        requestSignal = init?.signal ?? undefined;
        return {
          ok: status === 200,
          status,
          json: () => new Promise((_resolve, reject) => {
            requestSignal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          }),
        } as Response;
      },
    });
    const request = http.get("/body");
    const result = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    await Promise.resolve();
    http.abortPendingRequests();
    await result;
  });

  it("releases completed and failed requests and their external listeners", async () => {
    const external = new AbortController();
    const remove = vi.spyOn(external.signal, "removeEventListener");
    const signals: AbortSignal[] = [];
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: async (_url, init) => {
        signals.push(init!.signal!);
        if (signals.length === 1) return new Response("{}", { status: 200 });
        throw new TypeError("offline");
      },
    });
    await http.post("/ok", {}, { signal: external.signal });
    await expect(http.post("/error", {}, { signal: external.signal })).rejects.toThrow();
    expect(remove).toHaveBeenCalledTimes(2);
    http.abortPendingRequests();
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
  });
});
