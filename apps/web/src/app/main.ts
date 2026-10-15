import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import { loadContext, session } from '../services/api';
import '../styles/base.css';
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/admin' },
    { path: '/login', component: () => import('../admin/Login.vue') },
    {
      path: '/admin',
      component: () => import('../admin/Layout.vue'),
      meta: { admin: true },
      children: [
        { path: '', component: () => import('../admin/Dashboard.vue') },
        { path: 'security', component: () => import('../admin/Security.vue') },
        { path: 'events/new', component: () => import('../admin/EventEditor.vue') },
        { path: 'events/:id', component: () => import('../admin/EventEditor.vue') },
        { path: 'events/:id/roster', component: () => import('../admin/Roster.vue') },
        { path: 'events/:id/records', component: () => import('../admin/Records.vue') },
      ],
    },
    { path: '/display/:id', component: () => import('../display/Display.vue') },
    { path: '/s/:publicId', component: () => import('../checkin/Checkin.vue') },
    { path: '/:pathMatch(.*)*', component: () => import('../components/NotFound.vue') },
  ],
});
router.beforeEach(async (to) => {
  try {
    await loadContext();
    if (to.meta.admin && !session.user) return { path: '/login', query: { redirect: to.fullPath } };
    if (to.path === '/login' && session.user) return '/admin';
  } catch {
    if (to.meta.admin) return '/login';
  }
});
createApp(App).use(router).mount('#app');
