import { describe, expect, it } from "vitest";
import { UI_CATALOGS, uiCatalog, withOverrides } from "../src/i18n";

function leaves(value: object, prefix = ""): Record<string, string> {
  return Object.assign({}, ...Object.entries(value).map(([key, item]) =>
    typeof item === "string" ? { [prefix + key]: item } : leaves(item, prefix + key + ".")));
}

describe("UI catalogs", () => {
  it.each(Object.keys(UI_CATALOGS))("covers all keys and template parameters in %s", (language) => {
    const english = leaves(UI_CATALOGS.en);
    const localized = leaves(uiCatalog(language));
    expect(Object.keys(localized).sort()).toEqual(Object.keys(english).sort());
    for (const [key, value] of Object.entries(localized)) {
      expect(value.trim(), key).not.toBe("");
      expect(value.match(/\{\w+\}/g) ?? [], key).toEqual(english[key].match(/\{\w+\}/g) ?? []);
    }
  });

  it("uses supported base languages, English fallback and defined overrides", () => {
    expect(uiCatalog("pt-PT")).toBe(UI_CATALOGS.pt);
    expect(uiCatalog("nl")).toBe(UI_CATALOGS.en);
    expect(uiCatalog(null)).toBe(UI_CATALOGS.en);
    expect(withOverrides(UI_CATALOGS.fr.form, { submit: undefined, subject: "Host" }))
      .toMatchObject({ submit: "Envoyer", subject: "Host" });
  });

});
