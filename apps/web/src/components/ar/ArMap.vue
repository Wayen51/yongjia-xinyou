<script setup lang="ts">
/**
 * 板块二 · AR 互动：离线底图组件（运营端打点 + 玩家端雷达共用）
 * 底图自绘无在线瓦片，坐标换算见 @/lib/geo；断网可演示。
 * 数据来源：assets/ar/map/geo-anchors.json + yongjia-overview.webp
 */
import { computed, onMounted, ref } from "vue";
import { latLngToPx, loadAnchors, metersPerPx, pxToLatLng, type AnchorSet, type GeoAnchors } from "@/lib/geo";
import type { ArMapMarker } from "./types";

const props = withDefaults(
  defineProps<{
    markers?: ArMapMarker[];
    player?: { lat: number; lng: number } | null;
    scene?: "overview" | "shiweiyan";
    height?: number;
    interactive?: boolean;
    draggable?: boolean;
    activeId?: string | null;
    showLegend?: boolean;
    /** 定位精度半径（米），用于画「实时定位」精度圈 */
    accuracy?: number | null;
    /** 设备朝向（度），用于画方向指示 */
    heading?: number | null;
    /** 从玩家位置连线到该点的路线（如当前目标点位） */
    routeTarget?: { lat: number; lng: number } | null;
    /** 路线中点的距离文案 */
    routeLabel?: string;
    /** 雷达扫描动效 */
    scanning?: boolean;
    /** 玩家标记文案 */
    meLabel?: string;
    /** 交互提示文案（运营端=放置点位，玩家端=移动位置） */
    pickTip?: string;
    /** 其他玩家位置（后台监控大屏用） */
    peers?: Array<{ id: string; name: string; lat: number; lng: number; state?: string }>;
  }>(),
  {
    markers: () => [],
    player: null,
    scene: "overview",
    height: 420,
    interactive: false,
    draggable: false,
    activeId: null,
    showLegend: true,
    accuracy: null,
    heading: null,
    routeTarget: null,
    routeLabel: "",
    scanning: false,
    meLabel: "我的位置",
    pickTip: "点击地图放置点位 · 拖动标记可微调",
    peers: () => [],
  },
);

const emit = defineEmits<{
  (e: "map-click", v: { lat: number; lng: number }): void;
  (e: "marker-click", id: string): void;
  (e: "marker-move", v: { id: string; lat: number; lng: number }): void;
}>();

const anchors = ref<GeoAnchors | null>(null);
const set = computed<AnchorSet | null>(() =>
  anchors.value ? anchors.value[props.scene === "shiweiyan" ? "shiweiyan_map" : "overview_map"] : null,
);
const imgRef = ref<HTMLDivElement | null>(null);
const dragging = ref<string | null>(null);

onMounted(async () => {
  anchors.value = await loadAnchors();
});

const bg = computed(() => (set.value ? `/assets/ar/${set.value.image}` : ""));
const ratio = computed(() => (set.value ? set.value.width / set.value.height : 16 / 9));

function place(lat: number, lng: number) {
  if (!set.value) return { left: "0%", top: "0%" };
  const { x, y } = latLngToPx(set.value, lat, lng);
  return {
    left: `${(x / set.value.width) * 100}%`,
    top: `${(y / set.value.height) * 100}%`,
  };
}

function fenceStyle(m: ArMapMarker) {
  if (!set.value || !m.radius) return {};
  const pct = ((m.radius / metersPerPx(set.value, m.lat)) / set.value.width) * 100;
  return { width: `${pct * 2}%`, aspectRatio: "1 / 1" };
}

const scaleBar = computed(() => {
  if (!set.value) return null;
  const meters = 200;
  const pct = ((meters / metersPerPx(set.value, 28.3)) / set.value.width) * 100;
  return { pct, label: `${meters} m` };
});

