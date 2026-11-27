import { installRemoteAssistKit, type RemoteAssistKit } from "./kit";

const browserKit: RemoteAssistKit = {
  capture: (options) => import("./screenshot").then((m) => m.captureViewport(options)),
  canRecord: () => typeof document !== "undefined" && typeof MutationObserver !== "undefined",
  record: (emit, mask) => import("./recorder").then((m) => m.startRecorder(emit, mask)),
  loadUi: (actions, language) =>
    import("./loadUi").then((m) => m.loadRemoteAssistUi(actions, language)),
  storage: () => (typeof sessionStorage !== "undefined" ? sessionStorage : null),
};

/** @internal Enable remote assistance in a browser entry point. */
export function enableBrowserRemoteAssist(): void {
  installRemoteAssistKit(browserKit);
}
