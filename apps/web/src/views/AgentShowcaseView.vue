<script setup lang="ts">
/**
 * 效果展示 · 永嘉 3D 景点场景里的 Agent 运行效果
 *
 * 一屏讲清三件事：
 * ① 3D 景点场景可视化 —— 永嘉 6 个景点的 360° 全景现场，可环视、可点击热点
 * ② Agent 在身边怎么跑 —— 「感知 → 决策 → 动作」逐帧回放，镜头随 Agent 转向对应热点
 * ③ AR 交互演示 —— 同一套场景底座在手机端 AR 实景里的叠加效果（可切「围栏外/围栏内」）
 *
 * 演示口径：Agent 运行脚本由场景热点自动编排（服务端 buildAgentScript），
 * 不是硬编码动画；镜头转向、讲解文案、停留时长均来自真实热点数据。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { api } from "@/api/client";
import PanoViewer from "@/components/space/PanoViewer.vue";
import ArCameraStage from "@/components/ar/ArCameraStage.vue";
import { toast } from "@/lib/toast";
import { offsetPoint } from "@/lib/geo";
import type { PanoHotspot, SceneAgentScript, SceneRecord } from "@/types/api";

const scripts = ref<SceneAgentScript[]>([]);
const scenes = ref<SceneRecord[]>([]);
const activeId = ref("");
const loading = ref(true);

const idx = ref(0);
const playing = ref(false);
const speed = ref(1);
const log = ref<Array<{ t: string; kind: string; text: string }>>([]);
const arInside = ref(false);

const activeScene = computed(() => scenes.value.find((s) => s.id === activeId.value) ?? null);
const script = computed(() => scripts.value.find((s) => s.scene_id === activeId.value) ?? null);
const steps = computed(() => script.value?.steps ?? []);
const step = computed(() => steps.value[idx.value] ?? null);
const done = computed(() => steps.value.length > 0 && idx.value >= steps.value.length - 1 && !playing.value);

const KIND_META: Record<string, { label: string; color: string }> = {
  perceive: { label: "感知", color: "#3ec6b8" },
  decide: { label: "决策", color: "#e8b84b" },
  act: { label: "动作", color: "#7f9cf5" },
};

const cameraTarget = computed(() =>
  step.value
    ? { yaw: step.value.yaw ?? 0, pitch: step.value.pitch ?? 0, fov: step.value.kind === "act" ? 62 : 75 }
    : null
);

/** 当前步骤对应的热点（用于高亮） */
const panoHotspots = computed<PanoHotspot[]>(
  () =>
    (activeScene.value?.hotspots ?? []).map((h) => ({
      id: h.id,
      name: h.name,
      position: h.position,
      icon: h.icon || "pin",
      title: h.title,
      content: h.content,
      source: h.source || "",
      action: h.action || { type: "info", target: "" },
    }))
);

const metrics = computed(() => {
  const list = steps.value;
  const hotspots = new Set(list.map((s) => s.hotspot_id).filter(Boolean));
  const seconds = list.reduce((s, x) => s + x.dwell_ms, 0) / 1000;
  return [
    { label: "运行步骤", value: list.length, hint: "感知/决策/动作" },
    { label: "覆盖热点", value: hotspots.size, hint: "自动识别并讲解" },
    { label: "决策次数", value: list.filter((s) => s.kind === "decide").length, hint: "兴趣判定" },
    { label: "演示时长", value: `${seconds.toFixed(1)}s`, hint: `1x 速度` },
  ];
});