/** 定位精度圈：把「米」换算成底图百分比直径 */
const accuracyStyle = computed(() => {
  if (!set.value || !props.player || !props.accuracy || props.accuracy <= 0) return null;
  const pct = ((props.accuracy / metersPerPx(set.value, props.player.lat)) / set.value.width) * 100;
  return { ...place(props.player.lat, props.player.lng), width: `${pct * 2}%`, aspectRatio: "1 / 1" };
});

/** 玩家 → 目标点 的路线（用于「距离/方向」可视化） */
const route = computed(() => {
  if (!set.value || !props.player || !props.routeTarget) return null;
  return {
    a: latLngToPx(set.value, props.player.lat, props.player.lng),
    b: latLngToPx(set.value, props.routeTarget.lat, props.routeTarget.lng),
    mid: {
      lat: (props.player.lat + props.routeTarget.lat) / 2,
      lng: (props.player.lng + props.routeTarget.lng) / 2,
    },
  };
});

function toLatLng(clientX: number, clientY: number) {
  const el = imgRef.value;
  if (!el || !set.value) return null;
  const rect = el.getBoundingClientRect();
  const px = ((clientX - rect.left) / rect.width) * set.value.width;
  const py = ((clientY - rect.top) / rect.height) * set.value.height;
  return pxToLatLng(set.value, px, py);
}

function onMapClick(e: MouseEvent) {
  if (!props.interactive || dragging.value) return;
  const ll = toLatLng(e.clientX, e.clientY);
  if (ll) emit("map-click", ll);
}

function onMarkerDown(m: ArMapMarker, e: PointerEvent) {
  emit("marker-click", m.id);
  if (!props.draggable || !props.interactive) return;
  dragging.value = m.id;
  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
}

function onMarkerMove(m: ArMapMarker, e: PointerEvent) {
  if (dragging.value !== m.id) return;
  const ll = toLatLng(e.clientX, e.clientY);
  if (ll) emit("marker-move", { id: m.id, lat: ll.lat, lng: ll.lng });
}

function endDrag() {
  dragging.value = null;
}

const stateClass = (m: ArMapMarker) => `armap__pin--${m.state ?? "pending"}`;
</script>

