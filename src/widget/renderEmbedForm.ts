/**
 * The embedded (HubSpot) variant of the ticket form, a port of the hosted
 * widget's `TicketEmbedForm`: the tenant's HTML is injected into a bordered
 * frame, its scripts executed, the form pre-filled from the agent's ticket
 * data, and a submission detected through DOM events and HubSpot callbacks.
 *
 * States: loading (spinner over the frame), ready, submitted (green success
 * block), timeout (HubSpot never confirmed within 30s, with a retry link).
 */

import type { ToolCallTicketPrefill } from "../client/types";
import {
  prepareAutoFillHtml,
  setupAutoFillCallbacks,
  setupV2FormPreFill,
  tryFillForm,
  tryFillV2Forms,
  type PrefillData,
} from "./embed/autoFill";
import {
  filterFormData,
  prepareSubmitDetectorHtml,
  setupSubmitDetectorCallbacks,
  type CapturedFormData,
} from "./embed/submitDetector";
import { renderTicketSuccess } from "./renderTicketForm";
import { BORDER_COLOR, css, div, EMBED_MUTED_TEXT } from "./styles";
import type { ToolCallFormLabels } from "./toolCallLabels";

export type EmbedFormStatus = "loading" | "ready" | "submitted" | "timeout";

/** Per-tool-call state, owned by the widget so it survives re-renders. */
export interface EmbedFormState {
  status: EmbedFormStatus;
  captured?: CapturedFormData | null;
}

export interface EmbedFormViewOptions {
  state: EmbedFormState;
  embedHtml?: string;
  description?: string;
  ticket?: ToolCallTicketPrefill;
  /** Visitor email known to the SDK, used to pre-fill the form. */
  email?: string;
  labels: ToolCallFormLabels;
  /** The tool call's `message`, shown as a blue banner above. */
  message?: string;
  successMessage?: string;
  onSubmitted: (captured: CapturedFormData | null) => void;
}

export interface EmbedFormView {
  el: HTMLElement;
  /** Detach listeners and observers; the node itself stays. */
  destroy: () => void;
}

let embedSeq = 0;

/** Run the `<script>` tags in `container` (innerHTML does not), in order. */
async function executeScripts(container: HTMLElement): Promise<void> {
  const scripts = Array.from(container.querySelectorAll("script"));
  for (const oldScript of scripts) {
    const newScript = document.createElement("script");
    for (const attr of Array.from(oldScript.attributes)) {
      newScript.setAttribute(attr.name, attr.value);
    }
    if (oldScript.src) {
      await new Promise<void>((resolve, reject) => {
        newScript.onload = () => resolve();
        newScript.onerror = () =>
          reject(new Error(`Failed to load script: ${oldScript.src}`));
        oldScript.parentNode?.replaceChild(newScript, oldScript);
      });
    } else {
      newScript.textContent = oldScript.textContent;
      oldScript.parentNode?.replaceChild(newScript, oldScript);
    }
  }
}

function buildPrefill(
  ticket: ToolCallTicketPrefill | undefined,
  email: string | undefined,
): PrefillData | null {
  const data: PrefillData = {};
  if (ticket) {
    for (const [key, value] of Object.entries(ticket)) {
      if (key === "custom_fields" && value && typeof value === "object") {
        for (const [cfKey, cfValue] of Object.entries(
          value as Record<string, string>,
        )) {
          if (cfValue) data[cfKey] = cfValue;
        }
      } else if (typeof value === "string" && value) {
        data[key] = value;
      }
    }
  }
  if (email) data.email = email;
  return Object.keys(data).length > 0 ? data : null;
}

/** `TicketingDynamicForm`'s blue message banner. */
export function renderMessageBanner(message: string): HTMLElement {
  const banner = div({
    fontWeight: "500",
    color: "#1e40af",
    backgroundColor: "#eff6ff",
    padding: "12px",
    borderRadius: "4px",
    fontSize: "16px",
    lineHeight: "24px",
  });
  banner.className = "ago-ticket-form__message";
  banner.textContent = message;
  return banner;
}

