/**
 * Auto-fill for HubSpot embed forms (v1 and v2), ported from the hosted widget.
 *
 * v1 (`hbspt.forms.create`): fills DOM inputs directly via {@link tryFillForm}.
 * v2 (`hs-form-frame` / `HubSpotFormsV4`): fills through the `setFieldValue`
 * API after discovering the real field names with `getFormFieldValues()`.
 *
 * Convention-based: form fields are matched by suffix against standardized
 * names (email, firstname, lastname, phone, subject, body). The admin makes
 * sure their HubSpot form properties use those internal names.
 *
 * The SDK never writes to `window`: the callbacks the hosted widget injected
 * as `window.__agoFillHS` become a `CustomEvent` dispatched on `document`,
 * carrying a per-instance token so two forms on one page never cross.
 */

export type PrefillData = Record<string, string>;

/** Event the injected `onFormReady` callback dispatches on `document`. */
export const HS_FORM_READY_EVENT = "ago-hs-form-ready";

/**
 * Set a value through the native property descriptor to bypass framework
 * wrappers, and reset React's value tracker so React notices the change.
 */
function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const proto =
    el.tagName === "TEXTAREA"
      ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")
      : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const tracker = (el as unknown as { _valueTracker?: { setValue: (v: string) => void } })
    ._valueTracker;
  if (tracker) tracker.setValue("");
  el.focus();
  el.dispatchEvent(new Event("focus", { bubbles: true }));
  if (proto?.set) proto.set.call(el, value);
  else el.value = value;
  el.setAttribute("value", value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: true }));
}

/**
 * Fill form fields by name against `prefillData`: exact name first, then the
 * suffix after "/" (HubSpot v2 names like `0-1/email`). Only empty fields are
 * filled, never user input. Returns true if at least one field was filled.
 */
export function tryFillForm(
  container: HTMLElement,
  prefillData: PrefillData,
): boolean {
  const inputs = container.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >("input, textarea, select");
  let didFill = false;
  for (const el of inputs) {
    if (el.type === "hidden" || el.type === "submit" || el.type === "button") {
      continue;
    }
    const value =
      prefillData[el.name] ??
      (el.name.includes("/")
        ? prefillData[el.name.split("/").pop()!]
        : undefined);
    if (value && !el.value) {
      setNativeValue(el, value);
      didFill = true;
    }
  }
  return didFill;
}

/** The injected callback body: dispatch the ready event with the jQuery/DOM form. */
function readyCallback(token: string): string {
  return (
    `function($f){document.dispatchEvent(new CustomEvent(${JSON.stringify(
      HS_FORM_READY_EVENT,
    )},{detail:{token:${JSON.stringify(token)},form:$f}}))}`
  );
}

/**
 * Inject an `onFormReady` callback into `hbspt.forms.create()` calls so the
 * v1 form is filled as soon as it renders. Returns the modified HTML.
 */
