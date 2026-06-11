import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import { AgoPlugin } from '@useago/sdk/vue';
import App from './App.vue';
import Home from './pages/Home.vue';
import About from './pages/About.vue';
import Features from './pages/Features.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Home },
    { path: '/about', component: About },
    { path: '/features', component: Features },
  ],
});

const app = createApp(App);

app.use(router);

app.use(AgoPlugin, {
  baseUrl: 'https://ago.api.useago.com',
  agent: 'generic-guide',
  debug: true,
});

app.mount('#app');
