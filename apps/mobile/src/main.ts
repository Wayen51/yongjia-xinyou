/**
 * 永嘉新游 · 手机端入口（游客 H5）
 *
 * 游客扫码即玩：GPS 定位 → 围栏触发 → AR 看见 → 答题 → 领券。
 *
 * 本工程与网站（apps/web）物理分离，基础层通过 vite alias 复用网站源码
 * （api / types / lib / components / stores / views），不复制代码与素材。
 *
 * 路由使用 hash 模式：扫码链接形如 `/#/play/game_xxx`，
 * 静态托管无需服务端 rewrite，刷新不 404。
 */
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import "./theme/app.css";

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount("#app");
