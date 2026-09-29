/**
 * 网站入口（运营端 PC）
 *
 * 运营人员工作台：造游戏、看全局、3D 巡览。
 * 游客手机端是独立工程 apps/mobile（:5174），本工程为其提供共享基础层。
 */
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "@/App.vue";
import { router } from "@/router";
import "@/styles/main.css";

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount("#app");
