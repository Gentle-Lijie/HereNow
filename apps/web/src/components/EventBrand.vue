<script setup lang="ts">
import { ref, watch } from 'vue';
import Brand from './Brand.vue';
const props = withDefaults(
  defineProps<{ logo?: string | null; name?: string; small?: boolean }>(),
  { small: true, logo: null, name: '' },
);
const failed = ref(false);
watch(
  () => props.logo,
  () => {
    failed.value = false;
  },
);
</script>
<template>
  <img
    v-if="logo?.startsWith('data:image/png;base64,') && !failed"
    class="event-logo"
    :class="{ large: !small }"
    :src="logo"
    :alt="`${name || '活动'} Logo`"
    @error="failed = true"
  />
  <Brand v-else :small="small" />
</template>
<style scoped>
.event-logo {
  display: block;
  max-width: 180px;
  max-height: 36px;
  width: auto;
  height: auto;
  object-fit: contain;
}
.event-logo.large {
  max-width: 240px;
  max-height: 48px;
}
</style>
