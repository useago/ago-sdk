/**
 * English defaults for the bubble widget's chrome strings, and the merge that
 * layers a partial `labels` option on top of them.
 */

import { uiCatalog, withOverrides } from "../i18n";
import type { MountChatWidgetOptions, WidgetLabels } from "./types";

export const DEFAULT_WIDGET_LABELS: WidgetLabels = {
  ...uiCatalog("en").widget, timeAgo: uiCatalog("en").timeAgo,
};

export function resolveLabels(
  overrides: MountChatWidgetOptions["labels"],
  language?: string | null,
): WidgetLabels {
  return {
    ...withOverrides(uiCatalog(language).widget, overrides),
    timeAgo: withOverrides(uiCatalog(language).timeAgo, overrides?.timeAgo),
  };
}
