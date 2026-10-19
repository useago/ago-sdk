import { expect, it } from "vitest";
import type { TicketForm } from "../src/client/types";
import { createTicketFormState } from "../src/widget/renderTicketForm";

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
