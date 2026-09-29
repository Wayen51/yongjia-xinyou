<script setup lang="ts">
/**
 * 玩家端 · 旅游攻略
 *
 * 两个 Tab：
 *  - 景点：知识库（/api/knowledge）按 domain 筛出「山水景点 / 文化非遗 / 烟火商家」，点开读介绍
 *  - 路线：/api/itinerary/generate 生成逐日行程，作为行前路线引导
 *
 * 演示口径：不接真实票务/导航，路线为预置行程线的自然语言选线结果。
 */
import { onMounted, ref } from "vue";
import { api } from "@/api/client";
import { assetUrl } from "@/lib/assets";
import type { DemoPlan, KbItem } from "@/types/api";

const tab = ref<"spot" | "route">("spot");

const DOMAINS = ["poi", "culture", "business", ""] as const;
const DOMAIN_LABEL: Record<string, string> = {
  poi: "山水景点",
  culture: "文化非遗",
  business: "烟火商家",
  "": "全部",
};
const domain = ref<string>("poi");

const items = ref<KbItem[]>([]);
const loading = ref(false);
const detail = ref<KbItem | null>(null);

async function loadSpots() {
  loading.value = true;
  try {
    const r = await api.searchKnowledge({ domain: domain.value || undefined, limit: 40 });
    items.value = r.items ?? [];
  } catch {
    items.value = [];
  } finally {
    loading.value = false;
  }
}

/** 景点封面：seed 的 assets.cover 已指向真实照片 */
function thumbUrl(it: KbItem) {
  return assetUrl(it.assets?.cover) || "/assets/img/placeholders/poi-cover.webp";
}

function pickDomain(k: string) {
  domain.value = k;
  loadSpots();
}

const ROUTES = [
  { t: "经典两日", p: "帮我规划永嘉经典两日游" },
  { t: "亲子轻松", p: "带孩子玩两天，节奏轻松一点" },
  { t: "本地美食", p: "想吃永嘉本地美食，安排两天" },
  { t: "耕读非遗", p: "想体验耕读文化和非遗手作" },
];

const plan = ref<DemoPlan | null>(null);
const planLoading = ref(false);
const SESSION_ID = "mobile-guide-demo";

async function makeRoute(prompt: string) {
  planLoading.value = true;
  plan.value = null;
  try {
    const r = (await api.generateItinerary(SESSION_ID, prompt)) as Record<string, unknown>;
    const cand = (r?.itinerary ?? r?.plan ?? r) as DemoPlan;
    plan.value = cand?.days?.length ? cand : null;
  } catch {
    plan.value = null;
  } finally {
    planLoading.value = false;
  }
}

/** 兼容两种数据口径：景点（avg_cost_cny）与行程当日项（cost_cny） */
function cost(it: { avg_cost_cny?: number | null; cost_cny?: number }) {
  const v = it.cost_cny ?? it.avg_cost_cny;
  return v ? `¥${v}` : "免费";
}

onMounted(loadSpots);
</script>

