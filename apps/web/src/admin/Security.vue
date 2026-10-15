<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  Button as AButton,
  Input as AInput,
  InputPassword as AInputPassword,
  Form as AForm,
  FormItem as AFormItem,
  Popconfirm as APopconfirm,
} from 'ant-design-vue';
import {
  changePasswordSchema,
  passkeyNameSchema,
  type PasskeySummary,
} from '../../../../packages/contracts/src/account-security';
import { errorMessage, session } from '../services/api';
import {
  addPasskey,
  cancelPasskey,
  changePassword,
  listPasskeys,
  passkeyError,
  passkeysSupported,
  removePasskey,
} from '../services/account-security';

const router = useRouter();
const passwordForm = reactive({ current_password: '', new_password: '', confirmation: '' });
const passkeyForm = reactive({ current_password: '', name: '' });
const passkeys = ref<PasskeySummary[]>([]);
const loading = ref(true),
  busy = ref(''),
  error = ref(''),
  notice = ref('');
const listError = ref(false);
const errorBanner = ref<HTMLElement | null>(null);
watch(error, async (message) => {
  if (!message) return;
  await nextTick();
  errorBanner.value?.focus();
});
const supported = passkeysSupported();
const controller = new AbortController();
async function refresh() {
  loading.value = true;
  listError.value = false;
  try {
    const result = await listPasskeys();
    if (!controller.signal.aborted) passkeys.value = result.passkeys;
  } catch (error) {
    if (!controller.signal.aborted) listError.value = true;
    throw error;
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}
async function run(action: string, work: () => Promise<void>) {
  if (busy.value) return;
  busy.value = action;
  error.value = '';
  notice.value = '';
  try {
    await work();
  } catch (e) {
    if (!controller.signal.aborted) error.value = passkeyError(e);
  } finally {
    if (!controller.signal.aborted) busy.value = '';
  }
}
async function updatePassword() {
  await run('password', async () => {
    changePasswordSchema.parse(passwordFormToInput());
    if (passwordForm.new_password !== passwordForm.confirmation)
      throw new Error('两次输入的新密码不一致');
    await changePassword(passwordForm.current_password, passwordForm.new_password);
    passwordForm.current_password = '';
    passwordForm.new_password = '';
    passwordForm.confirmation = '';
    if (controller.signal.aborted) return;
    session.user = null;
    await router.replace({ path: '/login', query: { password_changed: '1' } });
  });
}
const passwordFormToInput = () => ({
  current_password: passwordForm.current_password,
  new_password: passwordForm.new_password,
});
async function register() {
  await run('register', async () => {
    const name = passkeyNameSchema.parse(passkeyForm.name);
    await addPasskey(passkeyForm.current_password, name, controller.signal);
    passkeyForm.current_password = '';
    if (controller.signal.aborted) return;
    passkeyForm.name = '';
    notice.value = 'Passkey 已添加，下次可直接使用 Passkey 登录。';
    await refresh();
  });
}
async function remove(id: string) {
  await run(id, async () => {
    if (!passkeyForm.current_password) throw new Error('请先输入当前密码，再移除 Passkey');
    await removePasskey(id, passkeyForm.current_password);
    passkeyForm.current_password = '';
    if (controller.signal.aborted) return;
    notice.value = 'Passkey 已移除，其他登录会话已退出。';
    await refresh();
  });
}
onMounted(() => {
  void refresh().catch((e: unknown) => {
    if (!controller.signal.aborted) error.value = errorMessage(e);
  });
});
onBeforeUnmount(() => {
  controller.abort();
  cancelPasskey();
  passwordForm.current_password = '';
  passwordForm.new_password = '';
  passwordForm.confirmation = '';
  passkeyForm.current_password = '';
});
const date = (value: string) => new Date(value).toLocaleString('zh-CN');
</script>
<template>
  <div class="security-page">
    <h1>账号安全</h1>
    <p class="muted">{{ session.user?.username }}</p>
    <div v-if="error" ref="errorBanner" role="alert" tabindex="-1" class="error-banner">
      {{ error }}
    </div>
    <p v-if="notice" role="status" class="success-message">{{ notice }}</p>
    <section aria-labelledby="password-heading">
      <h2 id="password-heading">修改密码</h2>
      <p class="muted">
        新密码为 12–200 个字符。修改后所有登录会话退出，已添加的 Passkey 仍可使用。
      </p>
      <a-form
        name="change-password"
        layout="vertical"
        :model="passwordForm"
        :disabled="!!busy"
        scroll-to-first-error
        @finish="updatePassword"
      >
        <a-form-item
          label="当前密码"
          name="current_password"
          :rules="[{ required: true, message: '请输入当前密码' }]"
          ><a-input-password
            v-model:value="passwordForm.current_password"
            autocomplete="current-password"
            :maxlength="200"
        /></a-form-item>
        <a-form-item
          label="新密码"
          name="new_password"
          :rules="[{ required: true, min: 12, max: 200, message: '新密码为 12–200 个字符' }]"
          ><a-input-password
            v-model:value="passwordForm.new_password"
            autocomplete="new-password"
            :maxlength="200"
        /></a-form-item>
        <a-form-item
          label="确认新密码"
          name="confirmation"
          :rules="[{ required: true, message: '请再次输入新密码' }]"
          ><a-input-password
            v-model:value="passwordForm.confirmation"
            autocomplete="new-password"
            :maxlength="200"
        /></a-form-item>
        <a-button type="primary" html-type="submit" :loading="busy === 'password'"
          >修改密码并重新登录</a-button
        >
      </a-form>
    </section>
    <section aria-labelledby="passkey-heading">
      <h2 id="passkey-heading">Passkey 登录</h2>
      <p class="muted">
        使用设备的指纹、面容、PIN 或安全密钥登录。添加或移除前需输入当前密码，最多保留 10 个
        Passkey。
      </p>
      <p v-if="!supported" role="status">
        当前浏览器不支持 Passkey，请使用支持 Passkey 的浏览器并通过 HTTPS 或 localhost 访问。
      </p>
      <a-form
        name="passkey"
        layout="vertical"
        :model="passkeyForm"
        :disabled="!!busy"
        scroll-to-first-error
        @finish="register"
      >
        <a-form-item
          label="当前密码（添加或移除时验证）"
          name="current_password"
          :rules="[{ required: true, message: '请输入当前密码' }]"
          ><a-input-password
            v-model:value="passkeyForm.current_password"
            autocomplete="current-password"
            :maxlength="200"
        /></a-form-item>
        <a-form-item
          label="Passkey 名称"
          name="name"
          :rules="[{ required: true, whitespace: true, message: '请输入 Passkey 名称' }]"
          ><a-input
            v-model:value="passkeyForm.name"
            placeholder="例如：我的 MacBook"
            :maxlength="80"
        /></a-form-item>
        <a-button html-type="submit" :disabled="!supported || !!busy" :loading="busy === 'register'"
          >添加 Passkey</a-button
        >
      </a-form>
      <p v-if="loading" role="status">正在加载 Passkey…</p>
      <a-button v-else-if="listError" :disabled="!!busy" @click="run('reload', refresh)"
        >刷新 Passkey 列表</a-button
      >
      <ul v-if="passkeys.length" class="passkey-list">
        <li v-for="key in passkeys" :key="key.id">
          <div>
            <strong>{{ key.name }}</strong>
            <p class="muted">
              添加于 {{ date(key.created_at) }}<br />{{
                key.last_used_at ? `最近使用 ${date(key.last_used_at)}` : '尚未用于登录'
              }}
            </p>
          </div>
          <a-popconfirm
            title="移除此 Passkey 并退出其他登录会话？"
            ok-text="移除"
            cancel-text="取消"
            :disabled="!!busy"
            @confirm="remove(key.id)"
            ><a-button
              danger
              :disabled="!!busy"
              :loading="busy === key.id"
              :aria-label="`移除 ${key.name}`"
              >移除</a-button
            ></a-popconfirm
          >
        </li>
      </ul>
      <p v-else-if="!loading && !listError" class="muted">
        尚未添加 Passkey，请先添加再使用 Passkey 登录。
      </p>
    </section>
  </div>
</template>
<style scoped>
.security-page {
  max-width: 620px;
}
h1 {
  margin: 0 0 8px;
}
h2 {
  font-size: 18px;
  margin: 0 0 12px;
}
section {
  border-top: 1px solid var(--border);
  margin-top: 24px;
  padding-top: 24px;
}
.muted {
  color: var(--muted);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.success-message {
  color: #237546;
}
.passkey-list {
  padding: 0;
  margin-top: 24px;
  list-style: none;
}
.passkey-list li {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: space-between;
  padding: 16px 0;
  border-top: 1px solid var(--border);
}
.passkey-list li > div {
  min-width: 0;
  overflow-wrap: anywhere;
}
.passkey-list p {
  margin: 4px 0 0;
  font-size: 12px;
}
:deep(.ant-btn) {
  min-height: 44px;
  height: auto;
  white-space: normal;
}
:deep(.ant-input-affix-wrapper),
:deep(input.ant-input:not(.ant-input-affix-wrapper input)) {
  min-height: 44px;
}
</style>
