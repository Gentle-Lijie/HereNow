<script setup lang="ts">
defineProps<{ light?: boolean; small?: boolean }>();
</script>
<template>
  <div class="brand" :class="{ light, small }">
    <span class="brand-mark"><i></i><i></i><i></i><i></i></span
    ><span>HereNow<span class="brand-cn">在场</span></span>
  </div>
</template>
<style scoped>
.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  font-size: 22px;
  letter-spacing: -0.8px;
  font-weight: 750;
  color: #272927;
}
.brand.light {
  color: #fff;
}
.brand-mark {
  display: grid;
  grid-template-columns: repeat(2, 7px);
  gap: 4px;
  padding: 9px;
  background: var(--accent);
  border-radius: 10px;
}
.brand-mark i {
  height: 7px;
  background: #fff;
  border-radius: 2px;
}
.brand-mark i:last-child {
  opacity: 0.45;
}
.brand-cn {
  margin-left: 11px;
  font-size: 13px;
  letter-spacing: 2px;
  font-weight: 500;
  opacity: 0.5;
}
.small {
  font-size: 18px;
}
.small .brand-mark {
  padding: 7px;
}
</style>
