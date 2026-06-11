/**
 * Angular-style example using AgoService with vanilla TS.
 *
 * This demonstrates how @useago/sdk/angular works WITHOUT a full Angular CLI setup.
 * In a real Angular project, you'd use `provideAgo()` in your app config and
 * `inject(AgoService)` in components.
 *
 * This vanilla example shows the same service API so Angular developers
 * can see how it works before integrating into their Angular app.
 */

import { AgoService } from '@useago/sdk/angular';
import { defineFunction } from '@useago/sdk';

// ─── Create the service (in Angular, this would be provided via DI) ───
const ago = new AgoService({
  baseUrl: 'https://ago.api.useago.com',
  agent: 'generic-guide',
  debug: true,
});

// ─── Register client functions ────────────────────────────────────────
const getCurrentTime = defineFunction({
  name: 'getCurrentTime',
  description: 'Get the current date, time, and timezone of the user',
  parameters: { type: 'object', properties: {} },
  handler: async () => ({
    time: new Date().toLocaleTimeString(),
    date: new Date().toLocaleDateString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }),
});

const getPageInfo = defineFunction({
  name: 'getPageInfo',
  description: "Get information about the user's current page and browser",
  parameters: { type: 'object', properties: {} },
  handler: async () => ({
    url: window.location.href,
    title: document.title,
    language: navigator.language,
    screenWidth: window.innerWidth,
    screenHeight: window.innerHeight,
  }),
});

ago.registerFunction(getCurrentTime);
ago.registerFunction(getPageInfo);

// ─── Subscribe to observables (RxJS-like API) ────────────────────────
const chunkSub = ago.chunks$.subscribe({
  next: (chunk) => {
    // Append streaming content to the last assistant message
    const lastMsg = document.querySelector('.chat-messages .chat-message--assistant:last-child .chat-message__content');
    if (lastMsg) {
      lastMsg.textContent = (lastMsg.textContent || '') + chunk.content;
    }
  },
});

const completeSub = ago.messages$.subscribe({
  next: (msg) => {
    addLog('complete', `Message: ${msg.content.slice(0, 80)}${msg.content.length > 80 ? '...' : ''}`);
  },
});

const errorSub = ago.errors$.subscribe({
  next: (err) => {
    addLog('error', err.error);
  },
});

// ─── Render UI ────────────────────────────────────────────────────────
const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="app-container">
    <header class="app-header">
      <h1>AGO Chat SDK - Angular Example</h1>
      <p class="subtitle">Using <code>AgoService</code> from <code>@useago/sdk/angular</code></p>
    </header>

    <main class="app-main">
      <div class="widget-container">
        <div class="chat-panel">
          <div class="chat-header"><h3>AGO Assistant</h3></div>
          <div class="chat-messages" id="messages">
            <div class="chat-welcome">
              Hello! I can tell you the current time or describe your browser. Try asking!
            </div>
          </div>
          <div class="chat-input-area">
            <form class="chat-input-form" id="chat-form">
              <input class="chat-input-field" id="chat-input" placeholder="Type your message..." />
              <button class="chat-input-submit" type="submit">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
              </button>
            </form>
          </div>
        </div>
      </div>

      <div class="content-area">
        <div class="page">
          <h2>How it works</h2>
          <p>This example uses <code>AgoService</code> from <code>@useago/sdk/angular</code> — the same service you'd use in a real Angular app with dependency injection.</p>

          <h3>Angular integration</h3>
          <pre><code>// app.config.ts
import { provideAgo } from '@useago/sdk/angular';

export const appConfig = {
  providers: [
    provideAgo({ baseUrl: 'https://YOUR-DOMAIN.useago.com' }),
  ],
};

// chat.component.ts
import { AgoService } from '@useago/sdk/angular';

@Component({ ... })
export class ChatComponent {
  private ago = inject(AgoService);

  // Observable streams
  messages$ = this.ago.messages$;
  chunks$ = this.ago.chunks$;
  errors$ = this.ago.errors$;

  send(text: string) {
    this.ago.sendMessage(text);
  }
}</code></pre>

          <h3>Event Log</h3>
          <div class="log-panel" id="log-panel">
            <p class="log-empty" id="log-empty">No events yet. Send a message to see the observable stream.</p>
          </div>
        </div>
      </div>
    </main>
  </div>
`;

// ─── Wire up form ─────────────────────────────────────────────────────
const form = document.getElementById('chat-form')!;
const inputEl = document.getElementById('chat-input') as HTMLInputElement;
const messagesEl = document.getElementById('messages')!;

let isSending = false;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text || isSending) return;

  inputEl.value = '';
  isSending = true;

  // Add user message
  messagesEl.innerHTML += `
    <div class="chat-message chat-message--user">
      <div class="chat-message__content">${escapeHtml(text)}</div>
    </div>
  `;

  // Add empty assistant message
  messagesEl.innerHTML += `
    <div class="chat-message chat-message--assistant">
      <div class="chat-message__content"></div>
    </div>
  `;
  messagesEl.scrollTop = messagesEl.scrollHeight;

  addLog('send', text);

  try {
    const msg = await ago.sendMessage(text);
    // Replace content with final message
    const lastAssistant = messagesEl.querySelector('.chat-message--assistant:last-child .chat-message__content');
    if (lastAssistant) {
      lastAssistant.textContent = msg.content;
    }
  } catch (err) {
    addLog('error', String(err));
  } finally {
    isSending = false;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function addLog(type: string, detail: string) {
  const logPanel = document.getElementById('log-panel')!;
  const empty = document.getElementById('log-empty');
  if (empty) empty.remove();

  const time = new Date().toLocaleTimeString();
  const badgeClass = type === 'error' ? 'log-badge--error' : type === 'send' ? 'log-badge--send' : 'log-badge--complete';
  logPanel.innerHTML += `
    <div class="log-entry">
      <span class="log-time">${time}</span>
      <span class="log-badge ${badgeClass}">${type.toUpperCase()}</span>
      <span class="log-detail">${escapeHtml(detail)}</span>
    </div>
  `;
  logPanel.scrollTop = logPanel.scrollHeight;
}

// ─── Cleanup (for SPA navigation) ────────────────────────────────────
window.addEventListener('beforeunload', () => {
  chunkSub.unsubscribe();
  completeSub.unsubscribe();
  errorSub.unsubscribe();
  ago.destroy();
});
