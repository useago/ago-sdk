import { useEffect, useRef, useState } from "react";
import type { AgoClient } from "../../client/AgoClient";
import type { AgoMessage, MessageApproval } from "../../client/types";
import type { UiCatalog } from "../../i18n/types";
import { withOverrides } from "../../i18n";
import { useOptionalAgoClient } from "../context/AgoContext";
import { useUiCatalog } from "../hooks/useUiCatalog";

export type BackgroundStateLabels = UiCatalog["backgroundState"];

export interface BackgroundStateProps {
  /** The message whose background work to display. */
  message: AgoMessage;
  /** The AGO client. If omitted, reads from AgoProvider context. */
  client?: AgoClient;
  /** Override individual labels from the selected language. */
  labels?: Partial<BackgroundStateLabels>;
  /** Called when an approval decision fails. */
  onError?: (error: Error) => void;
  className?: string;
}

/**
 * Render a message's background progress, outcome, and approval decisions.
 * The caller supplies updated messages; this component does not observe them.
 * Without a client or provider, approval buttons are disabled. After a decision
 * succeeds, buttons remain disabled until its identity, status, or decisions change.
 */
export function BackgroundState({ message, client, labels: overrides, onError, className = "" }: BackgroundStateProps) {
  const contextClient = useOptionalAgoClient();
  const resolvedClient = client ?? contextClient;
  const labels = withOverrides(useUiCatalog(resolvedClient).backgroundState, overrides);
  const approval = message.approval;
  const [clientScope, setClientScope] = useState({ client: resolvedClient, revision: 0 });
  if (clientScope.client !== resolvedClient) {
    setClientScope({ client: resolvedClient, revision: clientScope.revision + 1 });
  }

  const progress = message.progress;
  const statusLabels: Record<string, string> = {
    pending: labels.pending,
    in_progress: labels.inProgress,
    completed: labels.completed,
    failed: labels.failed,
    not_completed: labels.notCompleted,
  };
  const approvalLabels = {
    pending: labels.waiting,
    approved: labels.approved,
    rejected: labels.rejected,
    expired: labels.expired,
  };
  if (
    !progress &&
    !approval &&
    !message.outcome &&
    message.status !== "PAUSED" &&
    message.status !== "WAITING_APPROVAL"
  ) return null;

  const steps = progress?.steps ?? [];
  const completed = steps.filter((step) => step.status === "completed").length;
  const header = message.outcome ? labels[message.outcome] :
    message.status === "WAITING_APPROVAL" ? labels.waiting :
    message.status === "PAUSED" ? labels.paused : labels.inProgress;
  const marker: Record<string, string> = {
    pending: "○", in_progress: "◉", completed: "✓", failed: "!", not_completed: "−",
  };

  return (
    <div
      className={`ago-background-state ${className}`}
      style={{
        maxWidth: "100%", minWidth: 0, overflowWrap: "anywhere",
        color: "var(--ago-text-color, #30373e)", fontSize: 13,
        border: "1px solid var(--ago-border-color, #dee3e8)",
        borderRadius: "var(--ago-radius, 16px)",
        background: "var(--ago-panel-background, #fff)", padding: 12, marginBlock: 8,
      }}
    >
      <div style={{ fontWeight: 600, display: "flex", gap: 8, alignItems: "center" }}>
        <span aria-hidden="true" style={{ color: "var(--ago-accent-color, #1b5fc4)" }}>
          {message.outcome === "completed" ? "✓" : message.outcome ? "!" : "◉"}
        </span>
        {header}
      </div>
      {approval && (approval.actions.length > 0 || approval.allowedDecisions.length > 0) && (
        <details
          key={JSON.stringify([clientScope.revision, message.id, approval.id])}
          className="ago-background-state__approval"
          open={approval.status === "pending"}
          aria-label={labels.approval}
          style={{
            border: "1px solid var(--ago-border-color, #dee3e8)",
            borderRadius: 8,
            padding: 10,
            marginBlock: 8,
          }}
        >
          <summary style={{ fontWeight: 600, cursor: "pointer", minHeight: 44, alignContent: "center" }}>
            {labels.approval} · {approvalLabels[approval.status]}
          </summary>
          {approval.actions.map((action, index) => (
            <div key={index}>
              <strong>{action.name}</strong>
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxWidth: "100%" }}>
                {JSON.stringify(action.arguments, null, 2)}
              </pre>
            </div>
          ))}
          <ApprovalDecisions
            key={JSON.stringify([clientScope.revision, message.id, approval.id, approval.status, approval.allowedDecisions])}
            client={resolvedClient}
            approval={approval}
            labels={labels}
            onError={onError}
          />
        </details>
      )}
      {progress && (
        <section aria-label={labels.progress} style={{ marginTop: 10 }}>
          {steps.length > 0 && (
            <>
              <div role="progressbar" aria-label={labels.progress} aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={completed}
                style={{ height: 6, borderRadius: 6, background: "var(--ago-border-color, #dee3e8)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${completed / steps.length * 100}%`, background: "var(--ago-accent-color, #1b5fc4)" }} />
              </div>
              <div style={{ marginTop: 5, color: "var(--ago-muted-text-color, #6b6d6f)" }}>{labels.checklistCount.replace("{completed}", String(completed)).replace("{total}", String(steps.length))}</div>
              <div style={{ fontWeight: 600, marginTop: 10 }}>{labels.progress}</div>
              <ol style={{ listStyle: "none", margin: "4px 0 0", padding: 0 }}>
                {steps.map((step, index) => (
                  <li key={index} style={{ display: "flex", gap: 8, padding: "5px 0" }}>
                    <span aria-hidden="true" style={{ width: 16, flexShrink: 0, textAlign: "center", color: "var(--ago-accent-color, #1b5fc4)" }}>{marker[step.status]}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }}>{index + 1}. {step.name} <span style={{ color: "var(--ago-muted-text-color, #6b6d6f)", fontWeight: 400 }}>· {statusLabels[step.status]}</span></div>
                      {step.reason && <div style={{ color: "var(--ago-muted-text-color, #6b6d6f)", marginTop: 2 }}>{step.reason}</div>}
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
          {progress.activity.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 5 }}>{labels.activity}</div>
              <div style={{ maxHeight: 128, overflowY: "auto", padding: 8, borderRadius: 8, background: "var(--ago-agent-bubble-background, #f1f3f5)", fontFamily: "monospace", fontSize: 12 }}>
                {progress.activity.map((item, index) => <div key={index} style={{ paddingBlock: 2, whiteSpace: "pre-wrap" }}>{item.text}</div>)}
              </div>
            </div>
          )}
          {progress.truncated && <div style={{ marginTop: 8, color: "var(--ago-muted-text-color, #6b6d6f)" }}>{labels.truncated}</div>}
        </section>
      )}
    </div>
  );
}

/** Keep decision state for one approval snapshot. */
function ApprovalDecisions({ client, approval, labels, onError }: {
  client: AgoClient | null;
  approval: MessageApproval;
  labels: BackgroundStateLabels;
  onError?: (error: Error) => void;
}) {
  const [submission, setSubmission] = useState<"idle" | "pending" | "failed">("idle");
  const request = useRef<symbol>();

  // Keep requests alive when Suspense temporarily hides these controls.
  useEffect(() => () => { request.current = undefined; }, []);

  /** Submit once and report a failure while these controls are mounted. */
  const submitDecision = async (decision: "approve" | "reject") => {
    if (!client || request.current || !approval.allowedDecisions.includes(decision)) return;
    const attempt = Symbol();
    request.current = attempt;
    setSubmission("pending");
    try {
      await client.submitApprovalDecision(approval.id, decision);
    } catch (error) {
      if (request.current !== attempt) return;
      request.current = undefined;
      setSubmission("failed");
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };

  return (
    <>
      {approval.allowedDecisions.map((decision) => (
        <button
          key={decision}
          type="button"
          disabled={submission === "pending" || !client}
          onClick={() => void submitDecision(decision)}
          style={{
            minHeight: 44,
            padding: "8px 14px",
            marginInlineEnd: 8,
            border: "1px solid var(--ago-border-color, #dee3e8)",
            borderRadius: 8,
            background: "var(--ago-panel-background, #fff)",
            color: "var(--ago-text-color, #30373e)",
          }}
        >
          {decision === "approve" ? labels.approve : labels.reject}
        </button>
      ))}
      {submission === "pending" && <p role="status">{labels.submitting}</p>}
      {submission === "failed" && <p role="alert">{labels.decisionFailed}</p>}
    </>
  );
}