<template>
  <div class="mg">
    <!-- 顶部 Banner -->
    <section class="mg__banner">
      <img class="mg__bannerimg" src="/assets/mobile/banners/banner-guide.webp?v=20260913" alt="" />
      <div class="mg__veil"></div>
      <div class="mg__bannerhead">
        <h1>旅游攻略</h1>
        <p>景点介绍 · 路线引导</p>
      </div>
    </section>

    <!-- 顶部分段 -->
    <div class="mg__seg">
      <button class="mg__segbtn" :class="{ 'is-on': tab === 'spot' }" @click="tab = 'spot'">
        景点介绍
      </button>
      <button class="mg__segbtn" :class="{ 'is-on': tab === 'route' }" @click="tab = 'route'">
        路线引导
      </button>
    </div>

    <!-- 景点介绍 -->
    <template v-if="tab === 'spot'">
      <div class="mg__chips">
        <button
          v-for="k in DOMAINS"
          :key="k"
          class="mg__chip"
          :class="{ 'is-on': domain === k }"
          @click="pickDomain(k)"
        >
          {{ DOMAIN_LABEL[k] }}
        </button>
      </div>

      <div v-if="loading" class="mg__skel"></div>

      <p v-else-if="!items.length" class="mg__empty">暂无景点数据，请确认本地服务端已启动。</p>

      <div v-else class="mg__list">
        <button v-for="it in items" :key="it.id" class="mg__card" @click="detail = it">
          <div class="mg__thumb"><img :src="thumbUrl(it)" alt="" loading="lazy" /></div>
          <div class="mg__cardbody">
            <div class="mg__cardhead">
              <b>{{ it.name }}</b>
              <span v-if="it.rating" class="mg__rate">{{ it.rating.toFixed(1) }}</span>
            </div>
            <p class="mg__sum">{{ it.summary }}</p>
          <div class="mg__meta">
            <span v-if="it.category">{{ it.category }}</span>
            <span v-if="it.avg_duration_min">约 {{ it.avg_duration_min }} 分钟</span>
            <span v-if="it.avg_cost_cny">{{ cost(it) }}</span>
            </div>
          </div>
        </button>
      </div>
    </template>

    <!-- 路线引导 -->
    <template v-else>
      <div class="mg__chips">
        <button v-for="r in ROUTES" :key="r.t" class="mg__chip" @click="makeRoute(r.p)">
          {{ r.t }}
        </button>
      </div>

      <div v-if="planLoading" class="mg__skel"></div>
      <p v-else-if="!plan" class="mg__empty">选一个口味，为你生成逐日路线。</p>

      <div v-else class="mg__plan">
        <div class="mg__plantop">
          <b>{{ plan.title }}</b>
          <span>合计 ¥{{ plan.budget_total_cny }}</span>
        </div>
        <p v-if="plan.budget_note" class="mg__note">{{ plan.budget_note }}</p>

        <section v-for="d in plan.days" :key="d.day" class="mg__day">
          <h3>DAY {{ d.day }} · {{ d.theme }}</h3>
          <div v-for="it in d.items" :key="it.id" class="mg__stop">
            <span class="mg__time">{{ it.start }}</span>
            <div class="mg__stoptxt">
              <b>{{ it.name }}</b>
              <small v-if="it.reason">{{ it.reason }}</small>
            </div>
            <span class="mg__cost">{{ cost(it) }}</span>
          </div>
        </section>
      </div>
    </template>

    <!-- 景点详情抽屉 -->
    <div v-if="detail" class="mg__sheet" @click.self="detail = null">
      <div class="mg__sheetbody">
        <span class="mg__grab" aria-hidden="true"></span>
        <h2>{{ detail.name }}</h2>
        <div class="mg__meta">
          <span v-if="detail.category">{{ detail.category }}</span>
          <span v-if="detail.avg_duration_min">约 {{ detail.avg_duration_min }} 分钟</span>
        </div>
        <p class="mg__content">{{ detail.content || detail.summary }}</p>
        <p v-if="detail.source" class="mg__src">来源：{{ detail.source }}</p>
        <button class="mg__close" @click="detail = null">收起</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mg {
  padding: 0 16px 22px;
}
.mg__seg {
  margin-top: 4px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 4px;
  border-radius: 999px;
  border: 1px solid var(--color-line-strong);
  background: var(--color-surface-1);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.35);
}
.mg__segbtn {
  border: 0;
  border-radius: 999px;
  padding: 9px 0;
  font-size: 14px;
  font-family: inherit;
  color: var(--color-text-secondary);
  background: none;
  transition: color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
}
.mg__segbtn.is-on {
  color: #06121c;
  font-weight: 700;
  background: linear-gradient(180deg, var(--color-brand-500), var(--color-brand-300));
  box-shadow: 0 3px 12px rgba(62, 198, 184, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.35);
}
.mg__chips {
  display: flex;
  gap: 8px;
  margin: 14px 0 12px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.mg__chips::-webkit-scrollbar {
  display: none;
}
.mg__chip {
  flex: none;
  border-radius: 999px;
  border: 1px solid var(--color-line-soft);
  background: var(--color-surface-1);
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 12.5px;
  padding: 7px 13px;
}
.mg__chip.is-on {
  color: var(--color-brand-300);
  border-color: rgba(62, 198, 184, 0.5);
  background: rgba(62, 198, 184, 0.12);
}
.mg__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mg__card {
  display: flex;
  align-items: stretch;
  gap: 12px;
  width: 100%;
  text-align: left;
  font-family: inherit;
  padding: 12px;
  color: inherit;
  border-radius: var(--radius-xl);
  border: 1px solid var(--color-line-strong);
  background: linear-gradient(158deg, var(--color-surface-2), var(--color-surface-1) 66%);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.04);
  transition: transform var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}
