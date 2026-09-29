<script setup lang="ts">
/**
 * 手机端外壳（apps/mobile）
 *
 * 与网站外壳（apps/web 的 App.vue）分离：网站是「顶栏 + 页脚」的 PC 布局，
 * 手机端是「全屏内容 + 底部 Tab」的移动布局。
 *
 * 沉浸页（AR 寻宝 / 3D 云游）通过路由 meta.tabbar = false 隐藏底部 Tab：
 * 寻宝页自带「任务 / 地图 / 附近 / 排行」屏内导航，叠加外层 Tab 会重复。
 */
import { computed } from "vue";
import { RouterView, RouterLink, useRoute } from "vue-router";
import { useBackGesture } from "./composables/useBackGesture";

interface Tab {
  to: string;
  label: string;
  svg: string;
  /** 图标 viewBox：豆包板块图标为 48 格，历史图标为 24 格 */
  vb?: string;
}

/* 前四个 Tab 与豆包六大板块图标同源（资源生成_豆包工作区/板块图标/，48 格 2.5 线宽）：
   寻宝=AR定位针、攻略=知识库书本、云游=六面体、楠楠=对话气泡；
   颜色统一 currentColor——继承 tabbar 未选灰/选中青的状态反馈，不使用写死的板块彩色。
   「我的」豆包无对应图标，保留原人物图标（24 格）。 */
const TABS: Tab[] = [
  {
    to: "/",
    label: "寻宝",
    svg: '<path d="M24 6 C16 6, 8 12, 8 22 C8 32, 24 42, 24 42 C24 42, 40 32, 40 22 C40 12, 32 6, 24 6 Z" stroke="currentColor" fill="none" stroke-linejoin="round"/><circle cx="24" cy="21" r="5" stroke="currentColor" fill="none"/>',
  },
  {
    to: "/guide",
    label: "攻略",
    svg: '<path d="M10 8 C14 6, 20 6, 24 9 C28 6, 34 6, 38 8 L38 38 C34 36, 28 36, 24 39 C20 36, 14 36, 10 38 Z" stroke="currentColor" fill="none" stroke-linejoin="round"/><path d="M24 9 L24 39M14 15 L20 15M14 21 L20 21M28 15 L34 15M28 21 L34 21" stroke="currentColor" fill="none" stroke-linecap="round"/>',
  },
  {
    to: "/space",
    label: "云游",
    svg: '<path d="M24 8 L40 16 L40 32 L24 40 L8 32 L8 16 Z" stroke="currentColor" fill="none" stroke-linejoin="round"/><path d="M24 8 L24 24 L8 16M24 24 L40 16M24 24 L24 40" stroke="currentColor" fill="none"/><circle cx="24" cy="24" r="2" fill="currentColor" stroke="none"/>',
  },
  {
    to: "/agent",
    label: "楠楠",
    svg: '<rect x="6" y="10" width="36" height="24" rx="10" stroke="currentColor" fill="none"/><path d="M18 34 L14 40 L24 34" stroke="currentColor" fill="none" stroke-linejoin="round"/><circle cx="18" cy="22" r="2.2" fill="currentColor" stroke="none"/><circle cx="24" cy="22" r="2.2" fill="currentColor" stroke="none"/><circle cx="30" cy="22" r="2.2" fill="currentColor" stroke="none"/>',
  },
  {
    to: "/me",
    label: "我的",
    vb: "0 0 24 24",
    svg: '<circle cx="12" cy="8.5" r="3.6" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M4.6 20c1.3-3.5 4-5.3 7.4-5.3s6.1 1.8 7.4 5.3" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/>',
  },
];

const route = useRoute();
const showTabbar = computed(() => route.meta?.tabbar !== false);
/** 沉浸页：外壳不滚动，由页面自己管滚动 */
const immersive = computed(() => route.meta?.immersive === true);

/**
 * 底部 5 个 Tab 根页面互为平级（没有「上一级」），不显示返回键；
 * 其余路由（如 /play/:gameId 寻宝沉浸页）均为子级页面，左上角给返回入口。
 */
const TAB_ROOTS = new Set(["/", "/guide", "/space", "/agent", "/me"]);
const showBack = computed(() => !TAB_ROOTS.has(route.path));

/**
 * 左边缘滑入返回：沉浸页（/play/:id）没有常驻返回入口，
 * 而无站内历史时（扫码直达）router.back() 是空操作 —— 统一由外壳接管。
 * 返回键点击复用同一 goBack：有历史 router.back()，无历史兜底 replace('/')。
 */
const { active: backActive, progress: backProgress, goBack } = useBackGesture();

function isOn(to: string) {
  return to === "/" ? route.path === "/" : route.path.startsWith(to);
}
</script>

<template>
  <div class="yjm-root">
    <div class="yjm-body" :class="{ 'yjm-body--immersive': immersive }">
      <RouterView v-slot="{ Component }">
        <component :is="Component" />
      </RouterView>
    </div>

    <!-- 左上角返回键：仅子级页面出现；44×44 触控区，与左滑手势共用 goBack。
         显式 duration：fixed + backdrop-filter 合成层上 transitionend 偶发不触发，
         交给 Vue 计时收尾，避免离开态元素残留 -->
    <Transition name="yjm-back" :duration="160">
      <button
        v-if="showBack"
        type="button"
        class="yjm-backbtn"
        :class="{ 'yjm-backbtn--immersive': immersive }"
        aria-label="返回上一页"
        @click="goBack"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M15 5.5 8.5 12l6.5 6.5"
            stroke="currentColor"
            stroke-width="2"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </Transition>

    <!-- 左边缘滑入返回：指示器随手指位移推进 -->
    <div
      class="yjm-swipeback"
      :class="{ 'is-on': backActive }"
      :style="{ '--p': backProgress }"
      aria-hidden="true"
    >
      <span class="yjm-swipeback__ico">
        <svg viewBox="0 0 24 24">
          <path d="M14.5 5.5 8 12l6.5 6.5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
    </div>

    <nav v-if="showTabbar" class="yjm-tabbar">
      <RouterLink
        v-for="t in TABS"
        :key="t.to"
        :to="t.to"
        class="yjm-tab"
        :class="{ 'is-on': isOn(t.to) }"
      >
        <i class="yjm-tab__pill" aria-hidden="true"></i>
        <svg
          :viewBox="t.vb ?? '0 0 48 48'"
          :stroke-width="t.vb ? 1.7 : 2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          v-html="t.svg"
        />
        <span>{{ t.label }}</span>
      </RouterLink>
    </nav>
  </div>
</template>
