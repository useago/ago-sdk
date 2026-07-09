import { useCallback, useEffect, useRef, useState } from "react";
import type { AgoClient } from "../../client/AgoClient";
import { AgoError } from "../../client/errors";
import type {
  ClientFunctionInvocation,
  Conversation,
  FormSchema,
  ToolCallData,
} from "../../client/types";
import { useOptionalAgoClient } from "../context/AgoContext";

/**
 * The kind of thing the agent is doing, normalized across the two wire sources
 * (tool calls and client-function invocations) into one vocabulary the UI can
 * switch on.
 */
export type AgoActivityKind =
  | "navigation" // navigateToPage — "Navigating to …"
  | "action" // any other client function — "Updating …", "Opening …"
  | "status" // status_message / mcp_ui_resource
  | "progress" // progress_indicator
  | "reasoning" // the model's chain-of-thought
  | "confirmation" // confirmation_input — needs a yes/no
  | "form"; // form — needs field input

/** Where the item is in its lifecycle. */
export type AgoActivityStatus =
  | "running"
  | "done"
  | "error"
  | "awaiting-approval"
  | "rejected";

/**
 * One normalized entry in the agent's activity feed. Merges a tool call
 * (`toolCall:received`) or a client-function invocation (`function:invoke` /
 * `function:awaiting-approval` / `function:result`) into a single shape.
 */
export interface AgoActivityItem {
  /** Stable id — the tool-call id or the function invocationId. */
  id: string;
  kind: AgoActivityKind;
  /** Human label, e.g. "Navigating to Products". Override via `labelFor`. */
  label: string;
  status: AgoActivityStatus;
  /** The assistant message this activity belongs to (when known). */
  messageId?: string;
  toolName?: string;
  toolDisplayName?: string;
  functionName?: string;
  arguments?: Record<string, unknown>;
  message?: string;
  data?: Record<string, unknown>;
  formSchema?: FormSchema;
  /** True when this item waits on the user before it runs. */
  requiresApproval: boolean;
  createdAt: Date;
}

export interface UseAgoActivityOptions {
  /** The AGO client. If omitted, reads from AgoProvider context. */
  client?: AgoClient;
  /**
   * Include the model's `reasoning` items in the feed. Off by default — the
   * chain-of-thought is noisy for an activity display.
   */
  includeReasoning?: boolean;
  /**
   * Override the default label for an item. Return a string to replace it, or
   * `undefined` to keep the default. Use this to map route names / function
   * names to friendly copy, e.g. `navigateToPage` → "Navigating to Products".
   */
  labelFor?: (item: AgoActivityItem) => string | undefined;
}

export interface UseAgoActivityResult {
  /** Time-ordered activity for the current/most-recent turn. */
  items: AgoActivityItem[];
  /** The most recent item — handy for a collapsed "latest action" line. */
  latest?: AgoActivityItem;
  /** True while any item is waiting on the user (approval or form). */
  isAwaitingApproval: boolean;
  /** Approve an awaiting item (client function or confirmation). */
  approve: (id: string) => Promise<void>;
  /** Reject an awaiting item (client function or confirmation). */
  reject: (id: string) => Promise<void>;
  /** Submit form data for a `form` item. */
  submitForm: (id: string, values: Record<string, unknown>) => Promise<void>;
  /** Drop all items (e.g. when starting a new conversation). */
  clear: () => void;
}

const AWAITING_STATUSES = new Set<AgoActivityStatus>([
  "awaiting-approval",
]);

/** Map a tool-call `type` to an activity kind. */
function kindForToolCall(type: ToolCallData["type"]): AgoActivityKind {
  switch (type) {
    case "progress_indicator":
      return "progress";
    case "reasoning":
      return "reasoning";
    case "confirmation_input":
      return "confirmation";
    case "form":
      return "form";
    // status_message, mcp_ui_resource, and anything unknown read as status.
    default:
      return "status";
  }
}

