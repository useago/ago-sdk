import { describe, it, expect, vi, afterEach } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import { SSEHandler } from "../src/streaming/SSEHandler";
import type { FunctionRegistry } from "../src/functions/FunctionRegistry";

function execute(client: AgoClient, name: string, args: Record<string, unknown>) {
  const registry = (client as unknown as { functionRegistry: FunctionRegistry })
    .functionRegistry;
  return registry.execute(name, args);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Feed raw SSE frames to a handler the way the transport does. */
function feed(handler: SSEHandler, frames: Record<string, unknown>[]) {
  const stream = handler as unknown as {
    handleChunk: (d: Record<string, unknown>) => void;
  };
  for (const frame of frames) stream.handleChunk(frame);
}

describe("plusieurs appels front dans le meme tour", () => {
  it("les attentes se CHEVAUCHENT au lieu de s'additionner", async () => {
    vi.useFakeTimers();
    const client = new AgoClient({ baseUrl: "https://example.test" });

    // Deux pages, chacune avec sa propre source async de 400 ms.
    for (const name of ["setListState", "setDetailState"]) {
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
          functionName: name,
          data: {
            description: "Lignes",
            get: () =>
              new Promise((resolve) => setTimeout(() => resolve([name]), 400)),
          },
        }
      );
    }

    const started = Date.now();
    // Lancés ensemble, comme le fait le flux SSE (pas d'await entre les deux).
    // On horodate à la RÉSOLUTION, pas après avoir avancé toute l'horloge.
    let elapsed = 0;
    const stamp = <T,>(p: Promise<T>) =>
      p.then((v) => {
        elapsed = Math.max(elapsed, Date.now() - started);
        return v;
      });
    const both = Promise.all([
      stamp(execute(client, "setListState", { query: "a" })),
      stamp(execute(client, "setDetailState", { query: "b" })),
    ]);
    await vi.advanceTimersByTimeAsync(3_000);
    const [a, b] = (await both) as { data: string[] }[];

    expect(a.data).toEqual(["setListState"]);
    expect(b.data).toEqual(["setDetailState"]);
    // ~500 ms (100 de fenetre + 400 de travail), pas ~1000.
    expect(elapsed).toBeLessThan(800);
  });

  it("le flux SSE lance les appels sans les attendre (donc en parallele)", () => {
    const seen: string[] = [];
    const handler = new SSEHandler({
      onClientFunction: async (d) => {
        seen.push(d.functionName);
        await new Promise((r) => setTimeout(r, 50));
      },
    });

    feed(handler, [
      { type: "client_function", function_name: "fnA", id: "1", arguments: { x: 1 } },
      { type: "client_function", function_name: "fnB", id: "2", arguments: { x: 2 } },
    ]);

    // Les deux sont parties immediatement, aucune n'a attendu l'autre.
    expect(seen).toEqual(["fnA", "fnB"]);
  });

  it("deux appels identiques mais d'invocationId different sont TOUS DEUX executes", () => {
    const seen: string[] = [];
    const handler = new SSEHandler({
      onClientFunction: (d) => {
        seen.push(d.invocationId);
      },
    });

    feed(handler, [
      // readPageData n'a AUCUN parametre : deux appels distincts ont la meme
      // cle de dedup (`readPageData::{}`), meme avec des invocationId differents.
      { type: "client_function", function_name: "readPageData", id: "call-1", arguments: {} },
      { type: "client_function", function_name: "readPageData", id: "call-2", arguments: {} },
    ]);

    // Avant correctif, le second etait avale : son resultat n'etait jamais
    // soumis, le backend n'avait jamais tous les resultats, et resume.ready ne
    // passait jamais a true -> tour bloque en WAITING_CLIENT.
    expect(seen).toEqual(["call-1", "call-2"]);
  });

  it("le meme appel emis sous ses DEUX formes SSE ne tourne qu'une fois", () => {
    const seen: string[] = [];
    const handler = new SSEHandler({
      onClientFunction: (d) => {
        seen.push(d.invocationId);
      },
    });

    feed(handler, [
      // Forme brute (state dict) : aucun id.
      { type: "client_function", function_name: "readPageData", arguments: {} },
      // Forme UI (tool_call_data) : le meme appel, avec son id.
      { type: "client_function", function_name: "readPageData", id: "call-1", arguments: {} },
    ]);

    expect(seen).toEqual([""]);
  });

  it("une 3e emission apres les deux formes est bien un nouvel appel", () => {
    const seen: string[] = [];
    const handler = new SSEHandler({
      onClientFunction: (d) => {
        seen.push(d.invocationId);
      },
    });

    feed(handler, [
      { type: "client_function", function_name: "readPageData", arguments: {} },
      { type: "client_function", function_name: "readPageData", id: "call-1", arguments: {} },
      { type: "client_function", function_name: "readPageData", id: "call-2", arguments: {} },
    ]);

    expect(seen).toEqual(["", "call-2"]);
  });
});
