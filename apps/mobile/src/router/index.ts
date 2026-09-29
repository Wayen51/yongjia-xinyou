import { createRouter, createWebHashHistory } from "vue-router";

/**
 * 手机端路由（游客 H5）
 *
 * 与网站路由（apps/web 的 router/index.ts）完全隔离：
 * - 手机端**不注册**任何运营页面（游戏管理 / 点位编辑 / 监控大屏 / 数据看板）
 * - 网站也**不注册** /play 寻宝页，运营预览一律跳手机端入口（见 web 的 lib/playerEntry.ts）
 *
 * 采用 hash 模式：扫码链接 `/#/play/game_xxx` 无需服务端 rewrite，刷新不 404。
 */
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      name: "m-home",
      component: () => import("@/screens/HomeScreen.vue"),
      meta: { title: "寻宝大厅" },
    },
    {
      path: "/play/:gameId",
      name: "m-play",
      component: () => import("@/screens/PlayScreen.vue"),
      // 寻宝页自带「任务 / 地图 / 附近 / 排行」屏内导航，隐藏外层 Tab 并接管滚动
      meta: { title: "AR 寻宝", tabbar: false, immersive: true },
    },
    {
      // 旅游攻略：景点介绍（知识库）+ 路线引导（行程生成），手机端自有页面
      path: "/guide",
      name: "m-guide",
      component: () => import("@/screens/GuideScreen.vue"),
      meta: { title: "旅游攻略" },
    },
    {
      // 3D 云游 / 楠楠伴游复用网站已有页面（跨工程引用网站源码，不复制）
      path: "/space",
      name: "m-space",
      component: () => import("@/views/SpaceView.vue"),
      meta: { title: "3D 云游" },
    },
    {
      path: "/agent",
      name: "m-agent",
      component: () => import("@/views/AgentView.vue"),
      meta: { title: "楠楠伴游" },
    },
    {
      path: "/me",
      name: "m-me",
      component: () => import("@/screens/MeScreen.vue"),
      meta: { title: "我的" },
    },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
  scrollBehavior() {
    return { top: 0 };
  },
});

router.afterEach((to) => {
  document.title = to.meta?.title ? `${to.meta.title as string} | 永嘉新游` : "永嘉新游 · 寻宝";
});
