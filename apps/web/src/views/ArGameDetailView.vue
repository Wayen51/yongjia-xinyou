<script setup lang="ts">
/**
 * 板块二 · AR 互动：运营端游戏详情 / 编辑 / 发布
 * 运营在这里改题目、调围栏半径、换虚拟物与奖励券，并拿到玩家端入口二维码。
 */
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "@/api/client";
import ArMap from "@/components/ar/ArMap.vue";
import DemoQr from "@/components/ar/DemoQr.vue";
import type { ArMapMarker } from "@/components/ar/types";
import { openPlayerEntry, playerEntryUrl } from "@/lib/playerEntry";
import { toast } from "@/lib/toast";
import type { ArCoupon, ArGameDetail, ArGamePoint, ArTemplate } from "@/types/api";

const route = useRoute();
const router = useRouter();
const gameId = computed(() => String(route.params.id));

const game = ref<ArGameDetail | null>(null);
const templates = ref<ArTemplate[]>([]);
const coupons = ref<ArCoupon[]>([]);
const loading = ref(true);
const saving = ref(false);
const activePoi = ref<string | null>(null);

const BILLBOARDS = [
  "billboard-lantern.webp",
  "billboard-lotus-lamp.webp",
  "billboard-treasure.webp",
  "billboard-fu-bag.webp",
  "billboard-gift-box.webp",
  "billboard-coupon.webp",
  "billboard-scroll.webp",
  "billboard-nannan-sprite.webp",
];

const STATUS_META: Record<string, { label: string; tone: string }> = {
  draft: { label: "草稿", tone: "tone-warn" },
  active: { label: "进行中", tone: "tone-ok" },
  paused: { label: "已下线", tone: "tone-idle" },
  ended: { label: "已结束", tone: "tone-idle" },
};

const template = computed(() => templates.value.find((t) => t.id === game.value?.template_id));
const playUrl = computed(() => playerEntryUrl(gameId.value));

const markers = computed<ArMapMarker[]>(() =>
  (game.value?.points ?? []).map((p, i) => ({
    id: p.poi_id,
    name: p.poi_name,
    lat: p.lat,
    lng: p.lng,
    radius: p.geofence_radius_m,
    order: i + 1,
    state: i === 0 ? "current" : "pending",
    sub: p.task_type,
  })),
);

async function load() {
  loading.value = true;
  try {
    const [detail, tpl, cps] = await Promise.all([api.arGame(gameId.value), api.arTemplates(), api.arCoupons()]);
    game.value = detail;
    templates.value = tpl.templates;
    coupons.value = cps.coupons;
    activePoi.value = detail.points[0]?.poi_id ?? null;
  } catch (e) {
    toast((e as Error).message || "加载失败", "error");
  } finally {
    loading.value = false;
  }
}

async function save() {
  const g = game.value;
  if (!g) return;
  saving.value = true;
  try {
    const updated = await api.arUpdateGame(g.id, {
      name: g.name,
      intro: g.intro,
      outro: g.outro,
      start_date: g.start_date,
      end_date: g.end_date,
      completion_badge: g.completion_badge,
      points: g.points.map((p, i) => ({ ...p, order: i + 1 })),
    });
    game.value = updated;
    toast("已保存", "success");
  } catch (e) {
    toast((e as Error).message || "保存失败", "error");
  } finally {
    saving.value = false;
  }
}

async function publish() {
  const g = game.value;
  if (!g) return;
  try {
    await save();
    const res = await api.arPublishGame(g.id);
    toast(`已发布｜玩家入口 ${res.play_url}`, "success");
    load();
  } catch (e) {
    toast((e as Error).message || "发布失败", "error");
  }
}

async function pause() {
  const g = game.value;
  if (!g) return;
  await api.arPauseGame(g.id);
  toast("已下线", "info");
  load();
}

async function remove() {
  const g = game.value;
  if (!g) return;
  if (!window.confirm(`确认删除「${g.name}」？`)) return;
  await api.arDeleteGame(g.id);
  toast("已删除", "info");
  router.push("/ar");
}

