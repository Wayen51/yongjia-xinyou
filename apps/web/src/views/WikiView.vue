<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { api } from "@/api/client";
import { assetUrl } from "@/lib/assets";
import { fmtCost, fmtDuration } from "@/lib/rich";
import type { Domain, KbItem } from "@/types/api";

const route = useRoute();

const tabs = [
  { key: "", label: "全部" },
  { key: "culture", label: "文化·非遗" },
  { key: "poi", label: "山水·景点" },
  { key: "business", label: "烟火·商家" },
];

const activeTab = ref<"" | Domain>("");
const q = ref<string>("");
const indoorOnly = ref(false);
const items = ref<KbItem[]>([]);
const total = ref(0);
const loading = ref(false);
const page = ref(0);
const PAGE_SIZE = 24;
const noMore = ref(false);

let seq = 0;
async function load(reset = true) {
  const my = ++seq;
  if (reset) {
    page.value = 0;
    items.value = [];
    noMore.value = false;
  }
  loading.value = true;
  try {
    const resp = await api.searchKnowledge({
      q: q.value || undefined,
      domain: activeTab.value || undefined,
      indoor: indoorOnly.value ? "1" : undefined,
      limit: PAGE_SIZE,
    });
    if (my !== seq) return;
    // 仅取一页（演示环境数据量小，直接全量渲染更直观）
    items.value = resp.items;
    total.value = resp.total;
    noMore.value = items.value.length >= resp.total;
  } catch {
    if (my === seq) {
      items.value = [];
      total.value = 0;
    }
  } finally {
    if (my === seq) loading.value = false;
  }
}

watch(activeTab, () => load(true));
watch(indoorOnly, () => load(true));

let deb: ReturnType<typeof setTimeout> | undefined;
let fromRoute = false;
watch(q, () => {
  if (fromRoute) return;
  clearTimeout(deb);
  deb = setTimeout(() => load(true), 320);
});

/* 支持全局搜索框：/wiki?q=&focus= 直达条目详情（openDetail 为函数声明，先注册后执行） */
watch(
  () => ({ q: route.query.q as string | undefined, focus: route.query.focus as string | undefined }),
  async () => {
    const nq = typeof route.query.q === "string" ? route.query.q : "";
    fromRoute = true;
    if (nq !== q.value) q.value = nq;
    setTimeout(() => {
      fromRoute = false;
    }, 0);
    await load(true);
    const fid = typeof route.query.focus === "string" ? route.query.focus : "";
    if (fid && drawer.value?.id !== fid) await openDetail(fid);
  },
  { immediate: true },
);

/* ---------- 详情抽屉 ---------- */
const drawer = ref<{ id: string; item: KbItem | null; related: KbItem[] } | null>(null);
const detailLoading = ref(false);

async function openDetail(it: KbItem | string) {
  const id = typeof it === "string" ? it : it.id;
  drawer.value = { id, item: typeof it === "string" ? null : it, related: [] };
  detailLoading.value = true;
  try {
    const d = await api.knowledgeById(id);
    if (drawer.value?.id === id) {
      drawer.value.item = d.item;
      drawer.value.related = d.related;
    }
  } catch {
    /* 保留列表项数据 */
  } finally {
    detailLoading.value = false;
  }
}
function closeDetail() {
  drawer.value = null;
}

const domColor = (d: Domain | string) =>
  d === "poi" ? "yj-tag--poi" : d === "culture" ? "yj-tag--culture" : d === "business" ? "yj-tag--business" : "";

