<script setup lang="ts">
/**
 * 3D 大屏巡航（/cruise）
 *
 * 面向赛事现场投屏的「影院模式」：全屏无干扰，自动按脚本巡航 6 处永嘉实景，
 * 逐帧平滑转向并配解说字幕与数据浮层。演示者可用键盘接管控场。
 *
 * 巡航脚本不额外维护数据：由 `pano_scenes_index.json` + 各场景热点 JSON 自动编排，
 * 每个场景生成「开场全景 → 逐个看点 → 收尾全景」三段式镜头。
 *
 * 键盘：空格 暂停/继续 ｜ ←→ 上/下一镜 ｜ ↑↓ 上/下一景 ｜ F 全屏 ｜ M 手动接管 ｜ Esc 退出
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "@/api/client";
import PanoViewer from "@/components/space/PanoViewer.vue";
import type { PanoHotspot } from "@/types/api";

/* ---------------- 数据模型 ---------------- */

interface Scene {
  id: string;
  name: string;
  poi_id: string;
  panorama: string;
  hotspots: string;
  default_yaw: number;
  default_pitch: number;
  default_fov: number;
  description: string;
  thumbnail: string;
}

interface SceneHotspot {
  id: string;
  name: string;
  position: { yaw: number; pitch: number };
  icon?: string;
  title: string;
  content: string;
  source?: string;
  action?: { type: string; target: string };
}

/** 一个镜头 */
interface Cue {
  scene: number;
  yaw: number;
  pitch: number;
  fov: number;
  kind: "intro" | "hotspot" | "outro";
  title: string;
  caption: string;
  source?: string;
  hold: number;
}

const router = useRouter();

const ready = ref(false);
const error = ref("");
const scenes = ref<Scene[]>([]);
const cueList = ref<Cue[]>([]);

const cursor = ref(0);
const activeScene = ref(0);
const playing = ref(true);
const manual = ref(false);
const target = ref<{ yaw: number; pitch: number; fov: number } | null>(null);

const sceneHotspots = ref<Record<string, SceneHotspot[]>>({});

/* ---------------- UI 淡出 ---------------- */

const uiVisible = ref(true);
let idleTimer: number | null = null;

function bumpUi() {
  uiVisible.value = true;
  if (idleTimer) window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    if (playing.value && !manual.value) uiVisible.value = false;
  }, 3400);
}

/* ---------------- 片头 / 转场 / 片尾 ---------------- */

/** 片头序列：先亮品牌，再交给巡航 */
const intro = ref(true);
/** 换景转场遮罩：遮住全景加载的空白瞬间，顺带预告下一处 */
const transitioning = ref(false);
const transitionName = ref("");
/** 片尾卡：全部镜头走完后停留，再自动重播，形成展台无缝循环 */
const ending = ref(false);
let ended = false;

let introTimer: number | null = null;
let transitionTimer: number | null = null;

function dismissIntro() {
  if (!intro.value) return;
  intro.value = false;
  if (introTimer) {
    window.clearTimeout(introTimer);
    introTimer = null;
  }
}

function flashTransition(name: string) {
  transitionName.value = name;
  transitioning.value = true;
  if (transitionTimer) window.clearTimeout(transitionTimer);
  // 略长于换景等待（1.5s），让遮罩刚好盖住加载、落在新镜头上
  transitionTimer = window.setTimeout(() => {
    transitioning.value = false;
  }, 1800);
}

/** 走完一轮后的片尾停留：期间保持一次令牌有效性，被打断则自然退出 */
async function playEnding(my: number) {
  ended = true;
  ending.value = true;
  await sleep(7600);
  if (my !== token) return;
  ending.value = false;
  ended = false;
  void runCue(0);
}

function onSurfaceClick() {
  bumpUi();
  dismissIntro();
}

/* ---------------- 巡航编排 ---------------- */

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

