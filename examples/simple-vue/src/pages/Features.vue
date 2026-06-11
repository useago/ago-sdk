<template>
  <div class="page">
    <h2>SDK Features</h2>
    <div class="features-grid">
      <div class="feature-card" v-for="feature in features" :key="feature.title">
        <h3>{{ feature.title }}</h3>
        <p>{{ feature.description }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const features = [
  { title: 'Vue Plugin', description: 'app.use(AgoPlugin) provides the client to the whole app via inject/provide.' },
  { title: 'Composables', description: 'useChat(), useMessages(), useConversation() — reactive composables with auto-cleanup.' },
  { title: 'Client Functions', description: 'useAgoFunction() lets the AI call your frontend functions with full lifecycle management.' },
  { title: 'SSE Streaming', description: 'Real-time message streaming with automatic state updates and error handling.' },
  { title: 'Navigation', description: 'useAgoNavigation() integrates with vue-router so the AI can navigate users.' },
  { title: 'Event System', description: 'useAgoEvents() subscribes to any client event with auto-cleanup on unmount.' },
  { title: 'Zero Config', description: 'createAgo() auto-detects config from meta tags, data attributes, or window.AGO.' },
  { title: 'Type Safe', description: 'Full TypeScript support with strict types for all composables and functions.' },
];
</script>
