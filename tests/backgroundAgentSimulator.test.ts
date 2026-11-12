import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
// @ts-expect-error The development harness is plain Node JavaScript.
import { createSimulator } from '../examples/background-agent-simulator/server.mjs';

const dir = resolve('tests/fixtures/background-sdk');
const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8'));
const fixture = (name: string) => readFileSync(resolve(dir, name));
const url = (origin: string, path: string) => `${origin}${path}`;
const getCase = (name: string) => manifest.cases.find((item: {case: string}) => item.case === name);
const post = (origin: string, name: string, bodyName = name) => {
  const item = getCase(name);
  return fetch(url(origin, item.path), { method: 'POST', body: fixture(`decision-${bodyName}.request.json`) });
};
async function check(origin: string, name: string) {
  const item = getCase(name);
  const response = await fetch(url(origin, item.path), { method: item.method, ...(item.request_body_file ? { body: fixture(item.request_body_file) } : {}) });
  expect(response.status).toBe(item.response.status);
  for (const [key, value] of Object.entries(item.response.headers)) expect(response.headers.get(key)).toBe(value);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(item.response.body_file ? fixture(item.response.body_file) : Buffer.alloc(0));
}

describe('literal fixture simulator', () => {
  it('serves primary phases, exact decisions, retry, conflict and file bytes', async () => {
    const sim = createSimulator(); const origin = await sim.start();
    try {
      await check(origin, 'send'); await check(origin, 'history-running'); await check(origin, 'status-running');
      await check(origin, 'follow-approval'); expect(sim.phase).toBe('waiting');
      await check(origin, 'approval-authorized'); await check(origin, 'approval-authorized');
      expect(sim.phase).toBe('waiting'); await check(origin, 'follow-waiting');
      const invalid = await fetch(url(origin, getCase('approve').path), { method: 'POST', body: '{"decision":"approve","extra":true}' });
      expect(invalid.status).toBe(404);
      const accepted = await post(origin, 'approve'); expect(accepted.status).toBe(204); expect((await accepted.arrayBuffer()).byteLength).toBe(0);
      await check(origin, 'approval-approved'); await check(origin, 'history-approval-approved');
      await check(origin, 'follow-final'); expect(sim.phase).toBe('final');
      await check(origin, 'history-final'); await check(origin, 'status-final'); await check(origin, 'follow-final-baseline');
      const retry = await post(origin, 'approve'); expect(retry.status).toBe(204); expect((await retry.arrayBuffer()).byteLength).toBe(0);
      const conflict = await post(origin, 'reject'); expect(conflict.status).toBe(409);
      expect(Buffer.from(await conflict.arrayBuffer())).toEqual(fixture('error-approval-conflict.json'));
      const download = await fetch(url(origin, getCase('download').path));
      expect(download.headers.get('content-length')).toBe('82');
      expect(download.headers.get('content-disposition')).toBe(getCase('download').response.headers['Content-Disposition']);
      const data = Buffer.from(await download.arrayBuffer()); expect(data.length).toBe(82);
      expect(createHash('sha256').update(data).digest('hex')).toBe(manifest.download_sha256);
      expect((await fetch(url(origin, '/fixture-files/../manifest.json'))).status).toBe(404);
    } finally { await sim.close(); }
  });
  it('rejects oversized bodies on fixture and unknown routes', async () => {
    const sim = createSimulator(); const origin = await sim.start();
    try {
      const body = ' '.repeat(2 * 1024 * 1024) + fixture('send.request.json').toString();
      for (const path of [getCase('send').path, '/unknown']) {
        const response = await fetch(url(origin, path), { method: 'POST', body });
        expect(response.status).toBe(413);
        expect((await response.arrayBuffer()).byteLength).toBe(0);
      }
      await check(origin, 'send');
    } finally { await sim.close(); }
  });
  it('supports external approval without an HTTP control route', async () => {
    const sim = createSimulator(); const origin = await sim.start();
    try {
      await check(origin, 'follow-approval'); await check(origin, 'approval-authorized');
      sim.approveExternally(); await check(origin, 'approval-approved');
      expect((await post(origin, 'approve')).status).toBe(204);
      expect((await fetch(url(origin, '/approve'), { method: 'POST' })).status).toBe(404);
    } finally { await sim.close(); }
  });
  it.each(['reject', 'approval-rejected', 'fatal-pre-id', 'history-approval-redacted', 'follow-redacted', 'status-forked'])('serves isolated %s bytes', async (name) => {
    const sim = createSimulator({ caseName: name }); const origin = await sim.start();
    try { await check(origin, name); } finally { await sim.close(); }
  });
  it('releases complete records progressively before EOF and transitions only when written', async () => {
    let release!: () => void; let reached!: () => void;
    const barrier = new Promise<void>((resolveBarrier) => { release = resolveBarrier; });
    const paused = new Promise<void>((resolvePaused) => { reached = resolvePaused; });
    const sim = createSimulator({ beforeRecord: async ({ caseName, index }: { caseName: string; index: number }) => {
      if (caseName === 'follow-approval' && index === 1) { reached(); await barrier; }
    } });
    const origin = await sim.start();
    try {
      const response = await fetch(url(origin, getCase('follow-approval').path));
      const reader = response.body!.getReader();
      await paused;
      const first = await reader.read(); expect(first.done).toBe(false);
      const body = fixture('follow-to-approval.sse');
      const split = body.indexOf('\n\n') + 2;
      expect(Buffer.from(first.value!)).toEqual(body.subarray(0, split)); expect(sim.phase).toBe('running');
      release(); const remaining: Buffer[] = [];
      while (true) { const next = await reader.read(); if (next.done) break; remaining.push(Buffer.from(next.value)); }
      expect(Buffer.concat(remaining)).toEqual(body.subarray(split)); expect(sim.phase).toBe('waiting');
    } finally { release(); await sim.close(); }
  });
});
