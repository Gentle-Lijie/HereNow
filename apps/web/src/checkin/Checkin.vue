<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  Form as VanForm,
  Field as VanField,
  CellGroup as VanCellGroup,
  Button as VanButton,
  Checkbox as VanCheckbox,
  Loading as VanLoading,
} from 'vant';
import 'vant/lib/index.css';
import {
  validateAnswers,
  checkinLabels,
  type Answers,
  type LocationInput,
  type CheckinRecord,
  type PublicSession,
  type CheckinInput,
} from '../../../../packages/contracts/src/index';
import { api, ApiError, errorMessage, formatTime } from '../services/api';
import Brand from '../components/Brand.vue';
import MobileFields from './MobileFields.vue';
const publicId = String(useRoute().params.publicId),
  sessionKey = `hn_session_${publicId}`,
  draftKey = `hn_draft_${publicId}`,
  attemptKey = `hn_attempt_${publicId}`,
  publicSession = ref<PublicSession>(),
  identity = ref(''),
  answers = ref<Answers>({}),
  loading = ref(true),
  submitting = ref(false),
  networkUncertain = ref(false),
  error = ref(''),
  expired = ref(false),
  consent = ref(false),
  result = ref<CheckinRecord>(),
  locationData = ref<LocationInput>(),
  locationState = ref('未获取位置'),
  locating = ref(false),
  now = ref(Date.now()),
  offset = ref(0),
  remaining = computed(() =>
    Math.max(
      0,
      Math.ceil(
        ((publicSession.value ? Date.parse(publicSession.value.expires_at) : 0) -
          now.value -
          offset.value) /
          1000,
      ),
    ),
  );
