import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const webSrc = r("../web/src");

/* 真机 getUserMedia 需安全上下文：--mode https 时启用自签名证书 */

/**
 * 永嘉新游 · 手机端 APP（游客 H5）—— 独立工程
 *
 * 与网站（apps/web）物理分离：自有入口 / 路由 / 外壳 / 页面 / 样式，
 * 独立启动（:5174）、独立构建（dist）。
 *
 * base 分环境：正式服务（apps/server, :3000）把本工程 dist 挂在 /m/ 前缀下，
 * 故 build 用 /m/（手机访问 http://<局域网IP>:3000/m/）；
 * dev 必须保持 /，因为运行时代码里写死的 /assets/… 绝对路径（cover-*.webp、
 * pano_scenes_index.json 等）在 dev 下由 dev server 的 publicDir 直接托管，
 * 一旦 dev 也加 /m/ 前缀，这些请求会 404。
 *
 * 共享基础层直接指向网站源码，避免复制代码与素材：
 *
 *   @/                     → 本工程 src（手机端自有代码）
 *   @/api/… @/types/… @/lib/… @/components/… @/stores/… @/views/… @/styles/…
 *                          → apps/web/src 下的同名目录（两端共享）
 *
 * 约定：手机端自有代码的顶层目录不要使用 api / types / lib / components /
 * stores / views / styles 这些名字 —— 它们被保留给共享层。
 * 手机端自己的页面放 src/screens，样式放 src/theme。
 *
 * 素材同理不复制：publicDir 指向 apps/web/public（dev 直接托管，build 时拷贝）。
 * dev 时把 /api 代理到 Fastify 服务端（apps/server, :3000）。
 */
export default defineConfig(({ command, mode }) => ({
  // build → /m/（apps/server 的前缀挂载）；dev → /（public 素材由 dev server 托管）
  base: command === "build" ? "/m/" : "/",
  plugins: [vue(), tailwindcss(), ...(mode === "https" ? [basicSsl()] : [])],
  resolve: {
    alias: [
      // 顺序敏感：共享前缀必须排在通配 @/ 之前
      {
        find: /^@\/(api|types|lib|components|stores|views|styles)\//,
        replacement: `${webSrc}/$1/`,
      },
      { find: /^@\//, replacement: `${r("./src")}/` },
    ],
  },
  // 素材不复制：直接复用网站工程的 public
  publicDir: r("../web/public"),
  server: {
    host: "0.0.0.0",
    port: 5174,
    /**
     * 真机 / 内网穿透（隧道）联调必须放开 Host 校验。
     *
     * Vite 默认只放行 localhost 与 IP 形式的 Host，手机经公网或隧道域名
     * （如 *.trycloudflare.com、*.ngrok.io、*.cpolar.top）访问时，
     * 整个 dev server 会先被 403 拦掉，返回纯文本：
     *   Blocked request. This host ("<你的域名>") is not allowed.
     * 表现为「手机上云游页 / 寻宝页整页打不开」，而同一地址的 IP 访问却正常。
     *
     * 本工程 dev server 本来就监听 0.0.0.0 供真机调试，故直接放行任意 Host；
     * 若要收紧，换成白名单数组即可，例如：["abc.trycloudflare.com"]。
     * 该配置只影响 dev（build 产物由 apps/server 用 Fastify 托管，无此校验）。
     */
    allowedHosts: true,
    // 3D 模型动辄数百 MB，监听会触发 EBUSY 导致 dev 崩溃，直接忽略
    watch: {
      ignored: ["**/*.glb", "**/assets/videos/**"],
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
}));
