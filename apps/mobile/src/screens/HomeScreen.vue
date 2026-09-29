<script setup lang="ts">
/**
 * 玩家端 · 寻宝大厅（移动 H5 首页）
 *
 * 游客扫码后的落地页：一眼看到「正在进行的寻宝」，点进去即玩。
 * 与管理端 AR 游戏列表的区别：这里只读、只展示进行中的游戏，不含任何运营操作。
 */
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { api } from "@/api/client";
import { rememberGame } from "@/lib/playerStorage";
import type { ArGameMeta } from "@/types/api";

const games = ref<ArGameMeta[]>([]);
const loading = ref(true);
const error = ref("");
const COVERS: Record<string, string> = {
  culture: "/assets/mobile/covers/cover-culture.webp",
  midautumn: "/assets/mobile/covers/cover-midautumn.webp",
  spring: "/assets/mobile/covers/cover-spring.webp",
  "national-day": "/assets/mobile/covers/cover-nationalday.webp",
};

function gameCover(g: ArGameMeta) {
  return COVERS[g.template_id] ?? "/assets/mobile/covers/cover-culture.webp";
}

/** 卡片底部空间紧张，去掉年份前缀（2026-09-10 → 09-10） */
function shortDate(d: string) {
  return (d ?? "").replace(/^\d{4}-/, "");
}

