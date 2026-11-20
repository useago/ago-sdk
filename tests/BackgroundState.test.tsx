import React, { act, startTransition, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { AgoProvider, BackgroundState, createMockClient } from "../src/react";
import type { AgoMessage } from "../src/react";
import type { AgoClient } from "../src/client/AgoClient";

const message: AgoMessage = {
  id: "m", conversationId: "c", role: "assistant", status: "WAITING_APPROVAL",
  content: "", createdAt: new Date(),
  approval: { id: "a", status: "pending", actions: [{ name: "publish", arguments: { title: "Report" } }], allowedDecisions: ["approve", "reject"], expiresAt: null },
  progress: { steps: [{ name: "Draft", status: "completed", reason: null }], activity: [{ text: "Working", timestamp: null }], truncated: false },
};

async function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(node));
  return { container, root, render: async (next: React.ReactNode) => act(async () => root.render(next)) };
}

describe("BackgroundState public component", () => {
  it("renders passively without a client, uses overrides, and hides empty state", async () => {
    const view = await mount(<BackgroundState message={message} labels={{ approve: "Accept" }} className="custom" />);
    expect(view.container.textContent).toContain("Working");
    expect(view.container.textContent).toContain("Report");
    expect(view.container.querySelector(".custom")).not.toBeNull();
    const accept = Array.from(view.container.querySelectorAll("button")).find((button) => button.textContent === "Accept")!;
    expect(accept.disabled).toBe(true);
    await view.render(<BackgroundState message={{ ...message, status: "DONE", approval: undefined, progress: undefined }} />);
    expect(view.container.textContent).toBe("");
    await act(async () => view.root.unmount());
  });

  it.each(["direct", "provider"])("submits once via %s client and reports a failure", async (source) => {
    let reject!: (error: unknown) => void;
    const submit = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const client = createMockClient({ overrides: { submitApprovalDecision: submit } });
    const onError = vi.fn();
    const component = <BackgroundState message={message} client={source === "direct" ? client : undefined} onError={onError} />;
    const view = await mount(source === "provider" ? <AgoProvider client={client}>{component}</AgoProvider> : component);
    const button = view.container.querySelector("button")!;
    await act(async () => { button.click(); button.click(); });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith("a", "approve");
    expect(button.disabled).toBe(true);
    expect(view.container.querySelector('[role="status"]')).not.toBeNull();
    await act(async () => reject("offline"));
    expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
    expect(onError.mock.calls[0][0]).toEqual(new Error("offline"));
    expect(button.disabled).toBe(false);
    await act(async () => view.root.unmount());
  });

  it("keeps an accepted decision pending through progress updates until approval changes", async () => {
    const submit = vi.fn(async () => {});
    const client = createMockClient({ overrides: { submitApprovalDecision: submit } });
    const view = await mount(<BackgroundState message={message} client={client} />);
    await act(async () => view.container.querySelector("button")!.click());
    await view.render(<BackgroundState message={{ ...message, progress: { ...message.progress!, activity: [] } }} client={client} />);
    expect(view.container.querySelector("button")!.disabled).toBe(true);
    expect(view.container.querySelector('[role="status"]')).not.toBeNull();
    await view.render(<BackgroundState message={{ ...message, approval: { ...message.approval!, status: "approved", allowedDecisions: [] } }} client={client} />);
    expect(view.container.querySelector('[role="status"]')).toBeNull();
    expect(submit).toHaveBeenCalledTimes(1);
    await act(async () => view.root.unmount());
  });

  it("uses the client's language for labels without overrides", async () => {
    const client = createMockClient({ overrides: { getLanguage: () => "fr" } });
    const view = await mount(<BackgroundState message={message} client={client} labels={{ approve: "Accept" }} />);
    expect(view.container.textContent).toContain("Accept");
    expect(view.container.textContent).toContain("Refuser");
    await act(async () => view.root.unmount());
  });

  it.each(["replacement", "hidden"] as const)("reports a failure while approval controls are suspended (%s)", async (scenario) => {
    let reject!: (error: Error) => void;
    const client = createMockClient({
      overrides: { submitApprovalDecision: () => new Promise<void>((_resolve, fail) => { reject = fail; }) },
    });
    const onError = vi.fn();
    const suspended = new Promise<never>(() => {});
    function Suspend(): never { throw suspended; }
    function Harness({ client, suspend = false }: { client: AgoClient; suspend?: boolean }) {
      return (
        <React.StrictMode>
          <Suspense fallback="Loading">
            <BackgroundState message={message} client={client} onError={onError} />
            {suspend && <Suspend />}
          </Suspense>
        </React.StrictMode>
      );
    }

    const view = await mount(<Harness client={client} />);
    await act(async () => view.container.querySelector("button")!.click());
    if (scenario === "replacement") {
      const replacement = createMockClient();
      await act(async () => {
        startTransition(() => view.root.render(<Harness client={replacement} suspend />));
      });
      expect(view.container.querySelector("button")?.disabled).toBe(true);
    } else {
      await view.render(<Harness client={client} suspend />);
      expect(view.container.textContent).toContain("Loading");
    }
    const error = new Error("offline");
    await act(async () => reject(error));
    await view.render(<Harness client={client} />);
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(view.container.querySelector("button")?.disabled).toBe(false);
    await act(async () => view.root.unmount());
  });

  it.each(["message", "approval", "decisions", "client", "unmount"])("ignores a decision failure after %s changes", async (change) => {
    let reject!: (error: Error) => void;
    const client = createMockClient({ overrides: { submitApprovalDecision: () => new Promise<void>((_resolve, fail) => { reject = fail; }) } });
    const onError = vi.fn();
    const view = await mount(<BackgroundState message={message} client={client} onError={onError} />);
    await act(async () => view.container.querySelector("button")!.click());
    if (change === "unmount") await act(async () => view.root.unmount());
    else await view.render(<BackgroundState message={change === "client" ? message : change === "message" ? { ...message, id: "other" } : { ...message, approval: { ...message.approval!, ...(change === "approval" ? { id: "other" } : { allowedDecisions: [] }) } }} client={change === "client" ? createMockClient() : client} onError={onError} />);
    await act(async () => reject(new Error("offline")));
    expect(onError).not.toHaveBeenCalled();
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
    if (change !== "unmount") await act(async () => view.root.unmount());
  });
});


it("keeps pending approval open, collapses on resolution, and preserves manual reopening", async () => {
  const client = createMockClient();
  const view = await mount(<BackgroundState message={message} client={client} />);
  try {
    const details = () => view.container.querySelector<HTMLDetailsElement>("details")!;
    expect(details()).not.toBeNull();
    expect(details().open).toBe(true);
    const approved: AgoMessage = { ...message, status: "IN_PROGRESS", approval: { ...message.approval!, status: "approved", allowedDecisions: [] } };
    await view.render(<BackgroundState message={approved} client={client} />);
    expect(details().open).toBe(false);
    details().open = true;
    await view.render(<BackgroundState message={structuredClone(approved)} client={client} />);
    expect(details().open).toBe(true);
    await view.render(<BackgroundState message={{ ...message, approval: { ...message.approval!, id: "next-review" } }} client={client} />);
    expect(details().open).toBe(true);
  } finally { await act(async () => view.root.unmount()); }
});
