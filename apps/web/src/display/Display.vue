<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorMessage } from '../services/api';
import DisplayCode from './DisplayCode.vue';
import './display-code.css';
const eventId = String(useRoute().params.id),
  timerHost = window,
  origin = location.origin;
const ready = ref(false),
  error = ref('');
onMounted(async () => {
  try {
    const token = new URLSearchParams(location.hash.slice(1)).get('d');
    if (token) {
      await api(`/display/events/${eventId}/connect`, { method: 'POST', body: { token } });
      history.replaceState(null, '', location.pathname);
    }
    ready.value = true;
  } catch (cause) {
    error.value = errorMessage(cause);
  }
});
</script>
<template>
  <DisplayCode v-if="ready" :event-id="eventId" :timer-host="timerHost" :origin="origin" />
  <main v-else class="display-code">
    <p role="status">{{ error || '正在准备签到码…' }}</p>
  </main>
</template>
