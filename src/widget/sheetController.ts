/**
 * Framework-agnostic bottom-sheet controller.
 *
 * Owns the `peek <-> full` state machine and turns it into a **props bag**: a
 * plain object of styles and ARIA attributes that a renderer applies however it
 * likes. It never touches the DOM itself.
 *
 * That shape is deliberate. The React widget re-renders on every streamed token
 * and re-applies its inline `style` object, so a controller that wrote to the
 * DOM directly would be clobbered mid-stream. Returning props instead means
 * React can spread them, the vanilla adapter can hand them to `css()`, and a Vue
 * or Angular binding can bind them, all from one implementation.
 *
 * Modality is expressed, not delegated to `<dialog>`: promoting a dialog from
 * `show()` to `showModal()` requires closing it and re-parenting into the top
 * layer, which cancels any running transition. The renderer applies
 * `role="dialog"` / `aria-modal` / focus trapping from `isModal` instead.
 */

/** The two resting states. There is no `half`: it needs a drag engine to be worth having. */
export type SheetState = "peek" | "full";

/** Why a transition happened, so hosts can tell a tap from a breakpoint change. */
export type SheetChangeCause = "api" | "user" | "breakpoint";

export interface SheetOptions {
  /**
   * Max viewport width (px) treated as compact. A short landscape viewport
   * (`max-height: 500px`) counts as compact too, so a phone turned sideways
   * keeps the sheet instead of dropping to the desktop layout mid-conversation.
   * Defaults to `768`.
   */
  breakpoint?: number;
  /** State to rest in when the compact layout first applies. Defaults to `"peek"`. */
  initialState?: SheetState;
  /**
   * Space to leave below the sheet, for hosts whose page already owns the bottom
   * edge (a bottom nav, a sticky checkout bar). A number is treated as px; a
   * string is used verbatim, so `env(safe-area-inset-bottom)` or a `calc()` both
   * work. Defaults to `0`.
   */
  bottomOffset?: number | string;
  /**
   * Minimum height of the collapsed sheet, excluding the bottom safe area.
   * The bar grows past it if the host's own composer styling is taller.
   * Defaults to `152`.
   */
  peekHeight?: number;
  /** Called after every state change, with what caused it. */
  onStateChange?: (state: SheetState, cause: SheetChangeCause) => void;
}

/** Style/attribute bag for one element. Style keys are camelCase: React spreads
 *  them directly, and the vanilla `css()` helper takes the same shape. */
export interface ElementProps {
  style: Record<string, string>;
  attrs: Record<string, string | null>;
}

export interface SheetSnapshot {
  /** Whether the compact (phone-shaped) layout applies at all. */
  compact: boolean;
  /** Current resting state. Meaningless while `compact` is false. */
  state: SheetState;
  /**
   * Whether the sheet currently covers the viewport. Drives scroll locking,
   * dialog semantics, focus trapping and Escape. One predicate, so those can
   * never drift apart. False on a desktop viewport even when open: the host page
   * is still usable beside the widget and must stay keyboard-reachable.
   */
  isModal: boolean;
  /** Props for the sheet surface itself. */
  surface: ElementProps;
}

export interface SheetController {
  subscribe(onChange: () => void): () => void;
  getSnapshot(): SheetSnapshot;
  /**
   * Snapshot for server rendering: never compact, so the server HTML matches the
   * client's first paint. Promotion to a sheet happens after hydration, which
   * keeps `matchMedia` (absent in Node) out of the render path entirely.
   */
  getServerSnapshot(): SheetSnapshot;
  expand(cause?: SheetChangeCause): void;
  collapse(cause?: SheetChangeCause): void;
  toggle(cause?: SheetChangeCause): void;
  destroy(): void;
}

/** Highest z-index the widget claims. Kept below the max so a host can still
 *  deliberately layer something above it. */
const SHEET_Z_INDEX = "2147483000";

function asLength(value: number | string | undefined, fallback = "0px"): string {
  if (value === undefined) return fallback;
  return typeof value === "number" ? `${value}px` : value;
}

/**
 * Build the media query for the compact layout.
 *
 * Width alone is not enough: a phone in landscape is 844x390, so a
 * `max-width: 768px` query stops matching on the viewport that needs the sheet
 * most. The height clause covers it.
 */
export function compactMediaQuery(breakpoint: number): string {
  return (
    `(max-width: ${breakpoint}px), ` +
    `(max-height: 500px) and (orientation: landscape)`
  );
}

