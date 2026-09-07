import { afterEach, describe, expect, it, vi } from "vitest";
import { AgoClient } from "../src/client/AgoClient";

function captureRequests() {
  const requests: { body: Record<string, unknown>; headers: Headers }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = init.body instanceof FormData
      ? Object.fromEntries(init.body.entries())
      : JSON.parse(String(init.body));
    if (typeof body.metadata === "string") body.metadata = JSON.parse(body.metadata);
    if (typeof body.client_context === "string") body.client_context = JSON.parse(body.client_context);
    requests.push({ body, headers: new Headers(init.headers) });
    return new Response('data: {"message_id":"m1","thread":{"id":"t1"},"content":"OK","status":"DONE"}\n\n');
  }));
  return requests;
}

afterEach(() => vi.unstubAllGlobals());

for (const multipart of [false, true]) {
  describe(multipart ? "multipart metadata" : "JSON metadata", () => {
    const files = () => multipart ? [new File(["hello"], "note.txt", { type: "text/plain" })] : undefined;

    it("sends defaults alongside JWT, context and conversation without treating metadata as auth", async () => {
      const requests = captureRequests();
      const metadata = { brevo: { clientid: 11970100, isProPlan: false, count: 0, csmeMail: null, planName: "Équipe" } };
      const client = new AgoClient({ baseUrl: "https://example.test", userJwt: "signed-jwt", metadata });
      client.setContext("account", { data: { plan: "Free" } });
      await client.sendMessage("help", { files: files(), conversationId: "existing" });
      expect(requests[0].body.metadata).toEqual(metadata);
      expect(requests[0].body.client_context).toEqual({ entries: { account: { data: { plan: "Free" } } } });
      expect(requests[0].body.conversation_id).toBe("existing");
      expect(requests[0].headers.get("Authorization")).toBe("Bearer signed-jwt");
      client.destroy();
    });

    it("applies per-message replacements and null opt-out without mutating defaults", async () => {
      const requests = captureRequests();
      const client = new AgoClient({ baseUrl: "https://example.test", metadata: { old: true } });
      await client.sendMessage("override", { files: files(), metadata: { new: true } });
      await client.sendMessage("omit", { files: files(), metadata: null });
      await client.sendMessage("defaults", { files: files() });
      expect(requests.map(r => r.body.metadata)).toEqual([{ new: true }, undefined, { old: true }]);
      expect(requests[1].body).not.toHaveProperty("metadata");
      client.destroy();
    });

    it("supports runtime updates, clearing defaults and existing callers without metadata", async () => {
      const requests = captureRequests();
      const client = new AgoClient({ baseUrl: "https://example.test" });
      await client.sendMessage("legacy", { files: files() });
      client.updateConfig({ metadata: { brevo: { clientid: 2 } } });
      await client.sendMessage("updated", { files: files() });
      client.updateConfig({ metadata: null });
      await client.sendMessage("cleared", { files: files() });
      expect(requests.map(r => r.body.metadata)).toEqual([undefined, { brevo: { clientid: 2 } }, undefined]);
      client.destroy();
    });

    it("rejects circular metadata without leaving a generation in progress", async () => {
      const requests = captureRequests();
      const metadata: Record<string, unknown> = {};
      metadata.self = metadata;
      const client = new AgoClient({ baseUrl: "https://example.test", metadata });
      await expect(client.sendMessage("bad", { files: files() })).rejects.toThrow();
      expect(client.isGenerating()).toBe(false);
      expect(requests).toHaveLength(0);
      client.destroy();
    });
  });
}
