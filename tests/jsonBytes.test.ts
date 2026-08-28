import { describe, expect, it } from "vitest";
import {
  byteLength,
  jsonStringBytes,
  sliceJsonStringToBytes,
} from "../src/utils/jsonBytes";

describe("JSON byte utilities", () => {
  it("measures UTF-8 rather than JavaScript string length", () => {
    expect(byteLength("abc")).toBe(3);
    expect(byteLength("é")).toBe(2);
    expect(byteLength("😀")).toBe(4);
  });

  it("includes JSON escaping but excludes the surrounding quotes", () => {
    expect(jsonStringBytes("plain")).toBe(5);
    expect(jsonStringBytes('"\\\n')).toBe(6);
    expect(jsonStringBytes("é")).toBe(2);
  });

  it("returns the complete string when it fits exactly", () => {
    const text = 'a"é😀';

    expect(sliceJsonStringToBytes(text, jsonStringBytes(text))).toBe(text);
  });

  it("returns the longest whole-code-point prefix that fits", () => {
    expect(sliceJsonStringToBytes("😀😀", 3)).toBe("");
    expect(sliceJsonStringToBytes("😀😀", 4)).toBe("😀");
    expect(sliceJsonStringToBytes("😀😀", 7)).toBe("😀");
    expect(sliceJsonStringToBytes("😀😀", 8)).toBe("😀😀");
  });

  it("accounts for escaped characters while slicing", () => {
    expect(sliceJsonStringToBytes('a"b', 2)).toBe("a");
    expect(sliceJsonStringToBytes('a"b', 3)).toBe('a"');
    expect(sliceJsonStringToBytes('a"b', 4)).toBe('a"b');
    expect(sliceJsonStringToBytes("anything", 0)).toBe("");
  });
});