<template>
  <div class="armap" :style="{ aspectRatio: String(ratio), maxHeight: height + 'px' }">
    <div
      ref="imgRef"
      class="armap__canvas"
      :class="{ 'armap__canvas--pick': interactive }"
      :style="{ backgroundImage: `url(${bg})` }"
      @click="onMapClick"
    >
      <!-- 围栏半径 -->
      <div
        v-for="m in markers.filter((x) => x.radius && (x.state === 'current' || x.state === 'solved' || x.id === activeId))"
        :key="'fence-' + m.id"
        class="armap__fence"
        :style="{ ...place(m.lat, m.lng), ...fenceStyle(m) }"
      />

      <!-- 实时定位精度圈 -->
      <div v-if="accuracyStyle" class="armap__acc" :style="accuracyStyle" />

      <!-- 玩家 → 目标 路线 -->
      <svg
        v-if="route && set"
        class="armap__route"
        :viewBox="`0 0 ${set.width} ${set.height}`"
        preserveAspectRatio="none"
      >
        <line :x1="route.a.x" :y1="route.a.y" :x2="route.b.x" :y2="route.b.y" />
      </svg>
      <span v-if="route && routeLabel" class="armap__route-label" :style="place(route.mid.lat, route.mid.lng)">
        {{ routeLabel }}
      </span>

      <!-- 点位 -->
      <button
        v-for="m in markers"
        :key="m.id"
        class="armap__pin"
        :class="[stateClass(m), { 'armap__pin--on': m.id === activeId }]"
        :style="place(m.lat, m.lng)"
        :title="`${m.name}${m.sub ? ' · ' + m.sub : ''}`"
        @pointerdown="onMarkerDown(m, $event)"
        @pointermove="onMarkerMove(m, $event)"
        @pointerup="endDrag"
        @pointercancel="endDrag"
      >
        <span class="armap__dot">
          <span v-if="m.order" class="armap__order">{{ m.order }}</span>
        </span>
        <span class="armap__label">{{ m.name }}</span>
      </button>

      <!-- 玩家位置 -->
      <div v-if="player" class="armap__me" :style="place(player.lat, player.lng)">
        <span v-if="heading != null" class="armap__me-head" :style="{ transform: `rotate(${heading}deg)` }" />
        <span class="armap__me-ring" />
        <span class="armap__me-dot" />
        <span class="armap__label armap__label--me">{{ meLabel }}</span>
      </div>

      <!-- 雷达扫描动效 -->
      <div v-if="scanning && player" class="armap__scan" :style="place(player.lat, player.lng)">
        <span />
      </div>

      <!-- 其他玩家（后台监控大屏） -->
      <div
        v-for="p in peers"
        :key="'peer-' + p.id"
        class="armap__peer"
        :class="`armap__peer--${p.state || 'outside'}`"
        :style="place(p.lat, p.lng)"
        :title="p.name"
      >
        <span class="armap__peer-dot" />
        <span class="armap__peer-name">{{ p.name }}</span>
      </div>

      <!-- HUD -->
      <div class="armap__hud">
        <span class="armap__chip">离线底图 · 演示</span>
        <span v-if="scaleBar" class="armap__scale">
          <i :style="{ width: scaleBar.pct + '%' }" />
          <em>{{ scaleBar.label }}</em>
        </span>
      </div>

      <div v-if="interactive" class="armap__tip">{{ pickTip }}</div>

      <div v-if="showLegend" class="armap__legend">
        <span><i class="lg lg--pending" />待解锁</span>
        <span><i class="lg lg--current" />当前目标</span>
        <span><i class="lg lg--solved" />已通关</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.armap {
  position: relative;
  width: 100%;
  border-radius: var(--radius-card);
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
}
.armap__canvas {
  position: relative;
  width: 100%;
  height: 100%;
  background-size: 100% 100%;
  background-repeat: no-repeat;
  background-color: var(--color-surface-2);
  user-select: none;
}
.armap__canvas--pick {
  cursor: crosshair;
}

.armap__pin {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  z-index: 3;
}
.armap__dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-inverse);
  background: var(--text-dim);
  border: 2px solid rgba(255, 255, 255, 0.75);
  box-shadow: var(--shadow-pop);
}
.armap__pin--current .armap__dot {
  background: var(--accent);
  animation: pulse 1.6s ease-in-out infinite;
}
.armap__pin--solved .armap__dot {
  background: var(--success);
}
.armap__pin--locked .armap__dot {
  background: var(--color-surface-3);
  color: var(--text-dim);
  border-color: var(--color-line-strong);
}
.armap__pin--on .armap__dot {
  outline: 3px solid var(--primary-soft);
}
.armap__order {
  line-height: 1;
}
.armap__label {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  background: rgba(10, 18, 32, 0.78);
  color: var(--text-primary);
  white-space: nowrap;
  border: 1px solid rgba(255, 255, 255, 0.12);
}
.armap__label--me {
  color: var(--color-info);
  border-color: rgba(96, 165, 250, 0.4);
}

.armap__fence {
  position: absolute;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 1.5px dashed rgba(232, 184, 75, 0.75);
  background: radial-gradient(circle, rgba(232, 184, 75, 0.16), rgba(232, 184, 75, 0.04));
  pointer-events: none;
  z-index: 2;
}

/* 实时定位精度圈 */
.armap__acc {
  position: absolute;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 1px solid rgba(96, 165, 250, 0.55);
  background: radial-gradient(circle, rgba(96, 165, 250, 0.18), rgba(96, 165, 250, 0.03));
  pointer-events: none;
  z-index: 2;
}

/* 玩家 → 目标 路线 */
.armap__route {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 2;
  overflow: visible;
}
.armap__route line {
  stroke: rgba(96, 165, 250, 0.85);
  stroke-width: 3;
  stroke-dasharray: 10 8;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}
