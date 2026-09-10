import { useEffect, useRef, useState } from "react";
import type { AgoClient } from "../../client/AgoClient";
import { createSpeechToText } from "../../widget/speechToText";
import type { SpeechToTextLabels } from "../../widget/speechToText";
import { MUTED_TEXT_COLOR } from "../../widget/styles";
import { useOptionalAgoClient } from "../context/AgoContext";

export interface SpeechToTextButtonProps {
  /** Uses AgoProvider's client when omitted. */
  client?: AgoClient;
  onTranscript: (text: string) => void;
  /** Use this to hide or disable your editor while dictation is active. */
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
  /** Cancels dictation when the conversation or page changes. */
  scopeKey?: string;
  labels?: Partial<SpeechToTextLabels>;
  className?: string;
}

/** Ready-made microphone, live waveform, cancel/confirm controls and transcription. */
export function SpeechToTextButton(props: SpeechToTextButtonProps) {
  const contextClient = useOptionalAgoClient();
  const client = props.client ?? contextClient;
  const host = useRef<HTMLDivElement>(null);
  const control = useRef<ReturnType<typeof createSpeechToText>>();
  const callbacks = useRef(props);
  callbacks.current = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(false);
    setBusy(false);
    callbacks.current.onBusyChange?.(false);
    if (!client || !host.current) return;
    let active = true;
    const mounted = createSpeechToText({
      transcribe: (file, options) => client.transcribeAudio(file, options),
      onText: (text) => { if (active) callbacks.current.onTranscript(text); },
      onBusy: (value) => {
        if (!active) return;
        setBusy(value);
        if (value) setError("");
        callbacks.current.onBusyChange?.(value);
      },
      onError: (message) => { if (active) setError(message); },
      labels: callbacks.current.labels,
    });
    host.current.append(mounted.el);
    control.current = mounted;
    mounted.setDisabled(!!callbacks.current.disabled);
    void client.getConfig().then(({ permissions }) => {
      if (!active) return;
      const allowed = permissions.some((p) => p.speechToTextEnabled)
        && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
      mounted.setEnabled(allowed);
      setEnabled(allowed);
    }).catch(() => { /* Keep the control hidden when availability is unknown. */ });
    return () => {
      active = false;
      mounted.destroy();
      mounted.el.remove();
      control.current = undefined;
    };
  }, [client]);

  useEffect(() => { control.current?.setDisabled(!!props.disabled); }, [props.disabled]);
  useEffect(() => { control.current?.cancel(); }, [props.scopeKey, client]);
  useEffect(() => { control.current?.setLabels(props.labels); }, [props.labels]);

  return (
    <div className={`ago-speech-to-text ${props.className ?? ""}`}
      style={{ display: enabled ? "flex" : "none", flexDirection: "column", minWidth: 0, flex: busy ? 1 : undefined }}>
      <div ref={host} />
      {error && <span role="alert" style={{ color: MUTED_TEXT_COLOR, fontSize: "13px" }}>{error}</span>}
    </div>
  );
}
