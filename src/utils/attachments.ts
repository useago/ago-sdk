import type { AgoAttachment } from "../client/types";

/**
 * Helpers for displaying uploaded file attachments securely, mirroring the main
 * AGO frontend. The rule everywhere: only files the backend has verified as a
 * safe image are embedded inline as an `<img>`; everything else renders as a
 * download link. Embedding an arbitrary uploaded file (or trusting a spoofed
 * `content_type`) is an XSS vector, so the SDK never does it.
 */

/**
 * MIME types the SDK is willing to render inline. Mirrors the backend's
 * `SAFE_IMAGE_TYPES`. SVG is deliberately excluded: an `image/svg+xml` file can
 * carry `<script>`. Used only for the optimistic local preview of a file the
 * user just picked; for server-loaded attachments the backend's `isSafeImage`
 * verdict (which also re-checks the real bytes) is what counts.
 */
const SAFE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
]);

/**
 * Allow only URL schemes that are safe to put in an `<img src>` / `<a href>`.
 * Presigned attachment URLs are `https:` and optimistic previews are `blob:`;
 * anything else (notably `javascript:`/`data:`) is rejected and the attachment
 * falls back to a plain, non-clickable label. Defense in depth against a bad URL
 * reaching the DOM.
 */
export function safeAttachmentUrl(url?: string): string | undefined {
  if (!url) return undefined;
  const base =
    typeof window !== "undefined" && window.location
      ? window.location.href
      : "https://ago.local/";
  try {
    const parsed = new URL(url, base);
    if (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "blob:"
    ) {
      return url;
    }
  } catch {
    // Unparseable URL — treat as unsafe.
  }
  return undefined;
}

/**
 * Whether an attachment may be embedded inline as an `<img>`. Secure by default:
 * requires the backend's `isSafeImage` verdict, an `image/*` content type, and a
 * safe URL. PDFs, documents, SVGs, and unverified/spoofed types all return false
 * and are shown as download links instead.
 */
export function canInlineImage(attachment: AgoAttachment): boolean {
  return (
    attachment.isSafeImage === true &&
    typeof attachment.contentType === "string" &&
    attachment.contentType.startsWith("image/") &&
    safeAttachmentUrl(attachment.url) !== undefined
  );
}

/** Human-readable file size (e.g. "12.3 KB"). Empty string when size is unknown. */
export function formatFileSize(bytes?: number): string {
  if (bytes == null || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * Map one backend SDK attachment payload (snake_case, presigned `file_url`) onto
 * the camelCase {@link AgoAttachment} the SDK uses everywhere.
 */
export function mapAttachment(raw: {
  id?: unknown;
  name?: unknown;
  content_type?: unknown;
  file_size?: unknown;
  file_url?: unknown;
  is_safe_image?: unknown;
}): AgoAttachment {
  return {
    id: String(raw.id ?? ""),
    name: typeof raw.name === "string" && raw.name ? raw.name : "file",
    contentType:
      typeof raw.content_type === "string" ? raw.content_type : undefined,
    fileSize: typeof raw.file_size === "number" ? raw.file_size : undefined,
    url: typeof raw.file_url === "string" ? raw.file_url : undefined,
    isSafeImage: raw.is_safe_image === true,
  };
}

/**
 * Build optimistic attachments from the `File` objects the user just picked, so
 * their upload shows on their own message immediately (before the server round
 * trip). Each gets a local `blob:` URL via `URL.createObjectURL`; image previews
 * are gated on {@link SAFE_IMAGE_TYPES} so the same "safe image only" rule holds
 * locally. The blob URLs live for the page session, matching the main frontend.
 */
export function attachmentsFromFiles(files: File[]): AgoAttachment[] {
  return files.map((file, index) => ({
    id: `local-${index}-${file.name}`,
    name: file.name,
    contentType: file.type || undefined,
    fileSize: file.size,
    url:
      typeof URL !== "undefined" && URL.createObjectURL
        ? URL.createObjectURL(file)
        : undefined,
    isSafeImage: SAFE_IMAGE_TYPES.has(file.type),
  }));
}
