import { uiLanguage } from "../client/language";
import en from "./en";
import fr from "./fr";
import de from "./de";
import es from "./es";
import it from "./it";
import pt from "./pt";
import type { UiCatalog } from "./types";

export const UI_CATALOGS = { en, fr, de, es, it, pt };

export function uiCatalog(language?: string | null): UiCatalog {
  return UI_CATALOGS[uiLanguage(language)];
}

/** Undefined host properties leave the selected language's defaults intact. */
export function withOverrides<T extends object>(defaults: T, overrides?: Partial<T>): T {
  return { ...defaults, ...Object.fromEntries(
    Object.entries(overrides ?? {}).filter(([, value]) => value !== undefined),
  ) };
}
