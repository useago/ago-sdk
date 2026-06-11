<template>
  <div class="page">
    <h2>Welcome</h2>
    <p>This is the Vue.js example app for the AGO Chat SDK.</p>
    <p>Use the chat widget on the left to interact with the AGO assistant. It can:</p>
    <ul>
      <li>Tell you the current time (<code>getCurrentTime</code>)</li>
      <li>Show notifications (<code>showNotification</code>)</li>
      <li>Navigate to any page (<code>navigateToPage</code>)</li>
      <li>Describe your browser (<code>getPageInfo</code>)</li>
    </ul>

    <h3>Highlights</h3>
    <ul>
      <li><strong>AgoPlugin</strong> installed in <code>main.ts</code> &mdash; provides the client to the whole app</li>
      <li><strong>useChat()</strong> composable &mdash; messages + conversations in one call</li>
      <li><strong>useAgoFunction()</strong> &mdash; declarative function registration with auto-cleanup</li>
      <li><strong>useAgoNavigation()</strong> &mdash; lets the AI navigate with vue-router</li>
    </ul>
  </div>
</template>
