import { AgoError } from "./errors";

/** Validate a host-supplied locale without limiting it to SDK interface bundles. */
export function normalizeLanguage(language: unknown): string | null {
  if (language === undefined || language === null) return null;
  if (typeof language === "string") {
    const tag = language.trim().replace(/_/g, "-");
    try {
      const [locale] = /^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/i.test(tag)
        ? Intl.getCanonicalLocales(tag)
        : [];
      if (locale) return locale;
    } catch {
      // Report the same actionable config error for all invalid values.
    }
  }
  throw new AgoError(
    'Use a language tag such as "fr", "de-DE", or "pt-BR", or null to clear it. ' +
      "See docs/general/configuration.md#language (config_invalid_language).",
    "config_invalid_language",
  );
}
