<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { api } from "@/api/client";
import type { KbItem, PanoHotspot } from "@/types/api";
import PanoramaHero from "@/components/space/PanoramaHero.vue";
import PanoViewer from "@/components/space/PanoViewer.vue";
import ModelViewer from "@/components/space/ModelViewer.vue";

const route = useRoute();

const MODES = [
  { key: "pano" as const, label: "全景漫游" },
  { key: "model" as const, label: "实景模型" },
];

interface PanoScene {
  id: string;
  name: string;
  poi_id: string;
  panorama: string;
  mobile_panorama?: string;
  hotspots: string;
  default_yaw: number;
  default_pitch: number;
  default_fov: number;
  description: string;
  thumbnail: string;
  /** 场景专属三维模型。当前 6 个场景均为空，见下方 modelUrl 说明 */
  model_3d?: string | null;
}

const mode = ref<"pano" | "model">("pano");
const scenes = ref<PanoScene[]>([]);
const sceneId = ref("");
const hotspots = ref<PanoHotspot[]>([]);
const activeHotspot = ref<PanoHotspot | null>(null);
const kbItem = ref<KbItem | null>(null);
const loading = ref(true);
const thumbError = ref<Record<string, boolean>>({});
const modelTriangles = ref(0);

const currentScene = computed(() => scenes.value.find((s) => s.id === sceneId.value) ?? null);

/* 首屏主视觉跟随当前场景。与下方 PanoViewer 用同一张图，浏览器缓存直接命中，不额外下载 */
const HERO_FALLBACK = {
  panorama: "/assets/pano/pano-shiweiyan.webp",
  mobile_panorama: "/assets/pano/pano-shiweiyan-mobile.webp",
  poster: "/assets/hero/hero-nanxi.webp",
};
const heroPano = computed(() => currentScene.value?.panorama || HERO_FALLBACK.panorama);
const heroPanoMobile = computed(() => currentScene.value?.mobile_panorama || HERO_FALLBACK.mobile_panorama);
const heroPoster = computed(() => currentScene.value?.thumbnail || HERO_FALLBACK.poster);

/**
 * 「实景模型」是**固定展项**，不是"每个场景各有一个 3D 模型"。
 *
 * 现状：`public/assets/3d/` 下只有一个摄影测量模型（红建建筑群，
 * 桌面 50 万面 / 移动 6.8 万面），6 个场景的 `model_3d` 字段全为空。
 * 所以这里刻意把 modelUrl 做成显式透传：
 *   - 为空 → 交给 ModelViewer 按 red-buildings-config.json 加载默认模型（当前唯一路径）；
 *   - 哪天某个场景补上 model_3d，这里自动生效，不用再改渲染逻辑。
 * 页面上也据此写明"固定展项"，避免评委以为 3D 模式对应上方选中的全景场景。
 */
const modelUrl = computed(() => currentScene.value?.model_3d || "");

/**
 * 浏览埋点：展示端每打开 / 切换一个场景上报一次，source=space。
 * 对外访问量 = 演示基线 + 这里的真实计数；失败静默，埋点不该影响观看。
 *
 * 注意：**调用方必须保证一次「浏览」只调一次 loadScene** —— 埋点挂在 loadScene 里，
 * 重复加载会同时造成「热点/知识库请求翻倍」和「访问量虚高」。详见 onMounted 里的说明。
 */
function trackVisit(id: string) {
  void api.sceneVisit(id, "space").catch(() => {});
}

async function loadScene(id: string) {
  const scene = scenes.value.find((s) => s.id === id);
  activeHotspot.value = null;
  hotspots.value = [];
  kbItem.value = null;
  if (!scene) return;
  trackVisit(scene.id);
  loading.value = true;
  try {
    const [hs, kb] = await Promise.all([
      fetch(scene.hotspots)
        .then((r) => r.json())
        .catch(() => null),
      api.knowledgeById(scene.poi_id).catch(() => null),
    ]);
    hotspots.value = hs?.hotspots ?? [];
    kbItem.value = kb?.item ?? null;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    const data = await fetch("/assets/3d/pano_scenes_index.json").then((r) => r.json());
    scenes.value = data?.scenes ?? [];
    if (scenes.value.length) {
      // 支持外链直达指定场景：/space?scene=lishuijie（首页场景墙即走这个入口）
      const wanted = typeof route.query.scene === "string" ? route.query.scene : "";
      const target = scenes.value.find((s) => s.id === wanted) ?? scenes.value[0];
      // 只走一条加载路径：改动 sceneId 交给 watch 去加载。
      // 早期这里写成「先赋值再 await loadScene(...)」，导致同一个场景被加载两次
      // （热点 JSON + 知识库接口各请求两遍，接入浏览埋点后还表现为「打开一次访问量 +2」）。
      // 仅当目标恰已是当前场景（watch 不会触发）时才需要手动补一次。
      if (sceneId.value === target.id) await loadScene(target.id);
      else sceneId.value = target.id;
    }
  } catch {
    scenes.value = [];
    loading.value = false;
  }
});

