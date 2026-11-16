import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error The test server is plain Node JavaScript.
import { createSimulator } from './support/background-browser/server.mjs';

const fixture = (name: string) => readFileSync(`tests/fixtures/background-sdk/${name}`);
const url = (origin: string, path: string) => `${origin}${path}`;

describe('HTTP event stream', () => {
  it('releases complete records progressively before EOF and transitions only when written', async () => {
    let release!: () => void; let reached!: () => void;
    const barrier = new Promise<void>((resolveBarrier) => { release = resolveBarrier; });
    const paused = new Promise<void>((resolvePaused) => { reached = resolvePaused; });
    const sim = createSimulator({ beforeRecord: async ({ caseName, index }: { caseName: string; index: number }) => {
      if (caseName === 'follow-approval' && index === 1) { reached(); await barrier; }
    } });
    const origin = await sim.start();
    try {
      const response = await fetch(url(origin, '/api/sdk/v1/messages/33333333-3333-4333-8333-333333333333/events'));
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
