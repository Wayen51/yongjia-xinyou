import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// 永嘉新游 · 网站（运营端 PC）
//
// index.html → src/main.ts → App.vue + router/index.ts
//
// 游客手机端是独立工程 apps/mobile（:5174），通过 vite alias 复用本工程的
// src/api · types · lib · components · stores · views 与 public/assets。
// dev 时把 /api 代理到 Fastify 服务端（apps/server, :3000）
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      "@": r("./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    // 同 apps/mobile：手机经公网/隧道域名访问 dev server 时会被 Vite 的
    // Host 校验 403 拦掉（Blocked request. This host is not allowed.），
    // 放行任意 Host 以便真机与隧道联调；需收紧时改成白名单数组。
    allowedHosts: true,
    // public 下的视频为静态成片（含 >100MB 的演示成片），无需 HMR，
    // 且 Windows 上监听大文件会触发 EBUSY 导致 dev 崩溃，这里直接忽略。
    // 3D 模型（glb 数 MB～数百 MB）同样不会 HMR，一并忽略以防 EBUSY。
    watch: {
      ignored: ["**/assets/videos/**", "**/*.glb"],
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
  },
});
