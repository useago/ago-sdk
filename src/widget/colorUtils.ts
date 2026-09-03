/**
 * Pure color helpers for the widget's `colors` / `theme` options.
 *
 * Tenant-authored colors show up in every notation (`#rgb`, `#rrggbb`, `rgb()`,
 * `hsl()`, gradients), so parsing is lenient and every function degrades to a
 * safe default instead of throwing. No DOM access: these run at mount time and
 * in tests alike.
 */

/** Lighten a `#rrggbb` color by `percent` (0-100) toward white. */
export function lightenColor(color: string, percent: number): string {
  const hex = color.replace("#", "");
  const r = Number.parseInt(hex.substring(0, 2), 16);
  const g = Number.parseInt(hex.substring(2, 4), 16);
  const b = Number.parseInt(hex.substring(4, 6), 16);
  const lift = (n: number): number =>
    Math.min(255, Math.round(n + (255 - n) * (percent / 100)));
  const toHex = (n: number): string => n.toString(16).padStart(2, "0");
  return `#${toHex(lift(r))}${toHex(lift(g))}${toHex(lift(b))}`;
}

/** True for a six-digit hex color, with or without the leading `#`. */
export function isValidHexColor(color: string): boolean {
  return /^#?[0-9A-F]{6}$/i.test(color);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const hue = (((h % 360) + 360) % 360) / 60;
  const sector = hue | 0;
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  const [r, g, b] = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ][sector];
  const m = l - chroma / 2;
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

/**
 * Parse `#rgb`, `#rrggbb`, `rgb()`/`rgba()` or `hsl()`/`hsla()` into 0-255
 * channels. Returns null for anything else (named colors, `var()`, gradients).
 */
export function parseColorChannels(
  color: string,
): [number, number, number] | null {
  const value = color.trim();

  const hslMatch =
    /^hsla?\(\s*([\d.-]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i.exec(value);
  if (hslMatch) {
    const [h, sat, light] = hslMatch.slice(1, 4).map(Number);
    if ([h, sat, light].some(Number.isNaN)) return null;
    return hslToRgb(h, Math.min(sat, 100) / 100, Math.min(light, 100) / 100);
  }

  const rgbMatch = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(
    value,
  );
  if (rgbMatch) {
    const channels = rgbMatch.slice(1, 4).map(Number);
    if (channels.some((c) => Number.isNaN(c) || c < 0 || c > 255)) return null;
    return channels as [number, number, number];
  }

  const hex = value.replace("#", "");
  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return null;
  return [
    Number.parseInt(expanded.substring(0, 2), 16),
    Number.parseInt(expanded.substring(2, 4), 16),
    Number.parseInt(expanded.substring(4, 6), 16),
  ];
}

/** WCAG 2.1 relative luminance, 0 (black) to 1 (white). Null if unparseable. */
export function relativeLuminance(color: string): number | null {
  const channels = parseColorChannels(color);
  if (!channels) return null;
  const [r, g, b] = channels.map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio between two colors, 1 to 21. Null if either is unparseable. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const GRADIENT_PATTERN = /(?:repeating-)?(?:linear|radial|conic)-gradient\(/i;

/**
 * True when the value paints an image layer. Such a value belongs in the
 * `background` shorthand: `background-color` rejects it outright.
 */
export function isCssGradient(value: string | undefined): value is string {
  return !!value && GRADIENT_PATTERN.test(value);
}

/**
 * Every color token in a background value, in source order: gradient stops
 * across all layers, the trailing base color, and the fallbacks inside `var()`.
 */
export function backgroundColorTokens(value: string): string[] {
  return (
    value.match(/#[0-9a-f]{3,8}|(?:rgba?|hsla?)\([^()]*\)|\btransparent\b/gi) ??
    []
  );
}

/** True for stops that let the layer underneath show through. */
function isTransparentStop(color: string): boolean {
  const value = color.trim().toLowerCase();
  if (value === "transparent") return true;

  const slashAlpha = /\/\s*([\d.]+)%?\s*\)$/.exec(value);
  if (slashAlpha) return Number.parseFloat(slashAlpha[1]) === 0;

  const legacyAlpha = /^(?:rgba|hsla)\([^)]*,\s*([\d.]+)%?\s*\)$/.exec(value);
  if (legacyAlpha) return Number.parseFloat(legacyAlpha[1]) === 0;

  if (!value.startsWith("#")) return false;
  const hex = value.slice(1);
  if (!/^[0-9a-f]+$/.test(hex)) return false;
  if (hex.length === 8) return hex.slice(6) === "00";
  if (hex.length === 4) return hex[3] === "0";
  return false;
}

export const HEADER_TEXT_LIGHT = "#FFFFFF";
export const HEADER_TEXT_DARK = "#000000";

/** The near-white widget surface a translucent header stop composites over. */
const HEADER_SURFACE = "#FFFFFF";

/**
 * Pick a legible foreground for a tenant-chosen background, which may be a
 * solid color or a gradient. A gradient is judged by its least-contrasting
 * stop, since the text has to survive the whole sweep.
 *
 * Deliberately biased toward white: it flips to black only below 3:1, where
 * white stops being readable at all. Unparseable input (a `var()`, a named
 * color) keeps white, which is what the default dark header wants.
 */
export function readableTextColor(background: string | undefined): string {
  if (!background) return HEADER_TEXT_LIGHT;

  const tokens = isCssGradient(background)
    ? backgroundColorTokens(background)
    : [background];
  const candidates = tokens.some(isTransparentStop)
    ? [...tokens, HEADER_SURFACE]
    : tokens;

  const ratios = candidates
    .map((stop) => contrastRatio(stop, HEADER_TEXT_LIGHT))
    .filter((ratio): ratio is number => ratio !== null);
  if (!ratios.length) return HEADER_TEXT_LIGHT;

  return Math.min(...ratios) < 3 ? HEADER_TEXT_DARK : HEADER_TEXT_LIGHT;
}
