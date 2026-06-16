import { describe, it, expect, vi } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import {
  createFormCollector,
  deriveFormStatus,
  loadFormCollector,
  type FormCollectorSchema,
} from "../src/forms/createFormCollector";
import { logger } from "../src/utils/logger";

const schema: FormCollectorSchema = {
  type: "object",
  properties: {
    product: { type: "string", description: "Product name" },
    quantity: { type: "number", description: "Units" },
    express: { type: "boolean", description: "Express shipping" },
  },
  required: ["product", "quantity"],
};

// autoSubmit defaults to true once a submit target is set; these tests exercise
// the manual submit_<name> flow, so they opt out with autoSubmit: false. The
// default (auto-submit) is covered by the dedicated "autoSubmit" tests below.
function makeCollector(
  submit?: Parameters<typeof createFormCollector>[0]["submit"],
  autoSubmit = false
) {
  return createFormCollector({
    name: "order",
    description: "The order the user wants to place.",
    schema,
    submit,
    autoSubmit,
  });
}

describe("createFormCollector", () => {
  it("derives an all-optional update function plus a submit function", () => {
    const c = makeCollector({ via: "backend", destination: "order_webhook" });

    expect(c.functions.map((f) => f.name)).toEqual(["update_order", "submit_order"]);
    expect(c.functions[0].parameters.required).toEqual([]);
    expect(Object.keys(c.functions[0].parameters.properties)).toEqual([
      "product",
      "quantity",
      "express",
    ]);
    expect(c.contextKey).toBe("form:order");
  });

  it("omits the submit function when no submit target is configured", () => {
    const c = makeCollector();
    expect(c.functions.map((f) => f.name)).toEqual(["update_order"]);
  });

  it("merges patches, coerces by type, drops unknown keys; status derives from values", async () => {
    const c = makeCollector();
    expect(deriveFormStatus(schema, c.store.get().values).missing).toEqual([
      "product",
      "quantity",
    ]);

    await c.functions[0].handler({ product: "Widget", junk: "ignored" });
    expect(c.store.get().values).toEqual({ product: "Widget" });
    expect(deriveFormStatus(schema, c.store.get().values)).toEqual({
      missing: ["quantity"],
      complete: false,
    });

    const res = await c.functions[0].handler({ quantity: "3", express: "true" });
    expect(c.store.get().values).toEqual({
      product: "Widget",
      quantity: 3, // coerced number
      express: true, // coerced boolean
    });
    expect(deriveFormStatus(schema, c.store.get().values).complete).toBe(true);
    expect(res).toMatchObject({ ok: true, missing: [] });
  });

  it("exposes current state through the dynamic-context provider", async () => {
    const c = makeCollector();
    await c.functions[0].handler({ product: "Widget" });

    const entry = c.contextProvider();
    expect(entry.data).toEqual({
      values: { product: "Widget" },
      missing: ["quantity"],
      complete: false,
      submitted: false,
    });
    // The agent is told it is mid-collection, that conditional fields are driven by
    // `requiredWhen`, and is given the full schema + the values collected so far.
    expect(entry.description).toContain("collecting information");
    expect(entry.description).toContain("requiredWhen");
    expect(entry.description).toContain(
      `The form schema is the following: ${JSON.stringify(schema)}`
    );
    expect(entry.description).toContain(
      `Data collected so far: ${JSON.stringify({ product: "Widget" })}`
    );
  });

  it("client submit blocks until complete, then calls the handler and flips submitted", async () => {
    const handler = vi.fn(async () => ({ id: 42 }));
    const c = makeCollector({ via: "client", handler });

    const blocked = await c.submit();
    expect(blocked).toEqual({ ok: false, missing: ["product", "quantity"] });
    expect(handler).not.toHaveBeenCalled();

    await c.functions[0].handler({ product: "Widget", quantity: 2 });
    const ok = await c.submit();

    expect(handler).toHaveBeenCalledWith({ product: "Widget", quantity: 2 });
    expect(ok).toEqual({ ok: true, result: { id: 42 } });
    expect(c.store.get().submitted).toBe(true);
    // The response is kept in the store so a UI can echo a server message.
    expect(c.store.get().submitResult).toEqual({ id: 42 });

    // reset clears it again.
    c.reset();
    expect(c.store.get().submitResult).toBeUndefined();
  });

  it("accepts a bare URL string as shorthand for client submit", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 1 }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const c = createFormCollector({
      name: "order",
      description: "An order.",
      schema,
      submit: "/api/orders",
      autoSubmit: false,
    });
    expect(c.functions.map((f) => f.name)).toEqual(["update_order", "submit_order"]);

    await c.functions[0].handler({ product: "Widget", quantity: 2 });
    const res = await c.submit();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/orders",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ product: "Widget", quantity: 2 }),
      })
    );
    expect(res).toEqual({ ok: true, result: { id: 1 } });
    expect(c.store.get().submitted).toBe(true);

    vi.unstubAllGlobals();
  });

  it("backend submit relays the exact values through the client", async () => {
    const c = makeCollector({ via: "backend", destination: "order_webhook" });
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const spy = vi
      .spyOn(client, "submitFormCollector")
      .mockResolvedValue({ status: "completed" });

    const uninstall = c.install(client);
    await c.functions[0].handler({ product: "Widget", quantity: 5 });
    const result = await c.functions[1].handler({}); // submit_order

    expect(spy).toHaveBeenCalledWith("order", {
      product: "Widget",
      quantity: 5,
    });
    expect(result).toEqual({ ok: true, result: { status: "completed" } });

    uninstall();
    client.destroy();
  });

  it("auto-submits by default once complete and exposes no submit function", async () => {
    const handler = vi.fn(async () => ({ id: 7 }));
    // autoSubmit omitted on purpose: it defaults to true when a submit target is set.
    const c = createFormCollector({
      name: "order",
      description: "An order.",
      schema,
      submit: { via: "client", handler },
    });

    // No submit_ tool — the form submits itself.
    expect(c.functions.map((f) => f.name)).toEqual(["update_order"]);

    // An incomplete fill does not submit.
    const partial = await c.functions[0].handler({ product: "Widget" });
    expect(handler).not.toHaveBeenCalled();
    expect(partial).toEqual({
      ok: true,
      values: { product: "Widget" },
      missing: ["quantity"],
    });

    // The fill that completes the form triggers the submit and reports it.
    const done = await c.functions[0].handler({ quantity: 2 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ product: "Widget", quantity: 2 });
    expect(done).toMatchObject({ ok: true, submitted: true });
    expect(c.store.get().submitted).toBe(true);

    // A later fill does not submit again.
    await c.functions[0].handler({ express: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("autoSubmit also fires on a UI-driven setValues that completes the form", async () => {
    const handler = vi.fn(async () => ({ id: 1 }));
    const c = createFormCollector({
      name: "order",
      description: "An order.",
      schema,
      submit: { via: "client", handler },
      autoSubmit: true,
    });

    c.setValues({ product: "Widget", quantity: 3 });
    // setValues is fire-and-forget; let the microtask flush.
    await Promise.resolve();
    await Promise.resolve();

    expect(handler).toHaveBeenCalledWith({ product: "Widget", quantity: 3 });
    expect(c.store.get().submitted).toBe(true);
  });

  it("autoSubmit warns and stays inert without a submit target", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.enable();
    const c = createFormCollector({
      name: "order",
      description: "An order.",
      schema,
      autoSubmit: true,
    });
    logger.disable();
    expect(warn).toHaveBeenCalled();
    expect(c.functions.map((f) => f.name)).toEqual(["update_order"]);

    const res = await c.functions[0].handler({ product: "Widget", quantity: 2 });
    // No submit happened; just the normal update result.
    expect(res).toEqual({
      ok: true,
      values: { product: "Widget", quantity: 2 },
      missing: [],
    });
    expect(c.store.get().submitted).toBe(false);

    warn.mockRestore();
  });

  it("autoSubmit tells the agent in context that the form submits itself", () => {
    const c = createFormCollector({
      name: "order",
      description: "An order.",
      schema,
      submit: { via: "backend" },
      autoSubmit: true,
    });
    expect(c.contextProvider().description).toContain("submitted automatically");
    expect(c.contextProvider().description).not.toContain("call submit_order");
  });

  it("install registers functions + dynamic context, uninstall removes them", () => {
    const c = makeCollector({ via: "backend", destination: "d" });
    const client = new AgoClient({ baseUrl: "https://example.test" });

    const uninstall = c.install(client);
    expect(client.getRegisteredFunctions().map((s) => s.name)).toEqual([
      "update_order",
      "submit_order",
    ]);
    expect(client.getContextSnapshot()?.entries["form:order"]).toBeTruthy();

    uninstall();
    expect(client.getRegisteredFunctions()).toHaveLength(0);
    expect(client.getContextSnapshot()).toBeNull();
    client.destroy();
  });

  it("emits context:changed on install (initial missing) and on every store update", async () => {
    const c = makeCollector({ via: "backend", destination: "d" });
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const onChange = vi.fn();
    client.on("context:changed", onChange);

    // Install registers the provider → fires once, with the initial missing fields.
    const uninstall = c.install(client);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]?.entries["form:order"]?.data).toMatchObject({
      missing: ["product", "quantity"],
    });

    // A store update (agent fills a field) fires again with the fresh snapshot.
    onChange.mockClear();
    await c.functions[0].handler({ product: "Widget" });
    expect(onChange).toHaveBeenCalledTimes(1);
    const entry = onChange.mock.calls[0][0]?.entries["form:order"];
    expect(entry?.data).toMatchObject({ missing: ["quantity"] });
    expect(entry?.description).toContain(
      `Data collected so far: ${JSON.stringify({ product: "Widget" })}`
    );

    // UI-driven setValues also fires.
    onChange.mockClear();
    c.setValues({ quantity: 2 });
    expect(onChange).toHaveBeenCalledTimes(1);

    // After uninstall, store changes no longer notify the client.
    uninstall();
    onChange.mockClear();
    c.setValues({ product: "Other" });
    expect(onChange).not.toHaveBeenCalled();

    client.destroy();
  });

  it("honors initialValues and reset", async () => {
    const c = createFormCollector({
      name: "order",
      description: "An order.",
      schema,
      initialValues: { product: "Preset" },
    });
    expect(deriveFormStatus(schema, c.store.get().values).missing).toEqual([
      "quantity",
    ]);

    await c.functions[0].handler({ quantity: 9 });
    expect(deriveFormStatus(schema, c.store.get().values).complete).toBe(true);

    c.reset();
    expect(c.store.get()).toEqual({
      values: { product: "Preset" },
      submitted: false,
    });
    expect(deriveFormStatus(schema, c.store.get().values)).toEqual({
      missing: ["quantity"],
      complete: false,
    });
  });

  it("hydrate replays prefixed update_ tool-call arguments in order, coercing by type", () => {
    const c = makeCollector({ via: "backend", destination: "d" });

    c.hydrate([
      {
        id: "1",
        type: "status_message",
        status: "done",
        toolName: "client__update_order",
        arguments: { product: "Widget" },
      },
      {
        id: "2",
        type: "status_message",
        status: "done",
        toolName: "client__update_order",
        // strings coerced to their declared types; unknown keys dropped
        arguments: { quantity: "3", express: "true", junk: "x" },
      },
    ]);

    expect(c.store.get()).toEqual({
      values: { product: "Widget", quantity: 3, express: true },
      submitted: false,
    });
    expect(deriveFormStatus(schema, c.store.get().values)).toEqual({
      missing: [],
      complete: true,
    });
  });

  it("hydrate flips submitted when a completed submit_ tool call is present", () => {
    const c = makeCollector({ via: "backend", destination: "d" });

    // A *completed* (DONE) client-function call has type "status_message" and no
    // `function_name` — see backend ToolCallBagUIService.get_ui_from_tool_call_bag
    // (test_done_status_message). Matching must therefore go through `toolName`.
    c.hydrate([
      {
        id: "1",
        type: "status_message",
        status: "done",
        toolName: "client__update_order",
        arguments: { product: "Widget", quantity: 2 },
      },
      {
        id: "2",
        type: "status_message",
        status: "done",
        toolName: "client__submit_order",
      },
    ]);

    expect(c.store.get()).toEqual({
      values: { product: "Widget", quantity: 2 },
      submitted: true,
    });
    expect(deriveFormStatus(schema, c.store.get().values).complete).toBe(true);
  });

  it("hydrate matches an in-flight (WAITING_INPUT) client-function call by function_name", () => {
    const c = makeCollector({ via: "backend", destination: "d" });

    // A reload mid-call: the bag is still WAITING_INPUT, so the backend emits
    // type "client_function" WITH `function_name` (see test_waiting_input_client_function).
    // The unprefixed `functionName` is enough to match — no `client__` prefix here.
    c.hydrate([
      {
        id: "1",
        type: "client_function",
        status: "waiting_input",
        toolName: "client__update_order",
        functionName: "update_order",
        arguments: { product: "Widget", quantity: 2 },
      },
    ]);

    expect(c.store.get()).toEqual({
      values: { product: "Widget", quantity: 2 },
      submitted: false,
    });
    expect(deriveFormStatus(schema, c.store.get().values).complete).toBe(true);
  });

  it("hydrate is idempotent and resets from initial values on each call", () => {
    const c = createFormCollector({
      name: "order",
      description: "An order.",
      schema,
      initialValues: { product: "Preset" },
    });

    const calls: Parameters<typeof c.hydrate>[0] = [
      {
        id: "1",
        type: "status_message",
        status: "done",
        toolName: "client__update_order",
        arguments: { quantity: 4 },
      },
    ];
    c.hydrate(calls);
    c.hydrate(calls);
    expect(c.store.get().values).toEqual({ product: "Preset", quantity: 4 });

    // A conversation without this form's tool calls resets back to initial.
    c.hydrate([]);
    expect(c.store.get()).toEqual({
      values: { product: "Preset" },
      submitted: false,
    });
    expect(deriveFormStatus(schema, c.store.get().values)).toEqual({
      missing: ["quantity"],
      complete: false,
    });
  });

  it("install hydrates when getConversation loads a conversation's tool calls", async () => {
    const c = makeCollector({ via: "backend", destination: "d" });
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const uninstall = c.install(client);

    // The tool_call_data entry below is the *exact* shape ToolCallBagUIService
    // .get_ui_from_tool_call_bag emits for a DONE client-function call (see backend
    // test_arguments_exposed_for_done_client_function): snake_case keys, the
    // `client__` prefix, type "status_message" (NOT "client_function"), no
    // `function_name`, and `arguments` surfaced at the top level.
    const conversationJson = {
      id: "conv-1",
      title: "t",
      last_message_date: new Date().toISOString(),
      messages: [
        {
          id: "m1",
          content: "ok",
          role: "assistant",
          status: "DONE",
          created_at: new Date().toISOString(),
          tool_call_data: [
            {
              tool_call_data: true,
              status: "done",
              id: "tc1",
              tool_name: "client__update_order",
              tool_display_name: "Update Order",
              thread: { id: "conv-1" },
              arguments: { product: "Widget", quantity: 7 },
              type: "status_message",
              message: null,
              result: { message: "Order updated" },
              variant: "success",
            },
          ],
        },
      ],
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => conversationJson,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await client.getConversation("conv-1");
    expect(c.store.get().values).toEqual({ product: "Widget", quantity: 7 });
    expect(deriveFormStatus(schema, c.store.get().values).complete).toBe(true);

    // After uninstall the collector no longer reacts to further loads.
    uninstall();
    await client.getConversation("conv-1");
    expect(c.store.get().values).toEqual({ product: "Widget", quantity: 7 });

    vi.unstubAllGlobals();
    client.destroy();
  });

  it("rejects names that can't form valid function names", () => {
    expect(() =>
      createFormCollector({ name: "bad name!", description: "x", schema })
    ).toThrow();
  });
});

