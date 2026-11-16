import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/background-sdk');
const bytes = (name) => readFileSync(resolve(fixtures, name));
const phases = {
  running: ['history-running.json', 'status-running.json', 'follow-to-approval.sse'],
  waiting: ['history-approval-authorized.json', 'status-approval-authorized.json', 'follow-approval-authorized.sse'],
  approved: ['history-approval-approved.json', 'status-approval-approved.json', 'follow-to-final.sse'],
  final: ['history-final.json', 'status-final.json', 'follow-final-baseline.sse'],
};

export function createSimulator({ caseName, beforeRecord } = {}) {
  let phase = 'running';
  const sockets = new Set();
  const server = createServer(async (req, res) => {
    try {
      const path = req.url;
      let file;
      if (req.method === 'GET' && path === '/fixture-files/background-report.csv') {
        res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="background-report.csv"' });
        res.end(bytes('files/background-report.csv'));
        return;
      }
      if (req.method === 'GET' && path.startsWith('/api/sdk/v1/conversations/')) file = caseName === 'history-approval-redacted' ? 'history-approval-redacted.json' : phases[phase][0];
      else if (req.method === 'GET' && path.endsWith('/status')) file = phases[phase][1];
      else if (req.method === 'GET' && path.endsWith('/events')) file = phases[phase][2];
      else if (req.method === 'POST' && path.endsWith('/decision')) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const decision = JSON.parse(Buffer.concat(chunks).toString()).decision;
        if (decision === 'approve' && (phase === 'waiting' || phase === 'approved' || phase === 'final')) {
          if (phase === 'waiting') phase = 'approved';
          res.writeHead(204).end();
          return;
        }
      } else if (req.method === 'POST' && path === '/api/sdk/v1/messages') file = 'initial-send.sse';
      if (!file) { res.writeHead(404).end(); return; }
      const data = bytes(file);
      if (!file.endsWith('.sse')) { res.writeHead(200, { 'Content-Type': 'application/json' }).end(data); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      let offset = 0, index = 0;
      while (offset < data.length) {
        const delimiter = data.indexOf('\n\n', offset);
        const end = delimiter < 0 ? data.length : delimiter + 2;
        await beforeRecord?.({ caseName: file === 'follow-to-approval.sse' ? 'follow-approval' : file, index });
        if (res.destroyed) return;
        res.write(data.subarray(offset, end));
        offset = end;
        index++;
      }
      if (file === 'follow-to-approval.sse' && phase === 'running') phase = 'waiting';
      if (file === 'follow-to-final.sse' && phase === 'approved') phase = 'final';
      res.end();
    } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  return {
    get phase() { return phase; },
    async start() {
      await new Promise((resolveStart, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveStart); });
      return `http://localhost:${server.address().port}`;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      if (server.listening) await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    },
  };
}
