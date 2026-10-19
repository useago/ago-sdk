import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgoMessage,
  SdkConfig,
  TicketForm,
  ToolCallData,
} from "../src/client/types";
import { createMockClient } from "../src/testing/createMockClient";
import { mountChatWidget } from "../src/widget/createChatWidget";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ count: 0, items: [] }),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const ticketForm: TicketForm = {
  id: "tf-1",
  name: "Support",
  mode: "form",
  showSubject: true,
  showBody: true,
  showPriority: true,
  showTypology: true,
  fields: [
    {
      id: "f1",
      externalId: "product",
      title: "Product",
      required: true,
      hidden: false,
      position: 0,
      options: [
        { id: "o1", name: "App", value: "app", default: false, messageType: "info" },
        { id: "o2", name: "API", value: "api", default: false, messageType: "info" },
      ],
    },
    {
      id: "f2",
      title: "Region",
      required: false,
      hidden: false,
      position: 1,
      options: [],
    },
  ],
};

const config: SdkConfig = {
  permissions: [{ agents: [], ticketForm, fileAttachmentsEnabled: false, voiceEnabled: false, speechToTextEnabled: false }],
  proactive: { enabled: false },
};

function formCall(overrides: Partial<ToolCallData> = {}): ToolCallData {
  return {
    id: "tc-1",
    type: "form",
    status: "waiting_input",
    toolName: "ago_ticketing",
    displayMode: "display",
    askToTalkToHuman: true,
    allowedToCreateTicket: true,
    ticket: {
      subject: "Login broken",
      body: "I cannot log in since this morning.",
      typology: "Question",
      priority: "Normal",
      custom_fields: { product: "app" },
    },
    data: {},
    ...overrides,
  };
}

function answer(overrides: Partial<AgoMessage> = {}): AgoMessage {
  return {
    id: "a-1",
    conversationId: "conv-1",
    content: "Let me open a ticket for you.",
    role: "assistant",
    status: "DONE",
    toolCalls: [formCall()],
    createdAt: new Date(0),
    ...overrides,
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

function mount(
  options: Partial<Parameters<typeof mountChatWidget>[1]> = {},
  overrides: Record<string, (...args: unknown[]) => unknown> = {},
) {
  const client = createMockClient({
    overrides: {
      getConfig: async () => config,
      createTicket: async () => ({ id: "t-1", url: "https://tickets.example.test/t-1" }),
      submitToolCallForm: async () => ({ status: "completed", result: {} }),
      sendMessage: async () => answer(),
      // A known visitor by default: the email field is covered on its own.
      getUserIdentity: () => ({ email: "known@example.test", hasJwt: false }),
      ...overrides,
    },
  });
  const root = document.createElement("div");
  document.body.appendChild(root);
  const widget = mountChatWidget(root, { client, ...options });
  return {
    client,
    widget,
    root,
    form: () => root.querySelector<HTMLElement>(".ago-ticket-form"),
    input: (id: string) => root.querySelector<HTMLInputElement>(`#${id}`)!,
    select: (id: string) => root.querySelector<HTMLSelectElement>(`#${id}`)!,
    submitBtn: () => root.querySelector<HTMLButtonElement>(".ago-ticket-form__submit")!,
    composer: () => root.querySelector<HTMLElement>(".ago-chat-input")!,
    blocked: () => root.querySelector<HTMLElement>(".ago-chat-blocked"),
    cleanup: () => {
      widget.destroy();
      root.remove();
    },
  };
}

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event("input"));
  el.dispatchEvent(new Event("change"));
}

