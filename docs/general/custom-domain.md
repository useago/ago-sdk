# Custom domain (reverse proxy)

Serve AGO from your own domain so the browser calls
`https://app.client.com/ago/...` instead of `https://<tenant>.api.useago.com/...`.
A small reverse proxy on your side forwards those requests to AGO and rewrites
the `Host` header to your tenant subdomain. The SDK then points at your domain:

```ts
const ago = new AgoClient({
  baseUrl: "https://app.client.com/ago",   // your domain + a path prefix
  agent: "support",
});
```

That's the only SDK change. Every request becomes same-origin, so there is no
CORS preflight and ad blockers leave it alone. Nothing changes on the AGO
backend, and multi-tenant routing is untouched.

## How it works

The AGO backend picks the tenant **from the `Host` header only**:
`<tenant>.api.useago.com` resolves to tenant `<tenant>`. Your proxy rewrites
`Host` to that value, which is what selects the tenant. It also strips your path
prefix so the upstream path stays `/api/sdk/v1/...`.

```
Browser                                  Your proxy                         AGO backend
─────────────────────────────────────    ───────────────────────────────    ──────────────────────────────
GET app.client.com/ago/api/sdk/v1/...  ▶  strip "/ago", rewrite Host      ▶  GET <tenant>.api.useago.com/api/sdk/v1/...
  (same-origin, no CORS)                   Host: <tenant>.api.useago.com      tenant resolved from Host header
```

Throughout this page:

- `<tenant>` is your AGO tenant (the subdomain of `*.api.useago.com`).
- `<prefix>` is the path you serve AGO under (the example uses `ago`).

## What the proxy must do

1. Forward `/<prefix>/*` to `https://<tenant>.api.useago.com/*` (strip the prefix).
   Forward the **whole** path under the prefix, not just `/api/sdk/v1/*`: a few
   endpoints (tool-call confirm/reject) live directly under `/api/...`.
2. Set the upstream request header `Host: <tenant>.api.useago.com`.
3. Pass the SDK auth headers through untouched: `X-User-Anon-Id`,
   `Authorization`, `X-User-Email`, `X-Widget-Permission`.
4. **Do not buffer responses.** `sendMessage` streams the reply over SSE
   (`text/event-stream`). A proxy that buffers will make replies arrive all at
   once at the end instead of token by token. Each snippet below disables
   buffering.

When proxying to an HTTPS upstream, the TLS handshake must send the tenant
hostname as SNI, or AGO's certificate won't match. Most proxies derive SNI from
the upstream URL automatically; nginx needs it turned on explicitly (see below).

---

## nginx

```nginx
location /<prefix>/ {
    # Strip the prefix: /<prefix>/api/sdk/v1/x  ->  /api/sdk/v1/x
    rewrite ^/<prefix>/(.*)$ /$1 break;

    proxy_pass https://<tenant>.api.useago.com;

    # Tenant selection: rewrite Host to the tenant subdomain.
    proxy_set_header Host <tenant>.api.useago.com;

    # SNI must match the upstream cert, or the TLS handshake fails.
    proxy_ssl_server_name on;
    proxy_ssl_name <tenant>.api.useago.com;

    # Forward the original client IP (optional, nice for logs).
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    # SSE: stream the reply, don't buffer it.
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
    proxy_http_version 1.1;
    add_header X-Accel-Buffering no;
}
```

nginx forwards request headers (including `Authorization` and the `X-*` headers)
by default, so the auth headers pass through unchanged.

---

## Cloudflare Worker

```js
export default {
  async fetch(request) {
    const TENANT = "<tenant>";
    const PREFIX = "/<prefix>";
    const url = new URL(request.url);

    if (!url.pathname.startsWith(PREFIX + "/")) {
      return new Response("Not found", { status: 404 });
    }

    // Strip the prefix and swap in the tenant host.
    const upstream = new URL(request.url);
    upstream.hostname = `${TENANT}.api.useago.com`;
    upstream.pathname = url.pathname.slice(PREFIX.length); // "/ago/api/..." -> "/api/..."

    // Cloudflare sets Host (and SNI) from the request URL's hostname, and
    // streams the response body through by default, so SSE works as-is.
    const proxied = new Request(upstream, request);
    proxied.headers.set("Host", `${TENANT}.api.useago.com`);

    return fetch(proxied);
  },
};
```

