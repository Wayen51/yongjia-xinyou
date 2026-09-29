import { createRouter, createWebHistory } from "vue-router";

// 路由表：与产品设计稿 5.1 保持一致
// 平台定位为「永嘉文旅 AI-Agent 平台」（B 端生成 + C 端体验）
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: () => import("@/views/HomeView.vue"), meta: { title: "平台首页" } },
    { path: "/video", name: "video", component: () => import("@/views/VideoListView.vue"), meta: { title: "视频生成工坊" } },
    { path: "/video/new", name: "video-new", component: () => import("@/views/VideoStudioView.vue"), meta: { title: "视频生成" } },
    { path: "/video/:id", name: "video-detail", component: () => import("@/views/VideoDetailView.vue"), meta: { title: "视频详情" } },
    // 板块二 · AR 互动（节日模板 + AI 生成剧情 + 地图打点 + 玩家端围栏寻宝）
    { path: "/ar", name: "ar-list", component: () => import("@/views/ArGameListView.vue"), meta: { title: "AR 互动 · 游戏管理" } },
    { path: "/ar/new", name: "ar-new", component: () => import("@/views/ArGameStudioView.vue"), meta: { title: "AR 互动 · 创建游戏" } },
    { path: "/ar/:id", name: "ar-detail", component: () => import("@/views/ArGameDetailView.vue"), meta: { title: "AR 互动 · 游戏详情" } },
    // 玩家端寻宝页不注册在管理端：运营预览一律跳出当前 SPA，见 lib/playerEntry.ts
    {
      path: "/ar/:id/monitor",
      name: "ar-monitor",
      component: () => import("@/views/ArMonitorView.vue"),
      meta: { title: "AR 互动 · 玩家位置监控" },
    },
    // 旧版 2D 文化寻宝：作为 3D 云游内的隐藏小玩法保留
    { path: "/treasure", name: "treasure", component: () => import("@/views/TreasureView.vue"), meta: { title: "文化寻宝 · 2D 小玩法" } },
    { path: "/agent", name: "agent", component: () => import("@/views/AgentView.vue"), meta: { title: "智能伴侣 · 楠楠" } },
    { path: "/space", name: "space", component: () => import("@/views/SpaceView.vue"), meta: { title: "3D 云游" } },
    // 场景底座 · 永嘉 3D 景点场景管理（3D 云游 / 效果展示 / AR 寻宝共用）
    { path: "/scenes", name: "scenes", component: () => import("@/views/SceneManageView.vue"), meta: { title: "3D 景点场景管理" } },
    // 效果展示 · 3D 场景里的 Agent 运行效果 + AR 交互演示
    { path: "/showcase", name: "showcase", component: () => import("@/views/AgentShowcaseView.vue"), meta: { title: "Agent 运行效果展示" } },
    {
      path: "/cruise",
      name: "cruise",
      component: () => import("@/views/CruiseView.vue"),
      meta: { title: "3D 大屏巡航", fullscreen: true },
    },
    { path: "/wiki", name: "wiki", component: () => import("@/views/WikiView.vue"), meta: { title: "永嘉知识库" } },
    { path: "/dashboard", name: "dashboard", component: () => import("@/views/DashboardView.vue"), meta: { title: "数据看板" } },
    { path: "/:pathMatch(.*)*", name: "notfound", component: () => import("@/views/HomeView.vue") },
  ],
  scrollBehavior() {
    return { top: 0 };
  },
});

router.afterEach((to) => {
  const base = "永嘉新游 · 永嘉文旅 AI-Agent 平台";
  document.title = to.meta?.title ? `${to.meta.title as string} | ${base}` : base;
});