describe("ticket form tool call", () => {
  it("renders the pre-filled form above the answer once the turn completes", async () => {
    const m = mount();
    await m.widget.sendMessage("I need help");
    await flush();
    const form = m.form()!;
    expect(form).not.toBeNull();
    expect(form.textContent).toContain("You can use the following form to create a ticket");
    expect(m.input("ago-ticket-subject").value).toBe("Login broken");
    expect(m.select("ago-ticket-typology").value).toBe("Question");
    expect(m.select("ago-ticket-priority").value).toBe("Normal");
    expect(m.select("ago-ticket-field-product").value).toBe("app");
    // The form sits between the sources slot and the answer text.
    const message = m.root.querySelector(".ago-message--assistant")!;
    const order = Array.from(message.children).map((c) => c.className);
    expect(order.indexOf("ago-ticket-form")).toBeLessThan(
      order.indexOf("ago-message__content"),
    );
    m.cleanup();
  });

  it("shows the form as soon as the tool call streams in, without duplicating it", async () => {
    const m = mount({}, {
      sendMessage: () =>
        new Promise<AgoMessage>((resolve) => {
          setTimeout(() => resolve(answer()), 0);
        }),
    });
    const sending = m.widget.sendMessage("I need help");
    m.client.__emitEvent("message:start", { conversationId: "conv-1" });
    m.client.__emitEvent("toolCall:received", formCall());
    await flush();
    expect(m.root.querySelectorAll(".ago-ticket-form")).toHaveLength(1);
    await sending;
    await flush();
    expect(m.root.querySelectorAll(".ago-ticket-form")).toHaveLength(1);
    m.cleanup();
  });

  it("blocks submission on a missing required field", async () => {
    const createTicket = vi.fn(async () => ({ id: "t-1" }));
    const m = mount({}, { createTicket });
    await m.widget.sendMessage("I need help");
    await flush();
    type(m.input("ago-ticket-subject"), "");
    m.submitBtn().click();
    await flush();
    expect(createTicket).not.toHaveBeenCalled();
    expect(m.form()!.textContent).toContain("Subject is required.");
    expect(m.root.querySelector(".ago-ticket-form__submit-error")!.getAttribute("role")).toBe(
      "alert",
    );
    m.cleanup();
  });

  it("creates the ticket, completes the tool call and shows the success link", async () => {
    const createTicket = vi.fn(async () => ({
      id: "t-1",
      url: "https://tickets.example.test/t-1",
    }));
    const submitToolCallForm = vi.fn(async () => ({ status: "completed" }));
    const onSubmitted = vi.fn();
    const m = mount(
      { toolCallForm: { onSubmitted } },
      { createTicket, submitToolCallForm },
    );
    await m.widget.sendMessage("I need help");
    await flush();
    m.submitBtn().click();
    await flush();
    await flush();
    expect(createTicket).toHaveBeenCalledWith({
      subject: "Login broken",
      body: "I cannot log in since this morning.",
      priority: "Normal",
      typology: "Question",
      conversationId: "conv-1",
      email: undefined,
      customFields: [{ id: "product", value: "app" }],
      files: [],
      ticketFormId: "tf-1",
    });
    expect(submitToolCallForm).toHaveBeenCalledWith(
      "tc-1",
      expect.objectContaining({
        success: true,
        ticket_id: "t-1",
        ticket_url: "https://tickets.example.test/t-1",
        subject: "Login broken",
        custom_fields: [{ id: "product", value: "app" }],
      }),
    );
    const success = m.root.querySelector<HTMLElement>(".ago-ticket-form__success")!;
    expect(success.textContent).toContain("Your ticket has been successfully submitted.");
    expect(success.querySelector("a")!.href).toBe("https://tickets.example.test/t-1");
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(onSubmitted.mock.calls[0][0]).toMatchObject({
      toolCallId: "tc-1",
      mode: "form",
      ticket: { id: "t-1" },
    });
    m.cleanup();
  });

  it("replaces the composer while the form is pending, then offers a new conversation", async () => {
    const onNewConversation = vi.fn();
    const sendMessage = vi.fn(async () => answer());
    const m = mount({ toolCallForm: { onNewConversation } }, { sendMessage });
    await m.widget.sendMessage("I need help");
    await flush();
    expect(m.composer().style.display).toBe("none");
    expect(m.blocked()!.textContent).toContain(
      "Please complete the form above to continue the conversation",
    );
    expect(m.blocked()!.querySelector(".ago-chat-blocked__new")).toBeNull();

    m.submitBtn().click();
    await flush();
    await flush();
    expect(m.blocked()!.textContent).toContain("A ticket has been created");
    const newBtn = m.blocked()!.querySelector<HTMLButtonElement>(".ago-chat-blocked__new")!;
    newBtn.click();
    expect(onNewConversation).toHaveBeenCalledTimes(1);
    expect(m.blocked()).toBeNull();
    expect(m.composer().style.display).toBe("");
    expect(m.root.querySelector(".ago-message")).toBeNull();

    sendMessage.mockResolvedValue(answer({ toolCalls: undefined, conversationId: "conv-2" }));
    await m.widget.sendMessage("again");
    expect(sendMessage).toHaveBeenLastCalledWith("again", {
      conversationId: undefined,
      files: undefined,
    });
    m.cleanup();
  });

  it("keeps the typed text and the same node across streamed chunks and full renders", async () => {
    const m = mount({}, {
      sendMessage: () =>
        new Promise<AgoMessage>((resolve) => {
          setTimeout(() => resolve(answer()), 5);
        }),
    });
    const sending = m.widget.sendMessage("I need help");
    m.client.__emitEvent("message:start", { conversationId: "conv-1" });
    m.client.__emitEvent("toolCall:received", formCall());
    await flush();
    const textarea = m.root.querySelector<HTMLTextAreaElement>("#ago-ticket-body")!;
    type(textarea, "typed while streaming");
    m.client.__emitEvent("message:chunk", { content: "Let me " });
    m.client.__emitEvent("message:chunk", { content: "open a ticket." });
    const after = m.root.querySelector<HTMLTextAreaElement>("#ago-ticket-body")!;
    expect(after).toBe(textarea);
    expect(after.value).toBe("typed while streaming");
    await sending;
    await flush();
    const afterComplete = m.root.querySelector<HTMLTextAreaElement>("#ago-ticket-body")!;
    expect(afterComplete).toBe(textarea);
    expect(afterComplete.value).toBe("typed while streaming");
    m.cleanup();
  });

  it("shows the persisted success and the blocked card when reloading a thread", async () => {
    const m = mount(
      { conversationId: "conv-1" },
      {
        getConversation: async () => ({
          id: "conv-1",
          title: "Thread",
          lastMessageDate: new Date(),
          messages: [
            answer({
              toolCalls: [
                formCall({
                  data: {
                    success: true,
                    ticket: { ticket_id: "t-9", ticket_url: "https://x.test/t/9" },
                  },
                }),
              ],
            }),
          ],
        }),
      },
    );
    await flush();
    await flush();
    expect(m.root.querySelector(".ago-ticket-form__success")!.textContent).toContain(
      "https://x.test/t/9",
    );
    expect(m.root.querySelector("#ago-ticket-subject")).toBeNull();
    expect(m.blocked()!.querySelector(".ago-chat-blocked__new")).not.toBeNull();
    m.cleanup();
  });

  it("shows the not-allowed notice and still blocks the composer", async () => {
    const m = mount({}, {
      sendMessage: async () =>
        answer({ toolCalls: [formCall({ allowedToCreateTicket: false })] }),
    });
    await m.widget.sendMessage("I need help");
    await flush();
    expect(m.root.querySelector(".ago-ticket-form__denied")).not.toBeNull();
    expect(m.root.querySelector("#ago-ticket-subject")).toBeNull();
    expect(m.composer().style.display).toBe("none");
    m.cleanup();
  });

  it("renders only the newest form; the older one becomes a status line", async () => {
    const m = mount({}, {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce(answer({ id: "a-1", toolCalls: [formCall({ id: "tc-1" })] }))
        .mockResolvedValueOnce(answer({ id: "a-2", toolCalls: [formCall({ id: "tc-2" })] })),
    });
    await m.widget.sendMessage("first");
    await flush();
    // The pending form blocks the composer, but the programmatic path still sends.
    await m.widget.sendMessage("second");
    await flush();
    expect(m.root.querySelectorAll(".ago-ticket-form")).toHaveLength(1);
    const status = m.root.querySelector<HTMLElement>(".ago-toolcall-status--info")!;
    expect(status.textContent).toContain("A new contact form has been created");
    m.cleanup();
  });

  it("hosts an embedded form and completes the tool call on its submission", async () => {
    const submitToolCallForm = vi.fn(async () => ({
      status: "completed",
      result: { ticket: { ticket_id: "t-7", ticket_url: "https://x.test/t/7" } },
    }));
    const onSubmitted = vi.fn();
    const m = mount(
      { toolCallForm: { onSubmitted } },
      {
        submitToolCallForm,
        sendMessage: async () =>
          answer({
            toolCalls: [
              formCall({
                mode: "embed",
                embedHtml:
                  '<form id="hosted"><input name="email" value="a@b.co"><button type="submit">Go</button></form>',
                embedDescription: "Fill in the hosted form",
              }),
            ],
          }),
      },
    );
    await m.widget.sendMessage("I need help");
    await flush();
    const embed = m.root.querySelector<HTMLElement>(".ago-embed-form")!;
    expect(embed.textContent).toContain("Fill in the hosted form");
    const hosted = embed.querySelector<HTMLFormElement>("#hosted")!;
    hosted.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(submitToolCallForm).toHaveBeenCalledWith("tc-1", {
      success: true,
      source: "embed",
      thread_id: "conv-1",
      captured_form_data: { email: "a@b.co" },
    });
    expect(m.root.querySelector(".ago-ticket-form__success")!.textContent).toContain(
      "Your form has been submitted successfully.",
    );
    expect(onSubmitted.mock.calls[0][0]).toMatchObject({
      mode: "embed",
      ticket: { id: "t-7", url: "https://x.test/t/7" },
    });
    m.cleanup();
  });

  it("asks for an email only when the SDK has no identity, and validates it", async () => {
    const createTicket = vi.fn(async () => ({ id: "t-1" }));
    const anonymous = mount(
      {},
      { createTicket, getUserIdentity: () => ({ email: undefined, hasJwt: false }) },
    );
    await anonymous.widget.sendMessage("help");
    await flush();
    const email = anonymous.input("ago-ticket-email");
    expect(email).not.toBeNull();
    type(email, "not-an-email");
    anonymous.submitBtn().click();
    await flush();
    expect(createTicket).not.toHaveBeenCalled();
    expect(anonymous.form()!.textContent).toContain("Please enter a valid email address");
    type(anonymous.input("ago-ticket-email"), "jane@example.test");
    anonymous.submitBtn().click();
    await flush();
    await flush();
    expect(createTicket).toHaveBeenCalledWith(
      expect.objectContaining({ email: "jane@example.test" }),
    );
    anonymous.cleanup();

    const known = mount({}, { createTicket });
    await known.widget.sendMessage("help");
    await flush();
    expect(known.root.querySelector("#ago-ticket-email")).toBeNull();
    known.cleanup();

    // A JWT identifies the visitor too, and `toolCallForm.userEmail` fills the gap.
    const viaJwt = mount(
      {},
      { createTicket, getUserIdentity: () => ({ email: undefined, hasJwt: true }) },
    );
    await viaJwt.widget.sendMessage("help");
    await flush();
    expect(viaJwt.root.querySelector("#ago-ticket-email")).toBeNull();
    viaJwt.cleanup();
    const viaOption = mount(
      { toolCallForm: { userEmail: "opt@example.test" } },
      { createTicket, getUserIdentity: () => ({ email: undefined, hasJwt: false }) },
    );
    await viaOption.widget.sendMessage("help");
    await flush();
    expect(viaOption.root.querySelector("#ago-ticket-email")).toBeNull();
    viaOption.cleanup();
  });

  it("enables attachments when the form configuration arrives after rendering", async () => {
    let resolveConfig!: (value: SdkConfig) => void;
    const createTicket = vi.fn(async () => ({ id: "ticket" }));
    const m = mount({}, { createTicket, getConfig: () => new Promise<SdkConfig>(resolve => { resolveConfig = resolve; }) });
    await m.widget.sendMessage("help");
    await flush();
    expect(m.root.querySelector(".ago-ticket-form__config-loading")).not.toBeNull();
    resolveConfig({ ...config, permissions: [{ ...config.permissions[0], fileAttachmentsEnabled: true }] });
    await flush();
    const files = m.input("ago-ticket-files");
    expect(files).not.toBeNull();
    const file = new File(["details"], "details.txt", { type: "text/plain" });
    Object.defineProperty(files, "files", { value: [file] });
    files.dispatchEvent(new Event("change"));
    m.submitBtn().click();
    await flush();
    expect(createTicket).toHaveBeenCalledWith(expect.objectContaining({ files: [file] }));
    m.cleanup();
  });

  it("updates conditional questions and choices, then submits only the selected branch", async () => {
    const conditionalForm: TicketForm = {
      ...ticketForm, showPriority: false, showTypology: false,
      fields: [
        ticketForm.fields[0],
        { id: "account", title: "Account", required: true, hidden: false, position: 1, options: [],
          conditionalFieldId: "f1", conditionalFieldValue: "app, mobile" },
        { id: "version", title: "Version", required: true, hidden: false, position: 2, alwaysVisible: true,
          options: [
            { id: "app-v1", value: "app-v1", default: false, messageType: "info", conditionalFieldId: "product", conditionalFieldValues: ["app"] },
            { id: "api-v2", value: "api-v2", default: false, messageType: "info", conditionalFieldId: "product", conditionalFieldValues: ["api"] },
          ] },
        { id: "internal", title: "Internal", required: false, hidden: true, position: 3,
          options: [{ id: "sdk", value: "sdk", default: true, messageType: "info" }] },
      ],
    };
    const createTicket = vi.fn(async () => ({ id: "t-1" }));
    const m = mount({}, { createTicket, getConfig: async () => ({ ...config, permissions: [{ ...config.permissions[0], ticketForm: conditionalForm }] }) });
    await m.widget.sendMessage("help");
    await flush();
    type(m.input("ago-ticket-field-account"), "Old account");
    const version = m.select("ago-ticket-field-version");
    expect([...version.options].map(o => o.value)).toEqual(["", "app-v1"]);
    version.value = "app-v1";
    version.dispatchEvent(new Event("change"));
    const product = m.select("ago-ticket-field-product");
    product.value = "api";
    product.dispatchEvent(new Event("change"));
    expect(m.input("ago-ticket-field-account")).toBeNull();
    expect(m.select("ago-ticket-field-version").value).toBe("");
    m.submitBtn().click();
    await flush();
    expect(createTicket).not.toHaveBeenCalled();
    const nextVersion = m.select("ago-ticket-field-version");
    nextVersion.value = "api-v2";
    nextVersion.dispatchEvent(new Event("change"));
    m.submitBtn().click();
    await flush();
    expect(createTicket).toHaveBeenCalledWith(expect.objectContaining({
      customFields: expect.arrayContaining([{ id: "product", value: "api" }, { id: "version", value: "api-v2" }, { id: "internal", value: "sdk" }]),
    }));
    expect(createTicket.mock.calls[0][0].customFields).toHaveLength(3);
    m.cleanup();
  });

  it("reveals missing required questions on submit and uses the configured success message", async () => {
    const form: TicketForm = { ...ticketForm, fields: ticketForm.fields.map(f => ({ ...f, required: true })),
      successMessageText: "Demande reçue", successMessageUrlLabel: "Voir le ticket" };
    const createTicket = vi.fn(async () => ({ id: "ticket", url: "https://x.test/ticket" }));
    const m = mount({}, { createTicket,
      getConfig: async () => ({ ...config, permissions: [{ ...config.permissions[0], ticketForm: form }] }),
      sendMessage: async () => answer({ toolCalls: [formCall({ ticket: { subject: "Help", body: "Details" } })] }),
    });
    await m.widget.sendMessage("help");
    await flush();
    expect(m.input("ago-ticket-field-f2")).toBeNull();
    m.submitBtn().click();
    await flush();
    expect(createTicket).not.toHaveBeenCalled();
    expect(m.input("ago-ticket-field-f2")).not.toBeNull();
    const product = m.select("ago-ticket-field-product");
    product.value = "app";
    product.dispatchEvent(new Event("change"));
    type(m.input("ago-ticket-field-f2"), "Europe");
    m.submitBtn().click();
    await flush();
    expect(m.form()!.textContent).toContain("Demande reçue");
    expect(m.form()!.textContent).toContain("Voir le ticket");
    m.cleanup();
  });

  it("renders the placeholder for a non-ticketing form tool call", async () => {
    const m = mount({}, {
      sendMessage: async () =>
        answer({
          toolCalls: [
            formCall({
              toolName: "feedback",
              message: "Tell us more",
              formSchema: { type: "object", properties: { note: { type: "string" } } },
            }),
          ],
        }),
    });
    await m.widget.sendMessage("help");
    await flush();
    const placeholder = m.root.querySelector<HTMLElement>(".ago-toolcall-form-placeholder")!;
    expect(placeholder.textContent).toContain("feedback:");
    expect(placeholder.textContent).toContain("Tell us more");
    expect(placeholder.textContent).toContain("Generic form rendering (Coming soon)");
    expect(placeholder.querySelector("pre")!.textContent).toContain('"note"');
    m.cleanup();
  });

  it("works on the bubble placement too", async () => {
    document.body.replaceChildren();
    const client = createMockClient({
      overrides: {
        getConfig: async () => config,
        getConversations: async () => ({ data: [], hasMore: false, total: 0 }),
        sendMessage: async () => answer(),
      },
    });
    const widget = mountChatWidget(document.body, {
      client,
      placement: "bubble",
      persistConversation: false,
    });
    await widget.sendMessage("help");
    await flush();
    expect(document.querySelector(".ago-message__body .ago-ticket-form")).not.toBeNull();
    expect(document.querySelector<HTMLElement>(".ago-chat-input")!.style.display).toBe("none");
    widget.destroy();
  });
});

