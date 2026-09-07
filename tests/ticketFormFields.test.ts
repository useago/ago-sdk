import { describe, expect, it } from "vitest";
import type { TicketField, TicketForm } from "../src/client/types";
import { availableOptions, pruneCustomFields, visibleCustomFields } from "../src/widget/ticketFormFields";
import { computeTicketFormErrors, createTicketFormState, createTicketFormView } from "../src/widget/renderTicketForm";
import { DEFAULT_TOOL_CALL_FORM_LABELS as labels } from "../src/widget/toolCallLabels";

function field(id: string, extra: Partial<TicketField> = {}): TicketField {
  return { id, title: id, required: false, hidden: false, position: 0, options: [], ...extra };
}
function form(fields: TicketField[]): TicketForm {
  return { id: "support", mode: "form", showSubject: false, showBody: false, showTypology: false, showPriority: false, fields };
}
const option = (value: string, extra = {}) => ({ id: value, value, default: false, messageType: "info" as const, ...extra });

describe("ticket form questions", () => {
  it("accepts UUID parents, multiple values and the legacy comma-separated format outside Mirakl", () => {
    const f = form([
      field("uuid", { externalId: "category" }),
      field("child", { conditionalFieldId: "uuid", conditionalFieldValue: "app, api" }),
    ]);
    expect(visibleCustomFields(f, { category: "api" }).map(f => f.id)).toEqual(["uuid", "child"]);
    expect(visibleCustomFields(f, { category: "other" }).map(f => f.id)).toEqual(["uuid"]);
    f.fields[1].conditionalFieldValues = ["other"];
    expect(visibleCustomFields(f, { category: "api" }).map(f => f.id)).toEqual(["uuid"]);
    expect(visibleCustomFields(f, { category: "other" }).map(f => f.id)).toEqual(["uuid", "child"]);
  });

  it("skips hidden, inactive and inapplicable predecessors, and respects alwaysVisible", () => {
    const f = form([
      field("hidden", { hidden: true }),
      field("inactive", { active: false }),
      field("parent"),
      field("conditional", { conditionalFieldId: "parent", conditionalFieldValues: ["yes"] }),
      field("next"),
      field("always", { alwaysVisible: true }),
    ]);
    expect(visibleCustomFields(f, { parent: "no" }).map(f => f.id)).toEqual(["parent", "next", "always"]);
  });

  it("clears nested branch values but preserves unconditional hidden defaults", () => {
    const f = form([
      field("parent"),
      field("child", { conditionalFieldId: "parent", conditionalFieldValues: ["yes"] }),
      field("grandchild", { conditionalFieldId: "child", conditionalFieldValues: ["yes"] }),
      field("internal", { hidden: true }),
    ]);
    const values = { parent: "no", child: "yes", grandchild: "stale", internal: "default" };
    expect(visibleCustomFields(f, values).map(f => f.id)).toEqual(["parent"]);
    pruneCustomFields(f, values);
    expect(values).toEqual({ parent: "no", internal: "default" });
  });

  it("handles cycles without exposing their fields or crashing", () => {
    const f = form([
      field("a", { conditionalFieldId: "b", conditionalFieldValues: ["yes"] }),
      field("b", { conditionalFieldId: "a", conditionalFieldValues: ["yes"] }),
    ]);
    const values = { a: "yes", b: "yes" };
    expect(visibleCustomFields(f, values)).toEqual([]);
    pruneCustomFields(f, values);
    expect(values).toEqual({});
  });

  it("filters options and removes an invalid selection plus its descendants", () => {
    const f = form([
      field("region"),
      field("city", { options: [
        option("Paris", { conditionalFieldId: "region", conditionalFieldValues: ["FR", "EU"], position: 2 }),
        option("Berlin", { conditionalFieldId: "region", conditionalFieldValues: ["DE", "EU"], position: 1 }),
      ] }),
      field("address", { conditionalFieldId: "city", conditionalFieldValues: ["Paris"] }),
    ]);
    expect(availableOptions(f, f.fields[1], { region: "EU" }).map(o => o.value)).toEqual(["Berlin", "Paris"]);
    const values = { region: "DE", city: "Paris", address: "stale" };
    pruneCustomFields(f, values);
    expect(values).toEqual({ region: "DE" });
  });

  it("validates all applicable required questions and regex patterns, including unrevealed fields", () => {
    const f = form([
      field("first", { required: true }),
      field("second", { required: true }),
      field("code", { regexpForValidation: "^[0-9]{3}$", alwaysVisible: true }),
      field("conditional", { required: true, conditionalFieldId: "first", conditionalFieldValues: ["yes"] }),
      field("invalidPattern", { regexpForValidation: "[" }),
    ]);
    const state = createTicketFormState(undefined, f, "");
    state.customFields = { code: "abc", invalidPattern: "test" };
    expect(computeTicketFormErrors(f, state, labels, false)).toEqual({
      first: "first is required.", second: "second is required.", code: "code has an invalid format.",
    });
  });

  it("does not validate native or custom priority when excluded by typology", () => {
    const f = { ...form([field("priority", { title: "Priority", required: true })]), showPriority: true, priorityTypologies: ["Incident"] };
    const state = createTicketFormState({ priority: "", typology: "Question" }, f, "");
    expect(computeTicketFormErrors(f, state, labels, false)).toEqual({});
    state.ticket.typology = "Incident";
    expect(Object.keys(computeTicketFormErrors(f, state, labels, false))).toEqual(["priority"]);
  });

  it("renders groups in order and keeps an empty conditional select as a select", () => {
    const f = form([field("region"), field("city", { alwaysVisible: true, options: [
      option("Paris", { group: "France", position: 2, conditionalFieldId: "region", conditionalFieldValues: ["EU"] }),
      option("Lyon", { group: "France", position: 1, conditionalFieldId: "region", conditionalFieldValues: ["EU"] }),
      option("Hidden", { noDisplay: true }),
    ] })]);
    const state = createTicketFormState(undefined, f, "");
    state.customFields.region = "EU";
    const view = createTicketFormView({ state, ticketForm: f, labels, requireEmail: false, allowFiles: false,
      createTicket: async () => ({ id: "ticket" }), onCreated: () => {} });
    expect(view.el.querySelector("optgroup")?.label).toBe("France");
    expect([...view.el.querySelectorAll("optgroup option")].map(o => o.textContent)).toEqual(["Lyon", "Paris"]);
    state.customFields.region = "US";
    view.rebuild();
    const select = view.el.querySelector<HTMLSelectElement>("#ago-ticket-field-city")!;
    expect(select.tagName).toBe("SELECT");
    expect(select.options).toHaveLength(1);
  });
});
