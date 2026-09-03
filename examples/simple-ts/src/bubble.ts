import { mountChatWidget } from '@useago/sdk/widget';

// Public demo account. Swap for your own https://YOUR-DOMAIN.api.useago.com
// and one of your agent slugs.
const BASE_URL = 'https://playground.api.useago.com';

// The hosted embed widget without the iframe: a launcher bottom right, a
// teaser bubble one second later, and a panel with home / conversation /
// history screens. Mount it on document.body.
const bubble = mountChatWidget(document.body, {
  config: { baseUrl: BASE_URL, agent: 'generic-guide' },
  placement: 'bubble',
  title: 'Ask AGO',
  prompt: 'Hello, how can I help you today?',
  subtitle: 'Answers come from the **AGO docs**.',
  conversationStarters: [
    { label: 'What can the SDK do?' },
    { label: 'Pricing', message: 'Tell me about pricing' },
  ],
  // The embed snippet's palette; `theme` (see docs) wins over it key by key.
  colors: { button: '#007bff', header: '#03182f' },
  onOpen: () => console.log('bubble opened'),
  onClose: () => console.log('bubble closed'),
  onMessageSent: (text) => console.log('sent:', text),
  onMessageReceived: (message) => console.log('received:', message.content),
});

// Clean up on hot-reload so listeners don't stack up.
if (import.meta.hot) {
  import.meta.hot.dispose(() => bubble.destroy());
}