export function createSheetController(
  options: SheetOptions = {},
): SheetController {
  const breakpoint = options.breakpoint ?? 768;
  const peekHeight = options.peekHeight ?? 152;
  const bottomOffset = asLength(options.bottomOffset);
  const initialState: SheetState = options.initialState ?? "peek";

  const listeners = new Set<() => void>();
  let state: SheetState = initialState;
  let destroyed = false;

  const mql =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(compactMediaQuery(breakpoint))
      : undefined;

  // Snapshots are cached because `useSyncExternalStore` compares by identity: a
  // fresh object every call would loop forever.
  let snapshot: SheetSnapshot = build();
  const serverSnapshot: SheetSnapshot = buildFor(false, initialState);

  function surfaceProps(compact: boolean, current: SheetState): ElementProps {
    if (!compact) {
      // Desktop: the host owns the layout, so the sheet contributes nothing.
      return {
        style: {},
        attrs: { role: null, "aria-modal": null, "aria-label": null },
      };
    }
    const base: Record<string, string> = {
      position: "fixed",
      left: "0",
      right: "0",
      bottom: bottomOffset,
      zIndex: SHEET_Z_INDEX,
      display: "flex",
      flexDirection: "column",
      borderRadius: current === "full" ? "0" : "16px 16px 0 0",
      paddingBottom: "env(safe-area-inset-bottom)",
    };
    if (current === "full") {
      return {
        style: {
          ...base,
          top: "0",
          height: "auto",
          paddingTop: "env(safe-area-inset-top)",
        },
        // Modal semantics applied by hand rather than via <dialog>: see the file
        // header. tabIndex makes the surface programmatically focusable so the
        // renderer can move focus into it WITHOUT focusing the text field, which
        // would pop the on-screen keyboard.
        attrs: { role: "dialog", "aria-modal": "true", tabindex: "-1" },
      };
    }
    return {
      style: {
        ...base,
        top: "auto",
        // A minimum rather than a fixed height: the collapsed bar holds a
        // header, a two-line preview and a composer, and a hard height clips
        // them the moment a host restyles any of the three. The preview reserves
        // both of its lines, so the bar still does not jump as a reply streams.
        minHeight: `calc(${peekHeight}px + env(safe-area-inset-bottom))`,
        height: "auto",
      },
      // Peek is never modal: the host page behind it stays scrollable and
      // keyboard-reachable, which is the whole point of a non-modal sheet.
      attrs: { role: null, "aria-modal": null, tabindex: "-1" },
    };
  }

  function buildFor(compact: boolean, current: SheetState): SheetSnapshot {
    return {
      compact,
      state: current,
      isModal: compact && current === "full",
      surface: surfaceProps(compact, current),
    };
  }

  function build(): SheetSnapshot {
    return buildFor(!!mql?.matches, state);
  }

  function emit(): void {
    snapshot = build();
    for (const listener of listeners) listener();
  }

  function setState(next: SheetState, cause: SheetChangeCause): void {
    if (destroyed || state === next) return;
    state = next;
    emit();
    options.onStateChange?.(next, cause);
  }

  function onMediaChange(): void {
    if (destroyed) return;
    // Leaving the compact layout resets to the resting state, so returning to it
    // (rotating back, resizing) doesn't reopen a sheet the user had closed.
    if (!mql?.matches && state !== initialState) {
      state = initialState;
      emit();
      options.onStateChange?.(initialState, "breakpoint");
      return;
    }
    emit();
  }

  // The media listener is attached while at least one subscriber is watching,
  // NOT for the controller's whole life.
  //
  // React StrictMode mounts, runs effect cleanups, then remounts with the SAME
  // memoized value. Tearing the controller down from a cleanup keyed on its
  // identity therefore killed it permanently: `useMemo` does not re-run on the
  // remount, so the component held a destroyed controller and every command
  // silently no-opped. Driving attach/detach from the subscription instead means
  // React never has to call `destroy()` at all.
  let attached = false;
  function attach(): void {
    if (attached || !mql) return;
    mql.addEventListener("change", onMediaChange);
    attached = true;
    // Re-read: the viewport may have changed while nothing was subscribed.
    snapshot = build();
  }
  function detach(): void {
    if (!attached || !mql) return;
    mql.removeEventListener("change", onMediaChange);
    attached = false;
  }

  return {
    subscribe(onChange) {
      listeners.add(onChange);
      if (listeners.size === 1) attach();
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0) detach();
      };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    expand: (cause = "api") => setState("full", cause),
    collapse: (cause = "api") => setState("peek", cause),
    toggle: (cause = "api") =>
      setState(state === "full" ? "peek" : "full", cause),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      detach();
      listeners.clear();
    },
  };
}