function buildCues(list: Scene[], map: Record<string, SceneHotspot[]>): Cue[] {
  const cues: Cue[] = [];
  list.forEach((s, si) => {
    const hs = map[s.id] ?? [];

    cues.push({
      scene: si,
      yaw: s.default_yaw,
      pitch: s.default_pitch,
      fov: s.default_fov,
      kind: "intro",
      title: s.name,
      caption: s.description,
      hold: 5000,
    });

    hs.slice(0, 3).forEach((h) => {
      cues.push({
        scene: si,
        yaw: h.position.yaw,
        pitch: h.position.pitch,
        fov: 62,
        kind: "hotspot",
        title: h.title,
        caption: h.content,
        source: h.source,
        hold: 8200,
      });
    });

    if (hs.length) {
      cues.push({
        scene: si,
        yaw: s.default_yaw,
        pitch: s.default_pitch,
        fov: 80,
        kind: "outro",
        title: s.name,
        caption: "下一处，继续走。",
        hold: 2400,
      });
    }
  });
  return cues;
}

/** 播放轮次令牌：自增即作废此前所有待执行任务 */
let token = 0;
let timer: number | null = null;

function clearTimer() {
  if (timer) {
    window.clearTimeout(timer);
    timer = null;
  }
}

/**
 * 浏览埋点（source=cruise）。
 *
 * 与 SpaceView 的差别：大屏巡航是**无人值守循环播放**，按镜次上报会把数字刷爆，
 * 所以每个场景每场只记一次；重播后仍算同一场。
 */
const trackedScenes = new Set<string>();
function trackVisit(id: string | undefined) {
  if (!id || trackedScenes.has(id)) return;
  trackedScenes.add(id);
  void api.sceneVisit(id, "cruise").catch(() => {});
}

async function runCue(index: number) {
  if (!cueList.value.length) return;
  const my = ++token;
  clearTimer();

  const i = index % cueList.value.length;
  cursor.value = i;
  const cue = cueList.value[i];

  // 换景：先用转场遮罩盖住加载瞬间，等淡入完成再转视角，避免在加载中空转
  if (cue.scene !== activeScene.value) {
    flashTransition(scenes.value[cue.scene]?.name ?? "");
    await nextTick();
    activeScene.value = cue.scene;
    trackVisit(scenes.value[cue.scene]?.id);
    await sleep(1500);
    if (my !== token) return;
  }

  target.value = { yaw: cue.yaw, pitch: cue.pitch, fov: cue.fov };

  const delay = cue.hold + 2200;
  timer = window.setTimeout(() => {
    if (my !== token || !playing.value) return;
    // 走完一轮先进片尾卡，由片尾自动重播，展台可长时间无人值守
    if (!ended && i === cueList.value.length - 1) {
      void playEnding(my);
      return;
    }
    void runCue(i + 1);
  }, delay);
}

function togglePlay() {
  playing.value = !playing.value;
  if (playing.value) {
    // 从片尾卡继续：清掉片尾态，否则会立刻再次进入片尾
    ending.value = false;
    ended = false;
    void runCue(cursor.value);
  } else {
    token++;
    clearTimer();
  }
  bumpUi();
}

function goTo(index: number) {
  if (!cueList.value.length) return;
  const n = ((index % cueList.value.length) + cueList.value.length) % cueList.value.length;
  // 用户主动跳转即视为打断片尾
  ending.value = false;
  ended = false;
  playing.value = true;
  manual.value = false;
  void runCue(n);
  bumpUi();
}

/** 跳到下一个不同场景的首镜 */
function nextScene() {
  const cur = cueList.value[cursor.value]?.scene ?? 0;
  const idx = cueList.value.findIndex((c, i) => i > cursor.value && c.scene !== cur);
  goTo(idx >= 0 ? idx : 0);
}

/** 回到上一个不同场景的首镜 */
function prevScene() {
  const cur = cueList.value[cursor.value]?.scene ?? 0;
  for (let i = cursor.value - 1; i >= 0; i--) {
    if (cueList.value[i].scene !== cur) {
      goTo(cueList.value.findIndex((c) => c.scene === cueList.value[i].scene));
      return;
    }
  }
  goTo(0);
}

/* ---------------- 交互 ---------------- */

const hostRef = ref<HTMLElement | null>(null);

function toggleFullscreen() {
  const el = hostRef.value;
  if (!el) return;
  if (document.fullscreenElement) void document.exitFullscreen();
  else void el.requestFullscreen?.();
  bumpUi();
}

function toggleManual() {
  manual.value = !manual.value;
  // 交还人工操作时先暂停自动巡航，避免与手动拖拽抢视角
  if (manual.value && playing.value) togglePlay();
  bumpUi();
}

