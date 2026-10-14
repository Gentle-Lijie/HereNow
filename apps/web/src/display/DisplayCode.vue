<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import QRCode from 'qrcode';
import { api, errorMessage } from '../services/api';
import EventBrand from '../components/EventBrand.vue';
const props = defineProps<{ eventId: string; timerHost: Window; origin: string }>();
const requests = new AbortController();
const name = ref('准备签到'),
  logo = ref<string | null>(null),
  qr = ref(''),
  expires = ref(0),
  offset = ref(0),
  now = ref(Date.now()),
  error = ref(''),
  loading = ref(true);
const remaining = computed(() =>
  Math.max(0, Math.ceil((expires.value - now.value - offset.value) / 1000)),
);
const canShow = computed(() => remaining.value > 0 && qr.value !== '');
let alive = true,
  refreshTimer: number | undefined,
  ticker: number | undefined;
async function refresh() {
  try {
    const info = await api<{ name: string; checkin_logo: string | null }>(
      `/display/events/${props.eventId}/info`,
      { signal: requests.signal },
    );
    if (!alive) return;
    name.value = info.name;
    logo.value = info.checkin_logo;
    const result = await api<{
      token: string;
      public_id: string;
      expires_at: string;
      server_time: string;
    }>(`/display/events/${props.eventId}/qr`, { signal: requests.signal });
    const image = await QRCode.toDataURL(
      `${props.origin}/s/${result.public_id}#q=${result.token}`,
      {
        width: 640,
        margin: 4,
        color: { dark: '#111111', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      },
    );
    if (!alive) return;
    qr.value = image;
    expires.value = Date.parse(result.expires_at);
    offset.value = Date.parse(result.server_time) - Date.now();
    now.value = Date.now();
    error.value = '';
  } catch (cause) {
    if (alive) {
      error.value = errorMessage(cause);
      const status = (cause as { status?: number }).status;
      if (status && status >= 400 && status < 500) {
        expires.value = 0;
        qr.value = '';
      }
    }
  } finally {
    if (alive) {
      loading.value = false;
      refreshTimer = props.timerHost.setTimeout(() => void refresh(), error.value ? 5000 : 30000);
    }
  }
}
onMounted(() => {
  ticker = props.timerHost.setInterval(() => {
    now.value = Date.now();
  }, 250);
  void refresh();
});
onBeforeUnmount(() => {
  alive = false;
  requests.abort();
  if (ticker !== undefined) props.timerHost.clearInterval(ticker);
  if (refreshTimer !== undefined) props.timerHost.clearTimeout(refreshTimer);
});
</script>
<template>
  <main class="display-code">
    <EventBrand :logo="logo" :name="name" />
    <h1>{{ name }}</h1>
    <p class="display-code__label">签到</p>
    <div class="display-code__qr">
      <img v-if="canShow" :src="qr" alt="活动动态签到二维码" />
      <p v-else role="status">
        {{ loading ? '正在生成签到码…' : error || '签到码已过期，正在刷新…' }}
      </p>
    </div>
    <output class="display-code__countdown" aria-label="签到码有效倒计时">{{
      canShow ? `${remaining} 秒` : '—'
    }}</output>
  </main>
</template>