describe("createFormCollector with requiredWhen conditions", () => {
  // owner=2 ("not an owner") makes housing_type required; nb_loans>=1 makes
  // loan_amount required. Neither conditional field is in the static `required`.
  const conditionalSchema: FormCollectorSchema = {
    type: "object",
    properties: {
      owner: { type: "string", enum: ["1", "2"], description: "Owner?" },
      housing_type: {
        type: "string",
        enum: ["1", "2"],
        description: "Housing type",
        requiredWhen: { property: "owner", value: "2" },
      },
      nb_loans: { type: "number", description: "Number of loans" },
      loan_amount: {
        type: "number",
        description: "Total monthly loan repayment",
        requiredWhen: { property: "nb_loans", op: ">=", value: "1" },
      },
    },
    required: ["owner", "nb_loans"],
  };

  const makeConditional = () =>
    createFormCollector({
      name: "credit",
      description: "A credit form.",
      schema: conditionalSchema,
    });

  it("adds a conditional field to missing only once its condition holds", () => {
    // Nothing answered: only the static required fields are missing.
    expect(deriveFormStatus(conditionalSchema, {}).missing).toEqual([
      "owner",
      "nb_loans",
    ]);

    // owner=1 (a match would need "2") → housing_type stays optional.
    expect(
      deriveFormStatus(conditionalSchema, { owner: "1", nb_loans: 0 }).missing
    ).toEqual([]);

    // owner=2 → housing_type becomes required and surfaces as missing.
    expect(
      deriveFormStatus(conditionalSchema, { owner: "2", nb_loans: 0 }).missing
    ).toEqual(["housing_type"]);
  });

  it("evaluates the >= comparison operator numerically", () => {
    expect(
      deriveFormStatus(conditionalSchema, { owner: "1", nb_loans: 0 }).complete
    ).toBe(true);

    const oneLoan = deriveFormStatus(conditionalSchema, {
      owner: "1",
      nb_loans: 1,
    });
    expect(oneLoan.missing).toEqual(["loan_amount"]);
    expect(oneLoan.complete).toBe(false);

    expect(
      deriveFormStatus(conditionalSchema, {
        owner: "1",
        nb_loans: 1,
        loan_amount: 500,
      }).complete
    ).toBe(true);
  });

  it("treats an array value as an 'is one of' membership test", () => {
    const membershipSchema: FormCollectorSchema = {
      type: "object",
      properties: {
        profession: { type: "string", enum: ["1", "12", "13"] },
        contrat_travail: {
          type: "string",
          requiredWhen: { property: "profession", value: ["1", "2", "3"] },
        },
      },
      required: ["profession"],
    };

    // profession=1 is in the list → contrat_travail required.
    expect(deriveFormStatus(membershipSchema, { profession: "1" }).missing).toEqual([
      "contrat_travail",
    ]);
    // profession=12 (retraité) / 13 (sans emploi) are not → stays optional.
    expect(deriveFormStatus(membershipSchema, { profession: "12" }).missing).toEqual(
      []
    );
    expect(deriveFormStatus(membershipSchema, { profession: "13" }).missing).toEqual(
      []
    );
  });

  it("strips requiredWhen from the update tool params and keeps required empty", () => {
    const c = makeConditional();
    const params = c.functions[0].parameters;

    expect(params.required).toEqual([]);
    expect(Object.keys(params.properties)).toEqual([
      "owner",
      "housing_type",
      "nb_loans",
      "loan_amount",
    ]);
    // No SDK-only keys reach the wire shape.
    for (const prop of Object.values(params.properties)) {
      expect(prop).not.toHaveProperty("requiredWhen");
    }
    expect(params.properties.housing_type).toEqual({
      type: "string",
      description: "Housing type",
      enum: ["1", "2"],
    });
  });

  it("blocks submit until a now-relevant conditional field is filled", async () => {
    const handler = vi.fn(async () => ({ ok: true }));
    const c = createFormCollector({
      name: "credit",
      description: "A credit form.",
      schema: conditionalSchema,
      submit: { via: "client", handler },
    });

    // owner=2 turns housing_type required, so submit is blocked on it.
    await c.functions[0].handler({ owner: "2", nb_loans: 0 });
    expect(await c.submit()).toEqual({ ok: false, missing: ["housing_type"] });
    expect(handler).not.toHaveBeenCalled();

    await c.functions[0].handler({ housing_type: "1" });
    expect(await c.submit()).toMatchObject({ ok: true });
    expect(handler).toHaveBeenCalledWith({
      owner: "2",
      nb_loans: 0,
      housing_type: "1",
    });
  });

  it("exposes completeness via getStatus() derived from the schema", () => {
    const c = makeCollector();

    expect(c.getStatus()).toEqual({
      missing: ["product", "quantity"],
      complete: false,
    });

    c.setValues({ product: "Widget", quantity: 3 });
    expect(c.getStatus()).toEqual({ missing: [], complete: true });
  });
});

