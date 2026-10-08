import type { TicketTextTranslation } from "./types";

export function ticketFieldText(
  text: string | null | undefined,
  translation: TicketTextTranslation | undefined,
  language: string | null,
): string {
  const original = text ?? "";
  if (!translation || original !== translation.source) return original;

  const requested = (language ?? "").toLowerCase().replace(/_/g, "-");
  let locale = requested;
  while (locale) {
    if (translation.values[locale] !== undefined) return translation.values[locale];
    const separator = locale.lastIndexOf("-");
    locale = separator < 0 ? "" : locale.slice(0, separator);
  }
  // Match AGO's base language codes, including "pt" for Brazilian Portuguese.
  if (!requested.includes("-")) {
    const preferred = ({ en: "en-us", pt: "pt-br" } as Record<string, string>)[requested];
    if (preferred && translation.values[preferred] !== undefined) return translation.values[preferred];
    const variants = Object.keys(translation.values).filter((code) => code.startsWith(`${requested}-`));
    if (variants.length === 1) return translation.values[variants[0]];
  }
  return translation.default ?? original;
}
