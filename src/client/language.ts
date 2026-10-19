import { AgoError } from "./errors";

const UI_LANGUAGES = ["en", "fr", "de", "es", "it", "pt"] as const;
export type UiLanguage = typeof UI_LANGUAGES[number];

export function uiLanguage(language?: string | null): UiLanguage {
  const base = language?.toLowerCase().split(/[-_]/)[0];
  return UI_LANGUAGES.find((locale) => locale === base) ?? "en";
}

export function formConfigLanguage(language?: string | null): string {
  const locale = normalizeLanguage(language);
  return locale && UI_LANGUAGES.some((base) => locale.split("-")[0] === base) ? locale : "en";
}

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
