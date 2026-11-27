import { record } from "@rrweb/record";
import { AgoError } from "../client/errors";
import { maskSelector } from "./mask";
import { ROOT_ID } from "./kit";
import type { LiveRecorder } from "./liveStream";

/**
 * Record the page for the live view. The fields screenshots mask, the host's
 * `mask` selectors and the SDK's own UI are blocked (an empty box in the
 * replay); no canvas, fonts or inlined images. rrweb records one page at a
 * time, so only one recorder runs.
 */
export function startRecorder(emit: (event: unknown) => void, mask: readonly string[] = []): LiveRecorder {
  const blockSelector = maskSelector([...mask, `#${ROOT_ID}`], "remoteAssist.liveView.mask");
  const stop = record({
    emit,
    blockSelector,
    maskInputOptions: { password: true },
    recordCanvas: false,
    collectFonts: false,
    inlineImages: false,
    sampling: { mousemove: 50, scroll: 100, input: "last" },
  });
  if (!stop) {
    throw new AgoError("The page could not be recorded.", "remote_assist_live_view_unavailable");
  }
  return {
    stop,
    getNode: (id) => record.mirror.getNode(id),
    takeFullSnapshot: () => record.takeFullSnapshot(true),
  };
}
