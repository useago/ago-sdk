import { useEffect, useRef, useState } from "react";
import type { AgoClient } from "../../client/AgoClient";
import type { AgoMessage } from "../../client/types";
import type { UiCatalog } from "../../i18n/types";

type Labels = UiCatalog["responseState"];

export function ResponseState({
  message,
  client,
  labels,
}: {
  message: AgoMessage;
  client: AgoClient;
  labels: Labels;
}) {
  const approval = message.approval;
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const sequence = useRef(0);
  const scope = useRef({ client, id: approval?.id, status: approval?.status });
  if (
    scope.current.client !== client ||
    scope.current.id !== approval?.id ||
    scope.current.status !== approval?.status
  ) {
    scope.current = { client, id: approval?.id, status: approval?.status };
    sequence.current++;
  }

  useEffect(() => {
    const currentSequence = sequence;
    setPending(false);
    setFailed(false);
    return () => {
      currentSequence.current++;
    };
  }, [client, approval?.id, approval?.status]);

  const decide = async (decision: "approve" | "reject") => {
    if (!approval || pending || !approval.allowedDecisions.includes(decision)) return;
    const id = approval.id;
    const request = ++sequence.current;
    setPending(true);
    setFailed(false);
    try {
      await client.submitApprovalDecision(id, decision);
    } catch {
      if (sequence.current === request) {
        setPending(false);
        setFailed(true);
      }
    }
  };

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

  return (
    <div
      className="ago-response-state"
      style={{
        maxWidth: "100%",
        minWidth: 0,
        color: "var(--ago-text-color, #30373e)",
        fontSize: 13,
        overflowWrap: "anywhere",
      }}
    >
      {progress && (
        <section aria-label={labels.progress}>
          {progress.steps !== null && (
            <>
              <strong>{labels.progress}</strong>
              <ol style={{ paddingInlineStart: 20 }}>
                {progress.steps.map((step, index) => (
                  <li key={index}>
                    {step.name} ({statusLabels[step.status]})
                    {step.reason ? `: ${step.reason}` : ""}
                  </li>
                ))}
              </ol>
            </>
          )}
          {progress.activity.length > 0 && (
            <>
              <strong>{labels.activity}</strong>
              <ul style={{ paddingInlineStart: 20 }}>
                {progress.activity.map((item, index) => (
                  <li key={index}>
                    {item.text}{item.timestamp ? ` · ${item.timestamp}` : ""}
                  </li>
                ))}
              </ul>
            </>
          )}
          {progress.truncated && <p>{labels.truncated}</p>}
        </section>
      )}
      {approval && (
        <section
          aria-label={labels.approval}
          style={{
            border: "1px solid var(--ago-border-color, #dee3e8)",
            borderRadius: 8,
            padding: 10,
            marginBlock: 8,
          }}
        >
          <strong>{labels.approval}</strong>
          <p>{approvalLabels[approval.status]}</p>
          {approval.actions.map((action, index) => (
            <div key={index}>
              <strong>{action.name}</strong>
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxWidth: "100%" }}>
                {JSON.stringify(action.arguments, null, 2)}
              </pre>
            </div>
          ))}
          {approval.allowedDecisions.map((decision) => (
            <button
              key={decision}
              type="button"
              disabled={pending}
              onClick={() => void decide(decision)}
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
          {pending && <p role="status">{labels.submitting}</p>}
          {failed && <p role="alert">{labels.decisionFailed}</p>}
        </section>
      )}
      {message.status === "WAITING_APPROVAL" && !approval && <p>{labels.waiting}</p>}
      {message.outcome === "completed" && <p>{labels.completed}</p>}
      {message.outcome === "incomplete" && <p>{labels.incomplete}</p>}
      {message.outcome === "failed" && <p>{labels.failed}</p>}
      {message.status === "PAUSED" && <p>{labels.paused}</p>}
    </div>
  );
}
