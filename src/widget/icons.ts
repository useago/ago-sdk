/**
 * Inline SVG glyphs for the bubble widget. Every icon is `currentColor` and
 * `aria-hidden`, built with `createElementNS` (no innerHTML), so it inherits the
 * surrounding text color and never adds an accessible name of its own.
 *
 * Material Symbols paths use the `0 -960 960 960` viewBox; the Lucide ones use
 * `0 0 24 24` with strokes. The launcher's two paths are copied from the
 * reference loader so the bubble glyph is pixel-identical.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

interface IconOptions {
  /** Rendered size in px (width and height). */
  size?: number;
  /** Extra class name on the `<svg>`; must stay `ago-` prefixed by the caller. */
  className?: string;
}

function svg(viewBox: string, size: number, className?: string): SVGSVGElement {
  const el = document.createElementNS(SVG_NS, "svg");
  el.setAttribute("xmlns", SVG_NS);
  el.setAttribute("viewBox", viewBox);
  el.setAttribute("width", String(size));
  el.setAttribute("height", String(size));
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("focusable", "false");
  el.style.flexShrink = "0";
  el.style.display = "block";
  if (className) el.setAttribute("class", className);
  return el;
}

function filledPath(d: string, id?: string): SVGPathElement {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "currentColor");
  if (id) path.setAttribute("data-ago-path", id);
  return path;
}

/** A Material Symbols glyph (filled, viewBox `0 -960 960 960`). */
function material(d: string, opts: IconOptions = {}): SVGSVGElement {
  const el = svg("0 -960 960 960", opts.size ?? 24, opts.className);
  el.appendChild(filledPath(d));
  return el;
}

/** A Lucide-style stroked glyph (viewBox `0 0 24 24`). */
function stroked(
  paths: string[],
  opts: IconOptions & { strokeWidth?: number } = {},
): SVGSVGElement {
  const el = svg("0 0 24 24", opts.size ?? 24, opts.className);
  el.setAttribute("fill", "none");
  el.setAttribute("stroke", "currentColor");
  el.setAttribute("stroke-width", String(opts.strokeWidth ?? 2));
  el.setAttribute("stroke-linecap", "round");
  el.setAttribute("stroke-linejoin", "round");
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    el.appendChild(path);
  }
  return el;
}

// ── Material Symbols ────────────────────────────────────────────────

/** The reference launcher glyph (Material "chat", as shipped in frame.js). */
export const LAUNCHER_OPEN_PATH =
  "M240-400h480v-80H240v80Zm0-120h480v-80H240v80Zm0-120h480v-80H240v80ZM880-80 720-240H160q-33 0-56.5-23.5T80-320v-480q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v720ZM160-320h594l46 45v-525H160v480Zm0 0v-480 480Z";
/** The reference launcher "close" chevron (Material "expand_more"). */
export const LAUNCHER_CLOSE_PATH =
  "M480-344 240-584l56-56 184 184 184-184 56 56-240 240Z";

/**
 * The launcher's two-state glyph: both paths in one 48px SVG, toggled with
 * `data-ago-path="open" | "close"` (the caller flips `display`).
 */
export function launcherIcon(): SVGSVGElement {
  const el = svg("0 -960 960 960", 48);
  el.appendChild(filledPath(LAUNCHER_OPEN_PATH, "open"));
  el.appendChild(filledPath(LAUNCHER_CLOSE_PATH, "close"));
  return el;
}

/** Just the close chevron, for a launcher showing a custom `icon` image. */
export function launcherCloseIcon(): SVGSVGElement {
  const el = svg("0 -960 960 960", 48);
  el.appendChild(filledPath(LAUNCHER_CLOSE_PATH, "close"));
  return el;
}

export function chevronLeftIcon(opts?: IconOptions): SVGSVGElement {
  return material("M560-240 320-480l240-240 56 56-184 184 184 184-56 56Z", opts);
}

export function chevronRightIcon(opts?: IconOptions): SVGSVGElement {
  return material("M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z", opts);
}

export function closeIcon(opts?: IconOptions): SVGSVGElement {
  return material(
    "m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z",
    opts,
  );
}

export function addCommentIcon(opts?: IconOptions): SVGSVGElement {
  return material(
    "M440-400h80v-120h120v-80H520v-120h-80v120H320v80h120v120ZM80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Zm126-240h594v-480H160v525l46-45Zm-46 0v-480 480Z",
    opts,
  );
}

export function arrowUpwardIcon(opts?: IconOptions): SVGSVGElement {
  return material(
    "M440-160v-487L216-423l-56-57 320-320 320 320-56 57-224-224v487h-80Z",
    opts,
  );
}

export function arrowDownwardIcon(opts?: IconOptions): SVGSVGElement {
  return material(
    "M440-800v487L216-537l-56 57 320 320 320-320-56-57-224 224v-487h-80Z",
    opts,
  );
}

export function stopIcon(opts?: IconOptions): SVGSVGElement {
  return material("M240-240v-480h480v480H240Z", opts);
}

export function thumbUpIcon(opts?: IconOptions): SVGSVGElement {
  return material(
    "M720-120H280v-520l280-280 50 50q7 7 11.5 19t4.5 23v14l-44 174h258q32 0 56 24t24 56v80q0 7-2 15t-4 15L794-168q-9 20-30 34t-44 14Zm-360-80h360l120-280v-80H480l54-220-174 174v406Zm0-406v406-406Zm-80-34v80H160v360h120v80H80v-520h200Z",
    opts,
  );
}

