<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { useChat, useAgoFunction, useAgoNavigation } from '@useago/sdk/vue';
import { getCurrentTime, showNotification, getPageInfo } from '../functions';
import type { AgoMessage } from '@useago/sdk/vue';

const router = useRouter();

// All-in-one composable for messages + conversations
const { messages, isLoading, sendMessage } = useChat();

// Register navigation routes
useAgoNavigation((path: string) => router.push(path), [
  { name: 'home', path: '/', description: 'Home page' },
  { name: 'about', path: '/about', description: 'About AGO, our mission and values' },
  { name: 'features', path: '/features', description: 'List of AGO SDK features' },
]);

// Register client functions — auto-cleanup on unmount
useAgoFunction(getCurrentTime.name, getCurrentTime);
useAgoFunction(showNotification.name, showNotification);
useAgoFunction(getPageInfo.name, getPageInfo);

// Chat input
const input = ref('');
const messagesContainer = ref<HTMLElement | null>(null);

async function handleSend() {
  const text = input.value.trim();
  if (!text || isLoading.value) return;
  input.value = '';
  await sendMessage(text);
  await nextTick();
  scrollToBottom();
}

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}

function formatContent(msg: AgoMessage): string {
  return msg.content || (msg.status === 'IN_PROGRESS' ? '...' : '');
}
</script>

<template>
  <div class="chat-panel">
    <div class="chat-header">
      <h3>AGO Assistant</h3>
    </div>

    <div ref="messagesContainer" class="chat-messages">
      <div class="chat-welcome">
        Hello! I can tell you the current time, show notifications, navigate pages, or describe your browser. Try asking!
      </div>

      <div
        v-for="msg in messages"
        :key="msg.id"
        :class="['chat-message', `chat-message--${msg.role}`]"
      >
        <div class="chat-message__content">{{ formatContent(msg) }}</div>
      </div>
    </div>

    <div class="chat-input-area">
      <form class="chat-input-form" @submit.prevent="handleSend">
        <input
          v-model="input"
          class="chat-input-field"
          placeholder="Type your message..."
          :disabled="isLoading"
        />
        <button class="chat-input-submit" type="submit" :disabled="isLoading || !input.trim()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
            <path d="M2 21l21-9L2 3v7l15 2-15 2z" />
          </svg>
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
  border-radius: 16px;
  overflow: hidden;
}

.chat-header {
  padding: 16px 20px;
  background: #fafafa;
  border-bottom: 1px solid #e5e7eb;
}

.chat-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #1a1a2e;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chat-welcome {
  background: #f3f4f6;
  color: #4b5563;
  padding: 12px 16px;
  border-radius: 16px 16px 16px 4px;
  font-size: 14px;
  max-width: 85%;
}

.chat-message--user {
  align-self: flex-end;
}

.chat-message--user .chat-message__content {
  background: #007bff;
  color: #fff;
  border-radius: 16px 16px 4px 16px;
  padding: 12px 16px;
  font-size: 14px;
  max-width: 70%;
}

.chat-message--assistant .chat-message__content {
  background: #f3f4f6;
  color: #1a1a2e;
  border-radius: 16px 16px 16px 4px;
  padding: 12px 16px;
  font-size: 14px;
  max-width: 85%;
  white-space: pre-wrap;
}

.chat-input-area {
  padding: 16px 20px;
  background: #fafafa;
  border-top: 1px solid #e5e7eb;
}

.chat-input-form {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 24px;
  padding: 8px 16px;
}

.chat-input-field {
  flex: 1;
  border: none;
  outline: none;
  font-size: 14px;
  font-family: inherit;
  background: transparent;
  padding: 8px 0;
}

.chat-input-submit {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #007bff;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.chat-input-submit:hover { background: #0056b3; }
.chat-input-submit:disabled { background: #94a3b8; cursor: not-allowed; }
</style>
