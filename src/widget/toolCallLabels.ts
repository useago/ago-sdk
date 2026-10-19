import en from "../i18n/en";
import { withOverrides } from "../i18n";

/**
 * Client-owned wording for the ticket form and its surrounding chrome.
 * Hosts can customize individual strings through `toolCallForm.labels`.
 */

export interface ToolCallFormLabels {
  useFormToCreateTicket: string;
  yourEmail: string;
  emailPlaceholder: string;
  emailRequired: string;
  emailInvalid: string;
  subject: string;
  subjectRequired: string;
  typology: string;
  selectTypology: string;
  typologyRequired: string;
  question: string;
  task: string;
  incident: string;
  priority: string;
  selectPriority: string;
  priorityRequired: string;
  low: string;
  normal: string;
  high: string;
  urgent: string;
  detailedContext: string;
  detailedContextRequired: string;
  /** `{fieldTitle}` is substituted. */
  fieldRequired: string;
  fieldFormatInvalid: string;
  attachments: string;
  selectFile: string;
  submit: string;
  loading: string;
  maxCharacters: string;
  ticketSubmitted: string;
  findTicketHere: string;
  noTicketForm: string;
  notAllowed: string;
  submissionFailed: string;
  submissionFailedDescription: string;
  fileTooLarge: string;
  fileSize: string;
  removeFile: string;
  permissionDenied: string;
  validationFailed: string;
  pleaseCheckFields: string;
  embeddedFormSubmitted: string;
  noEmbedConfigured: string;
  embedSubmitTimeout: string;
  tryAgain: string;
  contactFormCreated: string;
  contactFormRejected: string;
  genericFormComingSoon: string;
  unknownToolCall: string;
  formPending: string;
  ticketCreatedBlocked: string;
  newConversation: string;
}

export const DEFAULT_TOOL_CALL_FORM_LABELS: ToolCallFormLabels = en.form;

export function mergeToolCallFormLabels(
  localized: Partial<ToolCallFormLabels> | undefined,
  overrides: Partial<ToolCallFormLabels> | undefined,
): ToolCallFormLabels {
  return withOverrides(withOverrides(DEFAULT_TOOL_CALL_FORM_LABELS, localized), overrides);
}

export function formatFormTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/(?<!\{)\{(\w+)\}(?!\})/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match);
}
