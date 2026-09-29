<script setup lang="ts">
/**
 * 玩家端 · 我的
 *
 * 本机游玩足迹 + 本机券包 + 可领奖励。Demo 阶段无账号体系：
 * 足迹与券包均存本机（lib/playerStorage），券为模拟券不核销，页面已明确标注。
 * 点卡片弹出券面详情（大图 + 模拟券码 + 复制 + 领取）。
 */
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { api } from "@/api/client";
import { onImgError } from "@/lib/assets";
import {
  readHistory,
  readClaims,
  saveClaims,
  type PlayerClaims,
  type PlayerHistoryItem,
} from "@/lib/playerStorage";
import type { ArCoupon } from "@/types/api";

const history = ref<PlayerHistoryItem[]>([]);
const coupons = ref<ArCoupon[]>([]);
const loading = ref(true);
const claims = ref<PlayerClaims>({});
const active = ref<ArCoupon | null>(null);
const copied = ref(false);

const claimedList = computed(() =>
  coupons.value
    .filter((c) => claims.value[c.id])
    .sort((a, b) => (claims.value[b.id] ?? 0) - (claims.value[a.id] ?? 0)),
);
const availableList = computed(() => coupons.value.filter((c) => !claims.value[c.id]));

function fmtTime(ts: number) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtClaim(ts: number | undefined) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日领取`;
}

/** 券面图：seed 存的是 "coupons/coupon-cpn-001.webp"，统一补全为 /assets/ar/ 前缀 */
function couponImg(c: ArCoupon) {
  const raw = (c.image || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/")) return raw;
  return raw.startsWith("assets/") ? `/${raw}` : `/assets/ar/${raw}`;
}

function isClaimed(id: string) {
  return Boolean(claims.value[id]);
}

function openCoupon(c: ArCoupon) {
  active.value = c;
  copied.value = false;
}

function claimActive() {
  if (!active.value || claims.value[active.value.id]) return;
  const next: PlayerClaims = { ...claims.value, [active.value.id]: Date.now() };
  claims.value = next;
  saveClaims(next);
}

function clearClaims() {
  claims.value = {};
  saveClaims({});
}

/** 模拟券码：由券 id 确定性生成（演示口径，非真实核销码） */
function demoCode(id: string) {
  const core = id.replace(/[^a-z0-9]/gi, "").toUpperCase();
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const tail = h.toString(16).toUpperCase().padStart(4, "0").slice(-4);
  return `YJ-${core}-${tail}`;
}

async function copyCode() {
  if (!active.value) return;
  const text = demoCode(active.value.id);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch {
      /* 忽略：演示环境复制失败不阻断 */
    }
    ta.remove();
  }
  copied.value = true;
  setTimeout(() => (copied.value = false), 1600);
}

onMounted(async () => {
  history.value = readHistory();
  claims.value = readClaims();
  try {
    const res = await api.arCoupons();
    coupons.value = res.coupons ?? [];
  } catch {
    coupons.value = [];
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="mme">
    <!-- 顶部 Banner -->
    <section class="mme__banner">
      <img class="mme__bannerimg" src="/assets/mobile/banners/banner-me.webp?v=20260913" alt="" />
      <div class="mme__veil"></div>
      <div class="mme__bannerhead">
        <h1>我的</h1>
        <p>本机足迹 · 奖励券</p>
      </div>
    </section>

    <!-- 身份卡 -->
    <section class="mme__id">
      <div class="mme__avatar" aria-hidden="true">
        <img src="/assets/brand/nannan-avatar.png" alt="" />
      </div>
      <div class="mme__idtxt">
        <b>演示游客</b>
        <small>本机身份 · 未登录</small>
      </div>
      <span class="mme__idtag">Demo</span>
    </section>

    <!-- 游玩足迹 -->
    <section class="mme__sec">
      <div class="mme__sectitle">
        <h2>我的寻宝足迹</h2>
        <span v-if="history.length" class="mme__count">{{ history.length }} 条</span>
      </div>

      <div v-if="!history.length" class="mme__empty">
        <img src="/assets/mobile/empty/empty-no-game.png" alt="" />
        <p>还没有寻宝记录。<br />去大厅挑一个活动开始吧。</p>
      </div>

      <template v-else>
        <RouterLink v-for="h in history" :key="h.id" class="mme__item" :to="`/play/${h.id}`">
          <div class="mme__itemtxt">
            <b>{{ h.name }}</b>
            <small>{{ fmtTime(h.at) }}</small>
          </div>
          <span class="mme__itemgo">继续 →</span>
        </RouterLink>
      </template>
    </section>

    <!-- 我的券包（已领取，存本机） -->
    <section v-if="claimedList.length" class="mme__sec">
      <div class="mme__sectitle">
        <h2>我的券包</h2>
        <span class="mme__count">{{ claimedList.length }} 张 · 存本机</span>
        <button type="button" class="mme__clear" @click="clearClaims">清空</button>
      </div>
      <div class="mme__coupons">
        <button v-for="c in claimedList" :key="c.id" type="button" class="mme__coupon is-claimed" @click="openCoupon(c)">
          <div class="mme__couponval" :class="{ 'mme__couponval--sm': c.value_label.length >= 4 }">{{ c.value_label }}</div>
          <div class="mme__coupontxt">
            <b>{{ c.name }}<span class="mme__claimedtag">已领取</span></b>
            <small>{{ c.desc }}</small>
            <span class="mme__couponmeta">有效期 {{ c.valid_days }} 天 · {{ fmtClaim(claims[c.id]) }} · {{ c.poi_id }}</span>
          </div>
          <span class="mme__stub" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M4 8a2 2 0 0 0 0 8v3h16v-3a2 2 0 0 1 0-8V5H4v3Zm10-3v14" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/></svg>
            <i>票</i>
          </span>
        </button>
      </div>
    </section>

    <!-- 可领奖励 -->
    <section class="mme__sec">
      <div class="mme__sectitle">
        <h2>可获得的奖励</h2>
        <span class="mme__count">{{ loading ? "" : `剩 ${availableList.length} / 共 ${coupons.length}` }}</span>
      </div>

      <div v-if="loading" class="mme__skel"></div>

      <p v-else-if="!coupons.length" class="mme__empty">暂无可领取的奖励。</p>

      <div v-else-if="!availableList.length" class="mme__empty">
        全部领完啦，太厉害了！<br />去
        <RouterLink class="mme__emptylink" to="/">寻宝</RouterLink>
        解锁更多玩法吧。
      </div>

      <div v-else class="mme__coupons">
        <button v-for="c in availableList" :key="c.id" type="button" class="mme__coupon" @click="openCoupon(c)">
          <div class="mme__couponval" :class="{ 'mme__couponval--sm': c.value_label.length >= 4 }">{{ c.value_label }}</div>
          <div class="mme__coupontxt">
            <b>{{ c.name }}</b>
            <small>{{ c.desc }}</small>
            <span class="mme__couponmeta">有效期 {{ c.valid_days }} 天 · 关联 {{ c.poi_id }}</span>
          </div>
          <span class="mme__stub" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M4 8a2 2 0 0 0 0 8v3h16v-3a2 2 0 0 1 0-8V5H4v3Zm10-3v14" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/></svg>
            <i>票</i>
          </span>
        </button>
      </div>
    </section>

    <p class="mme__note">
      演示口径：游客未登录，足迹与券包仅存本机，换设备不互通。奖励券为模拟券，不做真实核销。
    </p>

    <!-- 券面详情弹层 -->
    <Transition name="msheet">
      <div v-if="active" class="msheet" @click.self="active = null">
        <div class="msheet__panel" role="dialog" aria-modal="true">
          <button type="button" class="msheet__close" aria-label="关闭" @click="active = null">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
          <div v-if="couponImg(active)" class="msheet__art">
            <img :src="couponImg(active)" :alt="active.name" data-fallback="/assets/img/placeholders/poi-cover.webp" @error="onImgError" />
          </div>
          <div class="msheet__body">
            <div class="msheet__val">{{ active.value_label }}</div>
            <b class="msheet__name">{{ active.name }}</b>
            <p class="msheet__desc">{{ active.desc }}</p>
            <span class="msheet__meta">有效期 {{ active.valid_days }} 天 · 关联 {{ active.poi_id }} · 模拟券</span>
            <div class="msheet__code">
              <span class="msheet__codenum">{{ demoCode(active.id) }}</span>
              <button type="button" class="msheet__copy" :class="{ 'is-done': copied }" @click="copyCode">
                {{ copied ? "已复制 ✓" : "复制券码" }}
              </button>
            </div>
            <button
              type="button"
              class="msheet__claim"
              :class="{ 'is-done': isClaimed(active.id) }"
              :disabled="isClaimed(active.id)"
              @click="claimActive"
            >
              {{ isClaimed(active.id) ? "已领取 · 存于本机券包" : "领取到我的券包" }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.mme {
  padding: 0 16px 22px;
}

/* ---------- 身份卡 ---------- */
.mme__id {
  position: relative;
  z-index: 2;
  margin-top: -36px;
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 15px 16px;
  border-radius: var(--radius-xl);
  border: 1px solid rgba(62, 198, 184, 0.26);
  background: linear-gradient(142deg, rgba(62, 198, 184, 0.2), var(--color-surface-1) 58%);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.mme__avatar {
  flex: none;
  width: 50px;
  height: 50px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  color: var(--color-brand-300);
  background: rgba(62, 198, 184, 0.1);
  border: 1px solid rgba(62, 198, 184, 0.4);
  box-shadow: 0 0 0 3px rgba(62, 198, 184, 0.1), 0 4px 14px rgba(0, 0, 0, 0.4);
}
.mme__avatar img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mme__idtxt {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.mme__idtxt b {
  font-size: 16px;
}
.mme__idtxt small {
  font-size: 12px;
  color: var(--color-text-tertiary);
}
.mme__idtag {
  margin-left: auto;
  flex: none;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--color-accent-300, var(--color-brand-300));
  border: 1px solid var(--color-line-strong);
  border-radius: 999px;
  padding: 2px 9px;
}

/* ---------- 分区 ---------- */
.mme__sec {
  margin-top: 22px;
}
.mme__sectitle {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 11px;
}
.mme__sectitle h2 {
  margin: 0;
  font-size: 15.5px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 8px;
}
.mme__sectitle h2::before {
  content: "";
  width: 3px;
  height: 15px;
  border-radius: 2px;
  background: linear-gradient(180deg, var(--color-brand-300), rgba(62, 198, 184, 0));
}
.mme__count {
  font-size: 12px;
  color: var(--color-text-tertiary);
}

/* ---------- 足迹 ---------- */
.mme__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 14px;
  margin-bottom: 9px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-line-strong);
  background: linear-gradient(150deg, var(--color-surface-2), var(--color-surface-1) 70%);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.26), inset 0 1px 0 rgba(255, 255, 255, 0.04);
  transition: transform var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}
.mme__item:active {
  transform: scale(0.985);
  border-color: var(--color-brand-500);
}
.mme__itemtxt {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.mme__itemtxt b {
  font-size: 14.5px;
}
.mme__itemtxt small {
  font-size: 11.5px;
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
}
.mme__itemgo {
  margin-left: auto;
  flex: none;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--color-brand-300);
}

/* ---------- 券（票根式卡片 + 详情弹层） ---------- */
.mme__coupons {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mme__coupon {
  position: relative;
  display: flex;
  align-items: stretch;
  gap: 12px;
  width: 100%;
  padding: 14px;
  border-radius: var(--radius-xl);
  border: 1px solid rgba(232, 184, 75, 0.3);
  background: linear-gradient(140deg, rgba(232, 184, 75, 0.13), var(--color-surface-1) 56%);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  overflow: hidden;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform var(--dur-fast, 140ms) var(--ease-out, ease-out), border-color var(--dur-fast, 140ms) var(--ease-out, ease-out);
}
.mme__coupon:active {
  transform: scale(0.985);
  border-color: rgba(232, 184, 75, 0.55);
}
.mme__coupon.is-claimed {
  border-color: rgba(112, 200, 190, 0.32);
  background: linear-gradient(140deg, rgba(112, 200, 190, 0.1), var(--color-surface-1) 56%);
}
.mme__coupon.is-claimed::before {
  background: linear-gradient(180deg, #9fe6dc, #4ec3b6 55%, #1f7f74);
}
.mme__coupon::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(180deg, #f2d69a, #e8b84b 55%, #a07b1f);
}
.mme__couponval {
  flex: none;
  min-width: 54px;
  max-width: 96px;
  display: grid;
  place-items: center;
  text-align: center;
  padding: 0 10px;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.01em;
  white-space: nowrap;
  color: var(--color-accent-300, #e8b84b);
  border-right: 1px dashed rgba(232, 184, 75, 0.34);
  line-height: 1.25;
  text-shadow: 0 1px 10px rgba(232, 184, 75, 0.25);
}
/* 长面值（如「买一送一」「8.8折」）缩小字号，保证单行不折行 */
.mme__couponval--sm {
  font-size: 12.5px;
  letter-spacing: 0.02em;
}
.mme__coupontxt {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}
.mme__coupontxt b {
  font-size: 14px;
}
.mme__claimedtag {
  margin-left: 7px;
  display: inline-block;
  vertical-align: 2px;
  font-size: 10.5px;
  font-weight: 600;
  color: #9fe6dc;
  border: 1px solid rgba(112, 200, 190, 0.5);
  border-radius: 999px;
  padding: 0.5px 7px;
  background: rgba(112, 200, 190, 0.1);
}
.mme__coupontxt small {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.6;
}
.mme__couponmeta {
  font-size: 11px;
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
}
/* 右侧票根区：打孔虚线 + 票字，替代原来缩略小图 */
.mme__stub {
  flex: none;
  align-self: stretch;
  width: 54px;
  margin: -14px -14px -14px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border-left: 1.5px dashed rgba(232, 184, 75, 0.38);
  background:
    radial-gradient(circle at 0 0, transparent 7px, rgba(0, 0, 0, 0.22) 7.5px) left top / 9px 9px repeat-y,
    radial-gradient(circle at 0 100%, transparent 7px, rgba(0, 0, 0, 0.22) 7.5px) left bottom / 9px 9px repeat-y,
    rgba(232, 184, 75, 0.05);
  color: rgba(242, 214, 154, 0.85);
}
.mme__stub svg {
  width: 20px;
  height: 20px;
}
.mme__stub i {
  font-style: normal;
  font-size: 10px;
  letter-spacing: 0.2em;
  margin-right: -0.2em;
  color: var(--color-text-tertiary);
}
.mme__clear {
  margin-left: 8px;
  font-size: 11px;
  color: var(--color-text-tertiary);
  background: none;
  border: 1px solid var(--color-line-strong);
  border-radius: 999px;
  padding: 1px 9px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.mme__clear:active {
  color: #ff9c9c;
  border-color: rgba(255, 156, 156, 0.5);
}
.mme__emptylink {
  color: var(--color-brand-300);
  font-weight: 700;
  text-decoration: none;
  border-bottom: 1px dashed rgba(62, 198, 184, 0.5);
  padding-bottom: 1px;
}

/* ---------- 券面详情弹层 ---------- */
.msheet {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(4, 9, 17, 0.68);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.msheet__panel {
  position: relative;
  width: min(100%, 520px);
  max-height: 88dvh;
  overflow-y: auto;
  border-radius: 20px 20px 0 0;
  border: 1px solid rgba(232, 184, 75, 0.32);
  border-bottom: none;
  background: linear-gradient(180deg, rgba(232, 184, 75, 0.07), var(--color-surface-1, #0c1524) 30%);
  box-shadow: 0 -18px 44px rgba(0, 0, 0, 0.55);
  padding: 18px 18px calc(18px + var(--yjm-safe-bottom, 0px));
}
.msheet__close {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1px solid var(--color-line-strong);
  background: rgba(12, 21, 36, 0.78);
  color: var(--color-text-secondary);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.msheet__close svg {
  width: 16px;
  height: 16px;
}
.msheet__art {
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid rgba(232, 184, 75, 0.28);
  background: var(--color-surface-2);
}
.msheet__art img {
  display: block;
  width: 100%;
  max-height: 230px;
  object-fit: contain;
}
.msheet__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}
.msheet__val {
  align-self: flex-start;
  font-size: 13px;
  font-weight: 700;
  color: var(--color-accent-300, #e8b84b);
  border: 1px solid rgba(232, 184, 75, 0.4);
  border-radius: 999px;
  padding: 2px 12px;
  background: rgba(232, 184, 75, 0.1);
}
.msheet__name {
  font-size: 17px;
}
.msheet__desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-text-secondary);
}
.msheet__meta {
  font-size: 11.5px;
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
}
.msheet__code {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
  padding: 11px 13px;
  border-radius: 12px;
  border: 1px dashed rgba(232, 184, 75, 0.4);
  background: rgba(232, 184, 75, 0.06);
}
.msheet__codenum {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 15.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #f2d69a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.msheet__copy {
  flex: none;
  font-size: 12.5px;
  font-weight: 600;
  color: #0b1220;
  background: linear-gradient(140deg, #f2d69a, #e8b84b);
  border: none;
  border-radius: 9px;
  padding: 7px 13px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.msheet__copy.is-done {
  background: linear-gradient(140deg, #9fe6dc, #4ec3b6);
}
.msheet__claim {
  margin-top: 4px;
  font-size: 14.5px;
  font-weight: 700;
  color: #0b1220;
  background: linear-gradient(140deg, #f2d69a, #e8b84b);
  border: none;
  border-radius: 12px;
  padding: 13px;
  cursor: pointer;
  box-shadow: 0 8px 20px rgba(232, 184, 75, 0.22);
  -webkit-tap-highlight-color: transparent;
  transition: transform var(--dur-fast, 140ms) var(--ease-out, ease-out);
}
.msheet__claim:active:not(:disabled) {
  transform: scale(0.985);
}
.msheet__claim.is-done {
  background: var(--color-surface-2);
  color: #9fe6dc;
  border: 1px solid rgba(112, 200, 190, 0.4);
  box-shadow: none;
  cursor: default;
}
.msheet-enter-active,
.msheet-leave-active {
  transition: opacity 180ms ease;
}
.msheet-enter-active .msheet__panel {
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
.msheet-leave-active .msheet__panel {
  transition: transform 160ms ease-in;
}
.msheet-enter-from,
.msheet-leave-to {
  opacity: 0;
}
.msheet-enter-from .msheet__panel,
.msheet-leave-to .msheet__panel {
  transform: translateY(28px);
}

/* ---------- 空态 / 骨架 ---------- */
.mme__empty {
  padding: 20px 14px 22px;
  text-align: center;
  font-size: 12.5px;
  line-height: 1.9;
  color: var(--color-text-tertiary);
  border: 1px dashed var(--color-line-strong);
  border-radius: var(--radius-lg);
}
.mme__empty img {
  display: block;
  width: 168px;
  max-width: 62%;
  margin: 0 auto;
  opacity: 0.92;
}
.mme__empty p {
  margin: 8px 0 0;
}
.mme__skel {
  height: 78px;
  border-radius: var(--radius-md);
  background: linear-gradient(100deg, var(--color-surface-1) 30%, var(--color-surface-2) 50%, var(--color-surface-1) 70%);
  background-size: 220% 100%;
  animation: mme-shimmer 1.4s linear infinite;
}
@keyframes mme-shimmer {
  from {
    background-position: 120% 0;
  }
  to {
    background-position: -80% 0;
  }
}

.mme__note {
  margin-top: 22px;
  padding: 10px 14px;
  border-radius: var(--radius-lg);
  border: 1px dashed rgba(232, 184, 75, 0.28);
  background: rgba(232, 184, 75, 0.05);
  font-size: 11.5px;
  line-height: 1.8;
  color: var(--color-text-tertiary);
  text-align: center;
}
.mme__banner {
  position: relative;
  height: calc(178px + var(--yjm-safe-top));
  margin: 0 -16px;
  overflow: hidden;
}
.mme__banner::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 56px;
  background: linear-gradient(180deg, transparent, var(--color-bg-base));
  pointer-events: none;
}
.mme__bannerimg {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 55%;
}
.mme__veil {
  position: absolute;
  inset: 0;
  background: linear-gradient(
      180deg,
      rgba(7, 14, 24, 0.6),
      rgba(10, 18, 32, 0.16) 36%,
      rgba(7, 14, 24, 0.94) 100%
    ),
    radial-gradient(85% 60% at 88% 96%, rgba(232, 184, 75, 0.16), transparent 68%);
}
.mme__bannerhead {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 0 16px 46px;
}
.mme__bannerhead h1 {
  margin: 0;
  font-size: 27px;
  line-height: 1.15;
  letter-spacing: 0.03em;
  text-shadow: 0 2px 18px rgba(0, 0, 0, 0.6);
}
.mme__bannerhead p {
  margin: 7px 0 0;
  font-size: 12.5px;
  letter-spacing: 0.06em;
  color: var(--color-text-secondary);
  text-shadow: 0 1px 10px rgba(0, 0, 0, 0.6);
}
</style>