function localizedConfig(title: string): SdkConfig {
  return { ...config, permissions: [{ ...config.permissions[0], ticketForm: {
    ...ticketForm,
    fields: ticketForm.fields.map((field) => ({ ...field,
      title: field.id === 'f1' ? title : field.title,
      prefillAliases: [field.id, 'product'],
      options: field.options.map((option) => ({ ...option, name: `${title} ${option.value}` })),
    })),
  } }] };
}

it('keeps answers, attachments and submission status when the language changes', async () => {
  const getConfig = vi.fn().mockResolvedValue(config);
  let finish!: (result: { id: string }) => void;
  const createTicket = vi.fn(() => new Promise<{ id: string }>((resolve) => { finish = resolve; }));
  const m = mount({ allowFiles: true }, { getConfig, createTicket });
  try {
    await m.widget.sendMessage('help'); await flush();
    type(m.input('ago-ticket-subject'), 'My draft');
    const select = m.select('ago-ticket-field-product');
    select.value = 'api'; select.dispatchEvent(new Event('change'));
    const file = new File(['body'], 'draft.txt');
    Object.defineProperty(m.input('ago-ticket-files'), 'files', { value: [file] });
    m.input('ago-ticket-files').dispatchEvent(new Event('change'));
    getConfig.mockResolvedValue(localizedConfig('Produit'));
    m.client.__emitEvent('config:changed', { language: 'fr' }); await flush();
    expect(m.root.querySelector('label[for="ago-ticket-field-product"]')?.textContent).toContain('Produit');
    expect(m.select('ago-ticket-field-product').selectedOptions[0].textContent).toBe('Produit api');
    expect(m.input('ago-ticket-subject').value).toBe('My draft');
    expect(m.select('ago-ticket-field-product').value).toBe('api');
    expect(m.form()?.textContent).toContain('draft.txt');
    expect(m.root.querySelector('.ago-ticket-form__error')).toBeNull();
    m.submitBtn().click(); await flush();
    getConfig.mockResolvedValue(localizedConfig('Product'));
    m.client.__emitEvent('config:changed', { language: 'en' }); await flush();
    expect(m.submitBtn().disabled).toBe(true);
    finish({ id: 'submitted' }); await flush();
    expect(createTicket).toHaveBeenCalledWith(expect.objectContaining({ subject: 'My draft', files: [file], customFields: [{ id: 'product', value: 'api' }] }));
    getConfig.mockResolvedValue(localizedConfig('Produit'));
    m.client.__emitEvent('config:changed', { language: 'fr' }); await flush();
    expect(m.root.querySelector('.ago-ticket-form__success')).not.toBeNull();
    expect(m.root.querySelector('.ago-ticket-form__submit')).toBeNull();
  } finally { m.cleanup(); }
});