describe("loadFormCollector", () => {
  const definition = {
    name: "order",
    description: "The order the user wants to place.",
    schema,
    // Mirrors the backend response: the relay destination stays server-side.
    submit: { via: "backend" as const },
  };

  it("builds a collector from the backend definition", async () => {
    const client = { getFormCollector: vi.fn().mockResolvedValue(definition) };

    // autoSubmit: false keeps the manual submit_ flow (it defaults to true).
    const c = await loadFormCollector(client, { name: "order", autoSubmit: false });

    expect(client.getFormCollector).toHaveBeenCalledWith("order");
    expect(c.name).toBe("order");
    expect(c.functions.map((f) => f.name)).toEqual([
      "update_order",
      "submit_order",
    ]);
    expect(c.getStatus()).toEqual({
      missing: ["product", "quantity"],
      complete: false,
    });
  });

  it("lets passed options override the fetched definition", async () => {
    const client = { getFormCollector: vi.fn().mockResolvedValue(definition) };
    const handler = vi.fn(async () => ({ ok: true }));

    const c = await loadFormCollector(client, {
      name: "order",
      submit: { via: "client", handler },
      initialValues: { product: "Widget" },
    });

    expect(c.getValues()).toEqual({ product: "Widget" });
    c.setValues({ quantity: 2 });
    await c.submit();
    expect(handler).toHaveBeenCalledWith({ product: "Widget", quantity: 2 });
  });
});

