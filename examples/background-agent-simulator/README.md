```sh
node examples/background-agent-simulator/server.mjs --scenario staff-approval --port 0
node examples/background-agent-simulator/server.mjs --case fatal-pre-id --port 0
```

Use the printed origin as the SDK `baseUrl`. Omit `--port` for an OS-assigned port. `--case` selects one manifest case; the CSV is also available on the same origin. The default scenario follows the staff approval path. Rejection, redacted, fork and error fixtures are isolated cases.

Tests can import `createSimulator`, call `start()`, `approveExternally()` and `close()`, and pass an async `beforeRecord` callback to control SSE record release. The `clock` property is fixture metadata; no wall-clock expiry is simulated. The server binds only to loopback and serves only manifest routes.
