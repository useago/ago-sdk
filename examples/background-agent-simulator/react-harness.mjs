import { createServer } from 'vite';
import { createServer as createSocketServer } from 'node:net';
import { createSimulator } from './server.mjs';

const caseIndex = process.argv.indexOf("--case");
const caseName = caseIndex < 0 ? undefined : process.argv[caseIndex + 1];
const simulator = createSimulator({ caseName });
const target = await simulator.start();
const socket = createSocketServer();
await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const vite = await createServer({
  optimizeDeps: { entries: ["examples/background-agent-simulator/react.html"], include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"] },
  server: { host: 'localhost', port, strictPort: true, proxy: { '/api': target, '/fixture-files': target } },
});
await vite.listen();
const address = vite.httpServer.address();
console.log(`http://localhost:${address.port}/examples/background-agent-simulator/react.html`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await vite.close(); await simulator.close(); process.exit(0); });
