# Manual background agent check

From the SDK checkout:

```sh
npm ci
node examples/background-agent-e2e/server.mjs
```

Open the printed `http://localhost:...` URL. The server chooses an available port and serves the SDK source in this checkout. It does not proxy requests. Stop it with Ctrl+C.

Use a compatible AGO backend with its background agent feature enabled, a running worker, an agent configured to perform a task requiring approval, and an account authorized to make that approval. The backend must allow the printed localhost origin for cross-origin SDK requests. Configure its existing origin and authentication settings; this harness does not bypass them. Configure any required tenant authentication and have a valid JWT for the staff account ready. A signed JWT alone does not grant staff access.

Enter the backend URL, a stable visitor ID, and the agent ID or name. Select React or vanilla and connect. The visitor ID identifies the anonymous visitor; record it if you need to return as that visitor. An optional conversation ID opens an existing conversation. Paste a JWT into the password field when needed. **Update JWT** applies it to the existing client; **Remove JWT** explicitly logs out. The page keeps the token in memory only, clears the input after use, and does not put it in the URL. Switching widget type or connection settings requires Connect again. Enter the same visitor ID and conversation ID to return to the same context. Do not use real credentials on an untrusted machine.

1. Ask the configured agent to start its background task. Check that one response updates with progress and that the composer is blocked when the conversation cannot accept another message.
2. With a verified staff JWT for the authorized account, approve a pending action. Start another task and reject it. A decision acknowledges the approval; wait for the agent's eventual outcome.
3. Start a separate run without a JWT so the anonymous visitor owns its conversation. Check that privileged approval details and decision controls are absent. From an authorized AGO admin staff view of that same run, make an external decision, then watch the visitor view update through the status poll (normally about two seconds). Removing a JWT clears the SDK-owned view; it does not grant the anonymous visitor access to a conversation owned by another identity.
4. While background work is running, close and reopen the widget using its own controls. Confirm the work continues without pressing Stop and the latest state returns. In React, expand the bottom sheet from its peek bar; in vanilla, use the bubble launcher.
5. Complete a task that produces a file and open its download link. Verify the resulting file. Then start an ordinary chat turn and verify normal streaming and Stop behavior.

These steps exercise your configured backend and agent. A local simulator can check presentation wiring, but cannot establish that a real agent, worker, authorization setup, or file service works.
