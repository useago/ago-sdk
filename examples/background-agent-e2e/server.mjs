import { createServer } from "vite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createSocketServer } from "node:net";

const cacheDir = await mkdtemp(join(tmpdir(), "ago-e2e-vite-"));
const socket = createSocketServer();
await new Promise((resolve) => socket.listen(0, "localhost", resolve));
const port = socket.address().port;
await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
const vite = await createServer({
  cacheDir,
  optimizeDeps: { entries: ["examples/background-agent-e2e/index.html"] },
  server: { host: "localhost", port, strictPort: true },
});
await vite.listen();
const address = vite.httpServer.address();
console.log(`http://localhost:${address.port}/examples/background-agent-e2e/`);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await vite.close();
    await rm(cacheDir, { recursive: true, force: true });
    process.exit(0);
  });
}
