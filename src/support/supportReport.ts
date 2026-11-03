import type { AgoClient } from "../client/AgoClient";
import { capturePage, type CapturePageOptions } from "./capturePage";

export interface SupportEvidenceOptions {
  /** Off by default. true captures the viewport; options can limit the capture. */
  screenshot?: boolean | CapturePageOptions;
}

export interface SupportEvidence {
  files: File[];
  /** Screenshot failures don't discard the error log. */
  screenshotError?: string;
}

/** Export the watcher's retained, filtered errors and optionally capture the page. */
export async function collectSupportEvidence(
  client: Pick<AgoClient, "getRecentErrors">,
  options: SupportEvidenceOptions = {},
): Promise<SupportEvidence> {
  const report = {
    capturedAt: new Date().toISOString(),
    path: typeof window === "undefined" ? undefined : window.location.pathname,
    errors: client.getRecentErrors(),
  };
  const evidence: SupportEvidence = {
    files: [new File([JSON.stringify(report, null, 2)], "errors.json", { type: "application/json" })],
  };
  if (options.screenshot) {
    try {
      evidence.files.push(await capturePage(options.screenshot === true ? {} : options.screenshot));
    } catch (error) {
      evidence.screenshotError = error instanceof Error ? error.message : String(error);
    }
  }
  return evidence;
}