.armap__route-label {
  position: absolute;
  transform: translate(-50%, -50%);
  font-size: 11px;
  font-family: var(--font-mono);
  color: #dbeafe;
  background: rgba(10, 18, 32, 0.82);
  border: 1px solid rgba(96, 165, 250, 0.45);
  border-radius: var(--radius-pill);
  padding: 1px 8px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 5;
}

/* 雷达扫描动效 */
.armap__scan {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 320px;
  height: 320px;
  pointer-events: none;
  z-index: 2;
}
.armap__scan span {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2px solid rgba(62, 198, 184, 0.6);
  background: radial-gradient(circle, rgba(62, 198, 184, 0.22), transparent 70%);
  animation: radar 1.1s var(--ease-out) infinite;
}
@keyframes radar {
  0% {
    transform: scale(0.15);
    opacity: 0.9;
  }
  100% {
    transform: scale(1);
    opacity: 0;
  }
}

.armap__me {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  z-index: 4;
}
.armap__me-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--color-info);
  border: 2px solid #fff;
  box-shadow: 0 0 12px rgba(96, 165, 250, 0.9);
}
/* 设备朝向指示 */
.armap__me-head {
  position: absolute;
  top: -22px;
  left: 50%;
  margin-left: -6px;
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-bottom: 13px solid var(--color-info);
  transform-origin: 50% 28px;
  filter: drop-shadow(0 0 6px rgba(96, 165, 250, 0.85));
  z-index: 5;
}

/* 其他玩家（后台监控大屏） */
.armap__peer {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  pointer-events: none;
  z-index: 3;
}
.armap__peer-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.85);
  background: rgba(148, 163, 184, 0.95);
  box-shadow: 0 0 10px rgba(148, 163, 184, 0.8);
}
.armap__peer--inside .armap__peer-dot {
  background: var(--success);
  box-shadow: 0 0 12px rgba(74, 222, 128, 0.9);
}
.armap__peer--done .armap__peer-dot {
  background: var(--accent);
  box-shadow: 0 0 12px rgba(232, 184, 75, 0.9);
}
.armap__peer-name {
  font-size: 10px;
  line-height: 1.3;
  color: #e6edf7;
  background: rgba(10, 18, 32, 0.72);
  border-radius: var(--radius-pill);
  padding: 0 6px;
  white-space: nowrap;
}
.armap__me-ring {
  position: absolute;
  top: 0;
  width: 40px;
  height: 40px;
  margin-top: -13px;
  border-radius: 50%;
  border: 2px solid rgba(96, 165, 250, 0.5);
  animation: ring 2s ease-out infinite;
}

.armap__hud {
  position: absolute;
  left: 10px;
  bottom: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 5;
}
.armap__chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  background: rgba(10, 18, 32, 0.72);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  width: fit-content;
}
.armap__scale {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 90px;
}
.armap__scale i {
  display: block;
  height: 6px;
  border-left: 1px solid #fff;
  border-right: 1px solid #fff;
  border-bottom: 2px solid #fff;
}
.armap__scale em {
  font-size: 10px;
  font-style: normal;
  color: var(--text-secondary);
}

.armap__tip {
  position: absolute;
  right: 10px;
  bottom: 10px;
  font-size: 11px;
  color: var(--text-secondary);
  background: rgba(10, 18, 32, 0.72);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  padding: 2px 10px;
  z-index: 5;
}

.armap__legend {
  position: absolute;
  right: 10px;
  top: 10px;
  display: flex;
  gap: 10px;
  font-size: 11px;
  color: var(--text-secondary);
  background: rgba(10, 18, 32, 0.72);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  padding: 3px 10px;
  z-index: 5;
}
.armap__legend span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.lg {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.lg--pending {
  background: var(--text-dim);
}
.lg--current {
  background: var(--accent);
}
.lg--solved {
  background: var(--success);
}

@keyframes pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.18);
  }
}
@keyframes ring {
  0% {
    transform: scale(0.6);
    opacity: 0.9;
  }
  100% {
    transform: scale(1.5);
    opacity: 0;
  }
}
</style>
