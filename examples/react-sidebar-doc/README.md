# Chat to sidebar + document (React)

A centered chat that folds into a left sidebar the moment the agent cites
sources, then shows the **most probable document** (the first source of the
latest answer) in the center.

```bash
npm install
npm run dev
```

Ask something the demo agent answers from its knowledge base (e.g. "What is
AGO?"). When the reply comes back with sources, the layout splits: the chat
shrinks to a sidebar and the top-ranked document opens in the middle. If the
answer cites several documents, chips let you switch between them.

## How it works

The packaged `<ChatWidget>` is one fixed layout. This example uses the headless
[`useChat`](../../src/react/hooks/useChat.ts) hook instead, so the layout is
ours:

```tsx
const { messages, sendMessage, isLoading } = useChat();

// The most probable document = first source of the latest answer that cites any.
const sources = /* scan messages backwards for the last assistant msg with sources */;
const hasDoc = sources.length > 0;

return (
  <div className={hasDoc ? 'workspace workspace--split' : 'workspace'}>
    <section className="chat">{/* <Message> list + <ChatInput> */}</section>
    {hasDoc && <section className="doc">{/* iframe of sources[0].url */}</section>}
  </div>
);
```

`messages`, `sendMessage`, and the `<Message>` / `<ChatInput>` components all
come from `@useago/sdk/react`. The split, the transition, and the document pane
are plain CSS in [`src/App.css`](./src/App.css).

A source ([`AgoSource`](../../src/client/types.ts)) is `{ id, title, url? }`.
The center pane renders `url` in an `<iframe>`; some sites send
`X-Frame-Options`/CSP that block embedding, so an "Ouvrir l'original" link is
always shown as a fallback. Sources without a `url` show a placeholder.

## Run against local SDK source

Swap the dependency in `package.json` for the monorepo build, then build the SDK:

```jsonc
"@useago/sdk": "file:../.."
```

```bash
npm install && npm run build   # from the repo root, produces dist/
```
