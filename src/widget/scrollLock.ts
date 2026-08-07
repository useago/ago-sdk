/**
 * Background scroll lock, shared by every AGO surface that can cover the
 * viewport (the vanilla widget's sheet and side panel, the React sheet).
 *
 * Lives in its own module so both renderers hold the SAME lock: two
 * independent implementations would each think they owned the host's <body>.
 */

// ── Background scroll lock (fixed-body method) ─────────────────────────
// `overflow: hidden` on <html>/<body> does not stop touch scrolling on iOS
// Safari, so a full-screen sheet leaves the page scrollable underneath. The
// reliable cross-browser fix is to pin the body: capture the scroll offset,
// `position: fixed` the body shifted up by that offset (so it looks unmoved),
// then put the offset back when the last owner releases.
//
// Two properties this needs that a bare counter did not have:
//
//  1. It RESTORES the host's own inline styles rather than deleting them. The
//     SDK runs inside someone else's page, and that page may already pin the
//     body for its own modal. Removing `position`/`top`/... outright would
//     silently break the host (see CLAUDE.md: never override what already
//     exists in the host application).
//  2. Ownership is a set of tokens, not a count, so `unlock` is idempotent and
//     one widget can never drop a lock it does not hold. Overlapping
//     open/close/destroy paths would otherwise release someone else's lock.
//
// Keyed per `Document` so widgets living in different documents (iframes) that
// share this module instance don't stomp each other.

/** One captured inline declaration, so it can be put back exactly as it was. */
interface SavedDecl {
  style: CSSStyleDeclaration;
  prop: string;
  value: string;
  priority: string;
}
interface ScrollLockState {
  owners: Set<symbol>;
  saved: SavedDecl[];
  scrollY: number;
}

const scrollLocks = new WeakMap<Document, ScrollLockState>();
const LOCKED_BODY_PROPS = ["position", "top", "left", "right", "width"];

function saveDecls(
  style: CSSStyleDeclaration,
  props: readonly string[],
): SavedDecl[] {
  return props.map((prop) => ({
    style,
    prop,
    value: style.getPropertyValue(prop),
    priority: style.getPropertyPriority(prop),
  }));
}

function restoreDecls(saved: readonly SavedDecl[]): void {
  for (const { style, prop, value, priority } of saved) {
    // An empty captured value means the host had no inline declaration there,
    // so removing (not setting "") is what restores the original cascade.
    if (value) style.setProperty(prop, value, priority);
    else style.removeProperty(prop);
  }
}

export function lockBackgroundScroll(owner: symbol, doc: Document = document): void {
  const existing = scrollLocks.get(doc);
  if (existing) {
    existing.owners.add(owner);
    return;
  }
  const body = doc.body;
  const root = doc.documentElement;
  const scrollY = doc.defaultView?.scrollY ?? 0;
  scrollLocks.set(doc, {
    owners: new Set([owner]),
    saved: [
      ...saveDecls(body.style, LOCKED_BODY_PROPS),
      ...saveDecls(root.style, ["overflow"]),
    ],
    scrollY,
  });
  body.style.position = "fixed";
  body.style.top = `-${scrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  // overflow: hidden alone is unreliable on iOS but harmless as a second layer.
  root.style.overflow = "hidden";
}

export function unlockBackgroundScroll(owner: symbol, doc: Document = document): void {
  const state = scrollLocks.get(doc);
  // `delete` returning false means this owner never held the lock — releasing
  // twice, or releasing after someone else already cleaned up, is a no-op.
  if (!state || !state.owners.delete(owner)) return;
  if (state.owners.size > 0) return;
  scrollLocks.delete(doc);
  restoreDecls(state.saved);
  doc.defaultView?.scrollTo(0, state.scrollY);
}

