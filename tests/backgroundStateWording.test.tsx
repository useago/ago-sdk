import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { AgoMessage } from "../src/client/types";
import { createMockClient } from "../src/testing/createMockClient";
import labels from "../src/i18n/en";
import { BackgroundState } from "../src/react/components/BackgroundState";
import { renderBackgroundState } from "../src/widget/renderBackgroundState";

const message: AgoMessage = {
  id: "m", conversationId: "c", role: "assistant", status: "IN_PROGRESS",
  content: "", createdAt: new Date(),
  progress: { steps: ["One", "Two", "Three", "Four"].map((name) => ({ name, status: "completed" as const, reason: null })), activity: [], truncated: false },
};

describe.each(["React", "vanilla"])("%s background state wording", (renderer) => {
  it.each([
    [message, "In progress"],
    [{ ...message, status: "WAITING_APPROVAL" as const }, "Waiting for approval"],
    [{ ...message, status: "PAUSED" as const }, "Paused"],
    [{ ...message, status: "DONE" as const, outcome: "completed" as const }, "Completed"],
    [{ ...message, status: "DONE" as const, outcome: "incomplete" as const }, "Incomplete"],
  ])("uses the response status independently of checklist completion", async (current, expected) => {
    const container = document.createElement("div");
    const root = renderer === "React" ? createRoot(container) : null;
    if (root) {
      await act(async () => root.render(<BackgroundState message={current} client={createMockClient()} labels={labels.backgroundState} />));
    } else {
      container.appendChild(renderBackgroundState(current, labels.backgroundState, false, false, () => {})!);
    }
    const state = container.querySelector(".ago-background-state")!;
    expect(state.firstElementChild?.textContent).toContain(expected);
    expect(state.textContent).toContain("4/4 checklist steps completed");
    expect(state.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("4");
    if (root) await act(async () => root.unmount());
  });
});