export function thumbDownIcon(opts?: IconOptions): SVGSVGElement {
  return material(
    "M240-840h440v520L400-40l-50-50q-7-7-11.5-19t-4.5-23v-14l44-174H120q-32 0-56-24t-24-56v-80q0-7 2-15t4-15l120-282q9-20 30-34t44-14Zm360 80H240L120-480v80h360l-54 220 174-174v-406Zm0 406v-406 406Zm80 34v-80h120v-360H680v-80h200v520H680Z",
    opts,
  );
}

export function descriptionIcon(opts?: IconOptions): SVGSVGElement {
  return material(
    "M320-240h320v-80H320v80Zm0-160h320v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520ZM240-800v200-200 640-640Z",
    opts,
  );
}

export function downloadIcon(opts?: IconOptions): SVGSVGElement {
  return material(
    "M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z",
    opts,
  );
}

export function attachFileIcon(opts?: IconOptions): SVGSVGElement {
  return material(
    "M720-330q0 104-73 177T470-80q-104 0-177-73t-73-177v-370q0-75 52.5-127.5T400-880q75 0 127.5 52.5T580-700v350q0 46-32 78t-78 32q-46 0-78-32t-32-78v-370h80v370q0 13 8.5 21.5T470-320q13 0 21.5-8.5T500-350v-350q-1-42-29.5-71T400-800q-42 0-71 29t-29 71v370q-1 71 49 120.5T470-160q70 0 119-49.5T640-330v-390h80v390Z",
    opts,
  );
}

// ── Lucide / design-system glyphs ───────────────────────────────────

/** Lucide "house", stroke 1.5 (the footer Home tab). */
export function houseIcon(opts?: IconOptions): SVGSVGElement {
  return stroked(
    [
      "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8",
      "M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
    ],
    { ...opts, strokeWidth: 1.5 },
  );
}

/** Lucide "arrow-up-right" (conversation starter cards). */
export function arrowUpRightIcon(opts?: IconOptions): SVGSVGElement {
  return stroked(["M7 7h10v10", "M7 17 17 7"], opts);
}

/** Lucide "circle-alert" (error alerts). */
export function alertCircleIcon(opts?: IconOptions): SVGSVGElement {
  const el = stroked(["M12 8v4", "M12 16h.01"], opts);
  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "12");
  circle.setAttribute("r", "10");
  el.insertBefore(circle, el.firstChild);
  return el;
}

/** The reference's 8-spoke streaming spinner (`spinner.tsx`). Not animated here. */
export function spokeSpinnerIcon(opts?: IconOptions): SVGSVGElement {
  return stroked(
    [
      "M12 3v3m6.366-.366-2.12 2.12M21 12h-3m.366 6.366-2.12-2.12M12 21v-3m-6.366.366 2.12-2.12M3 12h3m-.366-6.366 2.12 2.12",
    ],
    { size: 20, ...opts, strokeWidth: 1.5 },
  );
}

/** The design-system conversations glyph (footer Chats tab, empty history). */
export function conversationsIcon(opts?: IconOptions): SVGSVGElement {
  const el = svg("0 0 24 24", opts?.size ?? 24, opts?.className);
  el.setAttribute("fill", "none");
  el.appendChild(
    filledPath(
      "M21.5166 5.68457C21.5166 5.43995 21.4185 5.20337 21.2402 5.02734C21.0616 4.85106 20.8173 4.75009 20.5605 4.75H6.90723C6.65037 4.75 6.40524 4.85098 6.22656 5.02734C6.04838 5.20336 5.9502 5.44001 5.9502 5.68457V19.0518L7.58691 17.4365C8.04823 16.9811 8.67203 16.7267 9.32031 16.7266H20.5605C20.8173 16.7265 21.0616 16.6255 21.2402 16.4492C21.4185 16.2732 21.5166 16.0366 21.5166 15.792V5.68457ZM23.0166 15.792C23.0166 16.4408 22.7556 17.0608 22.2939 17.5166C21.8326 17.972 21.2088 18.2265 20.5605 18.2266H9.32031C9.09545 18.2266 8.87996 18.3038 8.70996 18.4414L8.64062 18.5039L6.76172 20.3584C6.57148 20.5461 6.32948 20.6733 6.06836 20.7246C5.80739 20.7758 5.53645 20.7492 5.29004 20.6484C5.0436 20.5476 4.83171 20.3759 4.68164 20.1543C4.53151 19.9325 4.45027 19.671 4.4502 19.4023V5.68457C4.4502 5.03587 4.71129 4.41572 5.17285 3.95996C5.63429 3.50449 6.25881 3.25 6.90723 3.25H20.5605C21.2088 3.25009 21.8326 3.50457 22.2939 3.95996C22.7556 4.41574 23.0166 5.0358 23.0166 5.68457V15.792Z",
    ),
  );
  el.appendChild(
    filledPath(
      "M1.25 7.81793C1.25 7.16923 1.5111 6.54909 1.97266 6.09332C2.4341 5.63785 3.05861 5.38336 3.70703 5.38336C4.12108 5.38356 4.45703 5.71927 4.45703 6.13336C4.45703 6.54745 4.12108 6.88316 3.70703 6.88336C3.45018 6.88336 3.20505 6.98434 3.02637 7.16071C2.84819 7.33672 2.75 7.57337 2.75 7.81793V19.1304C3.02293 19.0188 3.34839 19.0755 3.56836 19.2984C3.85897 19.5932 3.85612 20.0681 3.56152 20.3589C3.37129 20.5467 3.12929 20.6729 2.86816 20.7242C2.60717 20.7754 2.33628 20.7497 2.08984 20.649C1.84341 20.5482 1.63154 20.3764 1.48145 20.1548C1.33122 19.933 1.25004 19.6707 1.25 19.4019V7.81793Z",
    ),
  );
  return el;
}
