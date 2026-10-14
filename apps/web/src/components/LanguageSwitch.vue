<script setup lang="ts">
import { locale, setLocale } from '../services/locale';
</script>
<template>
  <div class="language-switch" aria-label="Language / 语言">
    <button type="button" :aria-pressed="locale === 'zh'" @click="setLocale('zh')">中文</button>
    <button type="button" :aria-pressed="locale === 'en'" @click="setLocale('en')">English</button>
  </div>
</template>
<style scoped>
.language-switch {
  display: flex;
  gap: 4px;
  align-items: center;
}
.language-switch button {
  border: 0;
  background: transparent;
  color: #7a807a;
  padding: 8px;
  min-height: 44px;
  font-size: 13px;
  cursor: pointer;
}
.language-switch button[aria-pressed='true'] {
  color: #2b302d;
  font-weight: 600;
}
</style>