.mg__thumb {
  flex: none;
  width: 100px;
  height: 100px;
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--color-surface-2);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.32);
}
.mg__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mg__cardbody {
  flex: 1;
  min-width: 0;
}
.mg__card:active {
  transform: scale(0.985);
  border-color: var(--color-brand-500);
}
.mg__cardhead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.mg__cardhead b {
  font-size: 15.5px;
  color: var(--color-text-primary);
}
.mg__rate {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-family: var(--font-mono);
  font-weight: 600;
  font-size: 11.5px;
  color: var(--color-accent-300, #e8b84b);
  background: rgba(232, 184, 75, 0.1);
  border: 1px solid rgba(232, 184, 75, 0.3);
  border-radius: 6px;
  padding: 1px 6px;
}
.mg__rate::before {
  content: "★";
  font-size: 9px;
}
.mg__sum {
  margin: 7px 0 0;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--color-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.mg__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 9px;
  font-size: 11.5px;
  color: var(--color-text-tertiary);
}
.mg__meta span::before {
  content: "· ";
}
.mg__plan {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.mg__plantop {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 15px;
  border-radius: var(--radius-xl);
  border: 1px solid rgba(62, 198, 184, 0.3);
  background: linear-gradient(140deg, rgba(62, 198, 184, 0.18), rgba(31, 139, 130, 0.06) 62%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}
.mg__plantop b {
  font-size: 16px;
  line-height: 1.35;
}
.mg__plantop span {
  flex: none;
  font-size: 12.5px;
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--color-accent-300, #e8b84b);
  background: rgba(232, 184, 75, 0.12);
  border: 1px solid rgba(232, 184, 75, 0.32);
  border-radius: 999px;
  padding: 3px 10px;
}
.mg__note {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--color-text-tertiary);
}
.mg__day h3 {
  display: inline-block;
  margin: 0 0 10px;
  padding: 3px 11px;
  border-radius: 999px;
  font-size: 12.5px;
  font-family: var(--font-mono);
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--color-brand-100);
  background: rgba(62, 198, 184, 0.12);
  border: 1px solid rgba(62, 198, 184, 0.32);
}

.mg__stop {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 12px;
  margin-bottom: 8px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-line-strong);
  background: linear-gradient(150deg, var(--color-surface-2), var(--color-surface-1) 72%);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.24), inset 2px 0 0 rgba(62, 198, 184, 0.45);
}
.mg__time {
  flex: none;
  width: 44px;
  font-size: 11.5px;
  font-family: var(--font-mono);
  color: var(--color-brand-300);
}
.mg__stoptxt {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.mg__stoptxt b {
  font-size: 14px;
}
.mg__stoptxt small {
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--color-text-tertiary);
}
.mg__cost {
  flex: none;
  margin-left: auto;
  font-size: 12px;
  color: var(--color-text-secondary);
}
.mg__skel {
  height: 96px;
  border-radius: var(--radius-lg);
  background: linear-gradient(100deg, var(--color-surface-1) 30%, var(--color-surface-2) 50%, var(--color-surface-1) 70%);
  background-size: 220% 100%;
  animation: mg-shimmer 1.4s linear infinite;
}
@keyframes mg-shimmer {
  from {
    background-position: 120% 0;
  }
  to {
    background-position: -80% 0;
  }
}
.mg__empty {
  margin: 0;
  padding: 26px 16px;
  text-align: center;
  font-size: 13px;
  line-height: 1.9;
  color: var(--color-text-tertiary);
  border: 1px dashed var(--color-line-strong);
  border-radius: var(--radius-lg);
}
.mg__sheet {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: flex-end;
  background: rgba(4, 9, 16, 0.66);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}
.mg__sheetbody {
  width: 100%;
  max-height: 78%;
  overflow-y: auto;
  padding: 8px 18px calc(20px + var(--yjm-safe-bottom));
  border-radius: 22px 22px 0 0;
  border-top: 1px solid var(--color-line-strong);
  background: linear-gradient(180deg, var(--color-surface-2), var(--color-surface-1) 22%);
  box-shadow: 0 -18px 44px rgba(0, 0, 0, 0.5);
  animation: mg-sheet-up var(--dur-base) var(--ease-out) both;
}
@keyframes mg-sheet-up {
  from {
    transform: translateY(14%);
    opacity: 0.4;
  }
  to {
    transform: none;
    opacity: 1;
  }
}
.mg__grab {
  display: block;
  width: 38px;
  height: 4px;
  margin: 6px auto 12px;
  border-radius: 999px;
  background: var(--color-line-strong);
}

.mg__sheetbody h2 {
  margin: 0 0 8px;
  font-size: 18px;
}
.mg__content {
  margin: 12px 0 0;
  font-size: 13.5px;
  line-height: 1.85;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
}
.mg__src {
  margin: 12px 0 0;
  font-size: 11.5px;
  color: var(--color-text-tertiary);
}
.mg__close {
  width: 100%;
  margin-top: 16px;
  padding: 12px 0;
  border: 0;
  border-radius: 999px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  color: #06121c;
  background: var(--color-brand-300);
}
.mg__banner {
  position: relative;
  height: calc(186px + var(--yjm-safe-top));
  margin: 0 -16px;
  overflow: hidden;
}
.mg__banner::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 52px;
  background: linear-gradient(180deg, transparent, var(--color-bg-base));
  pointer-events: none;
}
.mg__bannerimg {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 60%;
}
.mg__veil {
  position: absolute;
  inset: 0;
  background: linear-gradient(
      180deg,
      rgba(7, 14, 24, 0.6),
      rgba(10, 18, 32, 0.16) 34%,
      rgba(7, 14, 24, 0.96) 100%
    ),
    radial-gradient(85% 60% at 10% 98%, rgba(62, 198, 184, 0.2), transparent 70%);
}
.mg__bannerhead {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 0 16px 14px;
}
.mg__bannerhead h1 {
  margin: 0;
  font-size: 27px;
  line-height: 1.15;
  letter-spacing: 0.03em;
  text-shadow: 0 2px 18px rgba(0, 0, 0, 0.6);
}
.mg__bannerhead p {
  margin: 7px 0 0;
  font-size: 12.5px;
  letter-spacing: 0.06em;
  color: var(--color-text-secondary);
  text-shadow: 0 1px 10px rgba(0, 0, 0, 0.6);
}
</style>
