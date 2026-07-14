/**
 * Generate a random UUID, preferring `crypto.randomUUID` when available.
 * The fallback only needs uniqueness (client-side ids), not crypto strength,
 * and must stay bundleable for browsers (no `node:crypto` import).
 */
export function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
