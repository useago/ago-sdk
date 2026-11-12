import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/background-sdk');
const manifest = JSON.parse(readFileSync(resolve(fixtureDir, 'manifest.json'), 'utf8'));
const cases = new Map(manifest.cases.map((item) => [item.case, item]));
const maxRequestBytes = 64 * 1024;
const bytes = (file) => readFileSync(resolve(fixtureDir, file));

/** Create a fixture-only server. beforeRecord can hold each SSE record for tests. */
export function createSimulator({ scenario = 'staff-approval', caseName, beforeRecord } = {}) {
  if (caseName && !cases.has(caseName)) throw new Error(`Unknown fixture case: ${caseName}`);
  if (!caseName && scenario !== manifest.scenario.name) throw new Error(`Unknown scenario: ${scenario}`);
  let phase = manifest.scenario.initial_phase;
  let decision = null;
  const sockets = new Set();
  function approveExternally() {
    if (phase !== 'waiting' || decision) throw new Error('No pending approval');
    decision = 'approve';
    phase = 'approved';
  }
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      let size = 0;
      let oversized = false;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > maxRequestBytes) {
          oversized = true;
          chunks.length = 0;
        } else if (!oversized) chunks.push(chunk);
      }
      if (oversized) { res.writeHead(413).end(); return; }
      const body = Buffer.concat(chunks);
      const pathname = req.url;
      let selected;
      if (caseName) {
        selected = cases.get(caseName);
        if (pathname === cases.get('download').path && req.method === 'GET') selected = cases.get('download');
      } else {
        const phaseCases = manifest.scenario.phases[phase];
        const history = cases.get(phaseCases.history);
        const status = cases.get(phaseCases.status);
        const follow = cases.get(phaseCases.follow);
        if (req.method === 'GET' && pathname === history.path) selected = history;
        else if (req.method === 'GET' && pathname === status.path) selected = status;
        else if (req.method === 'GET' && pathname === follow.path) selected = follow;
        else if (req.method === 'GET' && pathname === cases.get('download').path) selected = cases.get('download');
        else if (req.method === 'POST' && pathname === cases.get('send').path) selected = cases.get('send');
        else if (req.method === 'POST' && pathname === cases.get('approve').path) {
          const approve = matchesBody(body, cases.get('approve'));
          const reject = matchesBody(body, cases.get('reject'));
          if (approve && decision === 'approve') selected = cases.get('approve-retry');
          else if (approve && phase === 'waiting' && !decision) {
            decision = 'approve';
            phase = 'approved';
            selected = cases.get('approve');
          } else if (reject && decision === 'approve') selected = cases.get('approval-conflict');
        }
      }
      // The conflict fixture describes the opposite decision after a reject; the
      // primary scenario also serves those same conflict bytes for reject-after-approve.
      const conflict = selected?.case === 'approval-conflict' && !caseName;
      if (!selected || req.method !== selected.method || pathname !== selected.path ||
          (!conflict && !matchesBody(body, selected))) {
        res.writeHead(404).end();
        return;
      }
      const response = selected.response;
      res.writeHead(response.status, response.headers);
      if (!response.body_file) { res.end(); return; }
      const data = bytes(response.body_file);
      if (!response.headers['Content-Type']?.startsWith('text/event-stream')) { res.end(data); return; }
      // Split only on the fixture's literal blank-line delimiters, retaining bytes.
      let offset = 0;
      let index = 0;
      while (offset < data.length) {
        const delimiter = data.indexOf('\n\n', offset);
        const end = delimiter < 0 ? data.length : delimiter + 2;
        await beforeRecord?.({ caseName: selected.case, index, record: data.subarray(offset, end) });
        if (res.destroyed) return;
        res.write(data.subarray(offset, end));
        if (selected.case === 'follow-approval' && end === data.length && phase === 'running') phase = 'waiting';
        if (selected.case === 'follow-final' && end === data.length && phase === 'approved') phase = 'final';
        offset = end;
        index++;
      }
      if (response.sse_eof_after_body) res.end();
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  return {
    server,
    clock: manifest.clock,
    get phase() { return phase; },
    approveExternally,
    async start(port = 0) {
      await new Promise((resolveStart, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolveStart(); });
      });
      return `http://localhost:${server.address().port}`;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      if (server.listening) await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    },
  };
}

function matchesBody(body, item) {
  if (!item.request_body_file) return body.length === 0;
  try { return isDeepStrictEqual(JSON.parse(body), JSON.parse(bytes(item.request_body_file))); }
  catch { return false; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  const simulator = createSimulator({ scenario: option('--scenario'), caseName: option('--case') });
  const origin = await simulator.start(Number(option('--port') ?? 0));
  console.log(`Background agent simulator: ${origin} (fixture clock ${simulator.clock})`);
}
