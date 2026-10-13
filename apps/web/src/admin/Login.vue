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
      <div class="login-story">
        <Brand />
        <div class="story-copy">
          <span class="eyebrow">MAKE EVERY GATHERING COUNT</span>
          <h1>相聚的意义，<br />从在场开始<span>。</span></h1>
          <p>少一些繁琐，多一些从容。<br />让每一次活动签到，简单而有序。</p>
          <div class="gathering-art" aria-hidden="true">
            <div class="orbit orbit-one"></div>
            <div class="orbit orbit-two"></div>
            <div class="art-label">HERE<br /><em>& NOW</em></div>
            <span class="art-dot one"></span><span class="art-dot two"></span
            ><span class="art-dot three"></span>
          </div>
        </div>
        <div class="story-bottom">一个活动 · 一张动态码 · 每一份在场</div>
      </div>
      <main class="login-main">
        <div class="login-card">
          <span class="eyebrow">WELCOME BACK</span>
          <h2>欢迎回到在场</h2>
          <p class="muted">登录工作台，准备你的下一次相聚。</p>
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
              >进入工作台 <span class="login-arrow">↗</span></a-button
            ></a-form
          >
          <div class="login-footnote">参与活动？请扫描现场展示的活动二维码。</div>
        </div>
        <div class="login-copyright">HereNow · 为每一次相聚，留下温度。</div>
      </main>
    </div></a-config-provider
  >
</template>
<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 1fr 1fr;
}
.login-story {
  padding: 48px 9%;
  background: #eef0e7;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.story-copy {
  margin: auto 0;
  position: relative;
}
.story-copy .eyebrow {
  font-size: 10px;
  letter-spacing: 2.5px;
  color: #7a8870;
}
.story-copy h1 {
  font-size: clamp(38px, 4vw, 60px);
  line-height: 1.3;
  color: #394b37;
  margin: 30px 0 25px;
  font-weight: 650;
}
.story-copy h1 span {
  color: var(--accent);
}
.story-copy p {
  color: #7a8572;
  font-size: 14px;
  line-height: 1.9;
}
.gathering-art {
  height: 240px;
  position: relative;
  margin-top: 25px;
}
.orbit {
  position: absolute;
  border: 1px solid #ced6c4;
  border-radius: 50%;
  width: 290px;
  height: 190px;
  left: 0;
  top: 20px;
  transform: rotate(-30deg);
}
.orbit-two {
  transform: rotate(30deg);
}
.art-label {
  position: absolute;
  top: 53px;
  left: 70px;
  font-size: 47px;
  line-height: 0.95;
  letter-spacing: -3px;
  font-weight: 800;
  color: #b6c2a7;
}
.art-label em {
  font-style: normal;
  color: #879b75;
}
.art-dot {
  position: absolute;
  border-radius: 50%;
  width: 25px;
  height: 25px;
  background: #d6603d;
}
.art-dot.one {
  left: 250px;
  top: 30px;
}
.art-dot.two {
  left: 8px;
  top: 161px;
  background: #829673;
  width: 16px;
  height: 16px;
}
.art-dot.three {
  left: 205px;
  top: 215px;
  width: 9px;
  height: 9px;
  background: #aab99a;
}
.story-bottom {
  font-size: 10px;
  color: #87947c;
  letter-spacing: 2px;
  margin-top: 20px;
}
.login-main {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  padding: 70px 35px;
}
.login-card {
  max-width: 370px;
  width: 100%;
}
.login-card h2 {
  font-size: 29px;
  font-weight: 650;
  margin: 18px 0 12px;
  letter-spacing: -0.7px;
}
.login-card > .muted {
  font-size: 13px;
  margin-bottom: 35px;
}
.login-arrow {
  margin-left: 9px;
}
.login-footnote {
  margin-top: 27px;
  font-size: 11px;
  line-height: 1.7;
  color: #93978f;
  text-align: center;
}
.login-copyright {
  position: absolute;
  bottom: 30px;
  color: #a2a59b;
  font-size: 10px;
  letter-spacing: 0.5px;
}
@media (max-width: 767px) {
  .login-page {
    grid-template-columns: 1fr;
  }
  .login-story {
    padding: 24px;
    background: transparent;
  }
  .story-copy,
  .story-bottom {
    display: none;
  }
  .login-main {
    padding: 20px 24px 80px;
    min-height: 75vh;
  }
  .login-card h2 {
    font-size: 27px;
  }
}
</style>
