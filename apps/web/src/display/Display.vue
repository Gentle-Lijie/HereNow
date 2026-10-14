<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../services/api';
import { t, publicErrorMessage } from '../services/locale';
import LanguageSwitch from '../components/LanguageSwitch.vue';
import DisplayCode from './DisplayCode.vue';
import './display-code.css';
const eventId = String(useRoute().params.id),
  timerHost = window,
  origin = location.origin;
const ready = ref(false),
  error = ref('');
const updateTitle = (value: string) => {
  document.title = value;
};
onMounted(async () => {
  try {
    const token = new URLSearchParams(location.hash.slice(1)).get('d');
    if (token) {
      await api(`/display/events/${eventId}/connect`, { method: 'POST', body: { token } });
      history.replaceState(null, '', location.pathname);
    }
    ready.value = true;
  } catch (cause) {
    error.value = publicErrorMessage(cause);
  }
});
</script>
<template>
  <div class="display-route">
    <LanguageSwitch class="display-language" />
    <DisplayCode
      v-if="ready"
      :event-id="eventId"
      :timer-host="timerHost"
      :origin="origin"
      @title="updateTitle"
    />
    <main v-else class="display-code">
      <p role="status">{{ error || t('正在准备签到码…', 'Preparing QR code…') }}</p>
    </main>
  </div>
</template>
<style scoped>
.display-language {
  position: fixed;
  top: 4px;
  right: 8px;
  z-index: 1;
}
</style>
