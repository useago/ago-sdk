import { uiCatalog } from "../i18n";
import type { RemoteAssistUi, RemoteAssistUiActions } from "./RemoteAssistController";
import { createRemoteAssistUi } from "./ui";

/** Entry of the lazily loaded UI chunk: nothing here ships until a session is requested. */
export function loadRemoteAssistUi(
  actions: RemoteAssistUiActions,
  language: string | null | undefined,
): RemoteAssistUi {
  return createRemoteAssistUi(actions, uiCatalog(language).remoteAssist);
}
