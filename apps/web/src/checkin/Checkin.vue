<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  Form as VanForm,
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
import { api, ApiError, formatTime } from '../services/api';
import { formatReceiptTime } from '../services/time';
import { receiptAnswers } from '../services/receipts';
import { locale, t, fieldLabel, publicErrorMessage } from '../services/locale';
import LanguageSwitch from '../components/LanguageSwitch.vue';
import EventBrand from '../components/EventBrand.vue';
import MobileFields from './MobileFields.vue';
const publicId = String(useRoute().params.publicId),
  sessionKey = `hn_session_${publicId}`,
  draftKey = `hn_draft_${publicId}`,
  attemptKey = `hn_attempt_${publicId}`,
  publicSession = ref<PublicSession>(),
  answers = ref<Answers>({}),
  loading = ref(true),
  submitting = ref(false),
  networkUncertain = ref(false),
  error = ref(''),
  expired = ref(false),
  consent = ref(false),
  result = ref<CheckinRecord>(),
  locationData = ref<LocationInput>(),
  locationStatus = ref<
    'idle' | 'loading' | 'ready' | 'unsupported' | 'denied' | 'timeout' | 'failed'
  >('idle'),
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
const savedAnswerRows = computed(() =>
  result.value && publicSession.value
    ? receiptAnswers(publicSession.value.event.fields, result.value.answers, locale.value)
    : [],
);
const draft = () => {
  sessionStorage.setItem(
    draftKey,
    JSON.stringify({
      answers: answers.value,
      expires: Date.now() + 1800000,
    }),
  );
};
watch(
  answers,
  () => {
    if (!result.value) draft();
  },
  { deep: true },
);
async function initialize() {
  loading.value = true;
  error.value = '';
  let legacyDraft = '';
  try {
    const saved = sessionStorage.getItem(draftKey);
    if (saved) {
      const d = JSON.parse(saved) as { identity?: string; answers: Answers; expires: number };
      if (d.expires > Date.now()) {
        legacyDraft = d.identity ?? '';
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
      if (!savedSession)
        throw new Error(
          t(
            '请扫描现场正在展示的活动二维码，开始签到。',
            'Please scan the current on-site event QR code to begin.',
          ),
        );
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
    if (legacyDraft && publicSession.value) {
      const field = publicSession.value.event.fields.find((f) => f.roster_match);
      if (field && answers.value[field.key] === undefined) answers.value[field.key] = legacyDraft;
    }
    if (publicSession.value) {
      const keys = new Set(publicSession.value.event.fields.map((field) => field.key));
      answers.value = Object.fromEntries(
        Object.entries(answers.value).filter(([key]) => keys.has(key)),
      );
    }
    timer = setInterval(() => {
      now.value = Date.now();
      if (remaining.value === 0 && !result.value) expired.value = true;
    }, 1000);
  } catch (e) {
    error.value = publicErrorMessage(e);
  } finally {
    loading.value = false;
  }
}
const locationState = computed(() => {
  switch (locationStatus.value) {
    case 'loading':
      return t('正在获取位置…', 'Getting your location…');
    case 'ready':
      return t(
        `已获取位置 · 误差约 ${Math.ceil(locationData.value?.accuracy ?? 0)} 米`,
        `Location received · accuracy about ${Math.ceil(locationData.value?.accuracy ?? 0)} m`,
      );
    case 'unsupported':
      return t(
        '此浏览器不支持定位，请联系现场工作人员',
        'This browser does not support location. Please contact staff.',
      );
    case 'denied':
      return t(
        '位置权限已关闭，请在浏览器设置中允许定位',
        'Location access is denied. Please enable it in browser settings.',
      );
    case 'timeout':
      return t('定位超时，请重试', 'Location request timed out. Please try again.');
    case 'failed':
      return t(
        '暂时无法获取位置，请重试或现场核验',
        'Unable to get your location. Please retry or contact staff.',
      );
    default:
      return t('未获取位置', 'Location not received');
  }
});
watch(locale, () => {
  error.value = '';
});
function locate() {
  if (!navigator.geolocation) {
    locationStatus.value = 'unsupported';
    return;
  }
  locating.value = true;
  locationStatus.value = 'loading';
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
      locationStatus.value = 'ready';
      locating.value = false;
    },
    (e) => {
      if (!alive) return;
      locationStatus.value = e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'failed';
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
    error.value = t(
      '请阅读并同意本次活动的信息收集说明',
      'Please read and agree to the event data collection notice.',
    );
    return;
  }
  const event = publicSession.value.event;
  try {
    if (!networkUncertain.value)
      validateAnswers(
        event.fields.map((field) => ({ ...field, label: fieldLabel(field) })),
        answers.value,
      );
  } catch (e) {
    error.value = publicErrorMessage(e);
    return;
  }
  if (!networkUncertain.value && event.location_mode === 'required' && !locationData.value) {
    error.value = t(
      '请先获取位置；如果无法定位，请联系现场工作人员。',
      'Please get your location first, or contact staff for assistance.',
    );
    return;
  }
  const body: CheckinInput = {
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
    error.value = publicErrorMessage(e);
    if (e instanceof ApiError && ['SESSION_EXPIRED', 'RULE_CHANGED'].includes(e.code))
      expired.value = true;
  } finally {
    submitting.value = false;
  }
}
function formFailed() {
  error.value = t('请检查标记的必填字段', 'Please check the highlighted required fields.');
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
  <div class="checkin-page" :lang="locale === 'en' ? 'en' : 'zh-CN'">
    <header class="checkin-header">
      <EventBrand
        :logo="publicSession?.event.checkin_logo"
        :name="publicSession?.event.name"
      /><LanguageSwitch />
    </header>
    <main class="checkin-main">
      <div v-if="loading" class="checkin-loading">
        <van-loading size="25px" color="#d6603d">{{
          t('正在准备本次签到…', 'Preparing your check-in…')
        }}</van-loading>
      </div>
      <section v-else-if="result" class="result-card">
        <div class="result-symbol" :class="result.status">
          <svg v-if="result.status === 'CHECKED_IN'" viewBox="0 0 40 40" aria-hidden="true">
            <path d="m10 20 7 7 14-15" /></svg
          ><span v-else>{{ result.status === 'PENDING_REVIEW' ? '…' : '!' }}</span>
        </div>
        <h1>
          {{
            locale === 'zh'
              ? checkinLabels[result.status]
              : result.status === 'CHECKED_IN'
                ? 'Checked in'
                : result.status === 'PENDING_REVIEW'
                  ? 'Pending review'
                  : 'Revoked'
          }}
        </h1>
        <p v-if="result.status === 'CHECKED_IN'" class="receipt-save-notice" role="status">
          {{
            t(
              '请截图保存本页，作为本次签到成功凭证。内容较长时可使用长截图。',
              'Take a screenshot of this page to save your successful check-in receipt. Use a scrolling screenshot for longer content.',
            )
          }}
        </p>
        <p v-if="result.status !== 'CHECKED_IN'">
          {{
            result.status === 'PENDING_REVIEW'
              ? t(
                  '请联系现场工作人员完成核验。',
                  'Please contact on-site staff to complete the review.',
                )
              : t(
                  '记录已撤销，请联系现场工作人员。',
                  'This check-in has been revoked. Please contact staff.',
                )
          }}
        </p>
        <div class="receipt-details">
          <div>
            <span>{{ t('活动', 'Event') }}</span
            ><strong>{{ publicSession?.event.name }}</strong>
          </div>
          <div>
            <span>{{ t('签到时间', 'Check-in time') }}</span
            ><strong>{{
              formatReceiptTime(result.checked_in_at, publicSession?.event.timezone)
            }}</strong>
          </div>
          <div>
            <span>{{ t('回执', 'Receipt') }}</span
            ><strong class="receipt-id">{{ result.receipt_id }}</strong>
          </div>
        </div>
        <section v-if="savedAnswerRows.length" class="receipt-answers">
          <h2>{{ t('填写信息', 'Submitted information') }}</h2>
          <dl>
            <div v-for="row in savedAnswerRows" :key="row.key">
              <dt>{{ row.label }}</dt>
              <dd>{{ row.value }}</dd>
            </div>
          </dl>
        </section>
        <div class="result-footer">
          {{
            result.status === 'CHECKED_IN'
              ? t(
                  '信息已记录，无需再次提交。',
                  'Your information has been saved. No need to submit again.',
                )
              : t('此状态不计为签到成功。', 'This status does not count as a successful check-in.')
          }}
        </div>
      </section>
      <template v-else
        ><section v-if="publicSession" class="checkin-intro">
          <h1>{{ publicSession.event.name }}</h1>
          <p v-if="publicSession.event.description" class="event-description">
            {{ publicSession.event.description }}
          </p>
          <div class="checkin-event-meta">
            <span
              ><svg viewBox="0 0 20 20" aria-hidden="true">
                <rect x="3" y="4" width="14" height="13" rx="2" />
                <path d="M6 2v4m8-4v4M3 9h14" /></svg
              ><span class="event-meta-text"
                >{{ formatTime(publicSession.event.starts_at, publicSession.event.timezone) }} —
                {{ formatTime(publicSession.event.ends_at, publicSession.event.timezone) }}</span
              ></span
            ><span v-if="publicSession.event.checkin_early_minutes > 0">
              {{ t('提前', 'Check-in opens') }} {{ publicSession.event.checkin_early_minutes }}
              {{ t('分钟开放签到', 'minutes before the event') }} </span
            ><span v-if="publicSession.event.location_label"
              ><svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M16 8c0 5-6 10-6 10S4 13 4 8a6 6 0 1 1 12 0Z" />
                <circle cx="10" cy="8" r="2" /></svg
              ><span class="event-meta-text">{{ publicSession.event.location_label }}</span></span
            >
          </div>
        </section>
        <div v-if="error" class="error-banner" role="alert">{{ error }}</div>
        <div v-if="expired" class="session-expired" role="alert">
          <strong>{{ t('这次扫码会话已结束', 'This scan session has ended') }}</strong>
          <p>
            {{
              t(
                '请重新扫描现场最新二维码。已填内容会短时保留。',
                'Please scan the latest on-site QR code. Your draft is kept temporarily.',
              )
            }}
          </p>
        </div>
        <template v-if="publicSession"
          ><p v-if="!expired" class="session-countdown" role="timer">
            {{ t('请在', 'Please submit within') }} {{ remaining }} {{ t('秒内提交', 'seconds') }}
          </p>
          <van-form :disabled="expired" scroll-to-error @submit="submit" @failed="formFailed"
            ><van-cell-group v-if="publicSession.event.fields.length" class="checkin-fields"
              ><MobileFields v-model="answers" :fields="publicSession.event.fields"
            /></van-cell-group>
            <section v-if="publicSession.event.location_mode !== 'off'" class="location-card">
              <div class="location-heading">
                <div>
                  <strong>{{
                    publicSession.event.location_mode === 'required'
                      ? t('现场定位', 'On-site location')
                      : t('记录本次位置', 'Record location')
                  }}</strong>
                  <p>
                    {{
                      publicSession.event.location_mode === 'required'
                        ? t(
                            '位置将用于判断签到范围。',
                            'Your location is used to check the permitted area.',
                          )
                        : t(
                            '获取失败仍可继续签到。',
                            'You can continue if location is unavailable.',
                          )
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
                  >{{
                    locationData ? t('重新获取', 'Locate again') : t('获取位置', 'Get location')
                  }}</van-button
                >
              </div>
            </section>
            <section class="privacy-card">
              <p>
                {{ publicSession.event.organizer }}
                {{
                  t(
                    '收集本次表单信息，用于活动签到管理。签到资料在活动结束后保留',
                    'collects this information to manage event check-ins. Records are kept after the event for',
                  )
                }}
                {{ publicSession.event.retention_days }} {{ t('天。', 'days.')
                }}{{
                  publicSession.event.location_mode === 'off'
                    ? t('本活动不采集位置。', 'This event does not collect location.')
                    : t(
                        '位置信息及相关证据单独保留 7 天。',
                        'Location and related evidence are retained separately for 7 days.',
                      )
                }}{{
                  publicSession.event.contact
                    ? t(
                        `如有疑问，请联系 ${publicSession.event.contact}。`,
                        `For questions, please contact ${publicSession.event.contact}.`,
                      )
                    : ''
                }}
              </p>
              <van-checkbox v-model="consent" icon-size="17px" checked-color="#d6603d">{{
                t('我已了解并同意本次信息收集', 'I understand and agree to this data collection')
              }}</van-checkbox>
            </section>
            <div class="checkin-submit">
              <van-button
                block
                type="primary"
                native-type="submit"
                :loading="submitting"
                :disabled="expired && !networkUncertain"
                :loading-text="t('正在提交…', 'Submitting…')"
                >{{
                  networkUncertain
                    ? t('确认上次提交结果', 'Check previous submission')
                    : t('确认签到', 'Confirm check-in')
                }}</van-button
              >
            </div></van-form
          ></template
        >
      </template>
    </main>
  </div>
</template>
<style scoped>
.checkin-page {
  --van-primary-color: #d6603d;
  --van-button-primary-background: #d6603d;
  --van-button-primary-border-color: #d6603d;
  --van-switch-on-background: #d6603d;
  --van-picker-confirm-action-color: #d6603d;
  --van-button-border-radius: 8px;
  --van-field-input-text-color: #2b302d;
  --van-field-label-color: #586455;
  --van-font-size-md: 16px;
  min-height: 100dvh;
  background: var(--surface);
}
.checkin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  max-width: 560px;
  margin: auto;
  padding: 16px;
}
.checkin-main {
  max-width: 560px;
  margin: auto;
  padding: 8px 16px 0;
}
.checkin-intro h1 {
  font-size: 24px;
  line-height: 1.4;
  margin: 0 0 12px;
  overflow-wrap: anywhere;
}
.event-description {
  font-size: 14px;
  color: var(--muted);
  white-space: pre-wrap;
  line-height: 1.6;
  margin-bottom: 12px;
  overflow-wrap: anywhere;
}
.checkin-event-meta {
  display: grid;
  gap: 8px;
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 16px;
}
.checkin-event-meta > span {
  display: flex;
  gap: 8px;
  align-items: center;
  line-height: 20px;
  overflow-wrap: anywhere;
}
.event-meta-text {
  min-width: 0;
}
.checkin-event-meta svg {
  display: block;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  flex-shrink: 0;
}
.session-countdown {
  font-size: 12px;
  color: var(--muted);
  margin: 0 0 8px;
}
.checkin-fields {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.checkin-fields :deep(.van-cell) {
  padding: 12px 16px;
  overflow: visible;
}
.checkin-fields :deep(.van-field__label--top) {
  margin-bottom: 4px;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.5;
  padding-block: 2px;
}
.checkin-fields :deep(.van-field__value),
.checkin-fields :deep(.van-field__body) {
  overflow: visible;
}
.checkin-fields :deep(.van-field__control) {
  font-size: 16px;
  line-height: 1.5;
  min-height: 44px;
}
.checkin-fields :deep(input.van-field__control),
.checkin-fields :deep(textarea.van-field__control) {
  height: auto;
  padding: 8px 0;
}
.checkin-fields :deep(textarea.van-field__control) {
  min-height: 72px;
}
.checkin-fields :deep(.van-field__control::placeholder) {
  color: #899085;
  font-size: 16px;
  line-height: inherit;
}
.location-card {
  margin-top: 12px;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.location-heading strong {
  font-size: 14px;
  font-weight: 500;
}
.location-heading p {
  font-size: 12px;
  color: var(--muted);
  margin: 4px 0 0;
}
.location-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}
.location-bottom > span {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}
.location-bottom .van-button {
  flex-shrink: 0;
  min-width: 88px;
  height: 44px;
  font-size: 14px;
}
.privacy-card {
  padding: 12px 0 8px;
}
.privacy-card p {
  font-size: 12px;
  color: #677160;
  line-height: 1.6;
  margin-bottom: 8px;
  overflow-wrap: anywhere;
}
.privacy-card :deep(.van-checkbox__label) {
  font-size: 13px;
  line-height: 1.5;
}
.privacy-card :deep(.van-checkbox) {
  min-height: 44px;
}
.checkin-submit {
  padding-bottom: max(16px, env(safe-area-inset-bottom));
}
.checkin-submit .van-button {
  height: 48px;
  font-size: 16px;
}
.checkin-loading {
  padding: 40px 0;
  text-align: center;
}
.session-expired {
  background: #fff3e0;
  border: 1px solid #eddac0;
  padding: 12px 16px;
  border-radius: 8px;
  color: #856322;
  margin-bottom: 12px;
  font-size: 14px;
}
.session-expired p {
  margin: 4px 0 0;
  font-size: 12px;
}
.result-card {
  text-align: center;
  padding: 16px 0;
}
.result-symbol {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #e9f2e3;
  display: grid;
  place-items: center;
  margin: 0 auto 16px;
  color: #557d3e;
  font-size: 28px;
}
.result-symbol svg {
  width: 32px;
  height: 32px;
  fill: none;
  stroke: currentColor;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.result-symbol.PENDING_REVIEW {
  background: #fff0d9;
  color: #986b22;
}
.result-symbol.REVOKED {
  background: #fae8e1;
  color: #a04b30;
}
.result-card h1 {
  margin: 0 0 8px;
  font-size: 24px;
}
.result-card > p {
  font-size: 14px;
  color: var(--muted);
}
.result-card > .receipt-save-notice {
  margin: 12px 0 16px;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--green);
  text-align: left;
  line-height: 1.6;
}
.receipt-answers {
  margin: 16px 0;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  text-align: left;
}
.receipt-answers h2 {
  margin: 0 0 12px;
  font-size: 16px;
  line-height: 1.5;
}
.receipt-answers dl {
  margin: 0;
}
.receipt-answers dl > div + div {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.receipt-answers dt {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.receipt-answers dd {
  margin: 4px 0 0;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.receipt-details {
  margin: 16px 0;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 16px;
}
.receipt-details > div {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 12px;
  margin: 8px 0;
  font-size: 14px;
  line-height: 1.5;
}
.receipt-details span {
  font-size: 13px;
  color: var(--muted);
}
.receipt-details strong {
  font-weight: 500;
  overflow-wrap: anywhere;
}
.receipt-id {
  font-size: 12px;
  font-family: monospace;
}
.result-footer {
  font-size: 12px;
  color: var(--muted);
}
</style>
