import {
  mountChatWidget,
  type CreateFormCollectorOptions,
} from '@useago/sdk/widget';

// Public demo backend. Swap for your own https://YOUR-DOMAIN.api.useago.com.
const BASE_URL = 'https://ago.api.useago.com';

// Conversational form the agent fills while chatting, then submits.
const demoRequest: CreateFormCollectorOptions = {
  name: 'demo_request',
  description: 'A request to book a product demo of AGO.',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Full name of the requester' },
      email: { type: 'string', description: 'Work email address' },
      company: { type: 'string', description: 'Company name' },
      teamSize: { type: 'number', description: 'Number of people on the team' },
    },
    required: ['name', 'email', 'company'],
  },
  // Demo: run the submit in the browser. In production prefer
  // { via: 'backend', destination: 'demo_webhook' } so the URL + secret
  // stay server-side.
  submit: {
    via: 'client',
    handler: async (values) => {
      console.log('Demo request submitted:', values);
      window.alert(`Thanks ${(values as { name?: string }).name ?? ''}! We'll be in touch.`);
      return { ok: true };
    },
  },
};

const widget = mountChatWidget('#chat', {
  config: { baseUrl: BASE_URL, agent: 'generic-guide' },
  title: 'Book a demo',
  welcomeMessage: "Hi! Tell me a bit about your team and I'll set up a demo.",
  placeholder: 'Type your message…',
  height: 540,
  allowFiles: false,
  // Conversational forms (form creator).
  forms: [demoRequest],
  // Suggested replies are clickable by default and send the reply. Override or
  // disable with `onFollowUpClick`:
  //   onFollowUpClick: (reply) => console.log('clicked suggestion:', reply),
  //   onFollowUpClick: false, // render them non-interactive
  onMessageSent: (text) => console.log('sent:', text),
  onMessageReceived: (message) => console.log('received:', message.content),
});

// Clean up on hot-reload so listeners/forms don't stack up.
if (import.meta.hot) {
  import.meta.hot.dispose(() => widget.destroy());
}