watch(sceneId, (id) => {
  if (id) void loadScene(id);
});

function onHotspot(h: PanoHotspot) {
  activeHotspot.value = h;
}

/**
 * 热点类型映射：数据源 icon 字段存的是英文 key（mountain/water/cave...），
 * 这里统一转成中文标签 + 线条风 SVG 图标。
 * 与 PanoViewer.vue 的 emoji ICONS 同源但更精致，卡片里用 SVG 更协调。
 */
const HOTSPOT_TYPES: Record<string, { label: string; svg: string }> = {
  mountain: {
    label: "山景",
    svg: '<path d="M4 20L10 8l4 6 3-3 7 9" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>',
  },
  water: {
    label: "水景",
    svg: '<path d="M3 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
  },
  cave: {
    label: "岩洞",
    svg: '<path d="M4 20V12a8 8 0 0 1 16 0v8" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
  },
  building: {
    label: "建筑",
    svg: '<path d="M4 20V10l8-5 8 5v10M8 20v-6h8v6" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>',
  },
  bridge: {
    label: "古桥",
    svg: '<path d="M4 18h16M6 18c2-4 10-4 12 0M6 18v2M18 18v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  },
  lantern: {
    label: "风物",
    svg: '<path d="M12 3v2M8 7h8v8a4 4 0 0 1-8 0V7zM12 19v2M8 11h8" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>',
  },
  tree: {
    label: "古树",
    svg: '<path d="M12 21V12M7 12a5 5 0 0 1 10 0M8 7a4 4 0 0 1 8 0" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>',
  },
  default: {
    label: "点位",
    svg: '<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 8v4l3 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
  },
};
function hotspotType(key: string) {
  return HOTSPOT_TYPES[key] ?? HOTSPOT_TYPES.default;
}

/** 热点 target 形如 /wiki/POI-001 → 知识库支持 ?focus= 直达详情 */
function wikiLink(h: PanoHotspot) {
  const matched = /\/wiki\/([^/?#]+)/.exec(h.action?.target ?? "");
  return matched ? { path: "/wiki", query: { focus: matched[1] } } : { path: "/wiki" };
}

function onThumbError(id: string) {
  thumbError.value = { ...thumbError.value, [id]: true };
}
</script>

<template>
  <div class="space">
    <!-- 顶部：轻量环境氛围 -->
    <section class="space__hero">
      <div class="space__bg">
        <!-- 首屏主视觉：真 360° 实景全景，跟随当前场景切换 -->
        <PanoramaHero
          :panorama="heroPano"
          :mobile-panorama="heroPanoMobile"
          :poster="heroPoster"
          :speed="2"
          :pitch="-6"
          :fov="86"
        />
      </div>

      <div class="page space__head">
        <span class="yj-badge">3D 云游 · 实景漫游</span>
        <h1 class="font-serif-sc">把永嘉山水，搬进浏览器</h1>
        <p class="space__sub">
          6 处实景 360° 全景 + 红建建筑群摄影测量三维模型，按住拖动即可环视。点选全景中的热点，听楠楠讲讲眼前的山水人文。
        </p>
        <div class="space__tags">
          <span class="yj-tag yj-tag--poi">{{ currentScene?.poi_id ?? "POI-001" }} {{ currentScene?.name ?? "石桅岩" }}</span>
          <span class="yj-tag yj-tag--culture">雁荡山 · 楠溪江</span>
          <span class="yj-tag yj-tag--accent">实景 360° 全景</span>
        </div>

        <!-- 亮点数据条：把「3D 为主」的技术含量摊开讲 -->
        <div class="space__specs">
          <span class="space__spec"><b>6</b>处实景全景</span>
          <span class="space__spec"><b>945 万</b>面原始重建</span>
          <span class="space__spec"><b>50 万</b>面桌面交付</span>
          <span class="space__spec"><b>WebGL</b>实时渲染</span>
          <span class="space__spec"><b>360°</b>陀螺仪环视</span>
        </div>

        <div class="space__entries">
          <RouterLink class="space__cruise" to="/cruise">
            <span class="space__cruise-main">进入大屏巡航演示</span>
            <span class="space__cruise-sub">全屏 · 自动巡航 · 解说字幕 · 现场投屏适用</span>
          </RouterLink>
          <RouterLink class="space__showcase-link" to="/showcase">
            <svg class="space__showcase-ico" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
              <circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.6"/>
            </svg>
            <span>看 AI 伴游楠楠如何在场景里「感知 → 决策 → 动作」</span>
            <svg class="space__showcase-arrow" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </RouterLink>
        </div>
      </div>
    </section>

    <section class="page space__main">
      <!-- 沉浸式查看器 -->
      <div class="space__stage yj-card">
        <div class="space__stagebar">
          <div class="space__modes">
            <button
              v-for="m in MODES"
              :key="m.key"
              class="space__mode"
              :class="{ 'is-on': mode === m.key }"
              type="button"
              @click="mode = m.key"
            >
              {{ m.label }}
            </button>
          </div>
          <div class="space__stageinfo">
            <template v-if="mode === 'pano'">
              <b>{{ currentScene?.name ?? "—" }}</b>
              <span v-if="currentScene" class="space__stagepoi">{{ currentScene.description }}</span>
            </template>
            <template v-else>
              <b>红建建筑群</b>
              <span class="space__stagepoi">
                RealityScan 摄影测量
                <template v-if="modelTriangles"> · {{ modelTriangles.toLocaleString() }} 面</template>
              </span>
              <span v-if="!modelUrl" class="space__stagelock">固定展项 · 不随上方场景切换</span>
            </template>
          </div>
        </div>

        <div class="space__viewport">
          <PanoViewer
            v-if="mode === 'pano' && currentScene"
            :key="`pano-${currentScene.id}`"
            :panorama="currentScene.panorama"
            :hotspots="hotspots"
            :initial-yaw="currentScene.default_yaw"
            :initial-pitch="currentScene.default_pitch"
            :initial-fov="currentScene.default_fov"
            @hotspot="onHotspot"
          />
          <ModelViewer
            v-else-if="mode === 'model'"
            :key="`model-${modelUrl || 'default'}`"
            :model-url="modelUrl"
            @loaded="(info) => (modelTriangles = info.triangles)"
          />
          <div v-else class="space__stageload">
            <div class="yj-spinner"></div>
            <p>场景加载中…</p>
          </div>

          <!-- 热点详情浮层 -->
          <Transition name="hotpop">
            <div v-if="activeHotspot" class="space__hotpop">
              <button class="space__hotpop-close" type="button" title="关闭" @click="activeHotspot = null">✕</button>
              <span class="space__hotpop-src">{{ activeHotspot.source }}</span>
              <h3 class="font-serif-sc">{{ activeHotspot.title }}</h3>
              <p>{{ activeHotspot.content }}</p>
              <RouterLink class="space__hotpop-go" :to="wikiLink(activeHotspot)">在知识库中查看 →</RouterLink>
            </div>
          </Transition>
        </div>

        <!-- 舞台脚注：操作提示 + 场景计数，替代原先与下方场景墙重复的缩略图条 -->
        <div class="space__stagefoot">
          <span class="space__stagefoot-hint">
            <template v-if="mode === 'pano'">按住拖动环视 · 滚轮缩放 · 手机可开陀螺仪</template>
            <template v-else>拖动旋转 · 滚轮缩放 · 松开自动旋转</template>
          </span>
          <span v-if="mode === 'pano' && scenes.length" class="space__stagefoot-count">
            {{ scenes.length }} 处实景场景
          </span>
        </div>

        <p v-if="mode === 'model'" class="space__scenenote">
          <b>本模式为固定展项</b>：展示红建建筑群一处摄影测量实景模型（原始 945 万面，离线减面后交付桌面 50 万面 /
          移动端 6.8 万面），与其余六处场景无关——那六处以 360° 全景呈现。
          更多景区实景模型将陆续接入，届时按场景透传 model_3d 即可。
        </p>
      </div>

      <!-- 场景卡片墙：六处实景一屏铺开，点选即换场景 -->
      <section v-if="mode === 'pano' && scenes.length" class="space__wall">
        <h3 class="section-title">六处实景场景</h3>
        <p class="space__wallsub">点任意一张，即可同时切换上方查看器与首屏主视觉。</p>
        <div class="space__wallgrid">
          <button
            v-for="s in scenes"
            :key="s.id"
            class="space__wallcard"
            :class="{ 'is-on': s.id === sceneId }"
            type="button"
            @click="sceneId = s.id"
          >
            <img
              v-if="!thumbError[s.id]"
              :src="s.thumbnail"
              :alt="s.name"
              loading="lazy"
              decoding="async"
              @error="onThumbError(s.id)"
            />
            <span class="space__wallcard-veil"></span>
            <span class="space__wallcard-poi">{{ s.poi_id }}</span>
            <span class="space__wallcard-body">
              <b>{{ s.name }}</b>
              <small>{{ s.description }}</small>
            </span>
            <span class="space__wallcard-on">正在浏览</span>
          </button>
        </div>
      </section>

      <!-- 场景卡片 + 知识增强 -->
      <div class="space__cols">
        <div v-if="loading" class="yj-card">
          <div class="yj-skeleton" style="height: 160px"></div>
        </div>
        <div v-else-if="kbItem" class="yj-card yj-card--hover space__info">
          <div class="space__infotitle">
            <span class="font-serif-sc space__infoname">{{ kbItem.name }}</span>
            <span v-if="kbItem.indoor" class="yj-tag yj-tag--indoor">室内</span>
          </div>
          <p class="space__summary">{{ kbItem.summary }}</p>
          <div class="space__chips">
            <span v-for="t in kbItem.tags.slice(0, 5)" :key="t" class="yj-tag">{{ t }}</span>
          </div>
          <div class="space__meta">
            <span v-if="kbItem.avg_cost_cny != null">{{ kbItem.avg_cost_cny === 0 ? "免费" : `门票 ¥${kbItem.avg_cost_cny}` }}</span>
            <span v-if="kbItem.avg_duration_min">建议 {{ Math.round(kbItem.avg_duration_min / 60) }} 小时</span>
            <span>评分 {{ kbItem.rating }}</span>
          </div>
        </div>

        <div class="yj-card space__next">
          <div class="space__nexttitle">接下来可以</div>
          <div class="space__nextopts">
            <RouterLink to="/agent" class="space__opt yj-card yj-card--hover">
              <span class="space__opt-ic">🤖</span>
              <span>让楠楠帮你排这条线路</span>
              <b>→</b>
            </RouterLink>
            <RouterLink to="/treasure" class="space__opt yj-card yj-card--hover">
              <span class="space__opt-ic">🗺</span>
              <span>挑战文化谜题集章</span>
              <b>→</b>
            </RouterLink>
          </div>
        </div>
      </div>

      <!-- 热点灵感 -->
      <div v-if="mode === 'pano' && hotspots.length" class="space__hot">
        <h3 class="section-title">本场景可探索点位</h3>
        <div class="space__hotgrid">
          <button
            v-for="h in hotspots"
            :key="h.id"
            class="yj-card yj-card--hover space__hotcard"
            type="button"
            @click="onHotspot(h)"
          >
            <span class="space__hotic">
              <svg viewBox="0 0 24 24" fill="none" v-html="hotspotType(h.icon).svg" />
            </span>
            <div>
              <b>{{ h.title }}</b>
              <span class="space__hottag">{{ hotspotType(h.icon).label }}</span>
              <p>{{ h.content }}</p>
            </div>
          </button>
        </div>
      </div>
    </section>

    <!-- 文化寻宝 · 底部通栏 -->
    <RouterLink to="/treasure" class="space__band" title="进入文化寻宝玩法">
      <div class="space__band-in">
        <span class="space__band-ic">🗺️</span>
        <div class="space__band-txt">
          <b>文化寻宝</b>
          <small>3D 云游 · 隐藏小玩法 —— 苍坡、丽水街、狮子岩、石桅岩… 8 座驿站各有文化挑战，云游途中即可打卡集章</small>
        </div>
        <span class="space__band-go">进入玩法 →</span>
      </div>
    </RouterLink>
  </div>
</template>

<style scoped>
.space {
  flex: 1;
}

/* ---------- 顶部 ---------- */
.space__hero {
  position: relative;
  /* 首屏要装得下真全景：给足高度，让 3D 成为第一印象 */
  height: clamp(420px, 62vh, 640px);
  display: flex;
  align-items: flex-end;
  overflow: hidden;
}
.space__bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(180deg, #0b1526, #0e1b30);
}
.space__head {
  position: relative;
  z-index: 2;
  padding-bottom: 30px;
}
.space__head h1 {
  font-size: clamp(26px, 4vw, 40px);
  margin: 12px 0 8px;
}
.space__sub {
  color: var(--text-secondary);
  max-width: 680px;
  line-height: 1.8;
  margin: 0 0 12px;
  font-size: 14px;
}
.space__tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
/* 亮点数据条：把技术含量摊开讲 */
.space__specs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.space__spec {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  padding: 5px 12px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-caption);
  color: var(--color-text-secondary);
  background: rgba(10, 18, 32, 0.5);
  border: 1px solid var(--color-line-soft);
  backdrop-filter: blur(6px);
}
.space__spec b {
  font-family: var(--font-mono);
  font-size: var(--fs-body-sm);
  color: var(--color-brand-300);
}
/* 通往大屏巡航演示 / AI 伴游楠楠 的成套入口 */
.space__entries {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 18px;
  width: fit-content;
  min-width: 360px;
  max-width: 100%;
}
/* 通往大屏巡航演示的入口 */
.space__cruise {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px 18px;
  border-radius: 12px;
  border: 1px solid rgba(62, 198, 184, 0.42);
  background: linear-gradient(120deg, rgba(62, 198, 184, 0.16), rgba(124, 143, 245, 0.1));
  transition: all 0.2s ease;
}
.space__cruise:hover {
  border-color: var(--primary);
  background: linear-gradient(120deg, rgba(62, 198, 184, 0.24), rgba(124, 143, 245, 0.16));
  transform: translateY(-1px);
}
.space__cruise-main {
  font-size: 15px;
  font-weight: 700;
  color: var(--primary);
  letter-spacing: 0.02em;
}
.space__cruise-sub {
  font-size: 12px;
  color: var(--text-dim);
  letter-spacing: 0.02em;
}
.space__showcase-link {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 12px;
  border: 1px dashed rgba(62, 198, 184, 0.36);
  background: rgba(62, 198, 184, 0.06);
  font-size: 13px;
  color: var(--text-secondary);
  letter-spacing: 0.02em;
  text-decoration: none;
  transition: all 0.18s ease;
}
.space__showcase-link:hover {
  color: var(--primary);
  border-color: var(--primary);
  border-style: solid;
  background: rgba(62, 198, 184, 0.12);
  transform: translateY(-1px);
}
.space__showcase-ico {
  width: 16px;
  height: 16px;
  color: var(--primary);
  flex: 0 0 auto;
}
.space__showcase-arrow {
  margin-left: auto;
  width: 14px;
  height: 14px;
  color: currentColor;
  flex: 0 0 auto;
  transition: transform 0.18s ease;
}
.space__showcase-link:hover .space__showcase-arrow {
  transform: translateX(2px);
}

/* ---------- 查看器舞台 ---------- */
.space__main {
  margin-top: 22px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.space__stage {
  padding: 0;
  overflow: hidden;
  border-color: var(--color-line-strong);
  box-shadow: var(--shadow-pop);
}
.space__stagebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-line-soft);
  background: linear-gradient(180deg, var(--color-surface-2), var(--color-surface-1));
}
.space__modes {
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: var(--radius-pill);
  background: rgba(10, 18, 32, 0.7);
  border: 1px solid var(--color-line-soft);
}
.space__mode {
  padding: 7px 18px;
  border: 0;
  border-radius: var(--radius-pill);
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-text-secondary);
  background: transparent;
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);
  white-space: nowrap;
}
.space__mode:hover {
  color: var(--color-text-primary);
}
.space__mode.is-on {
  color: var(--color-bg-base);
  background: var(--color-brand-500);
  box-shadow: 0 4px 12px rgba(62, 198, 184, 0.3);
}
.space__stageinfo {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  min-width: 0;
}
.space__stageinfo b {
  font-size: 14.5px;
}
.space__stagepoi {
  font-size: 12px;
  color: var(--color-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 46vw;
}
/* 「固定展项」标记：明确 3D 模式与上方场景选择解耦，避免误读为当前场景的模型 */
.space__stagelock {
  margin-top: 2px;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-line-soft);
  background: rgba(62, 198, 184, 0.08);
  color: var(--color-brand-400, #5ad3c4);
  font-size: 11px;
  line-height: 1.5;
  white-space: nowrap;
}

.space__viewport {
  position: relative;
  height: clamp(320px, 56vh, 560px);
  background: var(--color-bg-base);
}
.space__stageload {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

/* ---------- 热点浮层 ---------- */
.space__hotpop {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 5;
  width: min(360px, calc(100% - 32px));
  padding: 16px 18px;
  border-radius: var(--radius-lg);
  background: rgba(16, 28, 48, 0.94);
  border: 1px solid var(--color-line-strong);
  box-shadow: var(--shadow-modal);
  backdrop-filter: blur(10px);
}
.space__hotpop-close {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 1px solid var(--color-line-soft);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  font-size: 12px;
}
.space__hotpop-close:hover {
  color: var(--color-text-primary);
  border-color: var(--color-line-strong);
}
.space__hotpop-src {
  display: inline-block;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--color-brand-300);
  margin-bottom: 6px;
}
.space__hotpop h3 {
  margin: 0 0 8px;
  font-size: 17px;
  padding-right: 26px;
}
.space__hotpop p {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.75;
  color: var(--color-text-secondary);
}
.space__hotpop-go {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-brand-300);
}
.space__hotpop-go:hover {
  color: var(--color-brand-500);
}
.hotpop-enter-active,
.hotpop-leave-active {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}
.hotpop-enter-from,
.hotpop-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

