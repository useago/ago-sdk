import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { AgoClient } from '../src/client/AgoClient';
import { mountChatWidget } from '../src/widget/createChatWidget';
const fixture = (name: string) => readFileSync(`tests/fixtures/background-sdk/${name}`, 'utf8');
const id = '11111111-1111-4111-8111-111111111111';
const initialEmpty = fixture('initial-send.sse').replace(/^data: (.*)$/gm, (_, json) => {
  const data = JSON.parse(json);
  if (data.viewer_id) data.viewer_id = 'viewer-visitor-1';
  if (typeof data.message === 'object' && data.message !== null) { data.message.progress = {steps: [], activity: [], truncated: false}; data.message.background_agent.checklist = []; }
  return `data: ${JSON.stringify(data)}`;
});
describe('fresh vanilla send follows background progress', () => {
  it.each([
    ['inline', false], ['bubble', false], ['inline', true], ['bubble', true],
  ] as const)('%s reaches waiting approval from follow (reset: %s)', async (placement, reset) => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url); urls.push(`${init?.method ?? 'GET'} ${path}`);
      if (init?.method === 'POST') return new Response(initialEmpty, {headers: {'Content-Type': 'text/event-stream'}});
      if (path.endsWith('/events')) return new Response(fixture('follow-approval-redacted.sse'), {headers: {'Content-Type': 'text/event-stream'}});
      if (path.endsWith('/status')) return new Response(fixture('status-approval-redacted.json'));
      if (path.includes('/conversations/')) return new Response(fixture('history-running.json'));
      throw new Error(`unexpected ${path}`);
    });
    const client = new AgoClient({baseUrl: 'https://example.test', userJwt: 'synthetic', fetch: fetcher as typeof fetch});
    const root = document.createElement('div'); document.body.append(root);
    const widget = mountChatWidget(root, {client, placement, defaultOpen: true, loadThreads: false, welcomeMessage: '', persistConversation: false});
    try {
      if (reset) widget.newConversation();
      await widget.sendMessage('start background work');
      await vi.waitFor(() => expect(root.textContent).toContain('Waiting for approval'), {timeout: 400, interval: 20});
      expect(client.getActiveConversation()).toBe(id);
      expect(urls.some((url) => url.endsWith('/events'))).toBe(true);
      expect(root.textContent).toContain('Publish result');
      expect(root.querySelector('textarea')?.disabled).toBe(true);
    } finally { widget.destroy(); client.destroy(); root.remove(); }
  });

  it('pauses observation after a closed bubble settles and resumes on open', async () => {
    let release!: (response: Response) => void;
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url); urls.push(path);
      if (init?.method === 'POST') return new Promise<Response>((resolve) => { release = resolve; });
      if (path.endsWith('/events')) return new Response(fixture('follow-approval-redacted.sse'), {headers: {'Content-Type': 'text/event-stream'}});
      if (path.endsWith('/status')) return new Response(fixture('status-approval-redacted.json'));
      if (path.includes('/conversations/')) return new Response(fixture('history-running.json').replaceAll('viewer-staff-1', 'viewer-visitor-1'));
      throw new Error(`unexpected ${path}`);
    });
    const client = new AgoClient({baseUrl: 'https://example.test', userJwt: 'synthetic', fetch: fetcher as typeof fetch});
    const root = document.createElement('div'); document.body.append(root);
    const widget = mountChatWidget(root, {client, placement: 'bubble', defaultOpen: true, loadThreads: false, welcomeMessage: '', persistConversation: false});
    try {
      const sent = widget.sendMessage('start background work');
      await vi.waitFor(() => expect(release).toBeDefined());
      widget.close!();
      release(new Response(initialEmpty, {headers: {'Content-Type': 'text/event-stream'}}));
      await sent;
      expect(client.getActiveConversation()).toBe(id);
      expect(urls.some((url) => url.endsWith('/events'))).toBe(false);
      widget.open!();
      await vi.waitFor(() => expect(root.textContent).toContain('Waiting for approval'));
      expect(client.getActiveConversation()).toBe(id);
      expect(urls.some((url) => url.endsWith('/events'))).toBe(true);
    } finally { widget.destroy(); client.destroy(); root.remove(); }
  });
});

it('keeps background observation suspended while a bubble shows history or stays closed', async () => {
  let historyReads = 0;
  let eventReads = 0;
  const fetcher = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    const path = String(url);
    if (path.includes('/conversations/')) {
      historyReads++;
      return new Response(fixture('history-running.json'));
    }
    if (path.endsWith('/events')) {
      eventReads++;
      return new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  const client = new AgoClient({ baseUrl: 'https://example.test', fetch: fetcher as typeof fetch });
  const root = document.createElement('div');
  const widget = mountChatWidget(root, { client, conversationId: id, placement: 'bubble', defaultOpen: false, loadThreads: false, persistConversation: false });
  try {
    await vi.waitFor(() => expect(root.textContent).toContain('Draft report'));
    expect(eventReads).toBe(0);
    widget.showScreen!('history');
    widget.open!();
    await Promise.resolve();
    expect(eventReads).toBe(0);
    expect(historyReads).toBe(1);
    widget.showScreen!('chat');
    await vi.waitFor(() => expect(eventReads).toBe(1));
    widget.close!();
    widget.showScreen!('history');
    widget.showScreen!('chat');
    await Promise.resolve();
    expect(eventReads).toBe(1);
    expect(historyReads).toBe(2);
    expect(client.getActiveConversation()).toBe(id);
    widget.open!();
    await vi.waitFor(() => expect(eventReads).toBe(2));
    expect(historyReads).toBe(3);
  } finally { widget.destroy(); client.destroy(); }
});
