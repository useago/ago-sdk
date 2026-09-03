/**
 * Form-submit detection for HubSpot embed forms, ported from the hosted
 * widget: DOM `submit` events scoped to the container, plus HubSpot's own
 * `onFormSubmit` / `onFormSubmitted` callbacks injected into
 * `hbspt.forms.create()` and relayed as `CustomEvent`s on `document` (the
 * SDK never writes `window` globals).
 */

export type CapturedFormData = Record<string, unknown>;

export const HS_FORM_SUBMIT_EVENT = "ago-hs-form-submit";
export const HS_FORM_SUBMITTED_EVENT = "ago-hs-form-submitted";

/**
 * Drop the provider's system/tracking fields and empty values so only what
 * the user typed is stored.
 */
export function filterFormData(
  data: CapturedFormData | null,
): CapturedFormData | null {
  if (!data || typeof data !== "object") return data;

  // Normalize HubSpot v2 `[{name, value}, ...]` into a flat object.
  let normalized: CapturedFormData;
  if (Array.isArray(data)) {
    normalized = {};
    for (const entry of data) {
      if (
        entry &&
        typeof entry === "object" &&
        "name" in entry &&
        entry.name &&
        entry.value !== undefined
      ) {
        normalized[entry.name as string] = entry.value;
      }
    }
  } else {
    normalized = data;
  }

  const filtered: CapturedFormData = {};
  for (const [rawKey, val] of Object.entries(normalized)) {
    // Strip HubSpot v2 prefixes (`0-1/lastname` → `lastname`).
    const key = rawKey.replace(/^\d+-\d+\//, "");
    if (key.startsWith("hs_") || key.startsWith("HS_")) continue;
    if (key === "LEGAL_CONSENT" || key === "legal_consent") continue;
    if (key === "goToWebinarWebinarKey") continue;
    if (val === "" || val === null || val === undefined) continue;
    if (typeof val === "string" && val.length > 2000) continue;
    filtered[key] = val;
  }
  return Object.keys(filtered).length > 0 ? filtered : null;
}

function captureFormElementData(form: HTMLFormElement): CapturedFormData | null {
  try {
    const fd = new FormData(form);
    const data: CapturedFormData = {};
    fd.forEach((value, key) => {
      if (value instanceof File) return;
      data[key] = value;
    });
    return Object.keys(data).length > 0 ? data : null;
  } catch {
    return null;
  }
}

function dispatcher(event: string, token: string, withForm: boolean): string {
  const detail = withForm
    ? `{token:${JSON.stringify(token)},form:$f}`
    : `{token:${JSON.stringify(token)}}`;
  return `function(${withForm ? "$f" : ""}){document.dispatchEvent(new CustomEvent(${JSON.stringify(
    event,
  )},{detail:${detail}}))}`;
}

/**
 * Inject `onFormSubmit` / `onFormSubmitted` callbacks into
 * `hbspt.forms.create()` calls. Returns the modified HTML.
 */
export function prepareSubmitDetectorHtml(
  htmlString: string,
  token: string,
): string {
  if (!htmlString) return htmlString;
  if (
    /hbspt\.forms\.create\s*\(\s*\{/.test(htmlString) &&
    !htmlString.includes(HS_FORM_SUBMITTED_EVENT)
  ) {
    return htmlString.replace(
      /hbspt\.forms\.create\s*\(\s*\{/g,
      `hbspt.forms.create({onFormSubmit:${dispatcher(
        HS_FORM_SUBMIT_EVENT,
        token,
        true,
      )},onFormSubmitted:${dispatcher(HS_FORM_SUBMITTED_EVENT, token, false)},`,
    );
  }
  return htmlString;
}

/**
 * Detect a submission inside `container`: scoped DOM listeners plus the
 * relayed HubSpot callbacks for `token`. HubSpot forms only notify once
 * HubSpot confirms success (their AJAX is deferred); `onSubmitAttempt` fires
 * on the attempt so the caller can time out. Returns a cleanup function.
 */
export function setupSubmitDetectorCallbacks(
  container: HTMLElement,
  onSubmit: (capturedData?: CapturedFormData | null) => void,
  onSubmitAttempt: (() => void) | undefined,
  token: string,
): () => void {
  let submitted = false;
  let capturedFormData: CapturedFormData | null = null;

  function notifySubmit(): void {
    if (submitted) return;
    submitted = true;
    onSubmit(filterFormData(capturedFormData));
  }

  function handleFormSubmit(form: HTMLFormElement): void {
    if (!capturedFormData) capturedFormData = captureFormElementData(form);
    if (form.closest(".hs-form, .hbspt-form, [data-hs-forms]")) {
      onSubmitAttempt?.();
      return;
    }
    notifySubmit();
  }

  const submitHandler = (e: Event): void => {
    const target = e.target as HTMLElement | null;
    if (target?.tagName === "FORM") handleFormSubmit(target as HTMLFormElement);
  };
  container.addEventListener("submit", submitHandler, true);

  const attached = new WeakSet<HTMLFormElement>();
  function attachFormListener(form: HTMLFormElement): void {
    if (attached.has(form)) return;
    attached.add(form);
    form.addEventListener("submit", () => handleFormSubmit(form));
  }
  for (const form of container.querySelectorAll("form")) attachFormListener(form);
  const observer = new MutationObserver(() => {
    for (const form of container.querySelectorAll("form")) attachFormListener(form);
  });
  observer.observe(container, { childList: true, subtree: true });

  const onHsSubmit = (event: Event): void => {
    const detail = (event as CustomEvent<{ token?: string; form?: unknown }>)
      .detail;
    if (!detail || detail.token !== token) return;
    try {
      const raw = detail.form as { jquery?: unknown; 0?: HTMLElement } | HTMLElement;
      const formEl: HTMLElement | undefined =
        raw && typeof raw === "object" && "jquery" in raw && raw.jquery
          ? (raw as { 0?: HTMLElement })[0]
          : (raw as HTMLElement);
      if (formEl?.querySelectorAll) {
        const inputs = formEl.querySelectorAll<
          HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        >("input, textarea, select");
        const data: CapturedFormData = {};
        for (const inp of inputs) {
          if (inp.name && inp.type !== "submit" && inp.type !== "button") {
            data[inp.name] = inp.value || "";
          }
        }
        if (Object.keys(data).length > 0) capturedFormData = data;
      }
    } catch {
      /* ignore */
    }
  };
  const onHsSubmitted = (event: Event): void => {
    const detail = (event as CustomEvent<{ token?: string }>).detail;
    if (!detail || detail.token !== token) return;
    notifySubmit();
  };
  document.addEventListener(HS_FORM_SUBMIT_EVENT, onHsSubmit);
  document.addEventListener(HS_FORM_SUBMITTED_EVENT, onHsSubmitted);

  return () => {
    container.removeEventListener("submit", submitHandler, true);
    observer.disconnect();
    document.removeEventListener(HS_FORM_SUBMIT_EVENT, onHsSubmit);
    document.removeEventListener(HS_FORM_SUBMITTED_EVENT, onHsSubmitted);
  };
}
