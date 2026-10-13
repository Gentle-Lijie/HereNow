<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ConfigProvider as AConfigProvider } from 'ant-design-vue';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import {
  AppstoreOutlined,
  PlusOutlined,
  LogoutOutlined,
  MenuOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons-vue';
import Brand from '../components/Brand.vue';
import { api, session } from '../services/api';
const menuOpen = ref(false),
  router = useRouter();
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
        controlHeight: 40,
      },
    }"
    ><div class="admin-shell">
      <aside :class="{ open: menuOpen }">
        <RouterLink to="/admin" class="sidebar-brand" @click="menuOpen = false"
          ><Brand
        /></RouterLink>
        <div class="workspace-label">
          <span class="workspace-avatar">H</span>
          <div>我的活动空间<small>轻量签到工作台</small></div>
          <span class="workspace-dot"></span>
        </div>
        <div class="nav-label">工作空间</div>
        <nav>
          <RouterLink to="/admin" @click="menuOpen = false"
            ><AppstoreOutlined />活动工作台<span class="nav-arrow">↗</span></RouterLink
          ><RouterLink
            v-if="session.user?.role === 'admin'"
            to="/admin/events/new"
            @click="menuOpen = false"
            ><PlusOutlined />创建活动</RouterLink
          >
        </nav>
        <div class="sidebar-note">
          <span class="note-icon">✳</span>
          <h3>简单签到，专注相聚。</h3>
          <p>一个活动，一张动态码。<br />让现场的每一步更从容。</p>
          <span>HERE. NOW. TOGETHER. <ArrowRightOutlined /></span>
        </div>
        <div class="sidebar-user">
          <span class="user-avatar">{{ session.user?.username.slice(0, 1).toUpperCase() }}</span>
          <div>
            {{ session.user?.username
            }}<small>{{ session.user?.role === 'admin' ? '管理员' : '现场操作员' }}</small>
          </div>
          <button aria-label="退出登录" @click="logout"><LogoutOutlined /></button>
        </div>
      </aside>
      <button
        v-if="menuOpen"
        class="sidebar-overlay"
        aria-label="关闭导航"
        @click="menuOpen = false"
      ></button>
      <div class="main-shell">
        <header>
          <button class="mobile-menu" aria-label="打开导航" @click="menuOpen = !menuOpen">
            <MenuOutlined /></button
          ><span class="header-breadcrumb">工作空间 <span>/</span> <strong>活动管理</strong></span>
          <div class="header-right">
            <span class="live-dot"></span> 每一份在场，都值得记录
            <span class="header-date">{{
              new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(new Date())
            }}</span>
          </div>
        </header>
        <main class="admin-main"><RouterView /></main>
        <footer><span>HereNow · 在场</span><span>为每一次相聚，留下温度。</span></footer>
      </div>
    </div></a-config-provider
  >
</template>
<style scoped>
.admin-shell {
  min-height: 100vh;
  display: flex;
}
aside {
  position: fixed;
  width: 246px;
  inset: 0 auto 0 0;
  background: #f6f6f1;
  border-right: 1px solid var(--border);
  padding: 34px 22px 20px;
  display: flex;
  flex-direction: column;
  z-index: 50;
}
.sidebar-brand {
  margin: 0 10px 38px;
}
.workspace-label {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 14px 10px;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  font-weight: 600;
}
.workspace-label small,
.sidebar-user small {
  display: block;
  font-size: 11px;
  font-weight: 400;
  color: var(--muted);
  margin-top: 5px;
}
.workspace-avatar {
  width: 33px;
  height: 33px;
  border-radius: 8px;
  background: #e6e9df;
  display: grid;
  place-items: center;
  font-size: 15px;
}
.workspace-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #72a27a;
  margin-left: auto;
}
.nav-label {
  font-size: 10px;
  letter-spacing: 2px;
  color: #92968d;
  padding: 28px 12px 13px;
}
nav {
  display: grid;
  gap: 7px;
}
nav a {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 13px 14px;
  border-radius: 8px;
  font-size: 14px;
  color: #777d72;
}
nav a.router-link-exact-active {
  background: #e9ece2;
  color: #3a4737;
  font-weight: 600;
}
nav a:hover {
  background: #eeefe8;
}
.nav-arrow {
  margin-left: auto;
  font-size: 17px;
}
.sidebar-note {
  margin-top: auto;
  padding: 25px 14px 32px;
}
.note-icon {
  font-size: 35px;
  color: #b2bda3;
}
.sidebar-note h3 {
  font-size: 13px;
  margin: 15px 0 10px;
  font-weight: 600;
}
.sidebar-note p {
  font-size: 12px;
  color: #848b7d;
  line-height: 1.9;
}
.sidebar-note > span:last-child {
  font-size: 8px;
  letter-spacing: 1.6px;
  color: #949c8c;
  display: flex;
  justify-content: space-between;
}
.sidebar-user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 4px 0;
  border-top: 1px solid var(--border);
  font-size: 12px;
}
.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #e0e5d6;
  display: grid;
  place-items: center;
  font-weight: 700;
}
.sidebar-user button {
  border: 0;
  background: none;
  color: #8b9384;
  margin-left: auto;
  padding: 10px;
}
.main-shell {
  margin-left: 246px;
  width: calc(100% - 246px);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
header {
  height: 78px;
  border-bottom: 1px solid var(--border);
  padding: 0 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  background: #ffffff80;
}
.header-breadcrumb {
  color: #a0a399;
}
.header-breadcrumb span {
  margin: 0 14px;
  color: #c2c6ba;
}
.header-breadcrumb strong {
  color: #66705f;
  font-weight: 500;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #85907d;
  font-size: 11px;
}
.live-dot {
  height: 5px;
  width: 5px;
  border-radius: 50%;
  background: #7aa376;
}
.header-date {
  border-left: 1px solid var(--border);
  padding-left: 20px;
  margin-left: 16px;
  color: #9c9f96;
}
.admin-main {
  padding: 38px 42px;
  max-width: 1440px;
  width: 100%;
  margin: 0 auto;
  flex: 1;
}
footer {
  display: flex;
  justify-content: space-between;
  padding: 22px 42px;
  font-size: 10px;
  letter-spacing: 0.5px;
  color: #a4a79d;
  border-top: 1px solid var(--border);
}
.mobile-menu {
  display: none;
}
.sidebar-overlay {
  display: none;
}
@media (max-width: 1023px) {
  aside {
    width: 205px;
    padding: 26px 15px;
  }
  .sidebar-brand {
    margin-bottom: 26px;
  }
  :deep(.brand-cn) {
    display: none;
  }
  .main-shell {
    margin-left: 205px;
    width: calc(100% - 205px);
  }
  header {
    padding: 0 24px;
  }
  .admin-main {
    padding: 28px 24px;
  }
  .header-right {
    display: none;
  }
}
@media (max-width: 767px) {
  aside {
    transform: translateX(-100%);
    width: 246px;
  }
  aside.open {
    transform: translateX(0);
  }
  .sidebar-overlay {
    display: block;
    position: fixed;
    inset: 0;
    background: #0005;
    border: 0;
    z-index: 40;
  }
  .main-shell {
    margin-left: 0;
    width: 100%;
  }
  header {
    height: 60px;
    padding: 0 20px;
    justify-content: flex-start;
    gap: 20px;
  }
  .mobile-menu {
    display: block;
    border: 0;
    background: none;
    padding: 8px;
  }
  .admin-main {
    padding: 25px 18px;
  }
  footer {
    padding: 20px 18px;
  }
  .sidebar-note {
    padding-bottom: 20px;
  }
}
</style>
