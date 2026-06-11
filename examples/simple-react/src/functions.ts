import { defineFunction } from '@useago/sdk';

/**
 * Functions defined once, reusable across components and tests.
 */

export const getCurrentTime = defineFunction({
  name: 'getCurrentTime',
  description: 'Get the current date, time, and timezone of the user',
  parameters: { type: 'object', properties: {} },
  handler: async () => {
    const now = new Date();
    return {
      time: now.toLocaleTimeString(),
      date: now.toLocaleDateString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  },
});

export const showNotification = defineFunction({
  name: 'showNotification',
  description: 'Display a notification popup to the user with a title, message, and type',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'The notification title' },
      message: { type: 'string', description: 'The notification body text' },
      type: { type: 'string', description: 'The notification style', enum: ['info', 'success', 'warning', 'error'] },
    },
    required: ['title', 'message'],
  },
  handler: async (args) => {
    const title = (args.title as string) || 'Notification';
    const message = (args.message as string) || '';
    const type = (args.type as string) || 'info';
    alert(`[${type.toUpperCase()}] ${title}\n\n${message}`);
    return { displayed: true, title, type };
  },
});

export const getPageInfo = defineFunction({
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
