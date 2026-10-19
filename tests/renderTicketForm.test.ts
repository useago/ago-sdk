import { expect, it, vi } from "vitest";
import { uiCatalog } from "../src/i18n";
import type { TicketForm } from "../src/client/types";
import { createTicketFormState, createTicketFormView } from "../src/widget/renderTicketForm";
import { DEFAULT_TOOL_CALL_FORM_LABELS as labels } from "../src/widget/toolCallLabels";

it.each(["Order number is invalid", ""])("preserves submission details or localizes the fallback (%j)", async (detail) => {
  const ticketForm: TicketForm = {
    id: "support", mode: "form", showSubject: false, showBody: false,
    showTypology: false, showPriority: false, fields: [],
  };
  const state = createTicketFormState(undefined, ticketForm, "");
  const currentLabels = { ...labels };
  const view = createTicketFormView({
    state, ticketForm, labels: currentLabels, requireEmail: false, allowFiles: false,
    createTicket: async () => { throw new Error(detail); }, onCreated: () => {},
  });
  view.el.querySelector<HTMLButtonElement>(".ago-ticket-form__submit")!.click();
  await vi.waitFor(() => expect(view.el.querySelector('[role="alert"]')?.textContent)
    .toBe(`Failed to submit ticket: ${detail || labels.submissionFailedDescription}`));
  Object.assign(currentLabels, uiCatalog("fr").form);
  view.rebuild();
  expect(view.el.querySelector('[role="alert"]')?.textContent)
    .toBe(`Échec de l'envoi du ticket: ${detail || currentLabels.submissionFailedDescription}`);
});

it.each([undefined, "ticket_field_123"])("prefills a translated field using its source-title alias (external ID: %s)", (externalId) => {
  const ticketForm: TicketForm = {
    id: "support", mode: "form", showSubject: false, showBody: false,
    showTypology: false, showPriority: false,
    fields: [{
      id: "field-uuid", externalId, title: "Numéro de commande", prefillAliases: ["order_number"],
      required: false, hidden: false, position: 0, options: [],
    }],
  };
  const state = createTicketFormState({ custom_fields: { order_number: "A-123" } }, ticketForm, "");
  expect(state.customFields).toEqual({ [externalId ?? "field-uuid"]: "A-123" });
});