The incoming request's headers (auth headers included) are carried over by
`new Request(upstream, request)`.

---

## Next.js (route handler)

Use a catch-all **route handler**, not `next.config.js` rewrites. A route
handler lets you set the upstream `Host` explicitly and stream the SSE response
back unbuffered by returning the upstream body directly. `next.config.js`
`rewrites` forward the incoming request's `Host` (you can't force the tenant
host), and they buffer the response, which breaks token-by-token streaming.

```ts
// app/<prefix>/[...path]/route.ts
const TENANT = "<tenant>";

async function proxy(request: Request, { params }: { params: { path: string[] } }) {
  const url = new URL(request.url);
  const upstream = `https://${TENANT}.api.useago.com/${params.path.join("/")}${url.search}`;

  // Copy incoming headers (auth headers included), then set the tenant Host.
  const headers = new Headers(request.headers);
  headers.set("Host", `${TENANT}.api.useago.com`);

  const res = await fetch(upstream, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    // @ts-expect-error: Node fetch needs this to stream a request body.
    duplex: "half",
    redirect: "manual",
  });

  // Return the upstream body as-is; this streams SSE through unbuffered.
  return new Response(res.body, { status: res.status, headers: res.headers });
}

export const GET = proxy;
export const POST = proxy;
export const dynamic = "force-dynamic"; // never cache the proxy
```

---

## Vite / Express (local dev)

For local development, proxy from your dev server so the browser still talks to
one origin.

**Vite** (`vite.config.ts`). `changeOrigin: true` rewrites `Host` to the target;
Vite's proxy streams SSE by default.

```ts
export default defineConfig({
  server: {
    proxy: {
      "/<prefix>": {
        target: "https://<tenant>.api.useago.com",
        changeOrigin: true,             // rewrite Host -> <tenant>.api.useago.com
        secure: true,
        rewrite: (path) => path.replace(/^\/<prefix>/, ""),
      },
    },
  },
});
```

**Express** with `http-proxy-middleware`:

```js
const { createProxyMiddleware } = require("http-proxy-middleware");

app.use(
  "/<prefix>",
  createProxyMiddleware({
    target: "https://<tenant>.api.useago.com",
    changeOrigin: true,                 // rewrite Host -> <tenant>.api.useago.com
    secure: true,
    pathRewrite: { "^/<prefix>": "" },  // strip the prefix
  })
);
```

`http-proxy-middleware` streams responses (SSE included) by default. Do **not**
put a buffering response middleware (e.g. `compression`) in front of this route,
or the stream will be held back.

---

## Client checklist

1. **Pick a path prefix** (`<prefix>`), e.g. `ago`. Make sure it doesn't collide
   with an existing route in your app.
2. **Deploy the proxy** for `/<prefix>/*` using the snippet for your stack.
3. **Point the SDK at your domain:** `baseUrl: "https://app.client.com/<prefix>"`.
4. **Whitelist your origin in AGO.** Even with the proxy, ask AGO to add
   `https://app.client.com` to your tenant's allowed origins.
5. **Test one call.** Open the app and send a message. The reply should stream in
   token by token. If it lands all at once, response buffering is still on. If
   you get a 404, the `Host` rewrite or prefix strip is wrong.

---

## When you don't need a proxy

The simplest setup is no proxy at all: point `baseUrl` straight at your tenant.

```ts
const ago = new AgoClient({ baseUrl: "https://<tenant>.api.useago.com" });
```

This works today. Requests are cross-origin, so your domain must be whitelisted
in your tenant's CORS config, and a browser ad blocker could block the
third-party host. Reach for the reverse proxy when you want same-origin requests
(no CORS, no ad-blocker risk) or want the traffic to look like it comes from your
own domain.

---

See also: [Configuration & auth](configuration.md) · [Core API](core.md)