function move(i: number, dir: -1 | 1) {
  const g = game.value;
  if (!g) return;
  const j = i + dir;
  if (j < 0 || j >= g.points.length) return;
  const arr = g.points;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

function removePoint(i: number) {
  const g = game.value;
  if (!g) return;
  g.points.splice(i, 1);
}

function setCoupon(p: ArGamePoint, id: string) {
  p.reward_coupon_id = id || null;
  const c = coupons.value.find((x) => x.id === id);
  p.reward_name = c?.name || "";
  p.coupon_image = c ? `/assets/ar/${c.image}` : null;
}

async function copyEntry() {
  try {
    await navigator.clipboard.writeText(playUrl.value);
    toast("玩家端链接已复制", "success");
  } catch {
    toast(playUrl.value, "info");
  }
}

onMounted(load);
</script>

<template>
  <div class="page page-wide py-8">
    <div v-if="loading" class="text-center text-secondary py-16">加载中…</div>

    <template v-else-if="game">
      <div class="flex flex-wrap items-end justify-between gap-4 mb-5">
        <div>
          <div class="flex items-center gap-3 flex-wrap">
            <h1 class="text-2xl font-bold tracking-wide">{{ game.name }}</h1>
            <span class="yj-tag" :class="STATUS_META[game.status]?.tone">{{ STATUS_META[game.status]?.label }}</span>
            <span class="yj-tag">{{ template?.festival || game.template_id }}</span>
            <span class="yj-tag">{{ game.points.length }} 个点位</span>
          </div>
          <p class="section-sub mt-2">
            {{ game.id }} · {{ game.start_date || '未设开始' }} ~ {{ game.end_date || '未设结束' }} ·
            参与 {{ game.participants }} 人 · 通关率 {{ game.completion_rate }}% ·
            剧情来源 {{ game.ai_mode === 'llm' ? 'LLM 生成' : '本地模板编排' }}
          </p>
        </div>
        <div class="flex gap-2 flex-wrap">
          <button class="yj-btn yj-btn--ghost" @click="router.push('/ar')">返回列表</button>
          <button class="yj-btn yj-btn--ghost" @click="openPlayerEntry(game.id)">玩家端预览</button>
          <button class="yj-btn yj-btn--ghost" @click="router.push(`/ar/${game.id}/monitor`)">位置监控</button>
          <button class="yj-btn yj-btn--ghost" :disabled="saving" @click="save">保存</button>
          <button v-if="game.status !== 'active'" class="yj-btn yj-btn--primary" @click="publish">发布上线</button>
          <button v-else class="yj-btn yj-btn--ghost" @click="pause">下线</button>
          <button class="yj-btn yj-btn--danger" @click="remove">删除</button>
        </div>
      </div>

      <div class="grid gap-6" style="grid-template-columns: 1fr 340px">
        <div class="flex flex-col gap-6">
          <!-- 地图分布 -->
          <section class="yj-card">
            <h2 class="font-bold mb-3">点位分布与围栏</h2>
            <ArMap :markers="markers" :active-id="activePoi" scene="overview" :height="380" @marker-click="activePoi = $event" />
          </section>

          <!-- 剧情 -->
          <section class="yj-card">
            <h2 class="font-bold mb-3">剧情文案</h2>
            <div class="grid gap-4" style="grid-template-columns: repeat(2, 1fr)">
              <label class="field">
                <span>开场剧情</span>
                <textarea v-model="game.intro" class="yj-input" rows="4" />
              </label>
              <label class="field">
                <span>通关结语</span>
                <textarea v-model="game.outro" class="yj-input" rows="4" />
              </label>
              <label class="field">
                <span>通关徽章</span>
                <input v-model="game.completion_badge" class="yj-input" />
              </label>
              <label class="field">
                <span>游戏名称</span>
                <input v-model="game.name" class="yj-input" />
              </label>
            </div>
          </section>

          <!-- 点位编辑 -->
          <section class="yj-card">
            <h2 class="font-bold mb-3">点位与谜题（{{ game.points.length }}）</h2>
            <div class="flex flex-col gap-3">
              <div
                v-for="(p, i) in game.points"
                :key="p.poi_id"
                class="station"
                :class="{ 'station--on': activePoi === p.poi_id }"
                @mouseenter="activePoi = p.poi_id"
              >
                <div class="flex items-center justify-between mb-2 gap-2 flex-wrap">
                  <div class="flex items-center gap-2">
                    <span class="no">{{ i + 1 }}</span>
                    <b class="text-sm">{{ p.poi_name }}</b>
                    <span class="yj-tag">{{ p.poi_type }}</span>
                    <span class="text-xs text-dim font-mono-sc">
                      {{ p.lat.toFixed(4) }}, {{ p.lng.toFixed(4) }}
                    </span>
                  </div>
                  <div class="flex gap-2">
                    <img v-if="p.billboard" class="bb" :src="p.billboard_url" :alt="p.billboard" />
                    <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="move(i, -1)">↑</button>
                    <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="move(i, 1)">↓</button>
                    <button class="yj-btn yj-btn--danger yj-btn--sm" @click="removePoint(i)">移除</button>
                  </div>
                </div>
                <div class="grid gap-3" style="grid-template-columns: repeat(2, 1fr)">
                  <label class="field" style="grid-column: span 2">
                    <span>题目</span>
                    <textarea v-model="p.question" class="yj-input" rows="2" />
                  </label>
                  <label class="field">
                    <span>标准答案</span>
                    <input v-model="p.answer" class="yj-input" />
                  </label>
                  <label class="field">
                    <span>提示</span>
                    <input v-model="p.hint" class="yj-input" />
                  </label>
                  <label class="field">
                    <span>虚拟物</span>
                    <select v-model="p.billboard" class="yj-input">
                      <option v-for="b in BILLBOARDS" :key="b" :value="b">{{ b.replace('billboard-', '').replace('.webp', '') }}</option>
                    </select>
                  </label>
                  <label class="field">
                    <span>围栏半径（米）</span>
                    <input v-model.number="p.geofence_radius_m" type="number" min="10" max="300" class="yj-input" />
                  </label>
                  <label class="field" style="grid-column: span 2">
                    <span>通关奖励券</span>
                    <select
                      class="yj-input"
                      :value="p.reward_coupon_id || ''"
                      @change="setCoupon(p, ($event.target as HTMLSelectElement).value)"
                    >
                      <option value="">不设奖励</option>
                      <option v-for="c in coupons" :key="c.id" :value="c.id">{{ c.name }}（{{ c.value_label }}）</option>
                    </select>
                  </label>
                </div>
              </div>
              <div v-if="!game.points.length" class="text-center text-secondary py-8">暂无点位，请到创建台补充</div>
            </div>
          </section>
        </div>

        <aside class="flex flex-col gap-6">
          <section class="yj-card text-center">
            <h2 class="font-bold mb-3">玩家端入口</h2>
            <DemoQr :text="playUrl" :size="140" caption="演示二维码 · 手机端输入链接体验" />
            <p class="text-xs text-dim mt-3 font-mono-sc break-all">{{ playUrl }}</p>
            <button class="yj-btn yj-btn--ghost yj-btn--sm mt-3" @click="copyEntry">复制链接</button>
            <button class="yj-btn yj-btn--primary yj-btn--sm mt-2 w-full" @click="router.push(`/ar/${game.id}/monitor`)">
              查看玩家实时位置
            </button>
          </section>

          <section class="yj-card">
            <h2 class="font-bold mb-3">玩法说明（现场讲解词）</h2>
            <ol class="flow">
              <li>游客扫码进入 → 看到开场剧情与点位清单</li>
              <li>按地图走到点位附近（演示用模拟定位，可一键到位）</li>
              <li>进入围栏后虚拟物出现（Billboard 平面呈现，不依赖专用眼镜）</li>
              <li>答对谜题解锁下一站，并获得商户券</li>
              <li>集齐全部点位 → 通关徽章 + 排行榜 + 领券核销（mock）</li>
            </ol>
          </section>

          <section class="yj-card">
            <h2 class="font-bold mb-3">奖励券（{{ coupons.length }}）</h2>
            <div class="flex flex-col gap-2">
              <div v-for="c in coupons" :key="c.id" class="flex items-center gap-2">
                <img :src="`/assets/ar/${c.image}`" :alt="c.name" class="cpn" />
                <div style="flex: 1; min-width: 0">
                  <div class="text-xs font-bold line-clamp-1">{{ c.name }}</div>
                  <div class="text-xs text-dim">{{ c.value_label }} · 有效 {{ c.valid_days }} 天</div>
                </div>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field > span {
  font-size: 12px;
  color: var(--text-secondary);
}
.station {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px;
  background: rgba(16, 28, 48, 0.6);
  transition: border-color var(--dur-fast) var(--ease-out);
}
.station--on {
  border-color: var(--primary);
}
.no {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 700;
  background: var(--accent-soft);
  color: var(--accent);
  flex: none;
}
.bb {
  width: 34px;
  height: 34px;
  object-fit: contain;
}
.cpn {
  width: 46px;
  height: 28px;
  object-fit: cover;
  border-radius: var(--radius-sm);
}
.flow {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: var(--lh-normal);
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
