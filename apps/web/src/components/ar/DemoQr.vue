<script setup lang="ts">
/**
 * 演示用二维码图形（非真实可扫）：由文本哈希生成稳定图案 + 三个定位角。
 * 演示口径要求：任何"扫码"环节均标注「演示模拟 · DEMO」，不做真实核销。
 */
import { computed, onMounted, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{ text: string; size?: number; caption?: string }>(),
  { size: 132, caption: "" },
);

const canvas = ref<HTMLCanvasElement | null>(null);
const MODULES = 25;

function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function draw() {
  const el = canvas.value;
  if (!el) return;
  const dpr = window.devicePixelRatio || 1;
  const size = props.size;
  el.width = size * dpr;
  el.height = size * dpr;
  const ctx = el.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);

  const cell = size / MODULES;
  const rand = mulberry32(hash(props.text || "yongjia-ar"));
  ctx.fillStyle = "#0a1220";

  const inFinder = (r: number, c: number) =>
    (r < 8 && c < 8) || (r < 8 && c >= MODULES - 8) || (r >= MODULES - 8 && c < 8);

  for (let r = 0; r < MODULES; r++) {
    for (let c = 0; c < MODULES; c++) {
      if (inFinder(r, c)) continue;
      if (rand() > 0.52) continue;
      ctx.fillRect(c * cell, r * cell, cell, cell);
    }
  }

  const finder = (r: number, c: number) => {
    ctx.fillStyle = "#0a1220";
    ctx.fillRect(c * cell, r * cell, cell * 7, cell * 7);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect((c + 1) * cell, (r + 1) * cell, cell * 5, cell * 5);
    ctx.fillStyle = "#0a1220";
    ctx.fillRect((c + 2) * cell, (r + 2) * cell, cell * 3, cell * 3);
  };
  finder(0, 0);
  finder(0, MODULES - 7);
  finder(MODULES - 7, 0);
}

onMounted(draw);
watch(() => [props.text, props.size], draw);

const label = computed(() => props.caption || "演示二维码 · 不可真实核销");
</script>

<template>
  <div class="demo-qr">
    <canvas ref="canvas" :style="{ width: size + 'px', height: size + 'px' }" />
    <p class="demo-qr__caption">{{ label }}</p>
  </div>
</template>

<style scoped>
.demo-qr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
canvas {
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: #fff;
  padding: 4px;
  box-sizing: content-box;
}
.demo-qr__caption {
  font-size: 11px;
  color: var(--text-dim);
}
</style>