/**
 * Kind for a full tool-call record — like {@link kindForToolCall} but also
 * resolves persisted `client_function` calls (navigation vs other action),
 * which the live stream surfaces separately and never tags as tool calls.
 */
function kindForToolCallData(tc: ToolCallData): AgoActivityKind {
  if (tc.type === "client_function") {
    return tc.functionName === "navigateToPage" ? "navigation" : "action";
  }
  return kindForToolCall(tc.type);
}

/**
 * Normalize the many backend/SDK status spellings (WAITING_INPUT, RUNNING,
 * DONE, completed, failed, REJECTED…) onto the activity status enum.
 */
function normalizeToolCallStatus(
  raw: string | undefined,
  kind: AgoActivityKind
): AgoActivityStatus {
  const s = (raw ?? "").toLowerCase();
  if (s.includes("reject")) return "rejected";
  if (s.includes("error") || s.includes("fail")) return "error";
  if (s.includes("done") || s.includes("complet")) return "done";
  if (s.includes("waiting") || s.includes("pending")) {
    return kind === "confirmation" || kind === "form"
      ? "awaiting-approval"
      : "running";
  }
  return "running";
}

/** Title-case a route/page key like "chatThreads" → "Chat Threads". */
function prettifyKey(value: unknown): string {
  if (typeof value !== "string" || !value) return "page";
  return value
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Default label when the consumer doesn't override via `labelFor`. */
function defaultLabel(item: AgoActivityItem): string {
  switch (item.kind) {
    case "navigation":
      return `Navigating to ${prettifyKey(item.arguments?.page)}`;
    case "action":
      if (item.functionName === "setPageState") return "Updating the page";
      if (item.functionName === "openFilteredConversations")
        return "Opening conversations";
      return (
        item.toolDisplayName ||
        item.message ||
        prettifyKey(item.functionName) ||
        "Working"
      );
    case "progress":
      return item.message || "Working";
    case "reasoning":
      return item.message || "Thinking";
    case "confirmation":
      return item.message || "Waiting for your confirmation";
    case "form":
      return item.message || item.toolDisplayName || "Please fill in the form";
    default:
      return item.message || item.toolDisplayName || item.toolName || "Working";
  }
}

/**
 * A live, normalized feed of what the agent is doing — navigations, state
 * changes, forms, confirmations, status, progress — plus the controls to
 * approve/reject/submit the items that wait on the user.
 *
 * Client functions surface via `function:invoke` (they're filtered out of
 * `toolCall:received`); everything else via `toolCall:received`. Reasoning is
 * suppressed unless `includeReasoning` is set. Approvals require the client's
 * approval gate (`AgoConfig.approvalPolicy` / `requiresApproval`, pause mode).
 *
 * ```tsx
 * const { items, latest, approve, reject } = useAgoActivity({
 *   labelFor: (i) =>
 *     i.kind === "navigation" ? routeLabels[i.arguments?.page as string] : undefined,
 * });
 * ```
 */
export function useAgoActivity(
  options: UseAgoActivityOptions = {}
): UseAgoActivityResult {
  const { includeReasoning = false, labelFor } = options;
  const contextClient = useOptionalAgoClient();
  const client = options.client || contextClient;

  if (!client) {
    throw new AgoError(
      "useAgoActivity requires an AgoClient. Either pass it as options.client or wrap your app in <AgoProvider>.",
      "provider_missing_client"
    );
  }

  const [items, setItems] = useState<AgoActivityItem[]>([]);

  // Ids already approved/rejected this session. Guards against a double-click or
  // a race (approve then reject) resolving inconsistently: the client drains the
  // pending approval on the first call, so the second would be a silent no-op
  // that still flipped the optimistic UI status. Checked synchronously, so it
  // holds even before React commits the optimistic state update.
  const actedRef = useRef<Set<string>>(new Set());

  // The assistant message the current turn's events belong to. A ref (not an
  // effect-local `let`) so it survives across renders and any listener
  // re-subscribe — otherwise an inline `labelFor` (the documented usage) would
  // reset it mid-turn and strand items with `messageId: undefined`.
  const currentMessageIdRef = useRef<string | undefined>(undefined);

  // Latest `labelFor` read through a ref so `upsert` (and the listener effect)
  // stay identity-stable regardless of the caller passing an inline arrow.
  const labelForRef = useRef(labelFor);
  labelForRef.current = labelFor;

  // Upsert an item by id: patch the existing one (preserving createdAt and
  // re-deriving the label) or append a new one, keeping insertion order.
  const upsert = useCallback(
    (id: string, patch: Omit<Partial<AgoActivityItem>, "id" | "label">) => {
      setItems((prev) => {
        const index = prev.findIndex((it) => it.id === id);
        const base: AgoActivityItem =
          index >= 0
            ? prev[index]
            : {
                id,
                kind: "status",
                label: "",
                status: "running",
                requiresApproval: false,
                createdAt: new Date(),
              };
        const draft: AgoActivityItem = { ...base, ...patch };
        draft.label = labelForRef.current?.(draft) ?? defaultLabel(draft);
        if (index >= 0) {
          return [
            ...prev.slice(0, index),
            draft,
            ...prev.slice(index + 1),
          ];
        }
        return [...prev, draft];
      });
    },
    []
  );

  useEffect(() => {
    const onStart = (data: { messageId: string }) => {
      currentMessageIdRef.current = data.messageId;
    };

    const onToolCall = (tc: ToolCallData) => {
      const kind = kindForToolCall(tc.type);
      if (kind === "reasoning" && !includeReasoning) return;
      upsert(tc.id, {
        kind,
        status: normalizeToolCallStatus(tc.status, kind),
        messageId: currentMessageIdRef.current,
        toolName: tc.toolName,
        toolDisplayName: tc.toolDisplayName,
        message: tc.message,
        data: tc.data,
        formSchema: tc.formSchema,
        requiresApproval: kind === "confirmation" || kind === "form",
      });
    };

    const onFunctionInvoke = (data: ClientFunctionInvocation) => {
      if (!data.invocationId) return; // placeholder mode carries no id to key on
      upsert(data.invocationId, {
        kind: data.functionName === "navigateToPage" ? "navigation" : "action",
        status: "running",
        messageId: currentMessageIdRef.current,
        functionName: data.functionName,
        arguments: data.arguments,
      });
    };

    const onAwaitingApproval = (data: ClientFunctionInvocation) => {
      if (!data.invocationId) return;
      upsert(data.invocationId, {
        kind: data.functionName === "navigateToPage" ? "navigation" : "action",
        status: "awaiting-approval",
        messageId: currentMessageIdRef.current,
        functionName: data.functionName,
        arguments: data.arguments,
        requiresApproval: true,
      });
    };

    const onFunctionResult = (data: {
      invocationId: string;
      result: unknown;
      error?: string;
    }) => {
      if (!data.invocationId) return;
      // Only the client's rejectFunction produces this exact shape. Keying on
      // `approved: false` alone would mislabel a handler that legitimately
      // returns `{ approved: false }` as business data (e.g. an eligibility
      // check) as a user rejection.
      const result = data.result as Record<string, unknown> | null;
      const rejected =
        typeof data.result === "object" &&
        result !== null &&
        result.approved === false &&
        result.reason === "user_rejected";
      upsert(data.invocationId, {
        status: data.error ? "error" : rejected ? "rejected" : "done",
        requiresApproval: false,
      });
    };

    // Rebuild the feed from a restored conversation's persisted tool calls, so
    // activity survives a page refresh (the SDK emits this on getConversation).
    // Persisted client-function calls DO appear in `toolCalls` here (unlike the
    // live stream, which routes them through function:invoke).
    const onConversationLoaded = (conversation: Conversation) => {
      for (const message of conversation.messages ?? []) {
        if (message.role !== "assistant") continue;
        for (const tc of message.toolCalls ?? []) {
          const kind = kindForToolCallData(tc);
          if (kind === "reasoning" && !includeReasoning) continue;
          // Skip calls still awaiting the user (WAITING_INPUT/WAITING_CONFIRMATION):
          // a cold reload can't re-arm the approval gate (the pending invocation is
          // gone and the page function may not be registered), so rendering them
          // would be a dead card or a never-ending spinner. Restore resolved steps
          // only; the turn is still paused server-side and continues on the next
          // message (or via the opt-in resumePendingClientFunctions).
          if (/waiting/i.test(tc.status ?? "")) continue;
          upsert(tc.id, {
            kind,
            status: normalizeToolCallStatus(tc.status, kind),
            messageId: message.id,
            toolName: tc.toolName,
            toolDisplayName: tc.toolDisplayName,
            functionName: tc.functionName,
            arguments: tc.arguments,
            message: tc.message,
            data: tc.data,
            formSchema: tc.formSchema,
            requiresApproval: kind === "confirmation" || kind === "form",
          });
        }
      }
    };

    // When the turn ends, settle anything still shown as running.
    const settleRunning = (status: AgoActivityStatus) => {
      setItems((prev) =>
        prev.map((it) =>
          it.status === "running" || it.status === "awaiting-approval"
            ? { ...it, status }
            : it
        )
      );
    };
    const onComplete = () => settleRunning("done");
    const onError = () => settleRunning("error");

    client.on("message:start", onStart);
    client.on("toolCall:received", onToolCall);
    client.on("function:invoke", onFunctionInvoke);
    client.on("function:awaiting-approval", onAwaitingApproval);
    client.on("function:result", onFunctionResult);
    client.on("conversation:loaded", onConversationLoaded);
    client.on("message:complete", onComplete);
    client.on("message:error", onError);

    return () => {
      client.off("message:start", onStart);
      client.off("toolCall:received", onToolCall);
      client.off("function:invoke", onFunctionInvoke);
      client.off("function:awaiting-approval", onAwaitingApproval);
      client.off("function:result", onFunctionResult);
      client.off("conversation:loaded", onConversationLoaded);
      client.off("message:complete", onComplete);
      client.off("message:error", onError);
    };
  }, [client, includeReasoning, upsert]);

  const approve = useCallback(
    async (id: string) => {
      const item = items.find((it) => it.id === id);
      // Only act on an item still awaiting the user, and only once per id.
      if (!item || item.status !== "awaiting-approval" || actedRef.current.has(id))
        return;
      // A form carries field values that must go through submitForm — the
      // confirm endpoint would submit nothing. Callers approve forms via
      // submitForm, not here.
      if (item.kind === "form") return;
      actedRef.current.add(id);
      // Optimistically clear the wait so the UI responds instantly.
      upsert(id, { status: "running", requiresApproval: false });
      if (item.functionName) {
        await client.approveFunction(id);
      } else {
        await client.confirmToolCall(id);
      }
    },
    [client, items, upsert]
  );

  const reject = useCallback(
    async (id: string) => {
      const item = items.find((it) => it.id === id);
      if (!item || item.status !== "awaiting-approval" || actedRef.current.has(id))
        return;
      actedRef.current.add(id);
      upsert(id, { status: "rejected", requiresApproval: false });
      if (item.functionName) {
        await client.rejectFunction(id);
      } else {
        await client.rejectToolCall(id);
      }
    },
    [client, items, upsert]
  );

  const submitForm = useCallback(
    async (id: string, values: Record<string, unknown>) => {
      upsert(id, { status: "running", requiresApproval: false });
      await client.submitToolCallForm(id, values);
      upsert(id, { status: "done" });
    },
    [client, upsert]
  );

  const clear = useCallback(() => {
    actedRef.current.clear();
    setItems([]);
  }, []);

  return {
    items,
    latest: items.length > 0 ? items[items.length - 1] : undefined,
    isAwaitingApproval: items.some((it) => AWAITING_STATUSES.has(it.status)),
    approve,
    reject,
    submitForm,
    clear,
  };
}
