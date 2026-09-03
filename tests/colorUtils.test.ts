import { describe, expect, it } from "vitest";
import {
  backgroundColorTokens,
  contrastRatio,
  isCssGradient,
  isValidHexColor,
  lightenColor,
  parseColorChannels,
  readableTextColor,
} from "../src/widget/colorUtils";

describe("readableTextColor", () => {
  it("keeps white on the default dark brand", () => {
    expect(readableTextColor("#03182f")).toBe("#FFFFFF");
  });

  it("flips to black on a white header", () => {
    expect(readableTextColor("#ffffff")).toBe("#000000");
  });

  it("keeps white on the reference launcher blue (about 4:1)", () => {
    expect(readableTextColor("#007bff")).toBe("#FFFFFF");
  });

  it("flips to black on a bright yellow", () => {
    expect(readableTextColor("#ffeb3b")).toBe("#000000");
  });

  it("parses rgb() and hsl() notations", () => {
    expect(readableTextColor("rgb(3, 24, 47)")).toBe("#FFFFFF");
    expect(readableTextColor("hsl(211 88% 9.8%)")).toBe("#FFFFFF");
    expect(readableTextColor("hsl(0, 0%, 100%)")).toBe("#000000");
  });

  it("judges a gradient by its least contrasting stop", () => {
    expect(
      readableTextColor("linear-gradient(90deg, #03182f, #ffffff)"),
    ).toBe("#000000");
    expect(
      readableTextColor("linear-gradient(90deg, #03182f, #1b5fc4)"),
    ).toBe("#FFFFFF");
  });

  it("composites a transparent stop over the white surface", () => {
    expect(
      readableTextColor("linear-gradient(transparent, #03182f)"),
    ).toBe("#000000");
  });

  it("falls back to white for missing or unparseable input", () => {
    expect(readableTextColor(undefined)).toBe("#FFFFFF");
    expect(readableTextColor("var(--brand)")).toBe("#FFFFFF");
    expect(readableTextColor("garbage")).toBe("#FFFFFF");
  });
});

describe("contrastRatio", () => {
  it("is symmetric and maxes out at 21 for black on white", () => {
    const a = contrastRatio("#000000", "#ffffff");
    const b = contrastRatio("#ffffff", "#000000");
    expect(a).toBeCloseTo(21, 5);
    expect(b).toBeCloseTo(21, 5);
  });

  it("returns null when a side is unparseable", () => {
    expect(contrastRatio("#000", "nope")).toBeNull();
  });
});

describe("parseColorChannels", () => {
  it("expands 3-digit hex", () => {
    expect(parseColorChannels("#fff")).toEqual([255, 255, 255]);
  });

  it("rejects out-of-range rgb", () => {
    expect(parseColorChannels("rgb(300, 0, 0)")).toBeNull();
  });
});

describe("gradient helpers", () => {
  it("detects gradients", () => {
    expect(isCssGradient("linear-gradient(#000, #fff)")).toBe(true);
    expect(isCssGradient("repeating-radial-gradient(#000, #fff)")).toBe(true);
    expect(isCssGradient("#000")).toBe(false);
    expect(isCssGradient(undefined)).toBe(false);
  });

  it("extracts every color token in order", () => {
    expect(
      backgroundColorTokens(
        "linear-gradient(90deg, #03182f 0%, rgba(0,0,0,0.5) 50%, transparent), #fff",
      ),
    ).toEqual(["#03182f", "rgba(0,0,0,0.5)", "transparent", "#fff"]);
  });
});

describe("lightenColor / isValidHexColor", () => {
  it("lightens toward white", () => {
    expect(lightenColor("#000000", 10)).toBe("#1a1a1a");
    expect(lightenColor("ffffff", 50)).toBe("#ffffff");
  });

  it("validates six-digit hex only", () => {
    expect(isValidHexColor("#03182F")).toBe(true);
    expect(isValidHexColor("03182f")).toBe(true);
    expect(isValidHexColor("#fff")).toBe(false);
    expect(isValidHexColor("rgb(0,0,0)")).toBe(false);
  });
});