function onHotspot(h: PanoHotspot) {
  const i = cueList.value.findIndex((c) => c.kind === "hotspot" && c.title === h.title);
  if (i >= 0) goTo(i);
}

function onKey(e: KeyboardEvent) {
  dismissIntro();
  switch (e.code) {
    case "Space":
      e.preventDefault();
      togglePlay();
      break;
    case "ArrowRight":
      goTo(cursor.value + 1);
      break;
    case "ArrowLeft":
      goTo(cursor.value - 1);
      break;
    case "ArrowDown":
      nextScene();
      break;
    case "ArrowUp":
      prevScene();
      break;
    case "KeyF":
      toggleFullscreen();
      break;
    case "KeyM":
      toggleManual();
      break;
    case "Escape":
      if (!document.fullscreenElement) router.push("/space");
      break;
  }
}

/* ---------------- 派生状态 ---------------- */

const current = computed<Cue | null>(() => cueList.value[cursor.value] ?? null);
const currentScene = computed<Scene | null>(() => scenes.value[activeScene.value] ?? null);
const hotspotsOfCurrent = computed<SceneHotspot[]>(() => sceneHotspots.value[currentScene.value?.id ?? ""] ?? []);
const progress = computed(() =>
  cueList.value.length ? ((cursor.value + 1) / cueList.value.length) * 100 : 0
);
const sceneIndexOf = computed(() =>
  scenes.value.length && currentScene.value
    ? scenes.value.findIndex((s) => s.id === currentScene.value!.id) + 1
    : 0
);

/** 进度条上的场景分界刻度 */
const sceneTicks = computed(() => {
  const total = cueList.value.length;
  if (!total || !scenes.value.length) return [];
  const ticks: number[] = [];
  for (let si = 1; si < scenes.value.length; si++) {
    const at = cueList.value.findIndex((c) => c.scene === si);
    if (at > 0) ticks.push((at / total) * 100);
  }
  return ticks;
});

/** PanoViewer 需要 PanoHotspot 结构，这里把场景热点映射过去 */
const viewerHotspots = computed<PanoHotspot[]>(() =>
  hotspotsOfCurrent.value.map((h) => ({
    id: h.id,
    name: h.name,
    title: h.title,
    content: h.content,
    source: h.source ?? "",
    icon: h.icon ?? "spot",
    position: h.position,
    action: h.action ?? { type: "none", target: "" },
  }))
);

/* ---------------- 生命周期 ---------------- */