export function createEmbedFormView(opts: EmbedFormViewOptions): EmbedFormView {
  const { state, labels } = opts;
  const token = `ago-embed-${Date.now().toString(36)}-${++embedSeq}`;
  const root = div({ display: "flex", flexDirection: "column", gap: "16px" });
  root.className = "ago-embed-form";
  if (opts.message) root.appendChild(renderMessageBanner(opts.message));
  const body = div({ display: "flex", flexDirection: "column", gap: "12px" });
  body.className = "ago-embed-form__body";
  root.appendChild(body);

  const cleanups: Array<() => void> = [];
  let submitTimer: ReturnType<typeof setTimeout> | undefined;
  let callbacksStale = false;
  let submitted = state.status === "submitted";
  let hubspotData: CapturedFormData | null = null;
  const prefill = buildPrefill(opts.ticket, opts.email);

  const handleSubmitted = (captured?: CapturedFormData | null): void => {
    if (submitted || callbacksStale) return;
    submitted = true;
    if (submitTimer) {
      clearTimeout(submitTimer);
      submitTimer = undefined;
    }
    state.status = "submitted";
    state.captured = captured ?? null;
    render();
    opts.onSubmitted(captured ?? null);
  };

  const handleSubmitAttempt = (): void => {
    if (submitted || submitTimer) return;
    callbacksStale = false;
    submitTimer = setTimeout(() => {
      if (!submitted) {
        submitTimer = undefined;
        state.status = "timeout";
        render();
      }
    }, 30_000);
  };

  // HubSpot v2 global submission event, and the v1/v2 postMessage callbacks.
  const onV2Submission = (): void => {
    try {
      const api = (globalThis as {
        HubSpotFormsV4?: {
          getForms?: () => Array<{
            getFormFieldValues?: () => Promise<Record<string, unknown>>;
          }>;
        };
      }).HubSpotFormsV4;
      const forms = api?.getForms?.();
      const first = forms?.[0];
      if (first?.getFormFieldValues) {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 3000),
        );
        Promise.race([first.getFormFieldValues(), timeout])
          .then((values) => handleSubmitted(filterFormData(values)))
          .catch(() => handleSubmitted(hubspotData));
        return;
      }
    } catch {
      /* ignore */
    }
    handleSubmitted(hubspotData);
  };
  window.addEventListener("hs-form-event:on-submission:success", onV2Submission);
  cleanups.push(() =>
    window.removeEventListener(
      "hs-form-event:on-submission:success",
      onV2Submission,
    ),
  );

  const portCleanups: Array<() => void> = [];
  const onMessage = (event: MessageEvent): void => {
    const data = event.data as
      | { type?: string; eventName?: string; data?: unknown; payload?: unknown }
      | undefined;
    if (data?.type === "hsFormCallback" && data.eventName === "onFormSubmit") {
      try {
        const fields = data.data;
        if (Array.isArray(fields)) {
          const collected: CapturedFormData = {};
          for (const field of fields) {
            if (field?.name && field.value !== undefined) {
              collected[field.name] = field.value;
            }
          }
          const filtered = filterFormData(collected);
          if (filtered) hubspotData = filtered;
        }
      } catch {
        /* ignore */
      }
      return;
    }
    if (data?.type === "hsFormCallback" && data.eventName === "onFormSubmitted") {
      handleSubmitted(hubspotData);
      return;
    }
    if (data?.type === "HS_CTA_PARENT_INIT" && event.ports?.[0]) {
      const port = event.ports[0];
      const onPort = (e: MessageEvent): void => {
        const pd = e.data as { type?: string; payload?: { formFieldValues?: unknown } };
        if (pd?.type === "HS_SEND_FORM_FIELD_VALUES") {
          const values = pd.payload?.formFieldValues;
          if (values && typeof values === "object") {
            const filtered = filterFormData(values as CapturedFormData);
            if (filtered) hubspotData = filtered;
          }
        }
        if (pd?.type === "HS_SEND_FORM_SUBMISSION_SUCCESS") {
          handleSubmitted(hubspotData);
        }
      };
      port.addEventListener("message", onPort);
      port.start();
      portCleanups.push(() => port.removeEventListener("message", onPort));
    }
  };
  window.addEventListener("message", onMessage);
  cleanups.push(() => {
    window.removeEventListener("message", onMessage);
    portCleanups.forEach((fn) => fn());
  });

  let frameCleanup: (() => void) | undefined;

  function mountFrame(host: HTMLElement): void {
    if (!opts.embedHtml) return;
    let html = prepareAutoFillHtml(opts.embedHtml, prefill, token);
    html = prepareSubmitDetectorHtml(html, token);
    const cleanupAutoFill = setupAutoFillCallbacks(prefill, token);
    const cleanupV2 = setupV2FormPreFill(prefill);
    host.innerHTML = html;
    const cleanupDetector = setupSubmitDetectorCallbacks(
      host,
      handleSubmitted,
      handleSubmitAttempt,
      token,
    );
    let lateObserver: MutationObserver | undefined;
    let lateTimer: ReturnType<typeof setTimeout> | undefined;
    let lateV2: (() => void) | undefined;
    executeScripts(host)
      .catch(() => {})
      .then(() => {
        if (state.status !== "loading") return;
        state.status = "ready";
        overlay.style.display = "none";
        // Late auto-fill: inputs HubSpot renders after the scripts ran.
        if (prefill) {
          tryFillForm(host, prefill);
          tryFillV2Forms(prefill);
          lateV2 = setupV2FormPreFill(prefill);
          lateObserver = new MutationObserver(() => tryFillForm(host, prefill));
          lateObserver.observe(host, { childList: true, subtree: true });
          lateTimer = setTimeout(() => lateObserver?.disconnect(), 10_000);
        }
      });
    frameCleanup = () => {
      cleanupAutoFill();
      cleanupV2();
      cleanupDetector();
      lateObserver?.disconnect();
      if (lateTimer) clearTimeout(lateTimer);
      lateV2?.();
      host.innerHTML = "";
    };
  }

  const overlay = div({
    position: "absolute",
    inset: "0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.8)",
    zIndex: "10",
  });
  overlay.className = "ago-embed-form__loading";
  const spinner = div({
    width: "24px",
    height: "24px",
    borderRadius: "50%",
    border: `2px solid ${EMBED_MUTED_TEXT}`,
    borderTopColor: "transparent",
    animation: "ago-spin 1s linear infinite",
  });
  spinner.setAttribute("role", "status");
  overlay.appendChild(spinner);

  function render(): void {
    body.replaceChildren();
    if (state.status === "timeout") {
      const box = div({
        borderRadius: "8px",
        border: "1px solid #fef08a",
        backgroundColor: "#fefce8",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      });
      box.className = "ago-embed-form__timeout";
      const p = document.createElement("p");
      p.textContent = labels.embedSubmitTimeout;
      css(p, { fontSize: "14px", lineHeight: "20px", color: "#854d0e", margin: "0" });
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = labels.tryAgain;
      css(retry, {
        alignSelf: "flex-start",
        fontSize: "14px",
        fontWeight: "500",
        color: "#854d0e",
        textDecoration: "underline",
        background: "none",
        border: "none",
        padding: "0",
        cursor: "pointer",
        minHeight: "44px",
        font: "inherit",
      });
      retry.addEventListener("click", () => {
        callbacksStale = true;
        submitted = false;
        submitTimer = undefined;
        state.status = "ready";
        render();
      });
      box.append(p, retry);
      body.appendChild(box);
      return;
    }
    if (state.status === "submitted") {
      body.appendChild(
        renderTicketSuccess({
          text: opts.successMessage || labels.embeddedFormSubmitted,
          urlLabel: labels.findTicketHere,
        }),
      );
      return;
    }
    if (opts.description) {
      const p = document.createElement("p");
      p.textContent = opts.description;
      css(p, { fontSize: "14px", lineHeight: "20px", margin: "0" });
      body.appendChild(p);
    }
    const frame = div({
      position: "relative",
      borderRadius: "8px",
      border: `1px solid ${BORDER_COLOR}`,
      overflow: "hidden",
    });
    frame.className = "ago-embed-form__frame";
    if (opts.embedHtml) {
      overlay.style.display = state.status === "loading" ? "flex" : "none";
      frame.appendChild(overlay);
      const host = div({ width: "100%", minHeight: "200px" });
      host.className = "ago-embed-form__host";
      frame.appendChild(host);
      frameCleanup?.();
      mountFrame(host);
    } else {
      const empty = div({
        padding: "24px",
        textAlign: "center",
        color: EMBED_MUTED_TEXT,
        fontSize: "14px",
      });
      empty.textContent = labels.noEmbedConfigured;
      frame.appendChild(empty);
    }
    body.appendChild(frame);
  }

  render();

  return {
    el: root,
    destroy: () => {
      if (submitTimer) clearTimeout(submitTimer);
      frameCleanup?.();
      cleanups.forEach((fn) => fn());
    },
  };
}
