export type ScreenshotRenderer = typeof import("./screenshotRenderer");

/** Load the DOM renderer chunk. Callers map a failure to their own error code. */
export function loadScreenshotRenderer(): Promise<ScreenshotRenderer> {
  return import("./screenshotRenderer");
}

export interface RenderViewportOptions {
  scale: number;
  /** Return false to leave a node (and its subtree) out of the image. */
  filter?: (node: Node) => boolean;
  /** Runs on each cloned node, e.g. to mask sensitive fields in the copy. */
  onCloneNode?: (clone: Element) => void;
}

/**
 * Fixed elements live in the viewport, but the captured root is shifted by
 * the scroll offset to show only the viewport: shift them back.
 */
function pinFixedElements(root: Element, x: number, y: number): void {
  if (!x && !y) return;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    if (el.style?.position !== "fixed") continue;
    let ancestor = el.parentElement;
    while (ancestor && ancestor !== root && ancestor.style?.position !== "fixed") {
      ancestor = ancestor.parentElement;
    }
    if (ancestor && ancestor !== root) continue;
    const current = el.style.transform && el.style.transform !== "none" ? ` ${el.style.transform}` : "";
    el.style.setProperty("transform", `translate(${x}px, ${y}px)${current}`, "important");
  }
}

/** Render the visible part of the page. The live page is never modified. */
export function renderViewport(lib: ScreenshotRenderer, options: RenderViewportOptions): Promise<HTMLCanvasElement> {
  const x = window.scrollX || 0;
  const y = window.scrollY || 0;
  const bodyBackground = document.body ? getComputedStyle(document.body).backgroundColor : "";
  return lib.domToCanvas(document.documentElement, {
    width: window.innerWidth,
    height: window.innerHeight,
    scale: options.scale,
    backgroundColor:
      bodyBackground && bodyBackground !== "rgba(0, 0, 0, 0)" ? bodyBackground : "#ffffff",
    style: { transform: `translate(${-x}px, ${-y}px)`, transformOrigin: "0 0" },
    filter: options.filter ?? null,
    onCloneNode: (clone) => {
      if (!(clone instanceof Element)) return;
      options.onCloneNode?.(clone);
      pinFixedElements(clone, x, y);
    },
  });
}
