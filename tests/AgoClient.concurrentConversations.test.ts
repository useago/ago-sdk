import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import type { AgoMessage } from "../src/client/types";
import { createFakeServer, flush, type FakeServer } from "./helpers/sseServer";

let server: FakeServer;

beforeEach(() => {
  server = createFakeServer();
  vi.stubGlobal("fetch", server.fetch);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function makeClient(): AgoClient {
  return new AgoClient({ baseUrl: "https://x.example.com", agent: "agent-1" });
}

const assistant = (messages: AgoMessage[]) => messages.filter((m) => m.role === "assistant");

/** Start an answer in `conversationId` and return its stream once it opened. */
async function startAnswer(client: AgoClient, conversationId: string, text = "hi") {
  const opened = server.streams.length;
  const sent = client.conversation(conversationId).sendMessage(text);
  await vi.waitFor(() => expect(server.streams.length).toBe(opened + 1));
  return { sent, stream: server.streams[opened] };
}

describe("two conversations answering at once", () => {
  it("keeps each answer in its own conversation, and stopping one leaves the other running", async () => {
    const client = makeClient();
    const conversationA = client.conversation("cA");
    const a = await startAnswer(client, "cA");
    const b = await startAnswer(client, "cB");

    a.stream.push({ message_id: "mA", thread: { id: "cA" }, content: "Alpha " });
    b.stream.push({ message_id: "mB", thread: { id: "cB" }, content: "Bravo " });
    a.stream.push({ message_id: "mA", thread: { id: "cA" }, content: "one" });
    await flush();

    expect(assistant(client.conversation("cA").getMessages()).map((m) => m.content)).toEqual([
      "Alpha one",
    ]);
    expect(assistant(client.conversation("cB").getMessages()).map((m) => m.content)).toEqual([
      "Bravo ",
    ]);

    await client.stop("cA");
    await a.sent;
    expect(server.calls.filter((c) => c.url.endsWith("/stop")).map((c) => c.url)).toEqual([
      "https://x.example.com/api/sdk/v1/messages/mA/stop",
    ]);
    expect(client.isGenerating("cA")).toBe(false);
    expect(client.isGenerating("cB")).toBe(true);
    expect(b.stream.signal?.aborted).toBe(false);

    b.stream.push({ message_id: "mB", thread: { id: "cB" }, content: "two" });
    b.stream.push({ message_id: "mB", thread: { id: "cB" }, status: "DONE" });
    b.stream.end();
    const finished = await b.sent;

    expect(finished.content).toBe("Bravo two");
    expect(assistant(conversationA.getMessages())[0]).toMatchObject({
      content: "Alpha one",
      status: "CANCELED",
    });
  });

  it("finishing one conversation does not touch the other's state", async () => {
    const client = makeClient();
    const a = await startAnswer(client, "cA");
    const b = await startAnswer(client, "cB");
    b.stream.push({ message_id: "mB", thread: { id: "cB" }, content: "still going" });
    a.stream.push({ message_id: "mA", thread: { id: "cA" }, content: "done" });
    a.stream.push({ message_id: "mA", thread: { id: "cA" }, status: "DONE" });
    a.stream.end();
    await a.sent;

    const [bAnswer] = assistant(client.conversation("cB").getMessages());
    expect(bAnswer).toMatchObject({ id: "mB", content: "still going", status: "IN_PROGRESS" });
    expect(client.isGenerating("cB")).toBe(true);
    b.stream.end();
    await b.sent;
  });

  it("stop() with no id stops every answer, and isGenerating() with no id means any", async () => {
    const client = makeClient();
    expect(client.isGenerating()).toBe(false);
    const a = await startAnswer(client, "cA");
    const b = await startAnswer(client, "cB");
    a.stream.push({ message_id: "mA", thread: { id: "cA" }, content: "a" });
    b.stream.push({ message_id: "mB", thread: { id: "cB" }, content: "b" });
    await flush();
    expect(client.isGenerating()).toBe(true);

    await client.stop();
    await Promise.all([a.sent, b.sent]);

    expect(a.stream.signal?.aborted).toBe(true);
    expect(b.stream.signal?.aborted).toBe(true);
    expect(client.isGenerating()).toBe(false);
    expect(server.calls.filter((c) => c.url.endsWith("/stop"))).toHaveLength(2);
  });

  it("destroy() aborts every running answer", async () => {
    const client = makeClient();
    const a = await startAnswer(client, "cA");
    const b = await startAnswer(client, "cB");

    client.destroy();
    await Promise.all([a.sent, b.sent]);

    expect(a.stream.signal?.aborted).toBe(true);
    expect(b.stream.signal?.aborted).toBe(true);
  });
});

describe("a new conversation", () => {
  it("is re-keyed to the server id from its first frame and emits id", async () => {
    const client = makeClient();
    const draft = client.conversation();
    const draftId = draft.id;
    const ids: Array<{ previousId: string; id: string }> = [];
    draft.on("id", (event) => ids.push(event));

    expect(client.conversation(draftId)).toBe(draft);
    const sent = draft.sendMessage("hello");
    await vi.waitFor(() => expect(server.streams).toHaveLength(1));
    expect(server.streams[0].body.conversation_id).toBeUndefined();

    server.streams[0].push({ message_id: "m1", thread: { id: "c-new" }, content: "Hi" });
    await flush();

    expect(draft.id).toBe("c-new");
    expect(draft.isDraft).toBe(false);
    expect(ids).toEqual([{ previousId: draftId, id: "c-new" }]);
    expect(client.conversation("c-new")).toBe(draft);
    expect(client.conversation(draftId)).toBe(draft);
    expect(client.isGenerating("c-new")).toBe(true);
    expect(client.isGenerating(draftId)).toBe(true);
    expect(draft.getMessages().every((m) => m.conversationId === "c-new")).toBe(true);

    server.streams[0].end();
    await sent;
  });

  it("follows the active conversation when the active draft is re-keyed", async () => {
    const client = makeClient();
    const draft = client.conversation();
    client.setActiveConversation(draft.id);
    const sent = draft.sendMessage("hello");
    await vi.waitFor(() => expect(server.streams).toHaveLength(1));
    server.streams[0].push({ message_id: "m1", thread: { id: "c-new" } });
    await flush();

    expect(client.getActiveConversation()).toBe("c-new");
    server.streams[0].end();
    await sent;
  });
});

describe("sending while the same conversation is answering", () => {
  it("queues the message and sends it when the answer ends, without stopping it", async () => {
    const client = makeClient();
    const conversation = client.conversation("cA");
    const first = conversation.sendMessage("first");
    await vi.waitFor(() => expect(server.streams).toHaveLength(1));
    server.streams[0].push({ message_id: "m1", thread: { id: "cA" }, content: "Answer one" });
    await flush();

    const second = conversation.sendMessage("second");
    await flush();

    expect(server.streams).toHaveLength(1);
    expect(server.calls.some((c) => c.url.endsWith("/stop"))).toBe(false);
    expect(conversation.getMessages().map((m) => [m.role, m.content])).toEqual([
      ["user", "first"],
      ["assistant", "Answer one"],
      ["user", "second"],
    ]);

    server.streams[0].push({ message_id: "m1", thread: { id: "cA" }, status: "DONE" });
    server.streams[0].end();
    expect((await first).content).toBe("Answer one");

    await vi.waitFor(() => expect(server.streams).toHaveLength(2));
    expect(server.streams[1].body).toMatchObject({ content: "second", conversation_id: "cA" });
    server.streams[1].push({ message_id: "m2", thread: { id: "cA" }, content: "Answer two" });
    server.streams[1].end();
    expect((await second).content).toBe("Answer two");
  });

  it("goes through the same queue for the global sendMessage", async () => {
    const client = makeClient();
    const first = client.sendMessage("first", { conversationId: "cA" });
    await vi.waitFor(() => expect(server.streams).toHaveLength(1));
    const second = client.sendMessage("second", { conversationId: "cA" });
    await flush();
    expect(server.streams).toHaveLength(1);

    server.streams[0].end();
    await first;
    await vi.waitFor(() => expect(server.streams).toHaveLength(2));
    server.streams[1].end();
    await second;
  });
});

const CLIENT_FUNCTION_FRAMES = (conversationId: string, messageId: string) => [
  { message_id: messageId, thread: { id: conversationId }, status: "IN_PROGRESS" },
  {
    tool_call_data: true,
    type: "client_function",
    status: "waiting_input",
    id: "bag1",
    function_name: "navigateToPage",
    arguments: { page: "billing" },
    thread: { id: conversationId },
  },
  {
    message_id: messageId,
    thread: { id: conversationId },
    status: "WAITING_CLIENT",
    waiting_tool_call_ids: ["bag1"],
  },
];

describe("client functions of a conversation that is not on screen", () => {
  function clientWithNavigation() {
    const client = new AgoClient({
      baseUrl: "https://x.example.com",
      clientFunctionsMode: "pause",
    });
    const handler = vi.fn(() => ({ navigated: true }));
    client.registerFunction({
      name: "navigateToPage",
      description: "Navigate",
      parameters: { type: "object", properties: {} },
      handler,
    });
    server.onSubmit = () => ({ status: "completed", resume: { message_id: "mA", ready: true } });
    return { client, handler };
  }

  it("are refused: not run, not announced, answered with the reason, and the turn completes", async () => {
    const { client, handler } = clientWithNavigation();
    const invoked = vi.fn();
    const results: unknown[] = [];
    client.on("function:invoke", invoked);
    client.on("function:result", (r) => results.push(r));
    client.setActiveConversation("cB");

    const conversationA = client.conversation("cA");
    const { sent, stream } = await startAnswer(client, "cA");
    for (const frame of CLIENT_FUNCTION_FRAMES("cA", "mA")) stream.push(frame);
    stream.end();
    await sent;

    await vi.waitFor(() => expect(server.streams).toHaveLength(2));
    expect(handler).not.toHaveBeenCalled();
    expect(invoked).not.toHaveBeenCalled();
    const submit = server.calls.find((c) => c.url.endsWith("/tool-calls/bag1/submit"));
    expect(submit?.body?.formData).toMatchObject({
      result: { performed: false, code: "conversation_not_active" },
      error: expect.stringContaining("switched to another conversation"),
      _type: "client_function_result",
    });
    expect(results).toEqual([
      expect.objectContaining({
        invocationId: "bag1",
        conversationId: "cA",
        messageId: "mA",
        error: expect.stringContaining("Not performed"),
      }),
    ]);

    expect(server.streams[1].url).toBe("https://x.example.com/api/sdk/v1/messages/mA/continue");
    server.streams[1].push({ message_id: "mA", thread: { id: "cA" }, content: "I did not open it." });
    server.streams[1].push({ message_id: "mA", thread: { id: "cA" }, status: "DONE" });
    server.streams[1].end();
    await vi.waitFor(() => expect(client.isGenerating("cA")).toBe(false));
    const [answer] = assistant(conversationA.getMessages());
    expect(answer).toMatchObject({ status: "DONE", content: "I did not open it." });
    expect(answer.functionCalls).toBeUndefined();
  });

  it("run as before when no active conversation is set", async () => {
    const { client, handler } = clientWithNavigation();
    const invoked = vi.fn();
    client.on("function:invoke", invoked);

    const { sent, stream } = await startAnswer(client, "cA");
    for (const frame of CLIENT_FUNCTION_FRAMES("cA", "mA")) stream.push(frame);
    stream.end();
    await sent;
    await vi.waitFor(() => expect(server.streams).toHaveLength(2));

    expect(handler).toHaveBeenCalledWith({ page: "billing" });
    expect(invoked).toHaveBeenCalledWith(
      expect.objectContaining({ invocationId: "bag1", conversationId: "cA", messageId: "mA" }),
    );
    server.streams[1].end();
  });

  it("run when their conversation is the active one", async () => {
    const { client, handler } = clientWithNavigation();
    client.setActiveConversation("cA");
    const { sent, stream } = await startAnswer(client, "cA");
    for (const frame of CLIENT_FUNCTION_FRAMES("cA", "mA")) stream.push(frame);
    stream.end();
    await sent;
    await vi.waitFor(() => expect(handler).toHaveBeenCalled());
    await vi.waitFor(() => expect(server.streams).toHaveLength(2));
    server.streams[1].end();
  });

  it("are refused on a reload resume of a conversation that is not on screen", async () => {
    const { client, handler } = clientWithNavigation();
    client.setActiveConversation("cB");
    const resumed = client.resumePendingClientFunctions({
      id: "cA",
      title: "",
      lastMessageDate: new Date(),
      messages: [
        {
          id: "mA",
          conversationId: "cA",
          content: "",
          role: "assistant",
          status: "WAITING_CLIENT",
          createdAt: new Date(),
          toolCalls: [
            {
              id: "bag1",
              type: "client_function",
              status: "waiting_input",
              toolName: "",
              functionName: "navigateToPage",
              arguments: { page: "billing" },
            },
          ],
        },
      ],
    });
    await vi.waitFor(() => expect(server.streams).toHaveLength(1));
    expect(handler).not.toHaveBeenCalled();
    server.streams[0].end();
    await resumed;
  });
});

describe("functionCalls on the message", () => {
  it("follow a call from running to done, and keep toolCalls for server tools only", async () => {
    const client = new AgoClient({ baseUrl: "https://x.example.com", clientFunctionsMode: "pause" });
    let finish!: (value: unknown) => void;
    client.registerFunction({
      name: "navigateToPage",
      description: "Navigate",
      parameters: { type: "object", properties: {} },
      handler: () => new Promise((resolve) => (finish = resolve)),
    });
    const conversation = client.conversation("cA");
    const sent = conversation.sendMessage("go");
    await vi.waitFor(() => expect(server.streams).toHaveLength(1));
    const stream = server.streams[0];
    stream.push({ message_id: "mA", thread: { id: "cA" }, content: "Opening. " });
    stream.push({
      tool_call_data: true,
      type: "status_message",
      status: "done",
      id: "tc1",
      message: "Looked it up",
      thread: { id: "cA" },
    });
    for (const frame of CLIENT_FUNCTION_FRAMES("cA", "mA").slice(1, 2)) stream.push(frame);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));

    let [answer] = assistant(conversation.getMessages());
    expect(answer.functionCalls).toEqual([
      {
        invocationId: "bag1",
        functionName: "navigateToPage",
        arguments: { page: "billing" },
        status: "running",
        contentOffset: "Opening. ".length,
      },
    ]);
    expect(answer.toolCalls?.map((c) => [c.id, c.contentOffset])).toEqual([["tc1", 9]]);

    finish({ ok: true });
    await vi.waitFor(() =>
      expect(assistant(conversation.getMessages())[0].functionCalls?.[0].status).toBe("done"),
    );
    stream.end();
    await sent;
    [answer] = assistant(conversation.getMessages());
    expect(answer.toolCalls?.map((c) => c.type)).toEqual(["status_message"]);
  });

  it("show a gated call awaiting approval, then rejected", async () => {
    const client = new AgoClient({
      baseUrl: "https://x.example.com",
      clientFunctionsMode: "pause",
      approvalPolicy: () => true,
    });
    client.registerFunction({
      name: "navigateToPage",
      description: "Navigate",
      parameters: { type: "object", properties: {} },
      handler: () => ({ ok: true }),
    });
    const conversation = client.conversation("cA");
    const sent = conversation.sendMessage("go");
    await vi.waitFor(() => expect(server.streams).toHaveLength(1));
    for (const frame of CLIENT_FUNCTION_FRAMES("cA", "mA")) server.streams[0].push(frame);
    server.streams[0].end();
    await sent;

    const status = () => assistant(conversation.getMessages())[0].functionCalls?.[0].status;
    expect(status()).toBe("awaiting_approval");
    await client.rejectFunction("bag1");
    expect(status()).toBe("rejected");
  });

  it("mark a throwing handler as an error", async () => {
    const client = new AgoClient({ baseUrl: "https://x.example.com", clientFunctionsMode: "pause" });
    client.registerFunction({
      name: "navigateToPage",
      description: "Navigate",
      parameters: { type: "object", properties: {} },
      handler: () => {
        throw new Error("No such page");
      },
    });
    const conversation = client.conversation("cA");
    const sent = conversation.sendMessage("go");
    await vi.waitFor(() => expect(server.streams).toHaveLength(1));
    for (const frame of CLIENT_FUNCTION_FRAMES("cA", "mA")) server.streams[0].push(frame);
    server.streams[0].end();
    await sent;

    await vi.waitFor(() =>
      expect(assistant(conversation.getMessages())[0].functionCalls?.[0]).toMatchObject({
        status: "error",
        error: expect.stringContaining("No such page"),
      }),
    );
  });
});

