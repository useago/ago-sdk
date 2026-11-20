import { AgoError } from "../client/errors";
import { loadScreenshotRenderer, renderViewport, type ScreenshotRenderer } from "../utils/renderViewport";

export interface CapturePageOptions {
  /** Defaults to the visible viewport. Supply an element to capture that element. */
  element?: HTMLElement;
  /** CSS selector to omit, in addition to iframes, password inputs and data-ago-private. */
  exclude?: string;
}

/** Render the page to a PNG File. Loads the screenshot renderer on demand. */
export async function capturePage(options: CapturePageOptions = {}): Promise<File> {
  if (typeof document === "undefined" || typeof window === "undefined") {
    throw new AgoError("Page capture requires a browser.", "screenshot_unavailable");
  }
  const element = options.element ?? document.body;
  // Iframes are dropped whole: their content is another document we do not filter.
  const excluded = 'iframe, input[type="password"], [data-ago-private]';
  const selector = options.exclude ? `${excluded}, ${options.exclude}` : excluded;
  // Validate before cloning, including when the capture root itself is private.
  if (element.closest(selector)) {
    throw new AgoError("Choose a capture element outside private content.", "screenshot_private_element");
  }
  let lib: ScreenshotRenderer;
  try {
    lib = await loadScreenshotRenderer();
  } catch {
    throw new AgoError("The screenshot renderer could not load. Please retry.", "screenshot_dependency_missing");
  }
  const filter = (node: Node) => !(node instanceof Element && node.matches(selector));
  const canvas = options.element
    ? await lib.domToCanvas(element, { scale: 1, filter })
    : await renderViewport(lib, { scale: 1, filter });
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new AgoError("PNG encoding failed; retry without a screenshot.", "screenshot_encoding_failed"));
    }, "image/png");
  });
  return new File([blob], "screenshot.png", { type: "image/png" });
}
