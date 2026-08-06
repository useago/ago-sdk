import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import {
  createSheetController,
  type SheetChangeCause,
  type SheetOptions,
  type SheetSnapshot,
} from "../../widget/sheetController";

/** Snapshot used when the sheet is switched off, or before a controller exists.
 *  Frozen module-level constant so its identity is stable across renders: a
 *  fresh object would make `useSyncExternalStore` re-render forever. */
const INERT: SheetSnapshot = {
  compact: false,
  state: "peek",
  isModal: false,
  surface: { style: {}, attrs: {} },
};

/**
 * DOM attribute names that React spells differently. The controller emits
 * canonical DOM names (it is framework-agnostic and the vanilla adapter feeds
 * them straight to `setAttribute`), so translating is React's job.
 */
const REACT_ATTR_NAMES: Record<string, string> = { tabindex: "tabIndex" };

function toReactAttrs(
  attrs: Record<string, string | null>,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [name, value] of Object.entries(attrs)) {
    out[REACT_ATTR_NAMES[name] ?? name] = value;
  }
  return out;
}

export interface UseSheetResult {
  /** Current state + the props bag to apply to the sheet surface. */
  sheet: SheetSnapshot;
  expand: (cause?: SheetChangeCause) => void;
  collapse: (cause?: SheetChangeCause) => void;
  toggle: (cause?: SheetChangeCause) => void;
}

/**
 * React binding for {@link createSheetController}.
 *
 * Reads through `useSyncExternalStore` with a **non-compact server snapshot**, so
 * `matchMedia` (which does not exist in Node) never runs during render. The
 * server emits the ordinary layout and the client promotes to a sheet after
 * hydration, instead of throwing on the server or flashing on the client.
 *
 * Pass `false` to opt out entirely: no sheet, no scroll lock, no focus trap, no
 * fixed overlay on the host page.
 */
export function useSheet(options?: SheetOptions | false): UseSheetResult {
  const enabled = options !== false;
  const opts = enabled ? (options ?? {}) : undefined;

  // Kept in a ref so an inline arrow in the caller's JSX doesn't tear down and
  // rebuild the controller on every render.
  const onStateChangeRef = useRef(opts?.onStateChange);
  onStateChangeRef.current = opts?.onStateChange;

  const controller = useMemo(() => {
    if (!enabled) return undefined;
    return createSheetController({
      breakpoint: opts?.breakpoint,
      initialState: opts?.initialState,
      bottomOffset: opts?.bottomOffset,
      peekHeight: opts?.peekHeight,
      onStateChange: (state, cause) =>
        onStateChangeRef.current?.(state, cause),
    });
    // Rebuilt only when a value that shapes the machine actually changes.
  }, [
    enabled,
    opts?.breakpoint,
    opts?.initialState,
    opts?.bottomOffset,
    opts?.peekHeight,
  ]);

  // Deliberately no `destroy()` on unmount: the controller's only external
  // resource is its media listener, which `subscribe` already attaches and
  // detaches. Destroying it from an effect cleanup breaks StrictMode, where the
  // cleanup runs between the two mounts while `useMemo` keeps the same instance.

  const subscribe = useCallback(
    (onChange: () => void) => controller?.subscribe(onChange) ?? (() => {}),
    [controller],
  );
  const getSnapshot = useCallback(
    () => controller?.getSnapshot() ?? INERT,
    [controller],
  );
  const getServerSnapshot = useCallback(
    () => controller?.getServerSnapshot() ?? INERT,
    [controller],
  );

  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // Memoized on the snapshot identity so spreading it doesn't produce a new
  // object (and a new render) on every pass.
  const sheet = useMemo<SheetSnapshot>(
    () => ({ ...raw, surface: { ...raw.surface, attrs: toReactAttrs(raw.surface.attrs) } }),
    [raw],
  );

  const expand = useCallback(
    (cause?: SheetChangeCause) => controller?.expand(cause),
    [controller],
  );
  const collapse = useCallback(
    (cause?: SheetChangeCause) => controller?.collapse(cause),
    [controller],
  );
  const toggle = useCallback(
    (cause?: SheetChangeCause) => controller?.toggle(cause),
    [controller],
  );

  return { sheet, expand, collapse, toggle };
}
