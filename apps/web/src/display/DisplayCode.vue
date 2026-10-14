<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watchEffect } from 'vue';
import QRCode from 'qrcode';
import { api } from '../services/api';
import { locale, t, publicErrorMessage } from '../services/locale';
import EventBrand from '../components/EventBrand.vue';
const props = defineProps<{ eventId: string; timerHost: Window; origin: string }>();
const emit = defineEmits<{ title: [string] }>();
const requests = new AbortController();
const name = ref(''),
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
      error.value = publicErrorMessage(cause);
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
watchEffect(() => {
  emit('title', t('活动签到', 'Event check-in'));
});
</script>
<template>
  <main class="display-code" :lang="locale === 'en' ? 'en' : 'zh-CN'">
    <EventBrand :logo="logo" :name="name" />
    <h1>{{ name || t('准备签到', 'Preparing check-in') }}</h1>
    <p class="display-code__label">{{ t('签到', 'Check in') }}</p>
    <div class="display-code__qr">
      <img
        v-if="canShow"
        :src="qr"
        :alt="t('活动动态签到二维码', 'Dynamic event check-in QR code')"
      />
      <p v-else role="status">
        {{
          loading
            ? t('正在生成签到码…', 'Generating QR code…')
            : error || t('签到码已过期，正在刷新…', 'QR code expired. Refreshing…')
        }}
      </p>
    </div>
    <output
      class="display-code__countdown"
      :aria-label="t('签到码有效倒计时', 'QR code expiry countdown')"
      >{{ canShow ? `${remaining} ${t('秒', 's')}` : '—' }}</output
    >
  </main>
</template>