export function prepareAutoFillHtml(
  htmlString: string,
  prefillData: PrefillData | null | undefined,
  token: string,
): string {
  if (!htmlString || !prefillData || Object.keys(prefillData).length === 0) {
    return htmlString;
  }
  if (
    /hbspt\.forms\.create\s*\(\s*\{/.test(htmlString) &&
    !/onFormReady/.test(htmlString)
  ) {
    return htmlString.replace(
      /hbspt\.forms\.create\s*\(\s*\{/g,
      `hbspt.forms.create({onFormReady:${readyCallback(token)},`,
    );
  }
  return htmlString;
}

/**
 * Listen for the injected `onFormReady` callback (matching `token`) and fill
 * the form it hands over, watching it for 10s for late-rendered inputs.
 * Returns a cleanup function.
 */
export function setupAutoFillCallbacks(
  prefillData: PrefillData | null | undefined,
  token: string,
): () => void {
  if (!prefillData || Object.keys(prefillData).length === 0) {
    return () => {};
  }
  const filtered: PrefillData = {};
  for (const [k, v] of Object.entries(prefillData)) {
    if (v != null && v !== "") filtered[k] = v;
  }
  const observers: MutationObserver[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  const handler = (event: Event): void => {
    const detail = (event as CustomEvent<{ token?: string; form?: unknown }>)
      .detail;
    if (!detail || detail.token !== token) return;
    const raw = detail.form as { jquery?: unknown; 0?: HTMLElement } | HTMLElement;
    const formEl: HTMLElement | undefined =
      raw && typeof raw === "object" && "jquery" in raw && raw.jquery
        ? (raw as { 0?: HTMLElement })[0]
        : (raw as HTMLElement);
    if (!formEl || typeof formEl.querySelectorAll !== "function") return;
    tryFillForm(formEl, filtered);
    const obs = new MutationObserver(() => {
      tryFillForm(formEl, filtered);
    });
    obs.observe(formEl, { childList: true, subtree: true });
    observers.push(obs);
    timers.push(setTimeout(() => obs.disconnect(), 10_000));
  };
  document.addEventListener(HS_FORM_READY_EVENT, handler);
  return () => {
    document.removeEventListener(HS_FORM_READY_EVENT, handler);
    observers.forEach((o) => o.disconnect());
    timers.forEach((t) => clearTimeout(t));
  };
}

interface HubSpotV2Form {
  setFieldValue: (name: string, value: string) => void;
  getFormFieldValues?: () => Promise<unknown>;
}

interface HubSpotFormsV4Api {
  getFormFromEvent?: (event: Event) => HubSpotV2Form | undefined;
  getForms?: () => HubSpotV2Form[];
}

/** Read (never write) the HubSpot v2 global, if the embed loaded it. */
function hubSpotV4(): HubSpotFormsV4Api | undefined {
  return (globalThis as { HubSpotFormsV4?: HubSpotFormsV4Api }).HubSpotFormsV4;
}

/**
 * Fill a HubSpot v2 form via `setFieldValue`. Discovers actual field names
 * via `getFormFieldValues()` and matches prefill keys by suffix; keys that
 * already contain "/" are used as-is. Falls back to the `0-1/` contact prefix
 * when discovery returns nothing (early on-ready events).
 */
async function fillV2Form(
  form: HubSpotV2Form,
  prefillData: PrefillData,
): Promise<void> {
  let formFieldNames: string[] | null = null;
  if (form.getFormFieldValues) {
    try {
      const fieldValues = await form.getFormFieldValues();
      let names: string[] = [];
      if (Array.isArray(fieldValues)) {
        names = fieldValues
          .filter(
            (f): f is Record<string, unknown> =>
              typeof f === "object" && f !== null,
          )
          .map((f) => f.name)
          .filter((n): n is string => typeof n === "string");
      } else if (typeof fieldValues === "object" && fieldValues !== null) {
        names = Object.keys(fieldValues);
      }
      if (names.length > 0) formFieldNames = names;
    } catch {
      /* fall through to the 0-1/ fallback */
    }
  }
  for (const [key, value] of Object.entries(prefillData)) {
    if (!value) continue;
    let fieldName: string;
    if (key.includes("/")) {
      fieldName = key;
    } else if (formFieldNames) {
      const match = formFieldNames.find((fn) => fn.endsWith("/" + key));
      if (!match) continue;
      fieldName = match;
    } else {
      fieldName = `0-1/${key}`;
    }
    try {
      form.setFieldValue(fieldName, value);
    } catch {
      /* the field may not exist on this form */
    }
  }
}

/**
 * Pre-fill HubSpot v2 forms (cross-origin `hs-form-frame`): listen for
 * `hs-form-event:on-ready`, then fill through the `HubSpotFormsV4` API. Must
 * be called before the embed script runs. Returns a cleanup function.
 */
export function setupV2FormPreFill(
  prefillData: PrefillData | null | undefined,
): () => void {
  if (!prefillData || Object.keys(prefillData).length === 0) {
    return () => {};
  }
  const handler = (event: Event): void => {
    try {
      const api = hubSpotV4();
      const form = api?.getFormFromEvent?.(event);
      if (!form?.setFieldValue) return;
      void fillV2Form(form, prefillData);
    } catch {
      /* the form may not support setFieldValue */
    }
  };
  window.addEventListener("hs-form-event:on-ready", handler);
  return () => window.removeEventListener("hs-form-event:on-ready", handler);
}

/** Fill already-rendered v2 forms. True if at least one form was found. */
export function tryFillV2Forms(prefillData: PrefillData): boolean {
  const api = hubSpotV4();
  const forms = api?.getForms?.();
  if (!Array.isArray(forms) || forms.length === 0) return false;
  for (const form of forms) {
    if (!form?.setFieldValue) continue;
    void fillV2Form(form, prefillData);
  }
  return true;
}
