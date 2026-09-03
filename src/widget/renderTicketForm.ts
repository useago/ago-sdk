/**
 * The ticket (contact) form the agent's `ago_ticketing` tool opens inside the
 * conversation, a value-for-value port of the hosted widget's `ContactForm`
 * and its field components.
 *
 * The widget re-renders the thread on every update, so the form cannot keep
 * its state in the DOM: it reads and writes a {@link TicketFormState} owned by
 * the widget and keyed by tool call id, and restyles in place. Field
 * visibility is progressive, like the reference: subject, then typology, then
 * priority, then the custom fields one after another as the previous one is
 * filled, with conditional fields gated on their parent's value.
 */

import type {
  CreateTicketResult,
  TicketField,
  TicketForm,
  ToolCallTicketPrefill,
} from "../client/types";
import { renderMarkdown } from "./renderMarkdown";
import {
  BORDER_COLOR,
  BRAND_TEXT_COLOR,
  css,
  div,
  FONT_VAR,
  PANEL_BACKGROUND,
  TEXT_COLOR,
} from "./styles";
import type { ToolCallFormLabels } from "./toolCallLabels";

/** Submit button: the design-system accent, or `colors.button` when set. */
const SUBMIT_BACKGROUND =
  "var(--ago-send-button-background, var(--ago-accent-color, #003edf))";

const EMAIL_PATTERN =
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}$/;

/** What the form collects; persisted by the widget across re-renders. */
export interface TicketFormState {
  ticket: {
    subject: string;
    typology: string;
    priority: string;
    body: string;
    tag: string;
  };
  /** Keyed by the field's `externalId`, else its `id`. */
  customFields: Record<string, string>;
  files: File[];
  email: string;
  errors: Record<string, string>;
  submittedOnce: boolean;
  loading: boolean;
  /** Last submission failure, shown under the button. */
  submitError: string | null;
  /** Set once the ticket exists; the form then shows the success block. */
  submitted?: { ticketId: string; ticketUrl?: string };
}

/** Key a field's value is stored and submitted under. */
export function fieldKey(field: TicketField): string {
  return field.externalId || field.id;
}

/** The backend's fallback key for a field without an external id. */
function sanitizeTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]/g, "_");
}

function sortedFields(form: TicketForm): TicketField[] {
  return [...form.fields].sort((a, b) => a.position - b.position);
}

/**
 * Build the initial state: the agent's pre-filled ticket, then the options
 * flagged default, then the tagger fields from `tag`, then the AI's custom
 * field values matched by external id, id, or sanitized title.
 */
export function createTicketFormState(
  prefill: ToolCallTicketPrefill | undefined,
  form: TicketForm | null,
  email: string,
): TicketFormState {
  const customFields: Record<string, string> = {};
  if (form) {
    for (const field of form.fields) {
      const def = field.options.find((o) => o.default);
      if (def) customFields[fieldKey(field)] = def.value ?? def.name ?? "";
    }
    if (prefill?.tag) {
      for (const field of form.fields) {
        if (field.type === "tagger") customFields[fieldKey(field)] = prefill.tag;
      }
    }
    if (prefill?.custom_fields) {
      for (const [key, value] of Object.entries(prefill.custom_fields)) {
        const match = form.fields.find(
          (f) =>
            f.externalId === key ||
            f.id === key ||
            (f.title ? sanitizeTitle(f.title) === key : false),
        );
        if (match) customFields[fieldKey(match)] = value;
      }
    }
  }
  return {
    ticket: {
      subject: prefill?.subject ?? "",
      typology: prefill?.typology ?? "Question",
      priority: prefill?.priority ?? "Normal",
      body: prefill?.body ?? "",
      tag: prefill?.tag ?? "",
    },
    customFields,
    files: [],
    email,
    errors: {},
    submittedOnce: false,
    loading: false,
    submitError: null,
  };
}

/** Re-apply the option defaults and prefill once the form config arrives. */
export function hydrateTicketFormState(
  state: TicketFormState,
  prefill: ToolCallTicketPrefill | undefined,
  form: TicketForm,
): void {
  const fresh = createTicketFormState(prefill, form, state.email);
  state.customFields = { ...fresh.customFields, ...state.customFields };
}

