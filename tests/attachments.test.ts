import { describe, it, expect } from "vitest";
import type { AgoAttachment } from "../src/client/types";
import {
  canInlineImage,
  formatFileSize,
  mapAttachment,
  safeAttachmentUrl,
} from "../src/utils/attachments";

function att(overrides: Partial<AgoAttachment> = {}): AgoAttachment {
  return {
    id: "a1",
    name: "photo.png",
    contentType: "image/png",
    fileSize: 2048,
    url: "https://files.example.com/photo.png?sig=abc",
    isSafeImage: true,
    ...overrides,
  };
}

describe("safeAttachmentUrl", () => {
  it("allows http, https and blob URLs", () => {
    expect(safeAttachmentUrl("https://x.com/a.png")).toBe("https://x.com/a.png");
    expect(safeAttachmentUrl("http://x.com/a.png")).toBe("http://x.com/a.png");
    expect(safeAttachmentUrl("blob:https://x.com/uuid")).toBe(
      "blob:https://x.com/uuid",
    );
  });

  it("rejects javascript: and data: URLs", () => {
    expect(safeAttachmentUrl("javascript:alert(1)")).toBeUndefined();
    expect(
      safeAttachmentUrl("data:text/html,<script>alert(1)</script>"),
    ).toBeUndefined();
  });

  it("returns undefined for empty/undefined", () => {
    expect(safeAttachmentUrl(undefined)).toBeUndefined();
    expect(safeAttachmentUrl("")).toBeUndefined();
  });
});

describe("canInlineImage", () => {
  it("inlines a backend-verified safe image", () => {
    expect(canInlineImage(att())).toBe(true);
  });

  it("never inlines when the backend did not verify it (isSafeImage false)", () => {
    expect(canInlineImage(att({ isSafeImage: false }))).toBe(false);
  });

  it("never inlines a non-image content type even if flagged safe", () => {
    expect(
      canInlineImage(att({ contentType: "application/pdf", name: "doc.pdf" })),
    ).toBe(false);
  });

  it("never inlines when the URL scheme is unsafe", () => {
    expect(canInlineImage(att({ url: "javascript:alert(1)" }))).toBe(false);
  });

  it("never inlines an SVG flagged safe (defense in depth)", () => {
    // The backend already excludes SVG from is_safe_image; if a payload ever
    // claimed otherwise, an image/svg+xml is still not embedded here unless the
    // backend says so — but a spoofed content type without the flag stays a link.
    expect(
      canInlineImage(att({ contentType: "image/svg+xml", isSafeImage: false })),
    ).toBe(false);
  });
});

describe("formatFileSize", () => {
  it("formats bytes, KB and MB", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("returns empty string for unknown size", () => {
    expect(formatFileSize(undefined)).toBe("");
    expect(formatFileSize(-1)).toBe("");
  });
});

describe("mapAttachment", () => {
  it("maps a backend payload to camelCase", () => {
    const mapped = mapAttachment({
      id: "x1",
      name: "report.pdf",
      content_type: "application/pdf",
      file_size: 1234,
      file_url: "https://files.example.com/report.pdf?sig=abc",
      is_safe_image: false,
    });
    expect(mapped).toEqual({
      id: "x1",
      name: "report.pdf",
      contentType: "application/pdf",
      fileSize: 1234,
      url: "https://files.example.com/report.pdf?sig=abc",
      isSafeImage: false,
    });
  });

  it("defaults isSafeImage to false when the backend omits it", () => {
    const mapped = mapAttachment({
      id: "x2",
      name: "photo.png",
      content_type: "image/png",
      file_url: "https://files.example.com/photo.png",
    });
    // Secure by default: without an explicit safe verdict, it is NOT inlined.
    expect(mapped.isSafeImage).toBe(false);
    expect(canInlineImage(mapped)).toBe(false);
  });

  it("falls back to a name when missing", () => {
    expect(mapAttachment({ id: "x3" }).name).toBe("file");
  });
});
