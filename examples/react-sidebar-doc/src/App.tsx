import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AgoProvider,
  ChatInput,
  Message,
  useChat,
} from '@useago/sdk/react';
import type { AgoSource } from '@useago/sdk/react';

/**
 * Demo: a centered chat that folds into a left sidebar as soon as the agent
 * cites sources, then renders the *most probable* document (the first source
 * of the latest answer) in the center. Built with the headless `useChat` hook
 * so the whole layout is ours, not the packaged `<ChatWidget>`.
 */
function Workspace() {
  const { messages, sendMessage, isLoading } = useChat();

  // The "active" document set is the sources of the most recent assistant
  // message that actually cites any. Older citations stay until a newer answer
  // replaces them, so the document panel never flickers to empty mid-chat.
  const sources = useMemo<AgoSource[]>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'assistant' && m.sources && m.sources.length > 0) {
        return m.sources;
      }
    }
    return [];
  }, [messages]);

  const hasDoc = sources.length > 0;

  // Which document is shown in the center. Defaults to the first (most
  // probable) source; resets whenever a new answer brings a new source set.
  const [activeId, setActiveId] = useState<string | null>(null);
  const sourcesKey = sources.map((s) => s.id).join('|');
  useEffect(() => {
    setActiveId(sources[0]?.id ?? null);
  }, [sourcesKey]);

  const active =
    sources.find((s) => s.id === activeId) ?? sources[0] ?? null;

  // Keep the transcript pinned to the latest message.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const isEmpty = messages.length === 0;

  return (
    <div className={`workspace ${hasDoc ? 'workspace--split' : ''}`}>
      {/* ── Chat column: centered hero when empty, sidebar once a doc shows ── */}
      <section className="chat">
        <header className="chat__header">
          <span className="chat__dot" />
          <span className="chat__title">AGO Assistant</span>
          {hasDoc && (
            <span className="chat__hint">cliquez une source pour l'ouvrir →</span>
          )}
        </header>

        <div className="chat__scroll" ref={scrollRef}>
          {isEmpty ? (
            <div className="chat__welcome">
              <h1>Posez une question.</h1>
              <p>
                Quand l'agent s'appuie sur des documents, le chat se replie sur
                le côté et le document le plus probable s'affiche au centre.
              </p>
              <div className="chat__suggestions">
                {[
                  'What is AGO?',
                  'How do I add the chat to my app?',
                  'What can the agent do on my site?',
                ].map((q) => (
                  <button key={q} onClick={() => sendMessage(q)}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <Message
                key={m.id}
                message={m}
                isLast={i === messages.length - 1}
                onFollowUpClick={(reply) => sendMessage(reply)}
              />
            ))
          )}
        </div>

        <div className="chat__input">
          <ChatInput
            onSend={(text) => sendMessage(text)}
            disabled={isLoading}
            placeholder="Posez votre question…"
          />
        </div>
      </section>

      {/* ── Document column: only mounted once we have a source to show ── */}
      {hasDoc && active && (
        <section className="doc">
          <header className="doc__header">
            <div className="doc__titles">
              <span className="doc__eyebrow">Document le plus probable</span>
              <h2 className="doc__title" title={active.title}>
                {active.title}
              </h2>
            </div>
            {active.url && (
              <a
                className="doc__open"
                href={active.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Ouvrir l'original ↗
              </a>
            )}
          </header>

          {/* When the agent cites more than one document, let the reader switch.
              The first chip is the most probable one and starts selected. */}
          {sources.length > 1 && (
            <div className="doc__tabs">
              {sources.map((s, i) => (
                <button
                  key={s.id}
                  className={`doc__tab ${s.id === active.id ? 'is-active' : ''}`}
                  onClick={() => setActiveId(s.id)}
                  title={s.title}
                >
                  <span className="doc__tab-rank">{i + 1}</span>
                  <span className="doc__tab-label">{s.title}</span>
                </button>
              ))}
            </div>
          )}

          <div className="doc__body">
            {active.url ? (
              <iframe
                key={active.id}
                className="doc__frame"
                src={active.url}
                title={active.title}
                referrerPolicy="no-referrer"
                sandbox="allow-scripts allow-same-origin allow-popups"
              />
            ) : (
              <div className="doc__placeholder">
                <p>Ce document n'expose pas d'URL affichable.</p>
                <p className="doc__placeholder-sub">{active.title}</p>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AgoProvider baseUrl="https://ago.api.useago.com" agent="generic-guide" debug>
      <Workspace />
    </AgoProvider>
  );
}
