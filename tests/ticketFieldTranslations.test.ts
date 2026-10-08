import { describe, expect, it, vi } from "vitest";
import type { TicketField, TicketForm } from "../src/client/types";
import { ticketFieldText } from "../src/client/ticketFieldTranslations";
import { computeTicketFormErrors, createTicketFormState, createTicketFormView } from "../src/widget/renderTicketForm";
import { DEFAULT_TOOL_CALL_FORM_LABELS as labels } from "../src/widget/toolCallLabels";

const translation = { source: "Topic", default: "Topic", values: { fr: "Sujet", "fr-ca": "Sujet canadien" } };
const field = (id: string, extra: Partial<TicketField> = {}): TicketField => ({
  id, title: "Topic", required: false, hidden: false, position: 0, options: [], alwaysVisible: true,
  translations: { title: translation }, ...extra,
});
const form = (fields: TicketField[]): TicketForm => ({
  id: "form", mode: "form", showSubject: false, showBody: false, showPriority: false, showTypology: false, fields,
});

describe("Ticket field translations", () => {
  it.each([["fr_CA", "Sujet canadien"], ["fr-BE", "Sujet"], ["de", "Topic"], [null, "Topic"]])(
    "resolves exact, parent and default text for %s", (language, expected) => {
      expect(ticketFieldText("Topic", translation, language)).toBe(expected);
    },
  );

  it("matches AGO regional defaults and leaves ambiguous locales at their default", () => {
    const translated = { source: "Topic", default: "Default", values: {
      "en-us": "US", "en-gb": "UK", "pt-br": "BR", "pt-pt": "PT", "es-mx": "MX", "de-de": "DE", "de-at": "AT",
    } };
    expect(["en", "pt", "es", "de"].map(locale => ticketFieldText("Topic", translated, locale)))
      .toEqual(["US", "BR", "MX", "Default"]);
  });

  it("preserves local edits, deliberately empty text and legacy fields", () => {
    expect(ticketFieldText("Custom", translation, "fr")).toBe("Custom");
    expect(ticketFieldText("", translation, "fr")).toBe("");
    expect(ticketFieldText("Original", undefined, "fr")).toBe("Original");
  });

  it("translates validation and recalculates errors after a language change", () => {
    const f = form([field("required", { required: true }), field("regex", { regexpForValidation: "^\\d+$" })]);
    const state = createTicketFormState(undefined, f, "");
    state.customFields.regex = "invalid";
    state.submittedOnce = true;
    const view = createTicketFormView({ state, ticketForm: f, language: "en", configLoading: false,
      labels, requireEmail: false, allowFiles: false, createTicket: vi.fn(), onCreated: vi.fn() });
    view.rebuild({ language: "fr" });
    expect(state.errors).toEqual({ required: "Sujet is required.", regex: "Sujet has an invalid format." });
    expect(computeTicketFormErrors(f, state, labels, false, "de").required).toBe("Topic is required.");
  });

  it("renders translations as text and retains checkbox, files and original submission values", async () => {
    const f = form([
      field("choice", { options: [{ id: "billing", name: "Billing", value: "billing_tag", default: true,
        group: "Support", messageType: "info", translations: {
          name: { source: "Billing", default: "Billing", values: { fr: "Facturation" } },
        } }] }),
      field("check", { type: "checkbox", description: "Help", translations: {
        title: translation, description: { source: "Help", default: "Help", values: { fr: "<img src=x onerror=alert(1)>" } },
      } }),
    ]);
    const state = createTicketFormState(undefined, f, "");
    state.files = [new File(["test"], "note.txt")];
    const createTicket = vi.fn(async () => ({ id: "created" }));
    const view = createTicketFormView({ state, ticketForm: f, language: "en", configLoading: false,
      labels, requireEmail: false, allowFiles: true, createTicket, onCreated: vi.fn() });
    const box = view.el.querySelector<HTMLInputElement>('[type="checkbox"]')!;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    view.rebuild({ language: "fr" });
    expect(view.el.querySelector<HTMLSelectElement>("select")!.value).toBe("billing_tag");
    expect(view.el.querySelector<HTMLSelectElement>("select")!.selectedOptions[0].textContent).toBe("Facturation");
    expect(view.el.querySelector<HTMLInputElement>('[type="checkbox"]')!.checked).toBe(true);
    expect(view.el.querySelector(".ago-ticket-form__description")!.textContent).toContain("<img");
    expect(view.el.querySelector("img")).toBeNull();
    expect(view.el.querySelector('[type="checkbox"]')!.getAttribute("aria-describedby")).toBe("ago-ticket-field-check-description");
    view.el.querySelector<HTMLButtonElement>(".ago-ticket-form__submit")!.click();
    await Promise.resolve();
    expect(createTicket).toHaveBeenCalledWith(expect.objectContaining({
      customFields: [{ id: "choice", value: "billing_tag" }, { id: "check", value: "true" }], files: state.files,
    }));
  });
});