function stamp() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(
    d.getSeconds()
  ).padStart(2, "0")}`;
}

function pushLog(kind: string, text: string) {
  log.value.unshift({ t: stamp(), kind, text });
  if (log.value.length > 9) log.value.pop();
}

let timer: number | undefined;

function clearTimer() {
  if (timer) window.clearTimeout(timer);
  timer = undefined;
}

/** 按当前步骤的停留时长排下一次推进 */
function schedule() {
  clearTimer();
  if (!playing.value) return;
  const cur = step.value;
  if (!cur) {
    playing.value = false;
    return;
  }
  timer = window.setTimeout(
    () => {
      if (idx.value < steps.value.length - 1) {
        idx.value += 1;
        const nx = steps.value[idx.value];
        if (nx) pushLog(nx.kind, `${nx.label} · ${nx.detail.slice(0, 34)}`);
        schedule();
      } else {
        playing.value = false;
      }
    },
    Math.max(320, cur.dwell_ms / speed.value)
  );
}

function play() {
  if (!steps.value.length) return;
  if (done.value) idx.value = 0;
  playing.value = true;
}

function pause() {
  playing.value = false;
  clearTimer();
}

function reset() {
  pause();
  idx.value = 0;
  log.value = [];
}

function jump(i: number) {
  pause();
  idx.value = i;
  const s = steps.value[i];
  if (s) pushLog(s.kind, `跳到：${s.label}`);
}

function pick(id: string) {
  pause();
  activeId.value = id;
  idx.value = 0;
  log.value = [];
  playing.value = true;
}

watch(playing, (v) => (v ? schedule() : clearTimer()));
watch(speed, () => {
  if (playing.value) schedule();
});

async function load() {
  loading.value = true;
  try {
    const [sc, sp] = await Promise.all([api.scenes(true), api.sceneAgentScripts()]);
    scenes.value = sc.scenes;
    scripts.value = sp.scripts;
    if (!activeId.value && scenes.value.length) {
      activeId.value = scenes.value[0].id;
    }
  } catch (e) {
    toast((e as Error).message || "加载失败", "error");
  } finally {
    loading.value = false;
  }
}

/* ---------- AR 交互演示：以石桅岩锚点为基准造演示位置 ---------- */
const AR_SCENE_ID = "shiwei-rock";
const arScene = computed(() => scenes.value.find((s) => s.id === AR_SCENE_ID) ?? scenes.value[0] ?? null);
const arTarget = computed(() =>
  arScene.value?.ar_lat != null && arScene.value?.ar_lng != null
    ? { lat: arScene.value.ar_lat, lng: arScene.value.ar_lng }
    : null
);
/** 围栏外：把「我的位置」放到目标西南约 180m 处 */
const arMe = computed(() => {
  const t = arTarget.value;
  if (!t) return null;
  return arInside.value ? { lat: t.lat + 0.0001, lng: t.lng + 0.0001 } : offsetPoint(t.lat, t.lng, 210, 200);
});
const arDistance = computed(() => (arInside.value ? 11 : 178));

onMounted(async () => {
  await load();
  if (steps.value.length) {
    idx.value = 0;
    playing.value = true;
    pushLog("perceive", `载入「${script.value?.scene_name}」，开始巡游`);
  }
});

onBeforeUnmount(clearTimer);
</script>

<template>
  <div class="page page-wide py-8">
    <!-- 页头 -->
    <div class="flex flex-wrap items-end justify-between gap-4 mb-5">
      <div>
        <h1 class="text-2xl font-bold tracking-wide">永嘉 3D 场景 · Agent 运行效果展示</h1>
        <p class="section-sub mt-1">
          同一份场景底座驱动三处：大屏 3D 云游 · Agent 现场运行 · 手机端 AR 实景寻宝
        </p>
      </div>
      <button class="yj-btn yj-btn--ghost" @click="$router.push('/scenes')">场景管理</button>
    </div>

    <div v-if="loading" class="text-center text-secondary py-16">加载中…</div>

    <template v-else>
      <!-- 场景切换 -->
      <div class="sh-scenes">
        <button
          v-for="s in scenes"
          :key="s.id"
          type="button"
          class="sh-scene"
          :class="{ on: s.id === activeId }"
          :style="{ '--c': s.theme_color }"
          @click="pick(s.id)"
        >
          <span class="sh-scene__dot" />
          {{ s.name }}
          <em>{{ s.hotspots.length }}</em>
        </button>
      </div>

      <!-- 主区 -->
      <div class="sh-main">
        <!-- 3D 舞台 -->
        <section class="sh-stage">
          <div class="sh-stage__canvas">
            <PanoViewer
              v-if="activeScene"
              :panorama="activeScene.panorama"
              :hotspots="panoHotspots"
              :initial-yaw="activeScene.default_yaw"
              :initial-pitch="activeScene.default_pitch"
              :initial-fov="activeScene.default_fov"
              :auto-rotate="!playing"
              :interactive="!playing"
              :ui="true"
              :target="cameraTarget"
              @error="toast('全景素材加载失败，请检查场景素材绑定', 'error')"
            />

            <!-- 舞台浮层 -->
            <div class="sh-hud sh-hud--tl">
              <b>{{ activeScene?.name }}</b>
              <span>{{ activeScene?.poi_id }} · {{ activeScene?.hotspots.length }} 个热点</span>
            </div>

            <div v-if="step" class="sh-hud sh-hud--tr" :style="{ '--k': KIND_META[step.kind]?.color }">
              <i />
              {{ KIND_META[step.kind]?.label }}中
            </div>

            <div class="sh-hud sh-hud--bl">
              <div class="sh-bar"><i :style="{ width: `${steps.length ? ((idx + 1) / steps.length) * 100 : 0}%` }" /></div>
              <span class="sh-hud__step">{{ idx + 1 }} / {{ steps.length }} · {{ step?.label || "待运行" }}</span>
            </div>
          </div>
        </section>

        <!-- Agent 运行时 -->
        <aside class="sh-panel">
          <div class="sh-ctrl">
            <button class="yj-btn yj-btn--primary yj-btn--sm" @click="playing ? pause() : play()">
              {{ playing ? "暂停" : done ? "重播" : "播放" }}
            </button>
            <button class="yj-btn yj-btn--ghost yj-btn--sm" :disabled="idx === 0" @click="jump(Math.max(0, idx - 1))">
              上一步
            </button>
            <button
              class="yj-btn yj-btn--ghost yj-btn--sm"
              :disabled="idx >= steps.length - 1"
              @click="jump(idx + 1)"
            >
              单步
            </button>
            <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="reset">重置</button>
            <select v-model.number="speed" class="yj-input" style="width: 76px; margin-left: auto">
              <option :value="0.5">0.5x</option>
              <option :value="1">1x</option>
              <option :value="2">2x</option>
              <option :value="4">4x</option>
            </select>
          </div>

          <!-- 当前步骤 -->
          <div v-if="step" class="sh-now" :style="{ '--k': KIND_META[step.kind]?.color }">
            <div class="sh-now__head">
              <span class="sh-now__kind">{{ KIND_META[step.kind]?.label }}</span>
              <b>{{ step.label }}</b>
              <span v-if="step.hotspot_name" class="yj-tag" style="margin-left: auto">{{ step.hotspot_name }}</span>
            </div>
            <p class="sh-now__text">{{ step.detail }}</p>
            <div class="sh-now__meta">
              <span>停留 {{ (step.dwell_ms / 1000).toFixed(1) }}s</span>
              <span>yaw {{ Math.round(step.yaw ?? 0) }}° / pitch {{ Math.round(step.pitch ?? 0) }}°</span>
            </div>
          </div>

          <!-- 步骤流 -->
          <div class="sh-flow">
            <button
              v-for="(s, i) in steps"
              :key="s.id"
              type="button"
              class="sh-flow__item"
              :class="{ on: i === idx, past: i < idx }"
              :style="{ '--k': KIND_META[s.kind]?.color }"
              @click="jump(i)"
            >
              <span class="sh-flow__kind">{{ KIND_META[s.kind]?.label }}</span>
              <span class="sh-flow__label">{{ s.label }}</span>
              <span class="sh-flow__no">{{ i + 1 }}</span>
            </button>
          </div>

          <!-- 运行指标 -->
          <div class="sh-metrics">
            <div v-for="m in metrics" :key="m.label">
              <b class="font-mono-sc">{{ m.value }}</b>
              <span>{{ m.label }}</span>
            </div>
          </div>

          <!-- 运行日志 -->
          <div class="sh-log">
            <div v-for="(l, i) in log" :key="i" class="sh-log__row">
              <span class="font-mono-sc">{{ l.t }}</span>
              <em :style="{ color: KIND_META[l.kind]?.color }">{{ KIND_META[l.kind]?.label }}</em>
              <span class="line-clamp-1">{{ l.text }}</span>
            </div>
            <p v-if="!log.length" class="text-xs text-dim">等待运行…</p>
          </div>
        </aside>
      </div>

      <!-- AR 交互演示 -->
      <section class="sh-ar">
        <div class="sh-ar__phone">
          <span class="sh-ar__notch" />
          <div class="sh-ar__screen">
            <ArCameraStage
              :poi-name="arScene?.name || '目标点位'"
              :scene-name="arScene?.name || '永嘉景点'"
              relic="billboard-treasure"
              :panorama="arScene?.panorama || ''"
              :inside="arInside"
              :distance="arDistance"
              :radius="arScene?.ar_radius_m ?? 50"
              :me="arMe"
              :target="arTarget"
              :collected="false"
            />
          </div>
        </div>

        <div class="sh-ar__side">
          <h2 class="text-lg font-bold">AR 交互演示</h2>
          <p class="text-sm text-secondary mt-2">
            手机端同款组件：摄像头实景 → 虚拟信物叠加 → 方位罗盘指向目标 → 进入围栏后信物浮现并点击收集。
            未授权摄像头时自动降级为「{{ arScene?.name }}」全景模拟 AR，叠加层与判定逻辑完全一致。
          </p>

          <div class="sh-ar__toggle">
            <button
              type="button"
              :class="{ on: !arInside }"
              @click="arInside = false"
            >
              围栏外 · 方位指引
            </button>
            <button type="button" :class="{ on: arInside }" @click="arInside = true">
              围栏内 · 信物叠加
            </button>
          </div>

          <ul class="sh-ar__list">
            <li><b>定位与方位</b><span>浏览器 watchPosition + 设备指南针（无指南针时模拟扫描）</span></li>
            <li><b>围栏判定</b><span>前端即时判定，服务端 checkin 为正式口径</span></li>
            <li><b>信物建模</b><span>Three.js 程序化生成，无外部模型依赖，可旋转/缩放/收集</span></li>
            <li><b>Agent 随行</b><span>楠楠携带位置上下文，围栏外答方向、围栏内答典故</span></li>
          </ul>

          <div class="sh-ar__demo">
            <span class="yj-tag">演示模拟 · DEMO</span>
            <span class="text-xs text-dim">摄像头画面不做真实空间锚定（无 SLAM），方位与距离为真实计算</span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
/* ---------- 场景切换 ---------- */
.sh-scenes {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.sh-scene {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 14px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-secondary);
  font-size: 12.5px;
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s, background 0.2s;
}
.sh-scene:hover {
  border-color: color-mix(in srgb, var(--c) 60%, var(--border));
}
.sh-scene.on {
  border-color: var(--c);
  color: var(--text-primary);
  background: color-mix(in srgb, var(--c) 18%, transparent);
}
.sh-scene__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--c);
  box-shadow: 0 0 8px var(--c);
}
.sh-scene em {
  font-style: normal;
  font-size: 10.5px;
  color: var(--text-dim);
}

/* ---------- 主区 ---------- */
.sh-main {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(320px, 0.85fr);
  gap: 16px;
  align-items: stretch;
}
@media (max-width: 1100px) {
  .sh-main {
    grid-template-columns: minmax(0, 1fr);
  }
}

.sh-stage__canvas {
  position: relative;
  height: min(62vh, 520px);
  border-radius: var(--radius-lg);
  overflow: hidden;
  border: 1px solid var(--border);
  background: #05080f;
}

.sh-hud {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 7px 12px;
  border-radius: var(--radius-md);
  background: rgba(6, 11, 20, 0.7);
  border: 1px solid var(--border);
  backdrop-filter: blur(8px);
  pointer-events: none;
}
.sh-hud--tl {
  left: 12px;
  top: 12px;
}
.sh-hud--tl b {
  font-size: 14px;
}
.sh-hud--tl span {
  font-size: 10.5px;
  color: var(--text-dim);
}
.sh-hud--tr {
  right: 12px;
  top: 12px;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--k);
  border-color: color-mix(in srgb, var(--k) 45%, transparent);
}
.sh-hud--tr i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--k);
  box-shadow: 0 0 8px var(--k);
  animation: sh-blink 1.4s ease-in-out infinite;
}
@keyframes sh-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.25;
  }
}
.sh-hud--bl {
  left: 12px;
  right: 12px;
  bottom: 12px;
  flex-direction: row;
  align-items: center;
  gap: 10px;
}
.sh-bar {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.16);
  overflow: hidden;
}
.sh-bar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--accent), var(--success));
  transition: width 0.35s ease;
}
.sh-hud__step {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
}

/* ---------- 右侧面板 ---------- */
.sh-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--bg-elevated);
}
.sh-ctrl {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.sh-now {
  padding: 11px 13px;
  border-radius: var(--radius-md);
  border: 1px solid color-mix(in srgb, var(--k) 40%, var(--border));
  background: color-mix(in srgb, var(--k) 10%, transparent);
}
.sh-now__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.sh-now__kind {
  font-size: 10.5px;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  background: var(--k);
  color: #06210f;
  font-weight: 600;
}
.sh-now__head b {
  font-size: 13px;
}
.sh-now__text {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.68;
  color: var(--text-primary);
}
.sh-now__meta {
  display: flex;
  gap: 12px;
  margin-top: 7px;
  font-size: 10.5px;
  color: var(--text-dim);
}

.sh-flow {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 190px;
  overflow-y: auto;
  padding-right: 2px;
}
.sh-flow__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 9px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-secondary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  flex: none;
}
.sh-flow__item:hover {
  background: rgba(255, 255, 255, 0.07);
}
.sh-flow__item.past {
  opacity: 0.55;
}
.sh-flow__item.on {
  border-color: var(--k);
  background: color-mix(in srgb, var(--k) 14%, transparent);
  color: var(--text-primary);
}
.sh-flow__kind {
  flex: 0 0 auto;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--k) 24%, transparent);
  color: var(--k);
}
.sh-flow__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sh-flow__no {
  font-size: 10px;
  color: var(--text-dim);
}

.sh-metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
.sh-metrics > div {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 7px 4px;
  border-radius: var(--radius-sm);
  background: rgba(62, 198, 184, 0.07);
  border: 1px solid var(--border);
}
.sh-metrics b {
  font-size: 15px;
  color: var(--accent);
}
.sh-metrics span {
  font-size: 10px;
  color: var(--text-dim);
}

.sh-log {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 10px;
  border-radius: var(--radius-sm);
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid var(--border);
  font-size: 10.5px;
  min-height: 58px;
}
.sh-log__row {
  display: flex;
  gap: 7px;
  align-items: baseline;
  color: var(--text-secondary);
}
.sh-log__row span:first-child {
  color: var(--text-dim);
  flex: 0 0 auto;
}
.sh-log__row em {
  font-style: normal;
  flex: 0 0 auto;
}
.sh-log__row span:last-child {
  min-width: 0;
}

/* ---------- AR 演示 ---------- */
.sh-ar {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 22px;
  align-items: start;
  margin-top: 22px;
  padding: 20px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--bg-elevated);
}
@media (max-width: 900px) {
  .sh-ar {
    grid-template-columns: minmax(0, 1fr);
  }
}
.sh-ar__phone {
  position: relative;
  width: 100%;
  padding: 9px;
  border-radius: 34px;
  background: linear-gradient(150deg, #38414f 0%, #1b2129 42%, #0e1218 100%);
  box-shadow: 0 22px 46px rgba(0, 0, 0, 0.55), inset 0 1px 1px rgba(255, 255, 255, 0.12);
}
.sh-ar__notch {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  width: 84px;
  height: 18px;
  border-radius: 999px;
  background: #04060a;
  z-index: 5;
}
.sh-ar__screen {
  position: relative;
  height: 430px;
  border-radius: 27px;
  overflow: hidden;
}
.sh-ar__side h2 {
  margin: 0;
}
.sh-ar__toggle {
  display: inline-flex;
  gap: 4px;
  margin-top: 15px;
  padding: 4px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.03);
}
.sh-ar__toggle button {
  padding: 6px 14px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}
.sh-ar__toggle button.on {
  background: rgba(62, 198, 184, 0.18);
  color: var(--accent);
}
.sh-ar__list {
  list-style: none;
  margin: 16px 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
@media (max-width: 700px) {
  .sh-ar__list {
    grid-template-columns: minmax(0, 1fr);
  }
}
.sh-ar__list li {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: rgba(62, 198, 184, 0.05);
}
.sh-ar__list b {
  font-size: 12.5px;
  color: var(--accent);
}
.sh-ar__list span {
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.sh-ar__demo {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}
</style>
