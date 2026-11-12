import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgoClient } from "../../src/client/AgoClient";
import { ChatWidget, type ChatWidgetHandle } from "../../src/react/components/ChatWidget";
import { mountChatWidget } from "../../src/widget/createChatWidget";

interface Session {
  client: AgoClient;
  mode: "react" | "vanilla";
  conversationId?: string;
  visitorId: string;
}

function Vanilla({ session }: { session: Session }) {
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const widget = mountChatWidget(target.current!, {
      client: session.client,
      conversationId: session.conversationId,
      placement: "bubble",
      defaultOpen: true,
      autoResume: false,
      loadThreads: false,
      allowFiles: true,
    });
    return () => widget.destroy();
  }, [session]);
  return <div ref={target} />;
}

function App() {
  const [baseUrl, setBaseUrl] = useState("");
  const [visitorId, setVisitorId] = useState("");
  const [agent, setAgent] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [jwt, setJwt] = useState("");
  const [mode, setMode] = useState<"react" | "vanilla">("react");
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const reactWidget = useRef<ChatWidgetHandle>(null);
  const sessionRef = useRef<Session | null>(null);

  useEffect(() => () => sessionRef.current?.client.destroy(), []);

  function connect(event: React.FormEvent) {
    event.preventDefault();
    try {
      const url = new URL(baseUrl);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Enter an HTTP(S) backend URL without credentials or a query.");
      if (!visitorId.trim()) throw new Error("Enter a stable visitor ID.");
      const client = new AgoClient({ baseUrl: url.toString().replace(/\/$/, ""), widgetId: visitorId.trim(), agent: agent.trim() || undefined, userJwt: jwt || null });
      sessionRef.current?.client.destroy();
      const next = { client, mode, visitorId: visitorId.trim(), conversationId: conversationId.trim() || undefined };
      sessionRef.current = next;
      setSession(next);
      setJwt("");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not configure the client.");
    }
  }

  function updateCredential(value: string | null) {
    session?.client.updateConfig({ userJwt: value });
    setJwt("");
  }

  return <main id="ago-e2e">
    <h1>Background agent manual check</h1>
    <p>Connect directly to a compatible backend. Credentials stay in this page's memory.</p>
    <form onSubmit={connect}>
      <label>Backend URL<input required type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-backend.example" /></label>
      <label>Visitor ID<input required value={visitorId} onChange={(e) => setVisitorId(e.target.value)} placeholder="Choose a stable ID" /></label>
      <label>Agent ID or name<input value={agent} onChange={(e) => setAgent(e.target.value)} /></label>
      <label>Conversation ID (optional)<input value={conversationId} onChange={(e) => setConversationId(e.target.value)} /></label>
      <label>JWT (optional)<input type="password" autoComplete="off" value={jwt} onChange={(e) => setJwt(e.target.value)} /></label>
      <label>Widget<select value={mode} onChange={(e) => setMode(e.target.value as "react" | "vanilla")}><option value="react">React</option><option value="vanilla">Vanilla</option></select></label>
      <div className="ago-e2e-actions"><button type="submit">Connect</button>{session && <><button type="button" disabled={!jwt} onClick={() => updateCredential(jwt)}>Update JWT</button><button type="button" onClick={() => updateCredential(null)}>Remove JWT</button></>}</div>
    </form>
    {error && <p role="alert">{error}</p>}
    {session && <><p>Connected as visitor <strong>{session.visitorId}</strong>. Use the widget to send a message.</p>{session.mode === "react" ? <div className="ago-e2e-widget"><ChatWidget ref={reactWidget} client={session.client} conversationId={session.conversationId} height="min(65dvh, 600px)" allowFiles sheet={{ breakpoint: 10000, initialState: "peek" }} /></div> : <Vanilla session={session} />}</>}
  </main>;
}

createRoot(document.getElementById("ago-e2e-root")!).render(<App />);
