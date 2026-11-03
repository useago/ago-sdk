import { AgoError } from "../client/errors";

export interface CapturePageOptions {
  /** Defaults to the visible viewport. Supply an element to capture that element. */
  element?: HTMLElement;
  /** CSS selector for content to omit, in addition to password inputs and data-ago-private. */
  exclude?: string;
}

/** Render the page to a PNG File. Loads the screenshot renderer on demand. */
export async function capturePage(options: CapturePageOptions = {}): Promise<File> {
  if (typeof document === "undefined" || typeof window === "undefined") {
    throw new AgoError("Page capture requires a browser.", "screenshot_unavailable");
  }
  const element = options.element ?? document.body;
  const excluded = 'input[type="password"], [data-ago-private]';
  const selector = options.exclude ? `${excluded}, ${options.exclude}` : excluded;
  // Validate before cloning, including when the capture root itself is private.
  if (element.closest(selector)) {
    throw new AgoError("Choose a capture element outside private content.", "screenshot_private_element");
  }
  let render: typeof import("html2canvas-pro")["default"];
  try {
    render = (await import("html2canvas-pro")).default;
  } catch {
    throw new AgoError("The screenshot renderer could not load. Please retry.", "screenshot_dependency_missing");
  }
  const canvas = await render(element, {
    logging: false,
    scale: 1,
    useCORS: true,
    ignoreElements: (node) => node.matches(selector),
    ...(options.element ? {} : {
      x: window.scrollX,
      y: window.scrollY,
      width: window.innerWidth,
      height: window.innerHeight,
    }),
  });
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new AgoError("PNG encoding failed; retry without a screenshot.", "screenshot_encoding_failed"));
    }, "image/png");
  });
  return new File([blob], "screenshot.png", { type: "image/png" });
}
