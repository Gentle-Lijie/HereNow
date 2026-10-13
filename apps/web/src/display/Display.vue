<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import QRCode from 'qrcode';
import { api, errorMessage } from '../services/api';
import Brand from '../components/Brand.vue';
const id = String(useRoute().params.id),
  name = ref('准备现场签到'),
  locationLabel = ref(''),
  qrImage = ref(''),
  joinUrl = ref(''),
  expires = ref(0),
  offset = ref(0),
  now = ref(Date.now()),
  error = ref(''),
  loading = ref(true),
  remaining = computed(() =>
    Math.max(0, Math.ceil((expires.value - now.value - offset.value) / 1000)),
  ),
  canShow = computed(() => remaining.value > 0 && qrImage.value !== ''),
  fullscreen = ref(false);
let ticker: ReturnType<typeof setInterval> | undefined,
  refreshTimer: ReturnType<typeof setTimeout> | undefined,
  alive = true;
async function refresh() {
  try {
    const r = await api<{
      name: string;
      location_label: string;
      token: string;
      public_id: string;
      expires_at: string;
      server_time: string;
    }>(`/display/events/${id}/qr`);
    if (!alive) return;
    name.value = r.name;
    locationLabel.value = r.location_label;
    joinUrl.value = `${location.origin}/s/${r.public_id}#q=${r.token}`;
    const image = await QRCode.toDataURL(joinUrl.value, {
      width: 640,
      margin: 4,
      color: { dark: '#283b24', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    });
    if (!alive) return;
    qrImage.value = image;
    expires.value = Date.parse(r.expires_at);
    offset.value = Date.parse(r.server_time) - Date.now();
    error.value = '';
  } catch (e) {
    if (alive) {
      error.value = errorMessage(e);
      if ((e as { status?: number }).status === 400) expires.value = 0;
    }
  } finally {
    loading.value = false;
    if (alive) refreshTimer = setTimeout(() => void refresh(), error.value ? 5000 : 30000);
  }
}
async function initialize() {
  try {
    const token = new URLSearchParams(location.hash.slice(1)).get('d');
    if (token) {
      await api(`/display/events/${id}/connect`, { method: 'POST', body: { token } });
      history.replaceState(null, '', location.pathname);
    }
    await refresh();
    ticker = setInterval(() => {
      now.value = Date.now();
    }, 1000);
  } catch (e) {
    error.value = errorMessage(e);
    loading.value = false;
  }
}
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      fullscreen.value = false;
    } else {
      await document.documentElement.requestFullscreen();
      fullscreen.value = true;
    }
  } catch {
    error.value = '当前浏览器不支持全屏，仍可正常展示签到码';
  }
}
onMounted(initialize);
onBeforeUnmount(() => {
  alive = false;
  if (ticker) clearInterval(ticker);
  if (refreshTimer) clearTimeout(refreshTimer);
});
</script>
<template>
  <div class="display-page">
    <header class="display-header">
      <Brand />
      <div class="display-controls">
        <RouterLink to="/admin">返回工作台</RouterLink
        ><button @click="toggleFullscreen">
          {{ fullscreen ? '退出全屏' : '全屏展示' }} <span>↗</span>
        </button>
      </div>
    </header>
    <main class="display-main">
      <div class="display-copy">
        <span class="display-kicker">GLAD YOU'RE HERE.</span>
        <h1>{{ name }}</h1>
        <p>扫一扫，让我们知道你已在场<span>。</span></p>
        <div v-if="locationLabel" class="display-location">◎ {{ locationLabel }}</div>
      </div>
      <div class="qr-card">
        <div v-if="canShow" class="qr-wrapper">
          <img :src="qrImage" alt="活动动态签到二维码" /><span class="qr-corner top-left"></span
          ><span class="qr-corner top-right"></span><span class="qr-corner bottom-left"></span
          ><span class="qr-corner bottom-right"></span>
        </div>
        <div v-else class="qr-unavailable">
          <span>{{ loading ? '◌' : '↻' }}</span
          ><strong>{{ loading ? '正在生成签到码' : '签到码暂不可用' }}</strong>
          <p>{{ error || '正在获取现场最新签到码…' }}</p>
        </div>
        <div class="qr-caption">
          <span :class="['connection-dot', { offline: error || !canShow }]"></span
          ><span>{{
            error ? '连接异常，正在重试' : canShow ? '动态签到码已就绪' : '等待有效签到码'
          }}</span
          ><strong v-if="canShow">{{ remaining }}s</strong>
        </div>
        <div class="qr-progress">
          <i :style="{ width: `${Math.min(100, (remaining / 45) * 100)}%` }"></i>
        </div>
      </div>
      <div class="display-steps">
        <span><b>01</b> 扫描活动码</span><i></i><span><b>02</b> 填写必要信息</span><i></i
        ><span><b>03</b> 确认签到</span>
      </div>
      <a
        v-if="canShow"
        class="preview-link"
        :href="joinUrl"
        target="_blank"
        rel="noopener noreferrer"
        >在此设备预览签到页 ↗</a
      >
      <div v-if="error && canShow" class="display-warning" role="alert">
        {{ error }} · 当前码将在到期后隐藏
      </div>
    </main>
    <footer class="display-footer">
      <span>HERE. NOW. TOGETHER.</span><span>每一份在场，都值得记录。</span>
    </footer>
  </div>