function paragraphs(s: string) {
  return s
    .split(/\n{1,}/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** 封面加载失败 → 条目级 fallback → 全局占位图 */
function fallbackCover(e: Event) {
  const el = e.currentTarget as HTMLImageElement | null;
  if (!el) return;
  const fb = el.dataset.fallback || "/assets/img/placeholders/poi-cover.webp";
  if (el.src.endsWith(fb)) return;
  el.src = fb;
}
</script>

<template>
  <div class="wiki page">
    <!-- 头部 -->
    <div class="wiki__head">
      <div>
        <h1 class="wiki__title font-serif-sc">永嘉知识库</h1>
        <p class="wiki__sub">文化 · 山水 · 烟火 —— AI 伴游的全部底气，源自这里的每一条真实条目。</p>
      </div>
      <span class="demo-chip">演示数据已就绪</span>
    </div>

    <!-- 控制 -->
    <div class="wiki__bar">
      <div class="wiki__tabs">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="wiki__tab"
          :class="{ 'wiki__tab--on': activeTab === t.key }"
          @click="activeTab = t.key as '' | Domain"
        >{{ t.label }}</button>
      </div>
      <div class="wiki__search">
        <span class="wiki__search-ic">🔍</span>
        <input v-model="q" class="wiki__input" type="search" placeholder="搜索：如 永嘉学派 / 麦饼 / 石桅岩…" />
        <label class="wiki__indoor">
          <input v-model="indoorOnly" type="checkbox" />
          <span>仅室内（雨天友好）</span>
        </label>
      </div>
    </div>

    <div class="wiki__count" v-if="!loading">共 {{ total }} 条</div>

    <!-- 网格 -->
    <div v-if="loading && !items.length" class="wiki__grid">
      <div v-for="i in 8" :key="i" class="yj-skeleton" style="height: 240px"></div>
    </div>

    <div v-else-if="!items.length" class="wiki__empty">
      没有匹配条目，换个关键词试试？
    </div>

    <div v-else class="wiki__grid">
      <article
        v-for="it in items"
        :key="it.id"
        class="yj-card yj-card--hover wiki__card"
        @click="openDetail(it)"
      >
        <div class="wiki__cover">
          <img
            :src="assetUrl(it.assets.cover) || assetUrl(it.assets.fallback)"
            :data-fallback="assetUrl(it.assets.fallback) || '/assets/img/placeholders/poi-cover.webp'"
            alt=""
            loading="lazy"
            @error="fallbackCover"
          />
          <span class="wiki__tag" :class="domColor(it.domain)">{{ it.domain === 'poi' ? '景点' : it.domain === 'culture' ? '文化' : '商家' }}</span>
          <span v-if="it.indoor" class="wiki__indoor">☂ 室内</span>
        </div>
        <div class="wiki__body">
          <h3 class="wiki__name">{{ it.name }}</h3>
          <p class="wiki__sum">{{ it.summary }}</p>
          <div class="wiki__meta">
            <span v-if="it.avg_cost_cny != null">{{ fmtCost(it.avg_cost_cny) }}</span>
            <span v-if="it.avg_duration_min">{{ fmtDuration(it.avg_duration_min) }}</span>
            <span v-if="it.rating">★ {{ it.rating }}</span>
          </div>
        </div>
      </article>
    </div>

    <!-- 详情抽屉 -->
    <Transition name="drawer">
      <div v-if="drawer" class="drawer-mask" @click.self="closeDetail">
        <aside class="drawer">
          <button class="drawer__close" @click="closeDetail">✕</button>
          <div v-if="!drawer.item && detailLoading" class="drawer__pad">
            <div class="yj-skeleton" style="height: 200px; margin-top: 10px"></div>
          </div>
          <div v-else-if="drawer.item" class="drawer__body yj-scroll">
            <div class="drawer__cover">
              <img
                :src="assetUrl(drawer.item.assets.cover) || assetUrl(drawer.item.assets.fallback)"
                :data-fallback="assetUrl(drawer.item.assets.fallback) || '/assets/img/placeholders/poi-cover.webp'"
                @error="fallbackCover"
              />
            </div>
            <div class="drawer__pad">
              <div class="drawer__head">
                <div>
                  <span class="wiki__tag" :class="domColor(drawer.item.domain)">
                    {{ drawer.item.domain === 'poi' ? '景点' : drawer.item.domain === 'culture' ? '文化' : '商家' }}
                  </span>
                  <h2 class="drawer__name font-serif-sc">{{ drawer.item.name }}</h2>
                </div>
                <span class="demo-chip">{{ drawer.item.id }}</span>
              </div>

              <p class="drawer__summary">{{ drawer.item.summary }}</p>

              <div v-for="(p, i) in paragraphs(drawer.item.content)" :key="i" class="drawer__para">{{ p }}</div>

              <div class="drawer__facts">
                <div class="drawer__fact" v-if="drawer.item.category">分类 <b>{{ drawer.item.category }}</b></div>
                <div class="drawer__fact" v-if="drawer.item.avg_cost_cny != null">参考花费 <b>{{ fmtCost(drawer.item.avg_cost_cny) }}</b></div>
                <div class="drawer__fact" v-if="drawer.item.avg_duration_min">建议游玩 <b>{{ fmtDuration(drawer.item.avg_duration_min) }}</b></div>
                <div class="drawer__fact">适合 <b>{{ drawer.item.suitable_for.join(" / ") }}</b></div>
              </div>

              <div class="drawer__tags">
                <span v-for="t in drawer.item.tags" :key="t" class="yj-tag">{{ t }}</span>
              </div>

              <div class="drawer__source">
                内容来源：<a :href="drawer.item.source_url || '#'" target="_blank" rel="noopener">{{ drawer.item.source }}</a>
              </div>

              <div v-if="drawer.related.length" class="drawer__related">
                <div class="drawer__rel-title">相关内容</div>
                <div class="drawer__relgrid">
                  <button
                    v-for="r in drawer.related"
                    :key="r.id"
                    class="drawer__rel"
                    @click="openDetail(r)"
                  >
                    <span class="yj-tag" :class="domColor(r.domain)">{{ r.domain === 'poi' ? '景点' : r.domain === 'culture' ? '文化' : '商家' }}</span>
                    {{ r.name }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.wiki {
  padding-top: 26px;
  padding-bottom: 20px;
}
.wiki__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
}
.wiki__title {
  font-size: 28px;
  margin: 0;
}
.wiki__sub {
  color: var(--text-secondary);
  font-size: 14px;
  margin: 8px 0 0;
}
.wiki__bar {
  margin-top: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wiki__tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.wiki__tab {
  cursor: pointer;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  border-radius: 999px;
  padding: 7px 18px;
  font-size: 14px;
  transition: all 0.16s ease;
}
.wiki__tab:hover {
  color: var(--text-primary);
  border-color: rgba(62, 198, 184, 0.4);
}
.wiki__tab--on {
  color: var(--primary);
  background: var(--primary-soft);
  border-color: rgba(62, 198, 184, 0.5);
}
.wiki__search {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px 12px;
  flex-wrap: wrap;
}
.wiki__search-ic {
  font-size: 14px;
  opacity: 0.7;
}
.wiki__input {
  flex: 1;
  min-width: 180px;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-size: 14px;
  padding: 6px 0;
}
.wiki__indoor {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  color: var(--text-secondary);
  cursor: pointer;
  accent-color: var(--primary);
}
.wiki__count {
  margin-top: 14px;
  font-size: 12px;
  color: var(--text-dim);
}
.wiki__grid {
  margin-top: 12px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 14px;
}
.wiki__card {
  cursor: pointer;
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.wiki__cover {
  position: relative;
  height: 128px;
  overflow: hidden;
}
.wiki__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s ease;
}
.wiki__card:hover .wiki__cover img {
  transform: scale(1.05);
}
.wiki__cover::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 55%, rgba(16, 28, 48, 0.95));
}
.wiki__tag {
  position: absolute;
  left: 10px;
  top: 10px;
  z-index: 2;
}
.wiki__indoor {
  position: absolute;
  right: 10px;
  top: 10px;
  z-index: 2;
}
.wiki__body {
  padding: 10px 14px 12px;
}
.wiki__name {
  font-size: 15.5px;
  margin: 0 0 5px;
}
.wiki__sum {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0 0 8px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.wiki__meta {
  display: flex;
  gap: 12px;
  font-size: 11.5px;
  color: var(--text-dim);
  font-family: "JetBrains Mono", monospace;
}
.wiki__empty {
  text-align: center;
  color: var(--text-dim);
  padding: 60px 0;
}

/* drawer */
.drawer-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(6, 10, 18, 0.6);
  backdrop-filter: blur(3px);
}
.drawer {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: min(460px, 94vw);
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.drawer__close {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 3;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: rgba(10, 18, 32, 0.6);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
}
.drawer__close:hover {
  color: var(--primary);
  border-color: var(--primary);
}
.drawer__body {
  flex: 1;
  overflow-y: auto;
}
.drawer__cover {
  height: 180px;
}
.drawer__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.drawer__pad {
  padding: 16px 18px 30px;
}
.drawer__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}
.drawer__name {
  margin: 10px 0 0;
  font-size: 22px;
}
.drawer__summary {
  color: var(--primary);
  font-size: 14px;
  line-height: 1.7;
  border-left: 3px solid var(--primary);
  padding-left: 12px;
  margin: 14px 0;
}
.drawer__para {
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.9;
  margin-bottom: 12px;
}
.drawer__facts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 14px 0;
}
.drawer__fact {
  font-size: 12px;
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 10px;
}
.drawer__fact b {
  color: var(--text-primary);
  font-weight: 500;
  margin-left: 4px;
}
.drawer__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.drawer__source {
  margin-top: 16px;
  font-size: 12px;
  color: var(--text-dim);
}
.drawer__source a {
  color: var(--primary);
}
.drawer__related {
  margin-top: 18px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
.drawer__rel-title {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}
.drawer__relgrid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.drawer__rel {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-primary);
  font-size: 12.5px;
  border-radius: 8px;
  padding: 5px 10px;
}
.drawer__rel:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.22s ease;
}
.drawer-enter-active .drawer,
.drawer-leave-active .drawer {
  transition: transform 0.22s ease;
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}
.drawer-enter-from .drawer,
.drawer-leave-to .drawer {
  transform: translateX(40px);
}
</style>
