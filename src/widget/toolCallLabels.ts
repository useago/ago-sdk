/**
 * Every string the ticket form and its surrounding chrome show, with the
 * hosted widget's English defaults, so a non-English site can translate them
 * through `toolCallForm.labels`.
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

export const DEFAULT_TOOL_CALL_FORM_LABELS: ToolCallFormLabels = {
  useFormToCreateTicket: "You can use the following form to create a ticket",
  yourEmail: "Your Email",
  emailPlaceholder: "Enter your email address",
  emailRequired: "Email is required",
  emailInvalid: "Please enter a valid email address",
  subject: "Subject",
  subjectRequired: "Subject is required.",
  typology: "Typology",
  selectTypology: "Select a typology",
  typologyRequired: "Typology is required.",
  question: "Question",
  task: "Task",
  incident: "Incident",
  priority: "Priority",
  selectPriority: "Select a priority",
  priorityRequired: "Priority is required.",
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
  detailedContext: "Detailed context",
  detailedContextRequired: "Detailed context is required.",
  fieldRequired: "{fieldTitle} is required.",
  attachments: "Attachments",
  selectFile: "Select file",
  submit: "Submit",
  loading: "Loading...",
  maxCharacters: "Maximum characters",
  ticketSubmitted: "Your ticket has been successfully submitted.",
  findTicketHere: "You can find it here:",
  noTicketForm: "No ticket form found",
  notAllowed: "You are not allowed to create a ticket.",
  submissionFailed: "Failed to submit ticket",
  submissionFailedDescription:
    "There was an error submitting your ticket. Please try again.",
  fileTooLarge: "File too large",
  permissionDenied: "Permission denied",
  validationFailed: "Validation error",
  pleaseCheckFields: "Please check your form fields and try again.",
  embeddedFormSubmitted: "Your form has been submitted successfully.",
  noEmbedConfigured: "No embed URL or HTML configured for this form.",
  embedSubmitTimeout:
    "The form submission could not be confirmed. Please try again.",
  tryAgain: "Try again",
  contactFormCreated:
    "A new contact form has been created, see below to fill it out.",
  contactFormRejected: "You are not allowed to create a ticket. See below why.",
  genericFormComingSoon: "Generic form rendering (Coming soon)",
  unknownToolCall: "Unknown tool call type: {type}",
  formPending: "Please complete the form above to continue the conversation",
  ticketCreatedBlocked:
    "A ticket has been created for this conversation.\n Please create a new conversation to continue.",
  newConversation: "New conversation",
};