describe("createFormCollector submit events", () => {
  const completeSchema: FormCollectorSchema = {
    type: "object",
    properties: {
      product: { type: "string" },
      quantity: { type: "number" },
    },
    required: ["product", "quantity"],
  };

  it("emits form:submitted with name, values, and result on success", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const c = createFormCollector({
      name: "order",
      description: "An order.",
      schema: completeSchema,
      submit: { via: "client", handler: async () => ({ id: 42 }) },
    });
    const onSubmitted = vi.fn();
    const onError = vi.fn();
    client.on("form:submitted", onSubmitted);
    client.on("form:error", onError);
    const uninstall = c.install(client);

    // The fill that completes the form auto-submits.
    await c.functions[0].handler({ product: "Widget", quantity: 2 });

    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(onSubmitted).toHaveBeenCalledWith({
      name: "order",
      values: { product: "Widget", quantity: 2 },
      result: { id: 42 },
    });
    expect(onError).not.toHaveBeenCalled();

    uninstall();
    client.destroy();
  });

  it("emits form:error when the submit handler throws", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const c = createFormCollector({
      name: "order",
      description: "An order.",
      schema: completeSchema,
      submit: {
        via: "client",
        handler: async () => {
          throw new Error("boom");
        },
      },
    });
    const onSubmitted = vi.fn();
    const onError = vi.fn();
    client.on("form:submitted", onSubmitted);
    client.on("form:error", onError);
    const uninstall = c.install(client);

    await c.functions[0].handler({ product: "Widget", quantity: 2 });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith({
      name: "order",
      values: { product: "Widget", quantity: 2 },
      error: "boom",
    });
    expect(onSubmitted).not.toHaveBeenCalled();

    uninstall();
    client.destroy();
  });

  it("emits form:error on a non-2xx HTTP submit response", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const c = createFormCollector({
      name: "order",
      description: "An order.",
      schema: completeSchema,
      submit: { via: "client", url: "/api/orders" },
    });
    const onError = vi.fn();
    client.on("form:error", onError);
    const uninstall = c.install(client);

    await c.functions[0].handler({ product: "Widget", quantity: 2 });

    expect(onError).toHaveBeenCalledWith({
      name: "order",
      values: { product: "Widget", quantity: 2 },
      error: "Submit failed: HTTP 500",
    });

    uninstall();
    client.destroy();
    vi.unstubAllGlobals();
  });

  it("fires neither event for an incomplete submit (validation pre-check)", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const c = createFormCollector({
      name: "order",
      description: "An order.",
      schema: completeSchema,
      submit: { via: "client", handler: async () => ({ id: 1 }) },
      autoSubmit: false,
    });
    const onSubmitted = vi.fn();
    const onError = vi.fn();
    client.on("form:submitted", onSubmitted);
    client.on("form:error", onError);
    const uninstall = c.install(client);

    const res = await c.submit();
    expect(res).toEqual({ ok: false, missing: ["product", "quantity"] });
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    uninstall();
    client.destroy();
  });
});

describe("AgoClient.getFormCollector", () => {
  it("fetches the definition and normalizes a null submit to undefined", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        name: "order",
        description: "An order.",
        schema,
        submit: null,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new AgoClient({ baseUrl: "https://example.test" });
    const def = await client.getFormCollector("order");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/api/sdk/v1/forms/order",
      expect.objectContaining({ method: "GET" }),
    );
    expect(def).toEqual({
      name: "order",
      description: "An order.",
      schema,
      submit: undefined,
    });

    vi.unstubAllGlobals();
    client.destroy();
  });
});