let timer: ReturnType<typeof setInterval> | undefined;
let alive = true;
let submitted: { key: string; body: CheckinInput } | undefined;
const draft = () => {
  sessionStorage.setItem(
    draftKey,
    JSON.stringify({
      identity: identity.value,
      answers: answers.value,
      expires: Date.now() + 1800000,
    }),
  );
};
watch(
  [identity, answers],
  () => {
    if (!result.value) draft();
  },
  { deep: true },
);
async function initialize() {
  loading.value = true;
  error.value = '';
  try {
    const saved = sessionStorage.getItem(draftKey);
    if (saved) {
      const d = JSON.parse(saved) as { identity: string; answers: Answers; expires: number };
      if (d.expires > Date.now()) {
        identity.value = d.identity;
        answers.value = d.answers;
      } else sessionStorage.removeItem(draftKey);
    }
    const qr = new URLSearchParams(location.hash.slice(1)).get('q');
    if (qr) {
      const data = await api<PublicSession>('/public/check-in-sessions', {
        method: 'POST',
        body: { token: qr, public_id: publicId },
      });
      publicSession.value = data;
      offset.value = Date.parse(data.server_time) - Date.now();
      sessionStorage.setItem(sessionKey, JSON.stringify(data));
      sessionStorage.removeItem(`${sessionKey}_receipt`);
      sessionStorage.removeItem(attemptKey);
      history.replaceState(null, '', location.pathname);
    } else {
      const savedSession = sessionStorage.getItem(sessionKey);
      if (!savedSession) throw new Error('请扫描现场正在展示的活动二维码，开始签到。');
      publicSession.value = JSON.parse(savedSession) as PublicSession;
      const pendingAttempt = sessionStorage.getItem(attemptKey);
      if (pendingAttempt) {
        const pending = JSON.parse(pendingAttempt) as {
          key: string;
          body: CheckinInput;
          session_id: string;
          expires: number;
        };
        if (pending.session_id === publicSession.value.session_id && pending.expires > Date.now()) {
          submitted = { key: pending.key, body: pending.body };
          networkUncertain.value = true;
        } else sessionStorage.removeItem(attemptKey);
      }
      const receipt = sessionStorage.getItem(`${sessionKey}_receipt`);
      if (receipt) {
        result.value = (
          await api<{ result: CheckinRecord }>(`/public/receipts/${receipt}`, {
            headers: { 'x-session-id': publicSession.value.session_id },
          })
        ).result;
      } else if (Date.parse(publicSession.value.expires_at) <= Date.now()) expired.value = true;
    }
    timer = setInterval(() => {
      now.value = Date.now();
      if (remaining.value === 0 && !result.value) expired.value = true;
    }, 1000);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}
function locate() {
  if (!navigator.geolocation) {
    locationState.value = '此浏览器不支持定位，请联系现场工作人员';
    return;
  }
  locating.value = true;
  locationState.value = '正在获取位置…';
  navigator.geolocation.getCurrentPosition(
    (p) => {
      if (!alive) return;
      locationData.value = {
        latitude: p.coords.latitude,
        longitude: p.coords.longitude,
        accuracy: p.coords.accuracy,
        coordinate_system: 'WGS84',
        source: 'browser_geolocation',
        captured_at: new Date(p.timestamp).toISOString(),
      };
      locationState.value = `已获取位置 · 误差约 ${Math.ceil(p.coords.accuracy)} 米`;
      locating.value = false;
    },
    (e) => {
      if (!alive) return;
      locationState.value =
        e.code === 1
          ? '位置权限已关闭，请在浏览器设置中允许定位'
          : e.code === 3
            ? '定位超时，请重试'
            : '暂时无法获取位置，请重试或现场核验';
      locationData.value = undefined;
      locating.value = false;
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
  );
}
async function submit() {
  if (!publicSession.value || submitting.value) return;
  error.value = '';
  if (!consent.value) {
    error.value = '请阅读并同意本次活动的信息收集说明';
    return;
  }
  const event = publicSession.value.event;
  try {
    if (!networkUncertain.value) validateAnswers(event.fields, answers.value);
  } catch (e) {
    error.value = errorMessage(e);
    return;
  }
  if (!networkUncertain.value && event.location_mode === 'required' && !locationData.value) {
    error.value = '请先获取位置；如果无法定位，请联系现场工作人员。';
    return;
  }
  const body: CheckinInput = {
    identity_value: identity.value,
    answers: { ...answers.value },
    ...(event.location_mode !== 'off' && locationData.value
      ? { location: { ...locationData.value } }
      : {}),
  };
  if (
    !submitted ||
    (!networkUncertain.value && JSON.stringify(body) !== JSON.stringify(submitted.body))
  )
    submitted = { key: crypto.randomUUID(), body };
  sessionStorage.setItem(
    attemptKey,
    JSON.stringify({
      ...submitted,
      session_id: publicSession.value.session_id,
      expires: Date.now() + 1800000,
    }),
  );
  submitting.value = true;
  try {
    const r = await api<{ result: CheckinRecord }>('/public/checkins', {
      method: 'POST',
      body: submitted.body,
      headers: { 'x-session-id': publicSession.value.session_id, 'Idempotency-Key': submitted.key },
    });
    networkUncertain.value = false;
    result.value = r.result;
    sessionStorage.setItem(`${sessionKey}_receipt`, r.result.receipt_id);
    sessionStorage.removeItem(draftKey);
    sessionStorage.removeItem(attemptKey);
  } catch (e) {
    networkUncertain.value = e instanceof ApiError && (e.status === 0 || e.status >= 500);
    if (!networkUncertain.value) sessionStorage.removeItem(attemptKey);
    error.value = errorMessage(e);
    if (e instanceof ApiError && ['SESSION_EXPIRED', 'RULE_CHANGED'].includes(e.code))
      expired.value = true;
  } finally {
    submitting.value = false;
  }
}
function formFailed() {
  error.value = '请检查标记的必填字段';
  document
    .querySelector('.van-field__error-message')
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
onMounted(initialize);
onBeforeUnmount(() => {
  alive = false;
  if (timer) clearInterval(timer);
});
</script>
<template>
  <div class="checkin-page">
    <header class="checkin-header"><Brand small /><span>一份在场，一份记录。</span></header>
    <main class="checkin-main">
      <div v-if="loading" class="checkin-loading">
        <van-loading size="25px" color="#d6603d">正在准备本次签到…</van-loading>
      </div>
      <section v-else-if="result" class="result-card">
        <div class="result-symbol" :class="result.status">
          <svg v-if="result.status === 'CHECKED_IN'" viewBox="0 0 40 40" aria-hidden="true">
            <path d="m10 20 7 7 14-15" /></svg
          ><span v-else>{{ result.status === 'PENDING_REVIEW' ? '…' : '!' }}</span>
        </div>
        <span class="eyebrow">THANK YOU FOR BEING HERE</span>
        <h1>{{ checkinLabels[result.status] }}</h1>
        <p>
          {{
            result.status === 'CHECKED_IN'
              ? '很高兴，你在这里。'
              : result.status === 'PENDING_REVIEW'
                ? '请联系现场工作人员完成核验。'
                : '记录已撤销，请联系现场工作人员。'
          }}
        </p>
        <div class="receipt-details">
          <div>
            <span>活动</span><strong>{{ publicSession?.event.name }}</strong>
          </div>
          <div>
            <span>签到时间</span
            ><strong>{{ formatTime(result.checked_in_at, publicSession?.event.timezone) }}</strong>
          </div>
          <div>
            <span>回执</span><strong class="receipt-id">{{ result.receipt_id }}</strong>
          </div>
        </div>
        <div class="result-footer">
          {{
            result.status === 'CHECKED_IN' ? '信息已记录，无需再次提交。' : '此状态不计为签到成功。'
          }}
        </div>
      </section>
      <template v-else
        ><section v-if="publicSession" class="checkin-intro">
          <span class="event-kicker">YOU'RE INVITED TO BE HERE</span>
          <h1>{{ publicSession.event.name }}</h1>
          <p v-if="publicSession.event.description" class="event-description">
            {{ publicSession.event.description }}
          </p>
          <div class="checkin-event-meta">
            <span
              ><svg viewBox="0 0 20 20" aria-hidden="true">
                <rect x="3" y="4" width="14" height="13" rx="2" />
                <path d="M6 2v4m8-4v4M3 9h14" /></svg
              >{{ formatTime(publicSession.event.starts_at, publicSession.event.timezone) }}</span
            ><span v-if="publicSession.event.location_label"
              ><svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M16 8c0 5-6 10-6 10S4 13 4 8a6 6 0 1 1 12 0Z" />
                <circle cx="10" cy="8" r="2" /></svg
              >{{ publicSession.event.location_label }}</span
            >
          </div>
        </section>
        <div v-if="error" class="error-banner" role="alert">{{ error }}</div>
        <div v-if="expired" class="session-expired" role="alert">
          <strong>这次扫码会话已结束</strong>
          <p>请重新扫描现场最新二维码。已填内容会短时保留。</p>
        </div>
        <template v-if="publicSession"
          ><section class="form-title">
            <h2>告诉我们，你已在场。</h2>
            <span v-if="!expired">{{ remaining }} 秒内提交</span>
          </section>
          <van-form :disabled="expired" scroll-to-error @submit="submit" @failed="formFailed"
            ><van-cell-group class="checkin-fields"
              ><van-field
                v-model="identity"
                :name="'identity_value'"
                :label="publicSession.event.identity_label"
                label-align="top"
                :type="publicSession.event.identity_type === 'phone' ? 'tel' : 'text'"
                :placeholder="`请输入${publicSession.event.identity_label}`"
                :maxlength="120"
                required
                :rules="[
                  { required: true, message: `请填写${publicSession.event.identity_label}` },
                ]" /><MobileFields v-model="answers" :fields="publicSession.event.fields"
            /></van-cell-group>
            <section v-if="publicSession.event.location_mode !== 'off'" class="location-card">
              <div class="location-heading">
                <span class="location-icon">◎</span>
                <div>
                  <strong>{{
                    publicSession.event.location_mode === 'required'
                      ? '确认你在活动现场'
                      : '记录本次位置'
                  }}</strong>
                  <p>
                    {{
                      publicSession.event.location_mode === 'required'
                        ? '位置将用于判断签到范围。'
                        : '获取失败仍可继续签到。'
                    }}
                  </p>
                </div>
              </div>
              <div class="location-bottom">
                <span role="status">{{ locationState }}</span
                ><van-button
                  plain
                  size="small"
                  :loading="locating"
                  :disabled="expired"
                  @click="locate"
                  >{{ locationData ? '重新获取' : '获取位置' }}</van-button
                >
              </div>
            </section>
            <section class="privacy-card">
              <h3>关于本次信息收集</h3>
              <p>
                {{ publicSession.event.organizer }}
                收集本次身份标识与表单信息，用于活动签到管理。签到资料在活动结束后保留
                {{ publicSession.event.retention_days }} 天。{{
                  publicSession.event.location_mode === 'off'
                    ? '本活动不采集位置。'
                    : '位置信息及相关证据单独保留 7 天。'
                }}{{
                  publicSession.event.contact
                    ? `如有疑问，请联系 ${publicSession.event.contact}。`
                    : ''
                }}
              </p>
              <van-checkbox v-model="consent" icon-size="17px" checked-color="#d6603d"
                >我已了解并同意本次信息收集</van-checkbox
              >
            </section>
            <div class="checkin-submit">
              <van-button
                block
                type="primary"
                native-type="submit"
                :loading="submitting"
                :disabled="expired && !networkUncertain"
                loading-text="正在提交…"
                >{{ networkUncertain ? '确认上次提交结果' : '确认签到' }} <span>↗</span></van-button
              >
              <p>网络中断时请重试，以服务器确认的结果为准。</p>
            </div></van-form
          ></template
        >
        <div v-else class="no-session-art" aria-hidden="true">
          <div>HERE<br /><em>& NOW</em></div>
        </div></template
      >
    </main>
    <footer class="checkin-footer">HereNow · 为每一次相聚，留下温度。</footer>
  </div>
</template>
<style scoped>
.checkin-page {
  --van-primary-color: #d6603d;
  --van-button-primary-background: #d6603d;
  --van-button-primary-border-color: #d6603d;
  --van-switch-on-background: #d6603d;
  --van-picker-confirm-action-color: #d6603d;
  --van-button-border-radius: 9px;
  --van-field-input-text-color: #3f483b;
  --van-field-label-color: #65705d;
  --van-font-size-md: 16px;
  min-height: 100dvh;
  background: #faf9f6;
}
.checkin-header {
  height: 78px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 15px;
  max-width: 560px;
  margin: auto;
  padding: 0 24px;
}
.checkin-header > span {
  font-size: 10px;
  color: #a2aa96;
}
.checkin-main {
  max-width: 560px;
  margin: auto;
  padding: 28px 24px 0;
}
.event-kicker {
  font-size: 9px;
  letter-spacing: 2px;
  color: #9aa789;
  font-weight: 600;
}
.checkin-intro h1 {
  font-size: 28px;
  line-height: 1.45;
  margin: 17px 0 14px;
  color: #3a4832;
  letter-spacing: -0.8px;
  overflow-wrap: anywhere;
}
.event-description {
  font-size: 13px;
  color: #89947e;
  white-space: pre-wrap;
  line-height: 1.9;
  margin-bottom: 20px;
}
.checkin-event-meta {
  display: grid;
  gap: 9px;
  font-size: 11px;
  color: #98a18b;
  border-bottom: 1px solid #e5e9dd;
  padding-bottom: 26px;
  margin-bottom: 26px;
}
.checkin-event-meta > span {
  display: flex;
  gap: 9px;
  align-items: center;
}
.checkin-event-meta svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  flex-shrink: 0;
}
.form-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}
.form-title h2 {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  color: #56664a;
}
.form-title > span {
  font-size: 10px;
  color: #a2ab96;
}
.checkin-fields {
  border: 1px solid #e4e8dc;
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}
.checkin-fields :deep(.van-cell) {
  padding: 18px 20px;
}
.checkin-fields :deep(.van-field__label--top) {
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 500;
}
.checkin-fields :deep(.van-field__control) {
  font-size: 16px;
  line-height: 1.6;
}
.checkin-fields :deep(.van-field__control::placeholder) {
  color: #bec6b3;
  font-size: 13px;
}
.checkin-fields :deep(.van-cell::after) {
  border-color: #edf0e6;
}
.location-card {
  margin-top: 20px;
  padding: 19px;
  background: #f0f4e8;
  border: 1px solid #e0e9d2;
  border-radius: 9px;
}
.location-heading {
  display: flex;
  gap: 12px;
  align-items: center;
}
.location-icon {
  font-size: 30px;
  color: #8b9f77;
}
.location-heading strong {
  font-size: 12px;
  font-weight: 500;
  color: #728760;
}
.location-heading p {
  font-size: 10px;
  color: #9bab8b;
  margin: 6px 0 0;
}
.location-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 17px;
}
.location-bottom > span {
  font-size: 10px;
  color: #879c6f;
  line-height: 1.6;
}
.location-bottom .van-button {
  flex-shrink: 0;
  height: 44px;
  border-color: #b9cba6;
  color: #7e9467;
  background: transparent;
  font-size: 11px;
}
.privacy-card {
  padding: 22px 3px 16px;
}
.privacy-card h3 {
  font-size: 12px;
  color: #68795b;
  font-weight: 500;
  margin: 0 0 8px;
}
.privacy-card p {
  font-size: 12px;
  color: #75806c;
  line-height: 1.9;
  margin-bottom: 19px;
}
.privacy-card :deep(.van-checkbox__label) {
  font-size: 12px;
  color: #58684e;
  line-height: 1.7;
}
.checkin-submit {
  padding: 5px 0 max(20px, env(safe-area-inset-bottom));
  position: relative;
}
.privacy-card :deep(.van-checkbox) {
  min-height: 44px;
}
.checkin-submit .van-button {
  height: 49px;
  font-size: 16px;
  letter-spacing: 0.5px;
}
.checkin-submit .van-button span {
  margin-left: 15px;
}
.checkin-submit > p {
  font-size: 10px;
  color: #aab29f;
  text-align: center;
  margin: 13px 0 0;
}
.checkin-footer {
  text-align: center;
  color: #afb6a5;
  font-size: 9px;
  letter-spacing: 0.5px;
  padding: 27px 18px max(24px, env(safe-area-inset-bottom));
}
.checkin-loading {
  padding: 80px 0;
  text-align: center;
}
.session-expired {
  background: #fff3e0;
  border: 1px solid #eddac0;
  padding: 17px;
  border-radius: 8px;
  color: #9b792e;
  margin-bottom: 20px;
  font-size: 12px;
}
.session-expired p {
  margin: 8px 0 0;
  font-size: 11px;
}
.result-card {
  text-align: center;
  padding: 35px 0;
}
.result-symbol {
  width: 76px;
  height: 76px;
  border-radius: 50%;
  background: #e9f2e3;
  display: grid;
  place-items: center;
  margin: 0 auto 32px;
  color: #71975b;
  font-size: 30px;
}
.result-symbol svg {
  width: 39px;
  height: 39px;
  fill: none;
  stroke: #789c62;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.result-symbol.PENDING_REVIEW {
  background: #fff0d9;
  color: #b7893d;
}
.result-symbol.REVOKED {
  background: #fae8e1;
  color: #b26246;
}
.result-card > .eyebrow {
  font-size: 8px;
  letter-spacing: 2px;
  color: #a0ad91;
}
.result-card h1 {
  margin: 20px 0 10px;
  font-size: 30px;
  color: #566b44;
}
.result-card > p {
  font-size: 13px;
  color: #92a180;
}
.receipt-details {
  margin: 35px 0 22px;
  text-align: left;
  background: #fff;
  border: 1px solid #e3e9da;
  border-radius: 10px;
  padding: 22px;
}
.receipt-details > div {
  display: grid;
  grid-template-columns: 70px 1fr;
  gap: 16px;
  margin: 13px 0;
  font-size: 12px;
  line-height: 1.7;
}
.receipt-details span {
  font-size: 11px;
  color: #a2ac94;
}
.receipt-details strong {
  font-weight: 500;
  color: #6f7e62;
}
.receipt-id {
  font-size: 10px;
  overflow-wrap: anywhere;
  font-family: monospace;
}
.result-footer {
  font-size: 11px;
  color: #a4ae98;
}
.no-session-art {
  height: 250px;
  display: grid;
  place-items: center;
  color: #c1cbb6;
}
.no-session-art > div {
  font-size: 55px;
  line-height: 1;
  font-weight: 800;
  letter-spacing: -3px;
}
.no-session-art em {
  font-style: normal;
  color: #d6dccc;
}
@media (max-width: 359px) {
  .checkin-header {
    padding: 0 18px;
  }
  .checkin-header > span {
    display: none;
  }
  .checkin-main {
    padding: 20px 18px 0;
  }
  .checkin-intro h1 {
    font-size: 25px;
  }
  .checkin-fields :deep(.van-cell) {
    padding: 17px 16px;
  }
}
</style>
