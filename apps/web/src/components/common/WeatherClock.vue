<script setup lang="ts">
/* 导航栏「日期 · 时间 · 天气」轻量横条。
   与首页 Hero 解耦：这里只保留时钟 + /api/weather 当前天气，桌面端常驻导航栏，
   窄屏自动隐藏（导航栏区域有限，避免挤压搜索与模式标识）。 */
import { computed, onMounted, onUnmounted, ref } from "vue";

const now = ref(new Date());
let timer: ReturnType<typeof setInterval> | undefined;

const pad = (n: number) => String(n).padStart(2, "0");
const time = () => `${pad(now.value.getHours())}:${pad(now.value.getMinutes())}:${pad(now.value.getSeconds())}`;
const date = () => `${now.value.getMonth() + 1}月${now.value.getDate()}日 · 周${"日一二三四五六"[now.value.getDay()]}`;

interface WxPoint {
  time?: string;
  weather: string;
  temp: number;
}
interface WxPayload {
  location?: string;
  summary?: string;
  mock?: boolean;
  current?: WxPoint;
  forecast?: WxPoint[];
}
const wx = ref<WxPayload | null>(null);
const currentPoint = computed(() => wx.value?.current ?? wx.value?.forecast?.[0] ?? null);

const wxIcon = (t = "") => {
  const s = t;
  if (s.includes("暴") || s.includes("雷")) return "⛈";
  if (s.includes("雪")) return "🌨";
  if (s.includes("雨")) return s.includes("小") ? "🌦" : "🌧";
  if (s.includes("雾")) return "🌫";
  if (s.includes("阴")) return "☁";
  if (s.includes("云")) return s.includes("晴") ? "🌤" : "⛅";
  return "☀";
};

onMounted(async () => {
  timer = setInterval(() => (now.value = new Date()), 1000);
  try {
    const res = await fetch(`/api/weather?t=${Date.now()}`);
    if (!res.ok) return;
    const raw = (await res.json()) as { code: number; data: typeof wx.value };
    wx.value = raw?.data ?? null;
  } catch {
    /* 天气拉不到就只显示时钟，不打扰导航 */
  }
});

onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div class="wc" aria-label="当前日期时间与天气">
    <span class="wc__clock">{{ time() }}</span>
    <span class="wc__date">{{ date() }}</span>
    <template v-if="currentPoint">
      <span class="wc__sep" aria-hidden="true"></span>
      <span class="wc__wx" :title="wx?.summary || `${wx?.location || '永嘉'} · ${currentPoint.weather}`">
        <i class="wc__ic">{{ wxIcon(currentPoint.weather) }}</i>
        <b>{{ currentPoint.temp }}°C</b>
        <em class="wc__cond">{{ currentPoint.weather }}</em>
      </span>
    </template>
  </div>
</template>

<style scoped>
.wc {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  user-select: none;
}
.wc__clock {
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: 13px;
  color: var(--text-primary);
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
}
.wc__date {
  color: var(--text-dim);
}
.wc__sep {
  width: 1px;
  height: 12px;
  background: var(--border);
}
.wc__wx {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.wc__ic {
  font-style: normal;
  font-size: 13px;
  line-height: 1;
}
.wc__wx b {
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: 12.5px;
  color: var(--text-primary);
}
.wc__cond {
  font-style: normal;
  color: var(--text-secondary);
}
@media (max-width: 1280px) {
  .wc__date,
  .wc__cond {
    display: none;
  }
}
@media (max-width: 920px) {
  .wc {
    display: none;
  }
}
</style>
