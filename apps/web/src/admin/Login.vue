<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import {
  Button as AButton,
  Input as AInput,
  InputPassword as AInputPassword,
  Form as AForm,
  FormItem as AFormItem,
  ConfigProvider as AConfigProvider,
} from 'ant-design-vue';
import Brand from '../components/Brand.vue';
import { api, loadContext, errorMessage } from '../services/api';
const form = reactive({ username: '', password: '' }),
  busy = ref(false),
  error = ref(''),
  router = useRouter(),
  route = useRoute();
async function login() {
  busy.value = true;
  error.value = '';
  try {
    await api('/admin/login', { method: 'POST', body: form });
    await loadContext(true);
    const redirect = String(route.query.redirect ?? '/admin');
    await router.replace(redirect.startsWith('/admin') ? redirect : '/admin');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <a-config-provider
    :theme="{ token: { colorPrimary: '#d6603d', borderRadius: 8, controlHeight: 46 } }"
    ><div class="login-page">
      <main class="login-main">
        <div class="login-card">
          <Brand />
          <h1>登录工作台</h1>
          <div v-if="error" role="alert" class="error-banner">{{ error }}</div>
          <a-form layout="vertical" :model="form" @finish="login"
            ><a-form-item
              label="账号"
              name="username"
              :rules="[{ required: true, message: '请输入账号' }]"
              ><a-input
                v-model:value="form.username"
                autocomplete="username"
                placeholder="输入管理员或操作员账号" /></a-form-item
            ><a-form-item
              label="密码"
              name="password"
              :rules="[{ required: true, message: '请输入密码' }]"
              ><a-input-password
                v-model:value="form.password"
                autocomplete="current-password"
                placeholder="输入登录密码" /></a-form-item
            ><a-button type="primary" html-type="submit" block :loading="busy"
              >登录</a-button
            ></a-form
          >
          <div class="login-footnote">参与活动？请扫描现场展示的活动二维码。</div>
        </div>
      </main>
    </div></a-config-provider
  >
</template>
<style scoped>
.login-page {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  background: var(--surface);
  padding: 24px 16px;
}
.login-main {
  width: min(100%, 360px);
}
.login-card h1 {
  font-size: 24px;
  margin: 24px 0;
}
.login-footnote {
  margin-top: 16px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted);
}
</style>
