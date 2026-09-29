<script setup lang="ts">
// 站点品牌：mark 图标 + 放大文字组合
import { ref } from "vue";

const markFailed = ref(false);
</script>

<template>
  <span class="site-logo">
    <span class="site-logo__mark">
      <img
        v-if="!markFailed"
        src="/assets/brand/logo-mark.svg"
        alt="永嘉新游"
        width="34"
        height="34"
        @error="markFailed = true"
      />
      <span v-else class="site-logo__fallback">永</span>
    </span>
    <span class="site-logo__text">
      <span class="site-logo__cn">永嘉新游</span>
      <span class="site-logo__en">YONGJIA ZHIYOU</span>
    </span>
  </span>
</template>

<style scoped>
.site-logo {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.site-logo__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  overflow: hidden;
  background: linear-gradient(135deg, rgba(62, 198, 184, 0.22), rgba(232, 184, 75, 0.12));
  flex: none;
}
.site-logo__mark img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.site-logo__fallback {
  font-size: 18px;
  font-weight: 800;
  color: var(--primary);
  line-height: 1;
}
.site-logo__text {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  line-height: 1.1;
}
.site-logo__cn {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: var(--text-primary);
}
.site-logo__en {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.28em;
  color: var(--text-dim);
  margin-top: 2px;
}

@media (max-width: 880px) {
  .site-logo__cn {
    font-size: 22px;
  }
}
</style>
