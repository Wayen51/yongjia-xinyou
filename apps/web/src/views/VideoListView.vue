<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "@/api/client";
import type { VideoProjectMeta, VideoStats, VideoStyleResp } from "@/types/api";

const router = useRouter();
const items = ref<VideoProjectMeta[]>([]);
const stats = ref<VideoStats | null>(null);
const loading = ref(true);
type FilterKey = "all" | "running" | "done" | "failed";
const filter = ref<FilterKey>("all");
const styles = ref<VideoStyleResp["styles"]>([]);
const FILTERS: Array<{ id: FilterKey; name: string }> = [
  { id: "all", name: "全部" },
  { id: "running", name: "生成中" },
  { id: "done", name: "已完成" },
  { id: "failed", name: "失败" },
];

const COVERS = [
  "/assets/hero/hero-nanxi.webp",
  "/assets/3d/shiwei-poster.webp",
  "/assets/img/kb/poi-002-cover.webp",
  "/assets/img/kb/cul-005-cover.webp",
  "/assets/img/kb/biz-003-cover.webp",
  "/assets/img/kb/poi-007-cover.webp",
];

const STATUS_META: Record<string, { label: string; tone: string }> = {
  scripting: { label: "脚本编排中", tone: "tone-warn" },
  generating: { label: "镜头生成中", tone: "tone-run" },
  stitching: { label: "拼接中", tone: "tone-run" },
  done: { label: "已完成", tone: "tone-ok" },
  failed: { label: "生成失败", tone: "tone-bad" },
};

const styleName = (id: string) => styles.value.find((s) => s.id === id)?.name || id;
const styleOf = (i: number) => COVERS[i % COVERS.length];

const filtered = computed(() => {
  if (filter.value === "all") return items.value;
  const run = new Set(["scripting", "generating", "stitching"]);
  return items.value.filter((it) =>
    filter.value === "running" ? run.has(it.status) : it.status === filter.value,
  );
});

async function load() {
  loading.value = true;
  try {
    const [list, st] = await Promise.all([api.listVideos(), api.videoStyles()]);
    items.value = list.items;
    stats.value = list.stats;
    styles.value = st.styles;
  } finally {
    loading.value = false;
  }
}

async function remove(id: string) {
  if (!window.confirm("确认删除该项目？分镜脚本与生成记录将一并删除。")) return;
  await api.videoDelete(id);
  load();
}

onMounted(load);

const statCards = computed(() => [
  { label: "项目总数", value: stats.value?.total ?? 0, hint: "AI 视频项目" },
  { label: "已完成成片", value: stats.value?.done ?? 0, hint: "可交付内容组替换" },
  { label: "生成中", value: stats.value?.generating ?? 0, hint: "脚本/镜头/拼接" },
  { label: "模拟成片总时长", value: `${stats.value?.total_duration_sec ?? 0}s`, hint: "分镜累计" },
]);

function fmtDay(s: string) {
  return s ? s.slice(0, 10) : "";
}
</script>

<template>
  <div class="page page-wide py-8">
    <div class="flex flex-wrap items-end justify-between gap-4 mb-5">
      <div>
        <h1 class="text-2xl font-bold tracking-wide">AI 视频工坊 · 作品</h1>
        <p class="section-sub mt-1">AIGC 视频项目集 · 提示词美化与模拟流水线的产出归档</p>
      </div>
      <button class="yj-btn yj-btn--primary" @click="router.push('/video/new')">＋ 新创作</button>
    </div>

    <!-- 统计 -->
    <div class="grid gap-4 mb-6" style="grid-template-columns: repeat(4, 1fr)">
      <div v-for="c in statCards" :key="c.label" class="yj-card text-center">
        <div class="text-2xl font-bold font-mono-sc" style="color: var(--primary)">{{ c.value }}</div>
        <div class="text-sm mt-1">{{ c.label }}</div>
        <div class="text-xs text-dim mt-0.5">{{ c.hint }}</div>
      </div>
    </div>

    <!-- 筛选 -->
    <div class="flex gap-2 mb-4 flex-wrap">
      <button
        v-for="f in FILTERS"
        :key="f.id"
        class="yj-tag"
        style="cursor: pointer; padding: 6px 14px"
        :class="filter === f.id ? 'yj-tag--poi' : ''"
        @click="filter = f.id"
      >
        {{ f.name }}
      </button>
    </div>

    <div v-if="loading" class="text-center text-secondary py-16">加载中…</div>

    <div v-else-if="filtered.length === 0" class="yj-card text-center py-16">
      <p class="text-secondary mb-4">还没有视频项目</p>
      <button class="yj-btn yj-btn--primary" @click="router.push('/video/new')">创作第一条 AI 视频</button>
    </div>

    <div v-else class="grid gap-5" style="grid-template-columns: repeat(3, 1fr)">
      <div v-for="(it, i) in filtered" :key="it.id" class="yj-card yj-card--hover video-card">
        <div class="video-cover" @click="router.push('/video/' + it.id)">
          <img :src="styleOf(i)" :alt="it.title" loading="lazy" />
          <div class="video-cover__shade" />
          <span class="yj-tag video-cover__style">{{ styleName(it.style) }}</span>
          <button class="play-badge" title="查看详情">▶</button>
          <span class="yj-tag video-cover__status" :class="STATUS_META[it.status]?.tone">
            {{ STATUS_META[it.status]?.label }}
          </span>
        </div>
        <div class="pt-3">
          <h3 class="font-bold leading-snug line-clamp-1" style="cursor: pointer" @click="router.push('/video/' + it.id)">
            {{ it.title }}
          </h3>
          <p class="text-xs text-secondary mt-1 line-clamp-1">{{ it.user_prompt }}</p>
          <div class="flex items-center justify-between mt-3">
            <span class="text-xs font-mono-sc text-dim">{{ it.shot_count }} 镜头 · {{ fmtDay(it.created_at) }}</span>
            <div class="flex gap-2">
              <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="router.push('/video/' + it.id)">详情</button>
              <button class="yj-btn yj-btn--danger yj-btn--sm" @click="remove(it.id)">删除</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.video-cover {
  position: relative;
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  aspect-ratio: 16 / 9;
}
.video-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.video-cover__shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 45%, rgba(4, 8, 16, 0.85));
}
.video-cover__style {
  position: absolute;
  left: 8px;
  top: 8px;
}
.video-cover__status {
  position: absolute;
  right: 8px;
  top: 8px;
}
.play-badge {
  position: absolute;
  left: 50%;
  top: 46%;
  transform: translate(-50%, -50%);
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.6);
  background: rgba(10, 18, 32, 0.55);
  color: #fff;
  font-size: 14px;
  display: grid;
  place-items: center;
  backdrop-filter: blur(4px);
  transition: background 0.2s;
}
.video-cover:hover .play-badge {
  background: var(--primary);
  border-color: var(--primary);
}
.tone-ok {
  color: var(--success);
  border-color: rgba(74, 222, 128, 0.4);
  background: rgba(74, 222, 128, 0.1);
}
.tone-run {
  color: #93c5fd;
  border-color: rgba(62, 198, 184, 0.4);
  background: rgba(62, 198, 184, 0.12);
}
.tone-warn {
  color: var(--warning);
  border-color: rgba(251, 191, 36, 0.4);
  background: rgba(251, 191, 36, 0.1);
}
.tone-bad {
  color: var(--danger);
  border-color: rgba(248, 113, 113, 0.4);
  background: rgba(248, 113, 113, 0.1);
}
</style>
