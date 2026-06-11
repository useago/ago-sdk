<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
import ChatPanel from './components/ChatPanel.vue';
</script>

<template>
  <div class="app-container">
    <header class="app-header">
      <h1>AGO Chat SDK - Vue Example</h1>
      <nav class="app-nav">
        <RouterLink to="/" exact-active-class="active">Accueil</RouterLink>
        <RouterLink to="/about" active-class="active">A propos</RouterLink>
        <RouterLink to="/features" active-class="active">Fonctionnalites</RouterLink>
      </nav>
    </header>

    <main class="app-main">
      <div class="widget-container">
        <ChatPanel />
      </div>
      <div class="content-area">
        <RouterView />
      </div>
    </main>
  </div>
</template>

<style>
@import './style.css';
</style>