onMounted(async () => {
  try {
    const res = await api.arGames("active");
    games.value = res.games ?? [];
  } catch (e) {
    error.value = (e as Error).message || "游戏列表加载失败";
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="mhome">
    <!-- 顶部山水氛围 -->
    <section class="mhome__hero">
      <div class="mhome__bg">
        <img class="mhome__bgimg" src="/assets/mobile/hero/hero-new.webp" alt="" />
        <div class="mhome__veil"></div>
      </div>
      <div class="mhome__head">
        <span class="mhome__badge">永嘉新游 · 玩家端</span>
        <h1 class="font-xiaoyao">寻宝大厅</h1>
        <p class="mhome__slogan">让永嘉的故事，被人记住。</p>
      </div>
    </section>

    <!-- 进行中的寻宝 -->
    <section class="mhome__sec">
      <div class="mhome__sectitle">
        <h2>正在进行的寻宝</h2>
        <span v-if="games.length" class="mhome__count">{{ games.length }} 个活动</span>
      </div>

      <div v-if="loading" class="mhome__skel">
        <div class="mhome__skelcard"></div>
        <div class="mhome__skelcard"></div>
      </div>

      <p v-else-if="error" class="mhome__empty">
        列表加载失败：{{ error }}
        <br />请确认已启动本地服务端。
      </p>

      <p v-else-if="!games.length" class="mhome__empty">
        当前没有进行中的寻宝活动。
        <br />请联系现场工作人员，或稍后再来。
      </p>

      <template v-else>
        <RouterLink
          v-for="g in games"
          :key="g.id"
          class="mhome__card"
          :to="`/play/${g.id}`"
          @click="rememberGame(g.id, g.name)"
        >
          <img class="mhome__cover" :src="gameCover(g)" alt="" loading="lazy" />
          <div class="mhome__cardbody">
            <div class="mhome__cardhead">
              <h3 class="font-serif-sc">{{ g.name }}</h3>
              <span class="mhome__pill">进行中</span>
            </div>
          <div class="mhome__stats">
            <span><b>{{ g.point_count }}</b> 个点位</span>
            <span><b>{{ g.total_rewards }}</b> 份奖励</span>
            <span><b>{{ g.participants }}</b> 人已加入</span>
          </div>
          <div class="mhome__cardfoot">
            <span class="mhome__time">{{ shortDate(g.start_date) }} 至 {{ shortDate(g.end_date) }}</span>
            <span class="mhome__go">开始寻宝 →</span>
          </div>
          </div>
        </RouterLink>
      </template>
    </section>

    <!-- 行前云游 -->
    <section class="mhome__sec">
      <RouterLink to="/space" class="mhome__entry">
        <span class="mhome__entryico mhome__entryico--space" aria-hidden="true">
          <svg viewBox="0 0 48 48" fill="none" stroke="#34D399" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M24 8 L40 16 L40 32 L24 40 L8 32 L8 16 Z" />
            <path d="M24 8 L24 24 L8 16M24 24 L40 16M24 24 L24 40" />
            <circle cx="24" cy="24" r="2" fill="#34D399" stroke="none" />
          </svg>
        </span>
        <div class="mhome__entrytxt">
          <b>行前云游</b>
          <small>6 处实景 360° 全景 + 摄影测量三维模型，先看看要去的山水</small>
        </div>
        <span class="mhome__entrygo">→</span>
      </RouterLink>
      <RouterLink to="/agent" class="mhome__entry">
        <span class="mhome__entryico mhome__entryico--nannan" aria-hidden="true">
          <svg viewBox="0 0 48 48" fill="none" stroke="#2DD4BF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="6" y="10" width="36" height="24" rx="10" />
            <path d="M18 34 L14 40 L24 34" />
            <circle cx="18" cy="22" r="2.2" fill="#2DD4BF" stroke="none" />
            <circle cx="24" cy="22" r="2.2" fill="#2DD4BF" stroke="none" />
            <circle cx="30" cy="22" r="2.2" fill="#2DD4BF" stroke="none" />
          </svg>
        </span>
        <div class="mhome__entrytxt">
          <b>问楠楠</b>
          <small>永嘉的吃住行玩，直接问智能伴游</small>
        </div>
        <span class="mhome__entrygo">→</span>
      </RouterLink>
    </section>

    <p class="mhome__note">演示口径：奖励为模拟券，不做真实核销 · 定位仅用于围栏判定</p>
  </div>
</template>

<style scoped>
.mhome {
  padding-bottom: 20px;
}

/* ---------- Hero ---------- */
.mhome__hero {
  position: relative;
  height: calc(268px + var(--yjm-safe-top));
  display: flex;
  align-items: flex-end;
  overflow: hidden;
}
.mhome__hero::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 60px;
  background: linear-gradient(180deg, transparent, var(--color-bg-base));
  pointer-events: none;
}
.mhome__bg {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, #0b1526, #0e1b30);
}
.mhome__bgimg {
  display: block;
  object-fit: cover;
  object-position: center 62%;
  width: 100%;
  height: 100%;
}
.mhome__veil {
  position: absolute;
  inset: 0;
  background: linear-gradient(
      180deg,
      rgba(7, 14, 24, 0.62) 0%,
      rgba(10, 18, 32, 0.12) 32%,
      rgba(10, 18, 32, 0.72) 72%,
      rgba(7, 14, 24, 0.97) 100%
    ),
    radial-gradient(90% 55% at 12% 96%, rgba(62, 198, 184, 0.22), transparent 70%);
}
.mhome__head {
  position: relative;
  z-index: 2;
  padding: 0 16px 18px;
}
.mhome__badge {
  display: inline-block;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--color-brand-100);
  border: 1px solid rgba(62, 198, 184, 0.4);
  border-radius: 999px;
  padding: 3px 10px;
  margin-bottom: 8px;
  background: rgba(62, 198, 184, 0.1);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.mhome__head h1 {
  margin: 0;
  font-size: 30px;
  line-height: 1.15;
  letter-spacing: 0.04em;
  text-shadow: 0 2px 18px rgba(0, 0, 0, 0.6);
}
.mhome__slogan {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--color-text-secondary);
  letter-spacing: 0.08em;
  text-shadow: 0 1px 10px rgba(0, 0, 0, 0.6);
}

/* ---------- 分区 ---------- */
.mhome__sec {
  padding: 18px 16px 0;
}
.mhome__sectitle {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
}
.mhome__sectitle h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 8px;
}
.mhome__sectitle h2::before {
  content: "";
  width: 3px;
  height: 15px;
  border-radius: 2px;
  background: linear-gradient(180deg, var(--color-brand-300), rgba(62, 198, 184, 0));
}
.mhome__count {
  font-size: 12px;
  color: var(--color-text-tertiary);
}

/* ---------- 游戏卡片 ---------- */
.mhome__card {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: stretch;
  gap: 12px;
  padding: 12px;
  margin-bottom: 12px;
  border-radius: var(--radius-xl);
  border: 1px solid var(--color-line-strong);
  background: linear-gradient(158deg, var(--color-surface-2), var(--color-surface-1) 62%);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.04);
  transition: transform var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}