function parentOf(form: TicketForm, field: TicketField): TicketField | undefined {
  if (!field.conditionalFieldId) return undefined;
  return form.fields.find(
    (f) => f.externalId === field.conditionalFieldId || f.id === field.conditionalFieldId,
  );
}

/** Whether a conditional field's parent currently holds the required value. */
function conditionMet(
  form: TicketForm,
  field: TicketField,
  values: Record<string, string>,
): boolean {
  if (!field.conditionalFieldId || !field.conditionalFieldValue) return true;
  const parent = parentOf(form, field);
  if (!parent) return true;
  return values[fieldKey(parent)] === field.conditionalFieldValue;
}

/**
 * The custom fields to render right now, in order. Hidden fields are skipped
 * (their values still travel), conditional fields wait for their parent, and
 * the rest reveal one after another as the previous one is filled (a checkbox
 * counts as filled).
 */
export function visibleCustomFields(
  form: TicketForm,
  values: Record<string, string>,
): TicketField[] {
  const fields = sortedFields(form);
  const out: TicketField[] = [];
  fields.forEach((field, idx) => {
    if (field.hidden) return;
    const conditional = !!(field.conditionalFieldId && field.conditionalFieldValue);
    if (conditional) {
      if (conditionMet(form, field, values)) out.push(field);
      return;
    }
    if (idx > 0) {
      const prev = fields[idx - 1];
      const prevFilled = prev.type === "checkbox" || !!values[fieldKey(prev)];
      if (!prevFilled) return;
    }
    out.push(field);
  });
  return out;
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

/** Port of `computeErrorsContactForm` plus the unknown-visitor email check. */
export function computeTicketFormErrors(
  form: TicketForm,
  state: TicketFormState,
  labels: ToolCallFormLabels,
  requireEmail: boolean,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const t = state.ticket;
  if (form.showSubject && !t.subject.trim()) errors.subject = labels.subjectRequired;
  if (form.showTypology && !t.typology.trim()) errors.typology = labels.typologyRequired;
  if (form.showPriority && !t.priority.trim()) errors.priority = labels.priorityRequired;
  if (form.showBody && !t.body.trim()) errors.body = labels.detailedContextRequired;
  for (const field of visibleCustomFields(form, state.customFields)) {
    const value = state.customFields[fieldKey(field)];
    if (field.required && !value?.trim()) {
      errors[fieldKey(field)] = fill(labels.fieldRequired, {
        fieldTitle: field.title ?? "",
      });
    }
  }
  if (requireEmail) {
    if (!state.email.trim()) errors.userEmail = labels.emailRequired;
    else if (!EMAIL_PATTERN.test(state.email)) errors.userEmail = labels.emailInvalid;
  }
  return errors;
}

// ── DOM ─────────────────────────────────────────────────────────────

const INPUT_STYLE: Partial<CSSStyleDeclaration> = {
  border: `1px solid ${BORDER_COLOR}`,
  borderRadius: "4px",
  width: "100%",
  padding: "8px",
  boxSizing: "border-box",
  fontSize: "16px",
  lineHeight: "24px",
  fontFamily: FONT_VAR,
  color: TEXT_COLOR,
  backgroundColor: PANEL_BACKGROUND,
};

function labelEl(text: string, htmlFor: string): HTMLLabelElement {
  const label = document.createElement("label");
  label.htmlFor = htmlFor;
  label.textContent = text;
  css(label, { display: "block", fontWeight: "600" });
  return label;
}

function errorEl(text: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = "ago-ticket-form__error";
  p.textContent = text;
  css(p, { color: "#ef4444", fontSize: "14px", lineHeight: "20px", margin: "0" });
  return p;
}

function fieldGroup(): HTMLDivElement {
  const group = div({ display: "flex", flexDirection: "column", gap: "8px" });
  group.className = "ago-ticket-form__field";
  return group;
}

function applyControlState(
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  hasError: boolean,
  disabled: boolean,
): void {
  css(el, INPUT_STYLE);
  if (hasError) el.style.borderColor = "#ef4444";
  el.disabled = disabled;
  if (disabled) {
    el.style.opacity = "0.5";
    el.style.cursor = "not-allowed";
  }
  el.addEventListener("focus", () => {
    el.style.outline = "2px solid var(--ago-accent-color, #003edf)";
    el.style.outlineOffset = "1px";
  });
  el.addEventListener("blur", () => {
    el.style.outline = "";
    el.style.outlineOffset = "";
  });
}

/** `TicketSuccessMessage`: the green confirmation block. */
export function renderTicketSuccess(opts: {
  text: string;
  ticketUrl?: string;
  urlLabel: string;
}): HTMLElement {
  const box = div({
    padding: "16px",
    borderRadius: "4px",
    backgroundColor: "#dcfce7",
    color: "#166534",
    fontSize: "16px",
    lineHeight: "24px",
  });
  box.className = "ago-ticket-form__success";
  box.setAttribute("role", "status");
  const p = document.createElement("p");
  p.textContent = opts.text;
  css(p, { whiteSpace: "pre-line", margin: "0" });
  box.appendChild(p);
  if (opts.ticketUrl) {
    const line = div({ marginTop: "4px" });
    line.append(document.createTextNode(`${opts.urlLabel} `));
    if (opts.ticketUrl.startsWith("http")) {
      const a = document.createElement("a");
      a.href = opts.ticketUrl;
      a.target = "_blank";
      a.rel = "noreferrer noopener";
      a.textContent = opts.ticketUrl;
      css(a, { fontWeight: "700", textDecoration: "underline", color: "#166534" });
      line.appendChild(a);
    } else {
      const span = document.createElement("span");
      span.textContent = opts.ticketUrl;
      span.style.fontWeight = "700";
      line.appendChild(span);
    }
    box.appendChild(line);
  }
  return box;
}

/** The "not allowed to create a ticket" notice. */
export function renderTicketDenied(markdown: string): HTMLElement {
  const box = div({
    width: "100%",
    padding: "16px",
    backgroundColor: "#fefce8",
    border: "1px solid #fef08a",
    borderRadius: "6px",
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    color: "#854d0e",
    boxSizing: "border-box",
    fontSize: "16px",
    lineHeight: "24px",
  });
  box.className = "ago-ticket-form__denied";
  const icon = document.createElement("span");
  icon.textContent = "i";
  icon.setAttribute("aria-hidden", "true");
  css(icon, {
    flexShrink: "0",
    width: "20px",
    height: "20px",
    marginTop: "2px",
    borderRadius: "50%",
    border: "2px solid #ca8a04",
    color: "#ca8a04",
    fontSize: "13px",
    fontWeight: "700",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: "1",
  });
  const text = div({ minWidth: "0" });
  text.appendChild(renderMarkdown(markdown));
  box.append(icon, text);
  return box;
}

export interface TicketFormViewOptions {
  state: TicketFormState;
  /** Null while the config loads or when the tenant has no ticket form. */
  ticketForm: TicketForm | null;
  configLoading: boolean;
  labels: ToolCallFormLabels;
  /** The tool call's `message`, shown as a blue banner above the form. */
  message?: string;
  /** Show the email field (the SDK has no identity for this visitor). */
  requireEmail: boolean;
  /** Show the attachments block. */
  allowFiles: boolean;
  successMessage?: string;
  successUrlLabel?: string;
  /** Create the ticket; resolves with its id and URL. */
  createTicket: (payload: {
    subject: string;
    typology: string;
    priority: string;
    body: string;
    files: File[];
    customFields: Array<{ id: string; value: string }>;
    email?: string;
    ticketFormId?: string;
  }) => Promise<CreateTicketResult>;
  /** The ticket exists: complete the tool call, update the composer. */
  onCreated: (result: CreateTicketResult, state: TicketFormState) => void;
  onError?: (error: Error) => void;
}

export interface TicketFormView {
  el: HTMLElement;
  /** Re-render from the current state (after the config arrives, for instance). */
  rebuild: (next?: Partial<Pick<TicketFormViewOptions, "ticketForm" | "configLoading">>) => void;
}

export function createTicketFormView(opts: TicketFormViewOptions): TicketFormView {
  const { state, labels } = opts;
  let ticketForm = opts.ticketForm;
  let configLoading = opts.configLoading;

  const root = div({
    position: "relative",
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    paddingBottom: "16px",
    fontSize: "16px",
    lineHeight: "24px",
    color: TEXT_COLOR,
    boxSizing: "border-box",
  });
  root.className = "ago-ticket-form";

  function validate(): boolean {
    if (!ticketForm) return false;
    state.errors = computeTicketFormErrors(ticketForm, state, labels, opts.requireEmail);
    return Object.keys(state.errors).length === 0;
  }

  async function submit(): Promise<void> {
    if (state.loading || !ticketForm) return;
    state.submittedOnce = true;
    state.submitError = null;
    if (!validate()) {
      state.submitError = `${labels.validationFailed}: ${labels.pleaseCheckFields}`;
      render();
      return;
    }
    state.loading = true;
    render();
    try {
      const result = await opts.createTicket({
        subject: state.ticket.subject,
        typology: state.ticket.typology || "Question",
        priority: state.ticket.priority || "Normal",
        body: state.ticket.body,
        files: state.files,
        customFields: Object.entries(state.customFields).map(([id, value]) => ({
          id,
          value,
        })),
        email: opts.requireEmail ? state.email : undefined,
        ticketFormId: ticketForm.id,
      });
      state.loading = false;
      state.submitted = { ticketId: result.id, ticketUrl: result.url };
      render();
      opts.onCreated(result, state);
    } catch (error) {
      state.loading = false;
      const err = error instanceof Error ? error : new Error(String(error));
      const status = (err as { status?: number }).status;
      let text = labels.submissionFailed;
      let description = labels.submissionFailedDescription;
      if (status === 413) text = labels.fileTooLarge;
      else if (status === 403) text = labels.permissionDenied;
      else if (status === 422) {
        text = labels.validationFailed;
        description = err.message || labels.pleaseCheckFields;
      } else if (err.message) description = err.message;
      state.submitError = `${text}: ${description}`;
      render();
      opts.onError?.(err);
    }
  }

  function setCustomField(field: TicketField, value: string): void {
    const key = fieldKey(field);
    state.customFields[key] = value;
    if (field.required) {
      if (value.trim()) delete state.errors[key];
      else if (state.submittedOnce) {
        state.errors[key] = fill(labels.fieldRequired, { fieldTitle: field.title ?? "" });
      }
    }
    // Progressive reveal: the next field may now be due.
    render();
  }

  function onTicketInput(): void {
    if (state.submittedOnce) validate();
  }

  function buildCustomField(field: TicketField): HTMLElement {
    const key = fieldKey(field);
    const id = `ago-ticket-field-${key}`;
    const value = state.customFields[key] ?? "";
    const disabled = state.loading;
    const error = state.errors[key];
    if (field.type === "checkbox") {
      const row = div({ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" });
      row.className = "ago-ticket-form__field";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.id = id;
      box.checked = value === "true";
      box.disabled = disabled;
      css(box, { width: "16px", height: "16px", margin: "0" });
      box.addEventListener("change", () => setCustomField(field, box.checked ? "true" : "false"));
      const label = document.createElement("label");
      label.htmlFor = id;
      label.textContent = field.title ?? "";
      label.style.fontWeight = "600";
      row.append(box, label);
      if (error) row.appendChild(errorEl(error));
      return row;
    }
    const group = fieldGroup();
    group.appendChild(labelEl(field.title ?? "", id));
    const options = field.options;
    if (options.length > 0) {
      const select = document.createElement("select");
      select.id = id;
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "----";
      select.appendChild(empty);
      for (const option of options) {
        const el = document.createElement("option");
        el.value = option.value ?? option.name ?? "";
        el.textContent = option.name ?? option.value ?? "";
        select.appendChild(el);
      }
      select.value = value;
      applyControlState(select, !!error, disabled);
      select.addEventListener("change", () => setCustomField(field, select.value));
      group.appendChild(select);
      const picked = options.find((o) => (o.value ?? o.name) === value);
      if (error) group.appendChild(errorEl(error));
      if (picked?.message) {
        const palette = {
          info: { bg: "#eff6ff", border: "#bfdbfe", text: "#1e3a8a" },
          warning: { bg: "#fffbeb", border: "#fcd34d", text: "#78350f" },
          danger: { bg: "#fef2f2", border: "#fca5a5", text: "#7f1d1d" },
        }[picked.messageType ?? "info"];
        const note = document.createElement("p");
        note.className = "ago-ticket-form__option-message";
        note.textContent = picked.message;
        css(note, {
          fontSize: "14px",
          lineHeight: "20px",
          border: `1px solid ${palette.border}`,
          backgroundColor: palette.bg,
          color: palette.text,
          borderRadius: "4px",
          padding: "8px",
          whiteSpace: "pre-line",
          margin: "0",
        });
        group.appendChild(note);
      }
      return group;
    }
    const input = document.createElement("input");
    input.type = "text";
    input.id = id;
    input.value = value;
    applyControlState(input, !!error, disabled);
    input.addEventListener("input", () => {
      state.customFields[key] = input.value;
      if (field.required && state.submittedOnce) {
        if (input.value.trim()) delete state.errors[key];
        else state.errors[key] = fill(labels.fieldRequired, { fieldTitle: field.title ?? "" });
        paintErrors();
      }
    });
    // Reveal the next field once the user leaves a filled text field.
    input.addEventListener("change", () => render());
    group.appendChild(input);
    if (error) group.appendChild(errorEl(error));
    return group;
  }

  /** Update error lines without rebuilding (keeps focus in the field). */
  function paintErrors(): void {
    for (const group of root.querySelectorAll<HTMLElement>("[data-ago-error-for]")) {
      const key = group.dataset.agoErrorFor!;
      const existing = group.querySelector(".ago-ticket-form__error");
      const message = state.errors[key];
      const control = group.querySelector<HTMLElement>("input, select, textarea");
      if (control) control.style.borderColor = message ? "#ef4444" : "";
      if (control && !message) control.style.border = `1px solid ${BORDER_COLOR}`;
      if (message && !existing) group.appendChild(errorEl(message));
      else if (message && existing) existing.textContent = message;
      else if (!message && existing) existing.remove();
    }
  }

  function render(): void {
    root.replaceChildren();
    if (opts.message) {
      const banner = div({
        fontWeight: "500",
        color: "#1e40af",
        backgroundColor: "#eff6ff",
        padding: "12px",
        borderRadius: "4px",
      });
      banner.className = "ago-ticket-form__message";
      banner.textContent = opts.message;
      root.appendChild(banner);
    }

    if (state.submitted) {
      root.appendChild(
        renderTicketSuccess({
          text: opts.successMessage || labels.ticketSubmitted,
          ticketUrl: state.submitted.ticketUrl,
          urlLabel: opts.successUrlLabel || labels.findTicketHere,
        }),
      );
      return;
    }

    if (configLoading) {
      const box = div({ padding: "16px", textAlign: "center", fontWeight: "700", fontSize: "20px" });
      box.className = "ago-ticket-form__config-loading";
      box.setAttribute("role", "status");
      box.textContent = labels.loading;
      root.appendChild(box);
      return;
    }

    if (!ticketForm) {
      const box = div({
        backgroundColor: "#fee2e2",
        color: "#991b1b",
        padding: "16px",
        borderRadius: "4px",
      });
      box.className = "ago-ticket-form__missing";
      box.textContent = labels.noTicketForm;
      root.appendChild(box);
      return;
    }

    const form = ticketForm;
    const disabled = state.loading;

    if (state.loading) {
      const overlay = div({
        position: "absolute",
        inset: "0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255, 255, 255, 0.7)",
        zIndex: "5",
        borderRadius: "16px",
        fontSize: "20px",
        fontWeight: "700",
      });
      overlay.className = "ago-ticket-form__loading";
      overlay.setAttribute("role", "status");
      overlay.textContent = labels.loading;
      root.appendChild(overlay);
    }

    const intro = div({
      fontWeight: "600",
      backgroundColor: "#bfdbfe",
      padding: "16px",
      borderRadius: "4px",
    });
    intro.className = "ago-ticket-form__intro";
    intro.textContent = labels.useFormToCreateTicket;
    root.appendChild(intro);

    if (opts.requireEmail) {
      const group = fieldGroup();
      group.dataset.agoErrorFor = "userEmail";
      group.appendChild(labelEl(`${labels.yourEmail} *`, "ago-ticket-email"));
      const input = document.createElement("input");
      input.type = "email";
      input.id = "ago-ticket-email";
      input.placeholder = labels.emailPlaceholder;
      input.value = state.email;
      applyControlState(input, !!state.errors.userEmail, disabled);
      input.addEventListener("input", () => {
        state.email = input.value;
        if (state.submittedOnce) {
          validate();
          paintErrors();
        }
      });
      group.appendChild(input);
      if (state.errors.userEmail) group.appendChild(errorEl(state.errors.userEmail));
      root.appendChild(group);
    }

    const showTypology = (form.showSubject && !!state.ticket.subject) || !form.showSubject;
    const showPriority = showTypology && (!!state.ticket.typology || !form.showTypology);
    const showFields = showPriority && (!!state.ticket.priority || !form.showPriority);

    if (form.showSubject) {
      const group = fieldGroup();
      group.dataset.agoErrorFor = "subject";
      group.appendChild(labelEl(labels.subject, "ago-ticket-subject"));
      const input = document.createElement("input");
      input.type = "text";
      input.id = "ago-ticket-subject";
      input.value = state.ticket.subject;
      applyControlState(input, !!state.errors.subject, disabled);
      input.addEventListener("input", () => {
        state.ticket.subject = input.value;
        onTicketInput();
        paintErrors();
      });
      // The typology select appears once a subject exists.
      input.addEventListener("change", () => render());
      group.appendChild(input);
      if (state.errors.subject) group.appendChild(errorEl(state.errors.subject));
      root.appendChild(group);
    }

    if (showTypology && form.showTypology) {
      const group = fieldGroup();
      group.dataset.agoErrorFor = "typology";
      group.appendChild(labelEl(labels.typology, "ago-ticket-typology"));
      const select = document.createElement("select");
      select.id = "ago-ticket-typology";
      for (const [value, text] of [
        ["", labels.selectTypology],
        ["Question", labels.question],
        ["Task", labels.task],
        ["Incident", labels.incident],
      ]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        select.appendChild(option);
      }
      select.value = state.ticket.typology;
      applyControlState(select, !!state.errors.typology, disabled);
      select.addEventListener("change", () => {
        state.ticket.typology = select.value;
        onTicketInput();
        render();
      });
      group.appendChild(select);
      if (state.errors.typology) group.appendChild(errorEl(state.errors.typology));
      root.appendChild(group);
    }

    if (showPriority && form.showPriority) {
      const group = fieldGroup();
      group.dataset.agoErrorFor = "priority";
      group.appendChild(labelEl(labels.priority, "ago-ticket-priority"));
      const select = document.createElement("select");
      select.id = "ago-ticket-priority";
      for (const [value, text] of [
        ["", labels.selectPriority],
        ["Low", labels.low],
        ["Normal", labels.normal],
        ["High", labels.high],
        ["Urgent", labels.urgent],
      ]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        select.appendChild(option);
      }
      select.value = state.ticket.priority;
      applyControlState(select, !!state.errors.priority, disabled);
      select.addEventListener("change", () => {
        state.ticket.priority = select.value;
        onTicketInput();
        render();
      });
      group.appendChild(select);
      if (state.errors.priority) group.appendChild(errorEl(state.errors.priority));
      root.appendChild(group);
    }

    if (showFields) {
      for (const field of visibleCustomFields(form, state.customFields)) {
        const el = buildCustomField(field);
        el.dataset.agoErrorFor = fieldKey(field);
        root.appendChild(el);
      }
    }

    // Detailed context, attachments, submit.
    const bodyGroup = fieldGroup();
    bodyGroup.dataset.agoErrorFor = "body";
    bodyGroup.appendChild(labelEl(labels.detailedContext, "ago-ticket-body"));
    const textarea = document.createElement("textarea");
    textarea.id = "ago-ticket-body";
    textarea.rows = 4;
    textarea.value = state.ticket.body;
    applyControlState(textarea, !!state.errors.body, disabled);
    css(textarea, { resize: "vertical", maxHeight: "240px", overflowY: "auto" });
    const counter = div({
      fontSize: "14px",
      lineHeight: "20px",
      marginTop: "4px",
      textAlign: "right",
      display: "none",
    });
    counter.className = "ago-ticket-form__counter";
    const paintCounter = (): void => {
      const n = state.ticket.body.length;
      counter.style.display = n > 60000 ? "block" : "none";
      counter.style.color = n > 65535 ? "#dc2626" : "#d97706";
      counter.textContent = `${n} / 65,535 · ${labels.maxCharacters}`;
    };
    const autosize = (): void => {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    textarea.addEventListener("input", () => {
      state.ticket.body = textarea.value;
      onTicketInput();
      paintErrors();
      paintCounter();
      autosize();
    });
    bodyGroup.append(textarea, counter);
    paintCounter();
    if (state.errors.body) bodyGroup.appendChild(errorEl(state.errors.body));
    root.appendChild(bodyGroup);

    if (opts.allowFiles) {
      const group = fieldGroup();
      group.className = "ago-ticket-form__field ago-ticket-form__attachments";
      group.appendChild(labelEl(labels.attachments, "ago-ticket-files"));
      const pick = document.createElement("label");
      pick.htmlFor = "ago-ticket-files";
      pick.textContent = labels.selectFile;
      css(pick, {
        display: "inline-block",
        alignSelf: "flex-start",
        backgroundColor: "#e5e7eb",
        padding: "8px 16px",
        borderRadius: "4px",
        cursor: "pointer",
        border: "1px solid #d1d5db",
        minHeight: "24px",
      });
      const input = document.createElement("input");
      input.type = "file";
      input.id = "ago-ticket-files";
      input.multiple = true;
      input.disabled = disabled;
      css(input, { display: "none" });
      input.addEventListener("change", () => {
        state.files = [...state.files, ...Array.from(input.files ?? [])];
        input.value = "";
        render();
      });
      group.append(pick, input);
      const list = div({ display: "flex", flexDirection: "column", gap: "4px" });
      state.files.forEach((file, i) => {
        const row = div({
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: "#f3f4f6",
          padding: "4px 8px",
          borderRadius: "4px",
        });
        const name = document.createElement("span");
        name.textContent = `${file.name} - ${(file.size / 1024).toFixed(1)} KB`;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "×";
        remove.setAttribute("aria-label", `Remove ${file.name}`);
        remove.disabled = disabled;
        css(remove, {
          color: "#dc2626",
          fontWeight: "700",
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: "18px",
          lineHeight: "1",
          width: "44px",
          height: "44px",
          margin: "-10px -12px -10px 0",
        });
        remove.addEventListener("click", () => {
          state.files = state.files.filter((_, idx) => idx !== i);
          render();
        });
        row.append(name, remove);
        list.appendChild(row);
      });
      group.appendChild(list);
      root.appendChild(group);
    }

    if (state.submitError) {
      const alert = errorEl(state.submitError);
      alert.setAttribute("role", "alert");
      alert.className = "ago-ticket-form__error ago-ticket-form__submit-error";
      root.appendChild(alert);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "ago-ticket-form__submit";
    button.disabled = disabled;
    css(button, {
      width: "100%",
      backgroundColor: SUBMIT_BACKGROUND,
      color: BRAND_TEXT_COLOR,
      padding: "8px 16px",
      borderRadius: "4px",
      border: "none",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "8px",
      cursor: disabled ? "default" : "pointer",
      fontSize: "16px",
      lineHeight: "24px",
      minHeight: "44px",
      font: "inherit",
      transition: "filter 0.15s",
    });
    const text = document.createElement("span");
    text.textContent = labels.submit;
    const arrow = document.createElement("span");
    arrow.textContent = "→";
    arrow.setAttribute("aria-hidden", "true");
    css(arrow, { fontSize: "20px", lineHeight: "1", transition: "transform 0.15s" });
    button.append(text, arrow);
    button.addEventListener("mouseenter", () => {
      button.style.filter = "brightness(0.9)";
      arrow.style.transform = "translateX(4px)";
    });
    button.addEventListener("mouseleave", () => {
      button.style.filter = "";
      arrow.style.transform = "";
    });
    button.addEventListener("click", () => void submit());
    root.appendChild(button);
  }

  render();

  return {
    el: root,
    rebuild: (next) => {
      if (next && "ticketForm" in next) ticketForm = next.ticketForm ?? null;
      if (next && "configLoading" in next) configLoading = !!next.configLoading;
      render();
    },
  };
}