</template>
<style scoped>
.display-page {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: #f2f4ea;
  color: #3f5134;
  position: relative;
  overflow: hidden;
}
.display-page::before,
.display-page::after {
  content: '';
  position: absolute;
  width: 700px;
  height: 700px;
  border: 1px solid #dfe6d4;
  border-radius: 50%;
  pointer-events: none;
  z-index: 0;
}
.display-page::before {
  left: -500px;
  top: 80px;
}
.display-page::after {
  right: -490px;
  bottom: -80px;
}
.display-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 32px 48px;
  position: relative;
  z-index: 1;
  gap: 20px;
}
.display-controls {
  display: flex;
  gap: 25px;
  align-items: center;
  font-size: 12px;
  color: #98a488;
}
.display-controls button {
  border: 1px solid #d7dfcc;
  background: transparent;
  border-radius: 7px;
  padding: 10px 17px;
  color: #788d62;
  font-size: 11px;
}
.display-controls button > span {
  margin-left: 13px;
}
.display-main {
  flex: 1;
  display: flex;
  align-items: center;
  flex-direction: column;
  justify-content: center;
  padding: 15px 24px 35px;
  position: relative;
  z-index: 1;
}
.display-copy {
  text-align: center;
  max-width: 750px;
}
.display-kicker {
  font-size: 10px;
  letter-spacing: 3px;
  color: #a4b291;
}
.display-copy h1 {
  font-size: clamp(26px, 3vw, 41px);
  margin: 22px 0 14px;
  line-height: 1.4;
  color: #4e6340;
  letter-spacing: -1.3px;
  overflow-wrap: anywhere;
}
.display-copy p {
  font-size: 14px;
  letter-spacing: 1px;
  color: #8fa17e;
  margin: 0 0 15px;
}
.display-copy p > span {
  color: var(--accent);
}
.display-location {
  font-size: 11px;
  color: #a2af92;
  margin-bottom: 24px;
}
.qr-card {
  background: #fff;
  border: 1px solid #e1e8d6;
  padding: 20px 25px 0;
  border-radius: 16px;
  width: min(390px, 75vw);
  box-shadow: 0 16px 40px #687e4610;
  overflow: hidden;
  margin-top: 10px;
}
.qr-wrapper {
  position: relative;
  aspect-ratio: 1;
}
.qr-wrapper img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.qr-corner {
  width: 15px;
  height: 15px;
  border-color: #e7ebdf;
  position: absolute;
  border-style: solid;
}
.top-left {
  top: 0;
  left: 0;
  border-width: 2px 0 0 2px;
}
.top-right {
  top: 0;
  right: 0;
  border-width: 2px 2px 0 0;
}
.bottom-left {
  bottom: 0;
  left: 0;
  border-width: 0 0 2px 2px;
}
.bottom-right {
  bottom: 0;
  right: 0;
  border-width: 0 2px 2px 0;
}
.qr-caption {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 10px;
  color: #9da88e;
  padding: 16px 2px 18px;
}
.connection-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #83a56a;
}
.connection-dot.offline {
  background: #ca9b50;
}
.qr-caption strong {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  color: #91a47e;
  font-weight: 500;
}
.qr-progress {
  height: 3px;
  background: #eef2e7;
  margin: 0 -25px;
}
.qr-progress i {
  display: block;
  height: 100%;
  background: #a9bd91;
  transition: width 1s linear;
}
.qr-unavailable {
  aspect-ratio: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  text-align: center;
  padding: 20px;
}
.qr-unavailable > span {
  font-size: 40px;
  color: #b0bd9d;
  margin-bottom: 25px;
}
.qr-unavailable strong {
  font-size: 15px;
  font-weight: 500;
  color: #82956c;
}
.qr-unavailable p {
  font-size: 11px;
  color: #a1ac94;
  margin: 13px 0 0;
}
.display-steps {
  display: flex;
  gap: 20px;
  align-items: center;
  margin: 31px 0 17px;
  color: #9ba88d;
  font-size: 11px;
}
.display-steps b {
  font-size: 9px;
  font-weight: 500;
  color: #afbaa2;
  margin-right: 6px;
}
.display-steps > i {
  width: 25px;
  height: 1px;
  background: #dce4d1;
}
.preview-link {
  font-size: 9px;
  color: #a2af91;
  border-bottom: 1px solid #dce4d0;
  padding: 3px;
}
.display-warning {
  font-size: 11px;
  color: #a68a49;
  margin-top: 12px;
}
.display-footer {
  display: flex;
  justify-content: space-between;
  padding: 22px 48px;
  position: relative;
  z-index: 1;
  color: #b2bda5;
  font-size: 9px;
}
.display-footer > span:first-child {
  letter-spacing: 1.8px;
}
@media (max-width: 767px) {
  .display-header {
    padding: 23px 20px;
  }
  .display-controls {
    gap: 10px;
    font-size: 10px;
  }
  .display-controls > button {
    display: none;
  }
  .display-main {
    padding: 20px 20px 30px;
  }
  .display-copy h1 {
    font-size: 27px;
  }
  .display-copy p {
    font-size: 12px;
  }
  .display-steps {
    gap: 10px;
    font-size: 10px;
  }
  .display-steps > i {
    width: 14px;
  }
  .display-steps b {
    display: none;
  }
  .display-footer {
    padding: 22px 20px;
    font-size: 8px;
  }
  .qr-card {
    width: min(360px, 86vw);
    padding: 15px 20px 0;
  }
  .qr-progress {
    margin: 0 -20px;
  }
}
@media (max-height: 650px) and (min-width: 768px) {
  .display-header {
    padding: 18px 35px;
  }
  .display-main {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 40px;
    max-width: 1050px;
    margin: auto;
    padding: 15px 30px;
  }
  .display-copy {
    grid-column: 1;
    grid-row: 1;
    text-align: left;
  }
  .qr-card {
    grid-column: 2;
    grid-row: 1/4;
    width: 320px;
  }
  .display-steps {
    grid-column: 1;
    margin: 15px 0;
  }
  .preview-link {
    grid-column: 1;
    justify-self: start;
  }
  .display-footer {
    padding: 15px 35px;
  }
}
</style>