.mhome__card::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(60% 80% at 6% 0%, rgba(62, 198, 184, 0.14), transparent 62%);
  pointer-events: none;
}
.mhome__card:active {
  transform: scale(0.985);
  border-color: var(--color-brand-500);
}
.mhome__cover {
  position: relative;
  z-index: 1;
  flex: none;
  width: 108px;
  height: 108px;
  object-fit: cover;
  border-radius: var(--radius-lg);
  background: var(--color-surface-2);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
}
.mhome__cardbody {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.mhome__cardhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.mhome__cardhead h3 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
}
.mhome__pill {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-brand-100);
  background: rgba(62, 198, 184, 0.14);
  border: 1px solid rgba(62, 198, 184, 0.38);
  border-radius: 999px;
  padding: 2px 9px 2px 8px;
}
.mhome__pill::before {
  content: "";
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-brand-500);
  box-shadow: 0 0 0 0 rgba(62, 198, 184, 0.6);
  animation: mhome-ping 1.8s var(--ease-out) infinite;
}
@keyframes mhome-ping {
  0% {
    box-shadow: 0 0 0 0 rgba(62, 198, 184, 0.55);
  }
  70% {
    box-shadow: 0 0 0 6px rgba(62, 198, 184, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(62, 198, 184, 0);
  }
}
.mhome__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin: 9px 0 10px;
  font-size: 12px;
  color: var(--color-text-secondary);
}
.mhome__stats span {
  white-space: nowrap;
}
.mhome__stats b {
  color: var(--color-text-primary);
  font-size: 13.5px;
}
.mhome__cardfoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  padding-top: 9px;
  border-top: 1px solid var(--color-line-soft);
}
.mhome__time {
  min-width: 0;
  font-size: 11.5px;
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mhome__go {
  flex: none;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  color: var(--color-brand-300);
}

/* ---------- 快捷入口 ---------- */
.mhome__entry {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 15px;
  margin-bottom: 10px;
  border-radius: var(--radius-xl);
  border: 1px solid var(--color-line-strong);
  background: linear-gradient(150deg, var(--color-surface-2), var(--color-surface-1) 70%);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.26), inset 0 1px 0 rgba(255, 255, 255, 0.04);
  transition: transform var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}
.mhome__entry:active {
  transform: scale(0.985);
  border-color: var(--color-brand-500);
}
/* 图标框配色与豆包板块主色同源：楠楠 #2DD4BF 青绿（默认）、云游 #34D399 薄荷 */
.mhome__entryico {
  flex: none;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 13px;
  color: #2dd4bf;
  background: linear-gradient(145deg, rgba(45, 212, 191, 0.24), rgba(19, 132, 120, 0.1));
  border: 1px solid rgba(45, 212, 191, 0.34);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
.mhome__entryico--space {
  color: #34d399;
  background: linear-gradient(145deg, rgba(52, 211, 153, 0.24), rgba(12, 138, 95, 0.1));
  border-color: rgba(52, 211, 153, 0.34);
}
.mhome__entryico svg {
  width: 24px;
  height: 24px;
}
.mhome__entrytxt {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.mhome__entrytxt b {
  font-size: 14.5px;
}
.mhome__entrytxt small {
  font-size: 12px;
  color: var(--color-text-tertiary);
  line-height: 1.6;
}
.mhome__entrygo {
  margin-left: auto;
  flex: none;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  font-size: 13px;
  color: var(--color-brand-300);
  font-weight: 700;
  background: rgba(62, 198, 184, 0.12);
  border: 1px solid rgba(62, 198, 184, 0.28);
  transition: transform var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
}
.mhome__entry:active .mhome__entrygo {
  transform: translateX(2px);
  background: rgba(62, 198, 184, 0.24);
}

.mhome__note {
  margin: 22px 16px 4px;
  padding: 10px 14px;
  border-radius: var(--radius-lg);
  border: 1px dashed rgba(232, 184, 75, 0.28);
  background: rgba(232, 184, 75, 0.05);
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--color-text-tertiary);
  text-align: center;
}

/* ---------- 骨架 / 空态 ---------- */
.mhome__skelcard {
  height: 116px;
  margin-bottom: 12px;
  border-radius: var(--radius-lg);
  background: linear-gradient(100deg, var(--color-surface-1) 30%, var(--color-surface-2) 50%, var(--color-surface-1) 70%);
  background-size: 220% 100%;
  animation: mhome-shimmer 1.4s linear infinite;
}
@keyframes mhome-shimmer {
  from {
    background-position: 120% 0;
  }
  to {
    background-position: -80% 0;
  }
}
.mhome__empty {
  padding: 26px 16px;
  text-align: center;
  font-size: 13px;
  line-height: 1.9;
  color: var(--color-text-tertiary);
  border: 1px dashed var(--color-line-strong);
  border-radius: var(--radius-lg);
}
</style>
