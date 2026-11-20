import { AgoError } from "../client/errors";
import { applyMask, findMaskTargets, maskSelector } from "./mask";
import { loadScreenshotRenderer, renderViewport, type ScreenshotRenderer } from "../utils/renderViewport";

/** Upload ceiling of `POST .../commands/{id}/screenshot`. */
export const MAX_SCREENSHOT_BYTES = 3 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_SCALE = 2;

export interface CaptureOptions {
  /** Extra mask selectors from the host config. */
  mask?: readonly string[];
  /** Host-provided capture, used instead of the built-in renderer. */
  capture?: () => Promise<Blob>;
  /** Nodes left out of the image (the SDK's own consent UI). */
  exclude?: (node: Node) => boolean;
}

type ToBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) => Promise<Blob | null>;

const canvasToBlob: ToBlob = (canvas, type, quality) =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Encode a canvas under `maxBytes`: PNG first (sharp text), then WebP and
 * JPEG at falling quality, then the same at half the size.
 */
export async function encodeUnderLimit(
  canvas: HTMLCanvasElement,
  maxBytes = MAX_SCREENSHOT_BYTES,
  toBlob: ToBlob = canvasToBlob,
): Promise<Blob> {
  const attempts: Array<[string, number | undefined]> = [
    ["image/png", undefined],
    ["image/webp", 0.85],
    ["image/jpeg", 0.8],
    ["image/jpeg", 0.6],
  ];
  let source = canvas;
  for (let round = 0; round < 3; round++) {
    for (const [type, quality] of attempts) {
      const blob = await toBlob(source, type, quality);
      // A browser without WebP encoding silently returns PNG: skip it.
      if (blob && blob.type === type && blob.size <= maxBytes) return blob;
    }
    source = halve(source);
  }
  throw new AgoError("The screenshot stays over 3 MB even downscaled.", "remote_assist_screenshot_too_large");
}

function halve(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const next = canvas.ownerDocument.createElement("canvas");
  next.width = Math.max(1, Math.floor(canvas.width / 2));
  next.height = Math.max(1, Math.floor(canvas.height / 2));
  next.getContext("2d")?.drawImage(canvas, 0, 0, next.width, next.height);
  return next;
}

function checkHostBlob(blob: unknown): Blob {
  if (!(blob instanceof Blob)) {
    throw new AgoError("remoteAssist.screenshot.capture() must resolve to a Blob.", "remote_assist_screenshot_invalid");
  }
  if (!ACCEPTED_TYPES.has(blob.type)) {
    throw new AgoError(
      `remoteAssist.screenshot.capture() returned "${blob.type || "no type"}"; use image/png, image/jpeg or image/webp.`,
      "remote_assist_screenshot_invalid",
    );
  }
  if (blob.size > MAX_SCREENSHOT_BYTES) {
    throw new AgoError("remoteAssist.screenshot.capture() returned more than 3 MB.", "remote_assist_screenshot_too_large");
  }
  return blob;
}

/**
 * Capture the visible part of the page (viewport only) as an image under
 * 3 MB, with every sensitive field masked in the captured copy. The live page
 * is never modified. The renderer is loaded on the first capture only.
 */
export async function captureViewport(options: CaptureOptions = {}): Promise<Blob> {
  if (options.capture) return checkHostBlob(await options.capture());
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new AgoError("Screenshots need a browser.", "remote_assist_screenshot_unavailable");
  }
  const selector = maskSelector(options.mask);
  let lib: ScreenshotRenderer;
  try {
    lib = await loadScreenshotRenderer();
  } catch (error) {
    throw new AgoError(
      `The screenshot renderer could not be loaded (${error instanceof Error ? error.message : String(error)}).`,
      "remote_assist_screenshot_unavailable",
    );
  }
  const exclude = options.exclude;
  const canvas = await renderViewport(lib, {
    scale: Math.min(window.devicePixelRatio || 1, MAX_SCALE),
    filter: exclude ? (node) => !exclude(node) : undefined,
    onCloneNode: (clone) => {
      for (const target of findMaskTargets(clone, selector)) applyMask(target);
    },
  });
  return encodeUnderLimit(canvas);
}
