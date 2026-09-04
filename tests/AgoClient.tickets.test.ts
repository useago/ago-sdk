import { afterEach, describe, expect, it, vi } from "vitest";
import { AgoClient } from "../src/client/AgoClient";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getConfig", () => {
  it("maps the ticket form onto camelCase", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          object: "config",
          permissions: [
            {
              id: "p1",
              name: "default",
              display_name: "Default",
              agents: [{ id: "ag1", name: "Guide" }],
              file_attachments_enabled: true,
              ticket_form: {
                id: "tf1",
                name: "Support",
                mode: "form",
                show_subject: true,
                show_body: false,
                fields: [
                  {
                    id: "f1",
                    external_id: "product",
                    title: "Product",
                    type: "select",
                    required: true,
                    position: 2,
                    options: [
                      { id: "o1", name: "App", value: "app", default: true, message_type: "warning", message: "Beta" },
                    ],
                    conditional_field_id: null,
                  },
                ],
              },
            },
          ],
          proactive: { enabled: true },
        }),
      ),
    );
    const client = new AgoClient({ baseUrl: "https://x.example.com" });
    const config = await client.getConfig();
    expect(config.proactive.enabled).toBe(true);
    const permission = config.permissions[0];
    expect(permission.displayName).toBe("Default");
    expect(permission.fileAttachmentsEnabled).toBe(true);
    expect(permission.agents).toEqual([{ id: "ag1", name: "Guide" }]);
    expect(permission.ticketForm).toEqual({
      id: "tf1",
      name: "Support",
      mode: "form",
      showSubject: true,
      showBody: false,
      showPriority: true,
      showTypology: true,
      fields: [
        {
          id: "f1",
          externalId: "product",
          title: "Product",
          type: "select",
          required: true,
          hidden: false,
          position: 2,
          options: [
            { id: "o1", name: "App", value: "app", default: true, message: "Beta", messageType: "warning" },
          ],
          conditionalFieldId: undefined,
          conditionalFieldValue: undefined,
        },
      ],
    });
    client.destroy();
  });

  it("maps the home page config, using each starter's description as its label", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          object: "config",
          permissions: [
            {
              id: "p1",
              home_page: {
                title: "How can we help?",
                subtitle: "Answers from the **docs**",
                widget_starter: {
                  id: "ws1",
                  initial_message: "Hi! Anything I can look up?",
                  agent_id: "ag-greeter",
                },
                home_starters: [
                  {
                    id: "s1",
                    title: "Pricing card (internal name)",
                    description: "How much does it cost?",
                    initial_message: "Tell me about pricing",
                    agent_id: "ag-sales",
                  },
                  // No initial_message: the card sends what it shows.
                  { id: "s2", title: "Docs", description: "Where are the docs?" },
                  // Nothing to show and nothing to send: dropped.
                  { id: "s3" },
                ],
              },
            },
          ],
        }),
      ),
    );
    const client = new AgoClient({ baseUrl: "https://x.example.com" });
    const home = (await client.getConfig()).permissions[0].homePage;
    expect(home).toEqual({
      title: "How can we help?",
      subtitle: "Answers from the **docs**",
      starters: [
        {
          id: "s1",
          label: "How much does it cost?",
          message: "Tell me about pricing",
          agentId: "ag-sales",
        },
        {
          id: "s2",
          label: "Where are the docs?",
          message: "Where are the docs?",
          agentId: undefined,
        },
      ],
      widgetStarter: {
        id: "ws1",
        message: "Hi! Anything I can look up?",
        agentId: "ag-greeter",
      },
    });
    client.destroy();
  });

  it("leaves homePage undefined when the backend does not send one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ object: "config", permissions: [{ id: "p1" }] }),
      ),
    );
    const client = new AgoClient({ baseUrl: "https://x.example.com" });
    const config = await client.getConfig();
    expect(config.permissions[0].homePage).toBeUndefined();
    client.destroy();
  });
});

describe("createTicket", () => {
  it("posts multipart form data with the custom fields as JSON", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: "t-1", url: "https://t.test/1" }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const client = new AgoClient({ baseUrl: "https://x.example.com" });
    const file = new File(["x"], "log.txt", { type: "text/plain" });
    const result = await client.createTicket({
      subject: "Broken",
      body: "Details",
      priority: "High",
      typology: "Incident",
      conversationId: "conv-1",
      email: "jane@example.test",
      customFields: [{ id: "product", value: "app" }],
      files: [file],
      ticketFormId: "tf1",
    });
    expect(result).toEqual({ id: "t-1", url: "https://t.test/1" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.example.com/api/sdk/v1/tickets");
    expect(init.method).toBe("POST");
    const body = init.body as FormData;
    expect(body.get("subject")).toBe("Broken");
    expect(body.get("body")).toBe("Details");
    expect(body.get("priority")).toBe("High");
    expect(body.get("typology")).toBe("Incident");
    expect(body.get("conversation_id")).toBe("conv-1");
    expect(body.get("email")).toBe("jane@example.test");
    expect(body.get("custom_fields")).toBe(JSON.stringify([{ id: "product", value: "app" }]));
    expect(body.get("ticket_form_id")).toBe("tf1");
    expect((body.get("files") as File).name).toBe("log.txt");
    // No JSON content type: the browser sets the multipart boundary.
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
    client.destroy();
  });
});

describe("getConversation tool call mapping", () => {
  it("keeps the ticketing fields of a persisted form tool call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          id: "c1",
          title: "Thread",
          created_at: "2026-07-01T00:00:00Z",
          last_message_at: "2026-07-01T00:00:00Z",
          messages: [
            {
              id: "m1",
              content: "Opening a ticket",
              role: "assistant",
              status: "DONE",
              created_at: "2026-07-01T00:00:00Z",
              tool_call_data: [
                {
                  id: "tc1",
                  type: "form",
                  status: "waiting_input",
                  tool_name: "ago_ticketing",
                  display_mode: "display",
                  ask_to_talk_to_human: true,
                  allowed_to_create_ticket: true,
                  ticket: { subject: "Hi", custom_fields: { product: "app" } },
                  mode: "embed",
                  ticket_form_id: "tf1",
                  embed_html: "<form></form>",
                  embed_description: "desc",
                  data: { success: true, ticket: { ticket_id: "t1" } },
                },
              ],
            },
          ],
        }),
      ),
    );
    const client = new AgoClient({ baseUrl: "https://x.example.com" });
    const conversation = await client.getConversation("c1");
    const call = conversation.messages![0].toolCalls![0];
    expect(call).toMatchObject({
      id: "tc1",
      type: "form",
      toolName: "ago_ticketing",
      displayMode: "display",
      askToTalkToHuman: true,
      allowedToCreateTicket: true,
      ticket: { subject: "Hi", custom_fields: { product: "app" } },
      mode: "embed",
      ticketFormId: "tf1",
      embedHtml: "<form></form>",
      embedDescription: "desc",
      data: { success: true, ticket: { ticket_id: "t1" } },
    });
    client.destroy();
  });
});
