import type { RemoteAssistDeps, RemoteAssistUi, RemoteAssistUiActions } from "./RemoteAssistController";

/**
 * The browser-only half of remote assistance: screenshot, live view recording,
 * consent UI and the per-tab grant storage. Browser entry points install it; the React Native
 * entry never imports it, so none of that code reaches a native bundle and
 * remote assistance stays off there.
 */
export interface RemoteAssistKit {
  capture: RemoteAssistDeps["capture"];
  /** The page can be recorded for the live view. */
  canRecord: () => boolean;
  record: NonNullable<RemoteAssistDeps["record"]>;
  loadUi: (actions: RemoteAssistUiActions, language: string | null | undefined) => Promise<RemoteAssistUi>;
  storage: () => Storage | null;
}

/** Id of the SDK's own remote-assistance UI root (left out of the live view). */
export const ROOT_ID = "ago-remote-assist";

let installed: RemoteAssistKit | null = null;

/** @internal Called by the browser entry points (`@useago/sdk`, `/react`, `/vue`, `/angular`, `/widget`). */
export function installRemoteAssistKit(kit: RemoteAssistKit): void {
  installed = kit;
}

/** @internal */
export function getRemoteAssistKit(): RemoteAssistKit | null {
  return installed;
}