/* ---------- 舞台脚注 ---------- */
.space__stagefoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid var(--color-line-soft);
  background: var(--color-surface-1);
}
.space__stagefoot-hint {
  font-size: 12px;
  letter-spacing: 0.04em;
  color: var(--color-text-tertiary);
}
.space__stagefoot-count {
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  color: var(--color-brand-300);
  white-space: nowrap;
}

/* ---------- 场景卡片墙 ---------- */
.space__wallsub {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--color-text-tertiary);
}
.space__wallgrid {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 14px;
}
.space__wallcard {
  position: relative;
  aspect-ratio: 16 / 10;
  padding: 0;
  overflow: hidden;
  font: inherit;
  text-align: left;
  cursor: pointer;
  border: 1px solid var(--color-line-soft);
  border-radius: var(--radius-lg);
  background: var(--color-surface-2);
  transition: border-color var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}
.space__wallcard img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform var(--dur-slow) var(--ease-out);
}
.space__wallcard:hover {
  transform: translateY(-2px);
  border-color: var(--color-line-strong);
}
.space__wallcard:hover img {
  transform: scale(1.06);
}
.space__wallcard.is-on {
  border-color: var(--color-brand-500);
  box-shadow: 0 0 0 2px rgba(62, 198, 184, 0.22);
}
.space__wallcard-veil {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 34%, rgba(10, 18, 32, 0.9) 100%);
}
.space__wallcard-poi {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  color: var(--color-text-primary);
  background: rgba(10, 18, 32, 0.55);
  backdrop-filter: blur(4px);
}
.space__wallcard-body {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 11px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.space__wallcard-body b {
  font-size: 15px;
  color: var(--color-text-primary);
}
.space__wallcard-body small {
  font-size: 11.5px;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.space__wallcard-on {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 2px 9px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-caption);
  color: var(--color-bg-base);
  background: var(--color-brand-500);
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}
.space__wallcard.is-on .space__wallcard-on {
  opacity: 1;
  transform: translateY(0);
}
.space__scenenote {
  margin: 0;
  padding: 12px 16px;
  font-size: 12.5px;
  line-height: 1.75;
  color: var(--color-text-tertiary);
  border-top: 1px solid var(--color-line-soft);
  background: var(--color-surface-1);
}

/* ---------- 知识卡 ---------- */
.space__cols {
  display: grid;
  grid-template-columns: 1fr minmax(280px, 1fr);
  gap: 16px;
  align-items: stretch;
}
.space__infotitle {
  display: flex;
  align-items: center;
  gap: 8px;
}
.space__infoname {
  font-size: 19px;
  font-weight: 700;
}
.space__summary {
  color: var(--text-secondary);
  line-height: 1.8;
  font-size: 14.5px;
  margin: 12px 0;
}
.space__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}
.space__meta {
  display: flex;
  gap: 18px;
  font-size: 12.5px;
  color: var(--text-dim);
  font-family: var(--font-mono);
}
.space__next {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.space__nexttitle {
  font-weight: 700;
  color: var(--text-primary);
}
.space__nextopts {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
}
.space__opt {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13.5px;
  color: var(--text-primary);
  padding: 12px 14px;
}
.space__opt-ic {
  font-size: 20px;
}
.space__opt b {
  margin-left: auto;
  color: var(--primary);
}

/* ---------- 热点网格 ---------- */
.space__hotgrid {
  margin-top: 12px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}
.space__hotcard {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 14px;
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: inherit;
}
.space__hotic {
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: rgba(62, 198, 184, 0.12);
  border: 1px solid rgba(62, 198, 184, 0.28);
  color: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
}
.space__hotic svg {
  width: 22px;
  height: 22px;
}
.space__hotcard b {
  font-size: 14px;
}
.space__hottag {
  display: inline-block;
  margin-left: 6px;
  font-size: 11px;
  color: var(--text-dim);
  letter-spacing: 0.06em;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
}
.space__hotcard p {
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.6;
  margin: 5px 0 0;
}

/* ---------- 底部通栏 ---------- */
.space__band {
  display: block;
  margin-top: 24px;
  position: relative;
  border-top: 1px solid rgba(62, 198, 184, 0.26);
  border-bottom: 1px solid rgba(62, 198, 184, 0.18);
  background:
    radial-gradient(720px 160px at 0% 130%, rgba(62, 198, 184, 0.17), transparent 60%),
    radial-gradient(640px 160px at 100% -40%, rgba(232, 184, 75, 0.12), transparent 60%),
    linear-gradient(180deg, #0f1d33, #0b1526);
  text-decoration: none;
  color: var(--text-primary);
  overflow: hidden;
  transition: filter 0.2s ease;
}
.space__band:hover {
  filter: brightness(1.13);
}
.space__band-in {
  width: 100%;
  box-sizing: border-box;
  padding: 16px 24px;
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 72px;
}
.space__band-ic {
  flex: 0 0 auto;
  width: 46px;
  height: 46px;
  border-radius: 13px;
  display: grid;
  place-items: center;
  font-size: 23px;
  background: linear-gradient(150deg, rgba(62, 198, 184, 0.24), rgba(62, 198, 184, 0.05));
  border: 1px solid rgba(62, 198, 184, 0.4);
  box-shadow: inset 0 0 16px rgba(62, 198, 184, 0.1), 0 8px 18px rgba(0, 0, 0, 0.28);
}
.space__band-txt {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1 1 auto;
}
.space__band-txt b {
  font-size: 17px;
  letter-spacing: 0.2px;
}
.space__band-txt small {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.65;
  max-width: min(680px, 52vw);
}
.space__band-go {
  margin-left: auto;
  flex: 0 0 auto;
  font-size: 13px;
  font-weight: 700;
  color: var(--primary);
  border: 1px solid rgba(62, 198, 184, 0.45);
  background: rgba(62, 198, 184, 0.09);
  padding: 8px 16px;
  border-radius: 999px;
  white-space: nowrap;
  transition: all 0.18s ease;
}
.space__band:hover .space__band-go {
  background: var(--primary);
  color: #06241f;
  box-shadow: 0 6px 16px rgba(62, 198, 184, 0.35);
}

@media (max-width: 800px) {
  .space__hero {
    /* 窄屏内容改为撑开高度，避免固定高度把文案挤出可视区 */
    height: auto;
    min-height: 0;
    padding-top: 30px;
  }
  .space__wallgrid {
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  }
  .space__cols {
    grid-template-columns: 1fr;
  }
  .space__stagebar {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .space__stageinfo {
    align-items: flex-start;
  }
  .space__stagepoi {
    max-width: none;
  }
  .space__modes {
    justify-content: center;
  }
  .space__mode {
    flex: 1;
    text-align: center;
  }
  .space__viewport {
    height: 380px;
  }
  .space__hotpop {
    right: 10px;
    left: 10px;
    width: auto;
    bottom: 10px;
  }
  .space__band {
    margin-top: 18px;
  }
  .space__band-in {
    min-height: 62px;
    padding: 12px 16px;
  }
  .space__band-txt small {
    display: none;
  }
}
</style>