const RAW_CONVERSATION = (status: string, content = "") => ({
  id: "cA",
  title: "Orders",
  messages: [
    { id: "u1", content: "hi", role: "user", status: "DONE", created_at: "2026-11-01T10:00:00Z" },
    { id: "mA", content, role: "assistant", status, created_at: "2026-11-01T10:00:01Z" },
  ],
});

describe("an answer left running by a reload", () => {
  const conversationGets = () => server.calls.filter((c) => c.url.endsWith("/conversations/cA"));

  async function openReloaded(client: AgoClient, active: boolean) {
    vi.useFakeTimers();
    server.onConversation = () => RAW_CONVERSATION("IN_PROGRESS", "Partial");
    if (active) client.setActiveConversation("cA");
    const conversation = client.conversation("cA");
    const unsubscribe = conversation.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    return { conversation, unsubscribe };
  }

  it("is polled while the conversation is active, until it finishes", async () => {
    const client = makeClient();
    const { conversation } = await openReloaded(client, true);
    expect(conversation.isGenerating()).toBe(true);
    expect(conversationGets()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(conversationGets()).toHaveLength(2);

    server.onConversation = () => RAW_CONVERSATION("DONE", "Full answer");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(assistant(conversation.getMessages())[0]).toMatchObject({
      content: "Full answer",
      status: "DONE",
    });
    expect(conversation.isGenerating()).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(conversationGets()).toHaveLength(3);
  });

  it("stops polling when the user switches to another conversation", async () => {
    const client = makeClient();
    await openReloaded(client, true);
    client.setActiveConversation("cB");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(conversationGets()).toHaveLength(1);
  });

  it("is not polled in the background", async () => {
    const client = makeClient();
    const { conversation } = await openReloaded(client, false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(conversationGets()).toHaveLength(1);
    expect(conversation.isGenerating()).toBe(false);
  });

  it("gives up after 5 minutes and marks the answer as failed", async () => {
    const client = makeClient();
    const { conversation } = await openReloaded(client, true);
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 2_000);
    expect(assistant(conversation.getMessages())[0].status).toBe("ERROR");
    expect(conversation.isGenerating()).toBe(false);
    const gets = conversationGets().length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(conversationGets()).toHaveLength(gets);
  });

  it("is stopped server-side by Stop", async () => {
    const client = makeClient();
    const { conversation } = await openReloaded(client, true);
    const stopped = vi.fn();
    client.on("message:stopped", stopped);

    await conversation.stop();

    expect(server.calls.map((c) => c.url)).toContain(
      "https://x.example.com/api/sdk/v1/messages/mA/stop",
    );
    expect(stopped).toHaveBeenCalledWith({ conversationId: "cA", messageId: "mA" });
    expect(assistant(conversation.getMessages())[0].status).toBe("CANCELED");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(conversationGets()).toHaveLength(1);
  });
});

describe("conversation object lifetime", () => {
  it("drops a finished, inactive, unsubscribed conversation; reopening fetches it again", async () => {
    const client = makeClient();
    server.onConversation = () => RAW_CONVERSATION("DONE", "Answer");
    const first = client.conversation("cA");
    const unsubscribe = first.subscribe(() => {});
    await vi.waitFor(() => expect(first.getSnapshot().isLoading).toBe(false));
    expect(client.conversation("cA")).toBe(first);

    unsubscribe();
    const reopened = client.conversation("cA");
    expect(reopened).not.toBe(first);
    reopened.subscribe(() => {});
    await vi.waitFor(() =>
      expect(server.calls.filter((c) => c.url.endsWith("/conversations/cA"))).toHaveLength(2),
    );
  });

  it("keeps a conversation alive while it answers, even with nobody subscribed", async () => {
    const client = makeClient();
    const { sent, stream } = await startAnswer(client, "cA");
    const conversation = client.conversation("cA");
    expect(client.conversation("cA")).toBe(conversation);
    stream.push({ message_id: "mA", thread: { id: "cA" }, content: "x" });
    stream.end();
    await sent;
    expect(client.conversation("cA")).not.toBe(conversation);
  });

  it("keeps the active conversation alive", async () => {
    const client = makeClient();
    client.setActiveConversation("cA");
    const conversation = client.conversation("cA");
    conversation.subscribe(() => {})();
    expect(client.conversation("cA")).toBe(conversation);
    client.setActiveConversation("cB");
    expect(client.conversation("cA")).not.toBe(conversation);
  });
});

describe("onGeneratingChanged", () => {
  it("fires when a conversation starts and stops answering", async () => {
    const client = makeClient();
    const seen: boolean[] = [];
    client.onGeneratingChanged(() => seen.push(client.isGenerating("cA")));
    const { sent, stream } = await startAnswer(client, "cA");
    stream.end();
    await sent;
    expect(seen).toEqual([true, false]);
  });
});