it('shows the latest selected language and keeps the form usable until a failed refresh recovers', async () => {
  const getConfig = vi.fn().mockResolvedValue(config);
  const m = mount({}, { getConfig });
  try {
    await m.widget.sendMessage('help'); await flush();
    const pending: Array<(config: SdkConfig) => void> = [];
    getConfig.mockImplementation(() => new Promise<SdkConfig>((resolve) => pending.push(resolve)));
    for (const language of ['fr', 'en', 'fr']) m.client.__emitEvent('config:changed', { language });
    pending[2](localizedConfig('Latest')); await flush();
    pending[0](localizedConfig('Old French')); pending[1](localizedConfig('Old English')); await flush();
    expect(m.form()?.textContent).toContain('Latest');
    expect(m.form()?.textContent).not.toContain('Old');
    getConfig.mockRejectedValue(new Error('offline'));
    m.client.__emitEvent('config:changed', { language: 'de' }); await flush();
    expect(m.form()?.textContent).toContain('Latest');
    getConfig.mockResolvedValue(localizedConfig('Recovered'));
    window.dispatchEvent(new Event('online')); await flush();
    expect(m.form()?.textContent).toContain('Recovered');
  } finally { m.cleanup(); }
});

it('updates validation labels when the language changes and clears answers for a different form', async () => {
  const getConfig = vi.fn().mockResolvedValue(config);
  const m = mount({}, { getConfig });
  try {
    await m.widget.sendMessage('help'); await flush();
    const select = m.select('ago-ticket-field-product');
    select.value = ''; select.dispatchEvent(new Event('change'));
    m.submitBtn().click(); await flush();
    expect(m.form()?.textContent).toContain('Product is required.');
    getConfig.mockResolvedValue(localizedConfig('Produit'));
    m.client.__emitEvent('config:changed', { language: 'fr' }); await flush();
    expect(m.form()?.textContent).toContain('Produit is required.');
    expect(m.select('ago-ticket-field-product').value).toBe('');
    const changed = localizedConfig('Another');
    changed.permissions[0].ticketForm!.id = 'another-form';
    getConfig.mockResolvedValue(changed);
    m.client.__emitEvent('config:changed', { language: 'de' }); await flush();
    expect(m.input('ago-ticket-subject').value).toBe('');
    expect(m.root.querySelector('.ago-ticket-form__error')).toBeNull();
  } finally { m.cleanup(); }
});

it('clears a form when a language refresh is forbidden and ignores its pending submission', async () => {
  const getConfig = vi.fn().mockResolvedValue(config);
  let finish!: (result: { id: string }) => void;
  const createTicket = vi.fn(() => new Promise<{ id: string }>(resolve => { finish = resolve; }));
  const submitToolCallForm = vi.fn();
  const m = mount({}, { getConfig, createTicket, submitToolCallForm });
  try {
    await m.widget.sendMessage('help'); await flush();
    type(m.input('ago-ticket-subject'), 'My draft');
    m.submitBtn().click(); await flush();
    getConfig.mockRejectedValue({ statusCode: 403 });
    m.client.__emitEvent('config:changed', { language: 'fr' }); await flush();
    expect(m.root.querySelector('#ago-ticket-subject')).toBeNull();
    finish({ id: 'submitted-ticket' }); await flush();
    expect(submitToolCallForm).not.toHaveBeenCalled();
    expect(m.root.querySelector('.ago-ticket-form__success')).toBeNull();
  } finally { m.cleanup(); }
});
