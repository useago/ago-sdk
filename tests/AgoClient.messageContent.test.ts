import { afterEach, describe, expect, it, vi } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import { AgoError } from "../src/client/errors";

const clients: AgoClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((client) => client.destroy());
  vi.unstubAllGlobals();
});

function createClient() {
  const client = new AgoClient({ baseUrl: "https://example.test" });
  clients.push(client);
  return client;
}

function reply() {
  return new Response('data: {"message_id":"m1","thread":{"id":"t1"},"content":"OK","status":"DONE"}\n\n');
}

describe.each([false, true])("message content with attachments=%s", (withFiles) => {
  const files = () => withFiles
    ? [new File(["hello"], "note.txt", { type: "text/plain" })]
    : undefined;

  it.each(["", " \n\t "])("rejects blank content %j before starting a request", async (content) => {
    const fetch = vi.fn().mockImplementation(reply);
    vi.stubGlobal("fetch", fetch);
    const client = createClient();
    const error = await client.sendMessage(content, { files: files() }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AgoError);
    expect(error).toMatchObject({ code: "message_empty_content" });
    expect(fetch).not.toHaveBeenCalled();
    expect(client.isGenerating()).toBe(false);
  });

  it("sends text and preserves the selected files", async () => {
    const fetch = vi.fn().mockImplementation(reply);
    vi.stubGlobal("fetch", fetch);
    const client = createClient();
    const selected = files();
    const result = await client.sendMessage("Analyze this", { files: selected });

    expect(result.content).toBe("OK");
    expect(fetch).toHaveBeenCalledOnce();
    const init = fetch.mock.calls[0][1] as RequestInit;
    if (withFiles) {
      expect(init.body).toBeInstanceOf(FormData);
      const body = init.body as FormData;
      expect(body.get("content")).toBe("Analyze this");
      expect(body.getAll("files")).toEqual(selected);
    } else {
      expect(JSON.parse(String(init.body)).content).toBe("Analyze this");
    }
  });
});

it.each([null, undefined, 123, {}])("rejects non-string content %j before starting a request", async (content) => {
  const fetch = vi.fn().mockImplementation(reply);
  vi.stubGlobal("fetch", fetch);
  const client = createClient();

  await expect(client.sendMessage(content as unknown as string)).rejects.toMatchObject({
    name: "AgoError",
    code: "message_empty_content",
  });

  expect(fetch).not.toHaveBeenCalled();
  expect(client.isGenerating()).toBe(false);
});

it("does not interrupt a running turn when blank content is rejected", async () => {
  let respond!: (response: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>((resolve) => { respond = resolve; }));
  vi.stubGlobal("fetch", fetch);
  const client = createClient();
  const pending = client.sendMessage("First message");
  const signal = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].signal!;

  await expect(client.sendMessage("", {
    files: [new File(["hello"], "note.txt", { type: "text/plain" })],
  })).rejects.toMatchObject({ code: "message_empty_content" });

  expect(fetch).toHaveBeenCalledOnce();
  expect(signal.aborted).toBe(false);
  expect(client.isGenerating()).toBe(true);
  respond(reply());
  await expect(pending).resolves.toMatchObject({ content: "OK" });
});
