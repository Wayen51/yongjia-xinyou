<script setup lang="ts">
/**
 * 板块二 · AR 互动：运营端游戏列表
 * 一屏看清「有哪些 AR 寻宝游戏、跑到什么状态」，并提供创建/发布/下线/玩家端预览入口。
 */
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "@/api/client";
import { openPlayerEntry } from "@/lib/playerEntry";
import { toast } from "@/lib/toast";
import type { ArGameMeta, ArStats, ArTemplate } from "@/types/api";

const router = useRouter();
const games = ref<ArGameMeta[]>([]);
const stats = ref<ArStats | null>(null);
const templates = ref<ArTemplate[]>([]);
const loading = ref(true);

type FilterKey = "all" | "active" | "draft" | "paused";
const FILTERS: Array<{ id: FilterKey; name: string }> = [
  { id: "all", name: "全部" },
  { id: "active", name: "进行中" },
  { id: "draft", name: "草稿" },
  { id: "paused", name: "已下线" },
];
const filter = ref<FilterKey>("all");

const STATUS_META: Record<string, { label: string; tone: string }> = {
  draft: { label: "草稿", tone: "tone-warn" },
  active: { label: "进行中", tone: "tone-ok" },
  paused: { label: "已下线", tone: "tone-idle" },
  ended: { label: "已结束", tone: "tone-idle" },
};

const filtered = computed(() =>
  filter.value === "all" ? games.value : games.value.filter((g) => g.status === filter.value),
);

const tplOf = (id: string) => templates.value.find((t) => t.id === id);
const coverOf = (g: ArGameMeta) => g.cover || `/assets/ar/theme/${g.template_id}/card.webp`;

const statCards = computed(() => [
  { label: "游戏总数", value: stats.value?.total_games ?? 0, hint: "含草稿与已下线" },
  { label: "进行中", value: stats.value?.active_games ?? 0, hint: "玩家端可进入" },
  { label: "累计参与", value: stats.value?.participants ?? 0, hint: "人次（演示）" },
  { label: "通关率", value: `${stats.value?.completion_rate ?? 0}%`, hint: `已发券 ${stats.value?.coupons_claimed ?? 0} 张` },
]);

async function load() {
  loading.value = true;
  try {
    const [list, tpl] = await Promise.all([api.arGames(), api.arTemplates()]);
    games.value = list.games;
    stats.value = list.stats;
    templates.value = tpl.templates;
  } catch (e) {
    toast((e as Error).message || "加载失败", "error");
  } finally {
    loading.value = false;
  }
}

async function publish(g: ArGameMeta) {
  const res = await api.arPublishGame(g.id);
  toast(`已发布：${g.name}｜玩家入口 ${res.play_url}`, "success");
  load();
}

async function pause(g: ArGameMeta) {
  await api.arPauseGame(g.id);
  toast(`已下线：${g.name}`, "info");
  load();
}

async function remove(g: ArGameMeta) {
  if (!window.confirm(`确认删除「${g.name}」？点位配置将一并删除。`)) return;
  await api.arDeleteGame(g.id);
  toast("已删除", "info");
  load();
}

onMounted(load);
</script>

<template>
  <div class="page page-wide py-8">
    <div class="flex flex-wrap items-end justify-between gap-4 mb-5">
      <div>
        <h1 class="text-2xl font-bold tracking-wide">AR 互动 · 游戏管理</h1>
        <p class="section-sub mt-1">
          节日模板 → AI 生成剧情谜题 → 地图打点发布 → 玩家实地围栏寻宝 · 全流程演示
        </p>
      </div>
      <div class="flex gap-2">
        <button class="yj-btn yj-btn--ghost" @click="router.push('/ar/AR-GAME-001')">查看演示样例</button>
        <button class="yj-btn yj-btn--primary" @click="router.push('/ar/new')">＋ 创建游戏</button>
      </div>
    </div>

    <div class="grid gap-4 mb-6" style="grid-template-columns: repeat(4, 1fr)">
      <div v-for="c in statCards" :key="c.label" class="yj-card text-center">
        <div class="text-2xl font-bold font-mono-sc" style="color: var(--primary)">{{ c.value }}</div>
        <div class="text-sm mt-1">{{ c.label }}</div>
        <div class="text-xs text-dim mt-0.5">{{ c.hint }}</div>
      </div>
    </div>

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
      <p class="text-secondary mb-4">还没有 AR 互动游戏</p>
      <button class="yj-btn yj-btn--primary" @click="router.push('/ar/new')">创建第一场 AR 寻宝</button>
    </div>

    <div v-else class="grid gap-5" style="grid-template-columns: repeat(3, 1fr)">
      <div v-for="g in filtered" :key="g.id" class="yj-card yj-card--hover ar-card">
        <div class="ar-cover" @click="router.push('/ar/' + g.id)">
          <img :src="coverOf(g)" :alt="g.name" loading="lazy" @error="($event.target as HTMLImageElement).src = '/assets/ar/share/share-cover.webp'" />
          <div class="ar-cover__shade" />
          <span class="yj-tag ar-cover__tpl">{{ tplOf(g.template_id)?.festival || g.template_id }}</span>
          <span class="yj-tag ar-cover__status" :class="STATUS_META[g.status]?.tone">
            {{ STATUS_META[g.status]?.label || g.status }}
          </span>
          <div class="ar-cover__meta">
            <span>{{ g.point_count }} 个点位</span>
            <span>{{ g.participants }} 人参与</span>
            <span>通关 {{ g.completion_rate }}%</span>
          </div>
        </div>
        <div class="pt-3">
          <h3 class="font-bold leading-snug line-clamp-1" style="cursor: pointer" @click="router.push('/ar/' + g.id)">
            {{ g.name }}
          </h3>
          <p class="text-xs text-secondary mt-1 line-clamp-1">
            {{ tplOf(g.template_id)?.name || g.template_id }} · {{ g.start_date || '未设开始' }} ~ {{ g.end_date || '未设结束' }}
          </p>
          <div class="flex items-center justify-between mt-3 gap-2 flex-wrap">
            <span class="text-xs font-mono-sc text-dim">{{ g.id }}</span>
            <div class="flex gap-2">
              <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="router.push('/ar/' + g.id)">详情</button>
              <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="openPlayerEntry(g.id)">玩家端</button>
              <button v-if="g.status !== 'active'" class="yj-btn yj-btn--primary yj-btn--sm" @click="publish(g)">发布</button>
              <button v-else class="yj-btn yj-btn--ghost yj-btn--sm" @click="pause(g)">下线</button>
              <button class="yj-btn yj-btn--danger yj-btn--sm" @click="remove(g)">删除</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ar-cover {
  position: relative;
  border-radius: var(--radius-md);
  overflow: hidden;
  cursor: pointer;
  aspect-ratio: 16 / 9;
  background: var(--bg-elevated);
}
.ar-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.ar-cover__shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 40%, rgba(4, 8, 16, 0.88));
}
.ar-cover__tpl {
  position: absolute;
  left: 8px;
  top: 8px;
}
.ar-cover__status {
  position: absolute;
  right: 8px;
  top: 8px;
}
.ar-cover__meta {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 8px;
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--text-secondary);
}
.tone-ok {
  color: var(--success);
  border-color: rgba(74, 222, 128, 0.4);
  background: rgba(74, 222, 128, 0.1);
}
.tone-warn {
  color: var(--warning);
  border-color: rgba(251, 191, 36, 0.4);
  background: rgba(251, 191, 36, 0.1);
}
.tone-idle {
  color: var(--text-secondary);
  border-color: var(--border);
  background: rgba(107, 120, 145, 0.12);
}
</style>