onMounted(async () => {
  window.addEventListener("keydown", onKey);
  bumpUi();

  try {
    const res = await fetch("/assets/3d/pano_scenes_index.json");
    if (!res.ok) throw new Error(`场景索引加载失败（${res.status}）`);
    const body = (await res.json()) as { scenes?: Scene[] };
    scenes.value = body.scenes ?? [];
    if (!scenes.value.length) throw new Error("场景索引为空");

    const map: Record<string, SceneHotspot[]> = {};
    await Promise.all(
      scenes.value.map(async (s) => {
        try {
          const r = await fetch(s.hotspots);
          const b = (await r.json()) as { hotspots?: SceneHotspot[] };
          map[s.id] = b.hotspots ?? [];
        } catch {
          map[s.id] = [];
        }
      })
    );
    sceneHotspots.value = map;
    cueList.value = buildCues(scenes.value, map);

    ready.value = true;
    await nextTick();
    void runCue(0);
    // 片头自动让位；点击或按键可提前跳过（dismissIntro）
    introTimer = window.setTimeout(dismissIntro, 3600);
  } catch (e) {
    error.value = (e as Error).message || "巡航数据加载失败";
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  token++;
  clearTimer();
  if (idleTimer) window.clearTimeout(idleTimer);
  if (introTimer) window.clearTimeout(introTimer);
  if (transitionTimer) window.clearTimeout(transitionTimer);
});
</script>

<template>
  <div
    ref="hostRef"
    class="cruise"
    :class="{ 'is-idle': !uiVisible, 'is-manual': manual, 'is-ending': ending, 'is-intro': intro }"
    @mousemove="bumpUi"
    @click="onSurfaceClick"
  >
    <!-- 加载 -->
    <div v-if="!ready && !error" class="cruise__boot">
      <div class="cruise__bootbar"><i></i></div>
      <p>正在装载永嘉实景巡航…</p>
    </div>

    <!-- 错误 -->
    <div v-else-if="error" class="cruise__boot">
      <p class="cruise__err">{{ error }}</p>
      <button class="cruise__btn" @click="router.push('/space')">返回 3D 云游</button>
    </div>

    <!-- 巡航主体 -->
    <template v-else>
      <div class="cruise__stage">
        <PanoViewer
          :panorama="currentScene?.panorama ?? ''"
          :hotspots="viewerHotspots"
          :auto-rotate="false"
          :interactive="manual"
          :ui="false"
          :target="target"
          @hotspot="onHotspot"
        />
      </div>

      <!-- 影院质感：暗角 + 胶片颗粒（纯装饰，不拦事件） -->
      <div class="cruise__vignette" aria-hidden="true"></div>
      <div class="cruise__grain" aria-hidden="true"></div>

      <!-- 场景名水印 -->
      <div v-if="currentScene" class="cruise__watermark font-xiaoyao" aria-hidden="true">
        {{ currentScene.name }}
      </div>

      <!-- 顶部：品牌 + 场景进度 -->
      <header class="cruise__top">
        <div class="cruise__brand">
          <span class="cruise__dot"></span>
          <b class="font-xiaoyao">永嘉新游</b>
          <span class="cruise__sub">3D 实景巡航</span>
        </div>
        <div class="cruise__scenes">
          <span
            v-for="(s, i) in scenes"
            :key="s.id"
            class="cruise__scenedot"
            :class="{ 'is-on': i === activeScene }"
            :title="s.name"
          ></span>
        </div>
      </header>

      <!-- 左下：解说字幕 -->
      <Transition name="cue" mode="out-in">
        <div v-if="current" :key="cursor" class="cruise__caption">
          <div class="cruise__captionhead">
            <span class="cruise__kind">{{
              current.kind === "intro" ? "场景" : current.kind === "outro" ? "场景" : "看点"
            }}</span>
            <h2 class="font-serif-sc">{{ current.title }}</h2>
          </div>
          <p v-if="current.caption" class="cruise__text">{{ current.caption }}</p>
          <div class="cruise__meta">
            <span v-if="currentScene">{{ currentScene.poi_id }} · {{ currentScene.name }}</span>
            <span v-if="current.source">来源 {{ current.source }}</span>
          </div>
        </div>
      </Transition>

      <!-- 右上：数据浮层 -->
      <aside class="cruise__hud">
        <div class="cruise__hudrow">
          <span class="cruise__hudk">场景</span>
          <span class="cruise__hudv">{{ sceneIndexOf }} / {{ scenes.length }}</span>
        </div>
        <div class="cruise__hudrow">
          <span class="cruise__hudk">本景看点</span>
          <span class="cruise__hudv">{{ hotspotsOfCurrent.length }}</span>
        </div>
        <div class="cruise__hudrow">
          <span class="cruise__hudk">镜头</span>
          <span class="cruise__hudv">{{ cursor + 1 }} / {{ cueList.length }}</span>
        </div>
        <div class="cruise__hudrow">
          <span class="cruise__hudk">状态</span>
          <span class="cruise__hudv" :class="{ 'is-warn': manual }">{{
            manual ? "手动接管" : playing ? "自动巡航" : "已暂停"
          }}</span>
        </div>
      </aside>

      <!-- 底部：进度 + 控制 -->
      <footer class="cruise__bottom">
        <div class="cruise__bar">
          <i :style="{ width: `${progress}%` }"></i>
          <span
            v-for="(t, i) in sceneTicks"
            :key="i"
            class="cruise__tick"
            :style="{ left: `${t}%` }"
          ></span>
        </div>
        <div class="cruise__ctrl">
          <button class="cruise__btn" @click="prevScene">上一景</button>
          <button class="cruise__btn" @click="goTo(cursor - 1)">上一镜</button>
          <button class="cruise__btn cruise__btn--main" @click="togglePlay">
            {{ playing ? "暂停" : "继续" }}
          </button>
          <button class="cruise__btn" @click="goTo(cursor + 1)">下一镜</button>
          <button class="cruise__btn" @click="nextScene">下一景</button>
          <button class="cruise__btn" :class="{ 'is-on': manual }" @click="toggleManual">
            {{ manual ? "恢复巡航" : "手动接管" }}
          </button>
          <button class="cruise__btn" @click="toggleFullscreen">全屏</button>
          <button class="cruise__btn cruise__btn--ghost" @click="router.push('/space')">退出</button>
        </div>
        <p class="cruise__keys">空格 暂停/继续 · ←→ 切镜 · ↑↓ 切景 · F 全屏 · M 手动 · Esc 退出</p>
      </footer>

      <!-- 换景转场遮罩 -->
      <Transition name="veil">
        <div v-if="transitioning" class="cruise__veil">
          <span class="cruise__veil-kicker">正在前往</span>
          <b class="font-serif-sc">{{ transitionName }}</b>
        </div>
      </Transition>

      <!-- 片头序列 -->
      <Transition name="veil">
        <div v-if="intro" class="cruise__opening">
          <span class="cruise__opening-kicker">AI×OPC 2026 · 永嘉农商杯</span>
          <h1 class="font-xiaoyao">永嘉新游</h1>
          <p class="cruise__opening-sub">3D 实景巡航 · 六处山水一次看完</p>
          <div class="cruise__opening-line"><i></i></div>
          <span class="cruise__opening-skip">点击或按任意键跳过</span>
        </div>
      </Transition>

      <!-- 片尾卡：一轮结束后停留，再自动重播 -->
      <Transition name="veil">
        <div v-if="ending" class="cruise__opening cruise__opening--end">
          <span class="cruise__opening-kicker">巡航结束</span>
          <h1 class="font-xiaoyao">永嘉，还想再来一次</h1>
          <p class="cruise__opening-sub">让管理更精准 · 让游客更想来 · 让来了更会玩</p>
          <div class="cruise__endscenes">
            <span v-for="s in scenes" :key="s.id">{{ s.name }}</span>
          </div>
          <span class="cruise__opening-skip">即将自动重播</span>
        </div>
      </Transition>
    </template>
  </div>
</template>

<style scoped>
.cruise {
  position: relative;
  /* 父级 .shell__main 是 flex 列容器：用 flex:1 拿满高度，避免 height:100% 在 flex item 上被压缩 */
  flex: 1;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: #050b14;
  color: var(--text-primary, #e8eef8);
  user-select: none;
}
.cruise.is-idle {
  cursor: none;
}

.cruise__stage {
  position: absolute;
  inset: 0;
}
.cruise__stage :deep(.pano) {
  width: 100%;
  height: 100%;
}

/* ---------- 加载 / 错误 ---------- */
.cruise__boot {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--text-secondary, #97a6bd);
  font-size: 14px;
}
.cruise__bootbar {
  width: 220px;
  height: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}
.cruise__bootbar i {
  display: block;
  width: 38%;
  height: 100%;
  border-radius: 999px;
  background: var(--primary, #3ec6b8);
  animation: cruise-sweep 1.15s ease-in-out infinite;
}
@keyframes cruise-sweep {
  0% {
    transform: translateX(-110%);
  }
  100% {
    transform: translateX(300%);
  }
}
.cruise__err {
  color: #f87171;
}

/* ---------- 顶部 ---------- */
.cruise__top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 22px 30px;
  background: linear-gradient(180deg, rgba(5, 11, 20, 0.82), transparent);
  transition: opacity 0.5s ease;
}
.cruise__brand {
  display: flex;
  align-items: center;
  gap: 9px;
}
.cruise__brand b {
  font-size: 17px;
  letter-spacing: 0.14em;
}
.cruise__sub {
  font-size: 12px;
  letter-spacing: 0.2em;
  color: var(--text-dim, #64748b);
}
.cruise__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--primary, #3ec6b8);
  box-shadow: 0 0 10px rgba(62, 198, 184, 0.9);
}
.cruise__scenes {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cruise__scenedot {
  width: 26px;
  height: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  transition: background 0.35s ease, box-shadow 0.35s ease;
}
.cruise__scenedot.is-on {
  background: var(--primary, #3ec6b8);
  box-shadow: 0 0 10px rgba(62, 198, 184, 0.55);
}

/* ---------- 字幕 ---------- */
.cruise__caption {
  position: absolute;
  left: 30px;
  bottom: 118px;
  max-width: min(660px, 56vw);
  padding: 20px 24px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-left: 3px solid var(--primary, #3ec6b8);
  background: linear-gradient(120deg, rgba(7, 14, 25, 0.9), rgba(7, 14, 25, 0.62));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}
.cruise__captionhead {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 9px;
}
.cruise__captionhead h2 {
  margin: 0;
  font-size: 26px;
  letter-spacing: 0.04em;
}
.cruise__kind {
  flex: none;
  font-size: 11px;
  letter-spacing: 0.14em;
  color: var(--primary, #3ec6b8);
  border: 1px solid rgba(62, 198, 184, 0.4);
  border-radius: 999px;
  padding: 2px 9px;
}
.cruise__text {
  margin: 0;
  font-size: 15px;
  line-height: 1.95;
  color: var(--text-secondary, #97a6bd);
  letter-spacing: 0.02em;
}
.cruise__meta {
  display: flex;
  gap: 16px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
  font-size: 11.5px;
  color: var(--text-dim, #64748b);
  font-family: var(--font-mono, monospace);
}

.cue-enter-active,
.cue-leave-active {
  transition: opacity 0.36s ease, transform 0.36s ease;
}
.cue-enter-from {
  opacity: 0;
  transform: translateY(12px);
}
.cue-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* ---------- 数据浮层 ---------- */
.cruise__hud {
  position: absolute;
  top: 74px;
  right: 30px;
  min-width: 178px;
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(7, 14, 25, 0.72);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  transition: opacity 0.5s ease;
}
.cruise__hudrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 5px 0;
}
.cruise__hudrow + .cruise__hudrow {
  border-top: 1px solid rgba(255, 255, 255, 0.055);
}
.cruise__hudk {
  font-size: 12px;
  color: var(--text-dim, #64748b);
}
.cruise__hudv {
  font-size: 13px;
  font-weight: 700;
  font-family: var(--font-mono, monospace);
  color: var(--primary, #3ec6b8);
}
.cruise__hudv.is-warn {
  color: #e8b84b;
}

/* ---------- 底部 ---------- */
.cruise__bottom {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 0 30px 20px;
  background: linear-gradient(0deg, rgba(5, 11, 20, 0.92), transparent);
  transition: opacity 0.5s ease;
}
.cruise__bar {
  position: relative;
  height: 2px;
  margin-bottom: 16px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  /* 刻意不用 overflow:hidden：刻度线需要探出进度条上下边缘 */
}
.cruise__bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--primary, #3ec6b8), #7c8ff5);
  transition: width 0.5s ease;
}
.cruise__ctrl {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.cruise__btn {
  padding: 7px 14px;
  border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.13);
  background: rgba(18, 30, 48, 0.72);
  color: var(--text-secondary, #97a6bd);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.18s ease;
}
.cruise__btn:hover {
  color: var(--text-primary, #e8eef8);
  border-color: rgba(62, 198, 184, 0.45);
}
.cruise__btn--main {
  color: #04141a;
  font-weight: 700;
  background: var(--primary, #3ec6b8);
  border-color: transparent;
}
.cruise__btn--main:hover {
  color: #04141a;
  filter: brightness(1.08);
}
.cruise__btn.is-on {
  color: #e8b84b;
  border-color: rgba(232, 184, 75, 0.5);
}
.cruise__btn--ghost {
  margin-left: auto;
  background: transparent;
}

/* ---------- 影院质感 ---------- */
.cruise__vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(128% 106% at 50% 46%, transparent 50%, rgba(3, 7, 13, 0.62) 100%);
}
.cruise__grain {
  position: absolute;
  inset: -60px;
  pointer-events: none;
  opacity: 0.045;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E");
  animation: cruise-grain 1.1s steps(3) infinite;
}
@keyframes cruise-grain {
  0% {
    transform: translate3d(0, 0, 0);
  }
  33% {
    transform: translate3d(-12px, 8px, 0);
  }
  66% {
    transform: translate3d(9px, -11px, 0);
  }
  100% {
    transform: translate3d(-7px, -5px, 0);
  }
}

/* 场景名水印：大字号低透明度，提供影院式辨识度 */
.cruise__watermark {
  position: absolute;
  right: 32px;
  bottom: 128px;
  font-size: 82px;
  line-height: 1;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.075);
  pointer-events: none;
  user-select: none;
  transition: opacity 0.55s ease;
}

/* 进度条场景刻度：标出每处场景的分界 */
.cruise__tick {
  position: absolute;
  top: 50%;
  width: 1px;
  height: 9px;
  transform: translate(-50%, -50%);
  background: rgba(255, 255, 255, 0.3);
}

/* ---------- 转场 / 片头 / 片尾 ---------- */
.cruise__veil,
.cruise__opening {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
  pointer-events: none;
}
.cruise__veil {
  background: radial-gradient(80% 80% at 50% 50%, rgba(4, 10, 18, 0.86), rgba(2, 6, 11, 0.96));
}
.cruise__veil-kicker,
.cruise__opening-kicker {
  font-size: 11.5px;
  letter-spacing: 0.36em;
  color: var(--primary, #3ec6b8);
}
.cruise__veil b {
  font-size: 34px;
  letter-spacing: 0.16em;
  color: var(--text-primary, #e8eef8);
}
.cruise__opening {
  background: radial-gradient(90% 90% at 50% 46%, rgba(6, 14, 24, 0.94), rgba(2, 5, 10, 0.99));
}
.cruise__opening h1 {
  margin: 6px 0 0;
  font-size: 68px;
  letter-spacing: 0.2em;
  color: var(--text-primary, #e8eef8);
  text-shadow: 0 0 42px rgba(62, 198, 184, 0.32);
}
.cruise__opening-sub {
  margin: 0;
  font-size: 14px;
  letter-spacing: 0.22em;
  color: var(--text-secondary, #97a6bd);
}
.cruise__opening-line {
  width: 220px;
  height: 2px;
  margin-top: 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}
.cruise__opening-line i {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--primary, #3ec6b8), #7c8ff5);
  transform-origin: left center;
  animation: cruise-intro-line 3.6s linear forwards;
}
@keyframes cruise-intro-line {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}
.cruise__opening-skip {
  position: absolute;
  bottom: 46px;
  font-size: 11.5px;
  letter-spacing: 0.18em;
  color: rgba(255, 255, 255, 0.34);
}
.cruise__endscenes {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: 20px;
  max-width: min(760px, 76vw);
}
.cruise__endscenes span {
  padding: 5px 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  font-size: 12.5px;
  color: var(--text-secondary, #97a6bd);
}
.cruise__opening--end h1 {
  font-size: 46px;
}

.veil-enter-active,
.veil-leave-active {
  transition: opacity 0.55s ease;
}
.veil-enter-from,
.veil-leave-to {
  opacity: 0;
}

/* 片尾态：字幕与浮层整体让位给片尾卡 */
.cruise.is-ending .cruise__caption,
.cruise.is-ending .cruise__hud,
.cruise.is-ending .cruise__watermark,
.cruise.is-ending .cruise__bottom,
.cruise.is-ending .cruise__top {
  opacity: 0;
  pointer-events: none;
}

/* 沉浸态：只留字幕，其余淡出 */
.cruise.is-idle .cruise__hud,
.cruise.is-idle .cruise__bottom,
.cruise.is-idle .cruise__top,
.cruise.is-idle .cruise__watermark {
  opacity: 0;
  pointer-events: none;
}
/* 手动接管时提示条常驻，避免演示者找不到恢复入口 */
.cruise.is-manual .cruise__bottom {
  opacity: 1;
  pointer-events: auto;
}

.cruise__keys {
  margin: 12px 0 0;
  font-size: 11.5px;
  color: var(--text-dim, #64748b);
  letter-spacing: 0.03em;
}

/* 窄屏兜底 */
@media (max-width: 900px) {
  .cruise__caption {
    left: 16px;
    right: 16px;
    bottom: 108px;
    max-width: none;
    padding: 15px 17px;
  }
  .cruise__captionhead h2 {
    font-size: 20px;
  }
  .cruise__text {
    font-size: 13.5px;
    line-height: 1.8;
  }
  .cruise__hud {
    display: none;
  }
  .cruise__watermark {
    display: none;
  }
  .cruise__opening h1 {
    font-size: 40px;
  }
  .cruise__opening--end h1 {
    font-size: 28px;
  }
  .cruise__top,
  .cruise__bottom {
    padding-left: 16px;
    padding-right: 16px;
  }
}
</style>
