import { AgoError } from "../client/errors";

/** Always masked, whatever the host configured. */
const ALWAYS_MASKED = ['input[type="password" i]', "[data-ago-mask]"];

/** `autocomplete` tokens that mark payment-card and one-time-code fields. */
const SENSITIVE_AUTOCOMPLETE = [
  "cc-name",
  "cc-given-name",
  "cc-additional-name",
  "cc-family-name",
  "cc-number",
  "cc-exp",
  "cc-exp-month",
  "cc-exp-year",
  "cc-csc",
  "cc-type",
  "one-time-code",
];

const MASK_COLOR = "#1f2328";
const REPLACED_ELEMENTS = new Set(["IMG", "VIDEO", "CANVAS", "IFRAME", "SVG", "OBJECT", "EMBED", "PICTURE"]);

/**
 * One selector matching everything a screenshot (or the live view) must hide.
 * A configured selector that does not parse throws: skipping it would
 * silently leave the field it was meant to hide in the image.
 */
export function maskSelector(
  extra: readonly string[] = [],
  option = "remoteAssist.screenshot.mask",
): string {
  const selectors = [
    ...ALWAYS_MASKED,
    ...SENSITIVE_AUTOCOMPLETE.map((token) => `[autocomplete~="${token}" i]`),
  ];
  for (const selector of extra) {
    const trimmed = typeof selector === "string" ? selector.trim() : "";
    if (!trimmed) continue;
    try {
      document.createDocumentFragment().querySelector(trimmed);
    } catch {
      throw new AgoError(
        `Invalid mask selector "${trimmed}". Fix ${option}.`,
        "remote_assist_invalid_mask",
      );
    }
    selectors.push(trimmed);
  }
  return selectors.join(",");
}

/** Elements of `root` (itself included) a screenshot must hide. */
export function findMaskTargets(root: ParentNode, selector: string): Element[] {
  const targets = Array.from(root.querySelectorAll(selector));
  if (root instanceof Element && root.matches(selector)) targets.unshift(root);
  return targets;
}

function paint(el: HTMLElement): void {
  const set = (name: string, value: string): void =>
    el.style.setProperty(name, value, "important");
  set("background", MASK_COLOR);
  set("color", "transparent");
  set("-webkit-text-fill-color", "transparent");
  set("text-shadow", "none");
  set("caret-color", "transparent");
}

/**
 * Turn an element of the CAPTURED copy into a solid block: its box keeps its
 * size, its content is hidden. Never call it on the live page.
 */
export function applyMask(el: Element): void {
  const doc = el.ownerDocument;
  if (REPLACED_ELEMENTS.has(el.tagName.toUpperCase())) {
    const block = doc.createElement("div");
    const style = (el as HTMLElement).style;
    if (style?.cssText) block.style.cssText = style.cssText;
    if (!block.style.display || block.style.display === "inline") {
      block.style.display = "inline-block";
    }
    paint(block);
    el.replaceWith(block);
    return;
  }
  if (!("style" in el)) return;
  const element = el as HTMLElement;
  paint(element);
  if (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT") {
    element.setAttribute("value", "");
    (element as HTMLInputElement).value = "";
    element.removeAttribute("placeholder");
  }
  if (element.tagName === "TEXTAREA") element.textContent = "";
  for (const child of Array.from(element.querySelectorAll("*"))) {
    (child as HTMLElement).style?.setProperty("visibility", "hidden", "important");
  }
}
