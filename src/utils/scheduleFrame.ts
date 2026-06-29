/**
 * Schedule a callback on the next animation frame, falling back to a ~60fps
 * timer in environments without `requestAnimationFrame` (SSR / some test envs).
 * Used to coalesce per-token streaming updates into one render per frame.
 *
 * @internal not part of the public SDK surface.
 */
export function scheduleFrame(cb: () => void): number {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(cb);
  }
  return setTimeout(cb, 16) as unknown as number;
}

/** Cancel a handle returned by {@link scheduleFrame}. @internal */
export function cancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(handle);
  } else {
    clearTimeout(handle);
  }
}
