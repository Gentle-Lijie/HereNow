<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ConfigProvider as AConfigProvider } from 'ant-design-vue';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import { AppstoreOutlined, PlusOutlined, LogoutOutlined } from '@ant-design/icons-vue';
import Brand from '../components/Brand.vue';
import { api, session } from '../services/api';
const router = useRouter(),
  route = useRoute();
const creating = computed(() => route.path === '/admin/events/new');
async function logout() {
  await api('/admin/logout', { method: 'POST' });
  session.user = null;
  await router.push('/login');
}
</script>
<template>
  <a-config-provider
    :locale="zhCN"
    :theme="{
      token: {
        colorPrimary: '#d6603d',
        borderRadius: 7,
        fontFamily: 'inherit',
        colorText: '#2b302d',
        controlHeight: 36,
        colorBgLayout: '#ffffff',
        colorBgContainer: '#ffffff',
      },
    }"
  >
    <div class="admin-shell">
      <header class="admin-header">
        <div class="header-content">
          <RouterLink to="/admin" class="header-brand" aria-label="HereNow 活动工作台">
            <Brand small />
          </RouterLink>
          <nav class="admin-nav" aria-label="后台导航">
            <RouterLink to="/admin" :class="{ active: !creating }">
              <AppstoreOutlined />活动工作台
            </RouterLink>
            <RouterLink
              v-if="session.user?.role === 'admin'"
              to="/admin/events/new"
              :class="{ active: creating }"
            >
              <PlusOutlined />创建活动
            </RouterLink>
          </nav>
          <div class="header-account">
            <span class="account-name" :title="session.user?.username">
              {{ session.user?.username }}
            </span>
            <span class="account-role">
              {{ session.user?.role === 'admin' ? '管理员' : '现场操作员' }}
            </span>
            <button class="logout-button" aria-label="退出登录" title="退出登录" @click="logout">
              <LogoutOutlined /><span>退出</span>
            </button>
          </div>
        </div>
      </header>
      <main class="admin-main"><RouterView /></main>
    </div>
  </a-config-provider>
</template>
<style scoped>
.admin-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.admin-header {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.header-content {
  max-width: 1440px;
  margin: 0 auto;
  padding: 8px 24px;
  display: flex;
  align-items: center;
  gap: 28px;
  min-height: 64px;
}
.header-brand {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  min-height: 44px;
}
.admin-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}
.admin-nav a,
.logout-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 12px;
  border-radius: 7px;
  color: var(--muted);
  font-size: 14px;
  white-space: nowrap;
}
.admin-nav a:hover,
.logout-button:hover {
  background: #f7f7f5;
  color: #2b302d;
}
.admin-nav a.active {
  background: #fff3ee;
  color: var(--accent);
  font-weight: 600;
}
.header-account {
  margin-left: auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.account-name {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.account-role {
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}
.logout-button {
  flex-shrink: 0;
  min-width: 44px;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.header-brand:focus-visible,
.admin-nav a:focus-visible,
.logout-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.admin-main {
  padding: 24px;
  max-width: 1440px;
  width: 100%;
  margin: 0 auto;
  flex: 1;
}
@media (max-width: 1023px) {
  .header-content {
    gap: 16px;
  }
  .account-name {
    max-width: 100px;
  }
  .account-role {
    display: none;
  }
}
@media (max-width: 767px) {
  .header-content {
    flex-wrap: wrap;
    padding: 8px 16px;
    gap: 4px 12px;
  }
  :deep(.brand-cn) {
    display: none;
  }
  .admin-nav {
    order: 1;
    width: 100%;
  }
  .account-name {
    max-width: 80px;
  }
  .logout-button {
    padding: 0;
  }
  .logout-button > span:last-child {
    display: none;
  }
  .admin-main {
    padding: 16px;
  }
}
</style>
