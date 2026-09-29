<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { RouterView, useRoute } from "vue-router";
import SiteLogo from "@/components/common/SiteLogo.vue";
import WeatherClock from "@/components/common/WeatherClock.vue";
import GlobalSearch from "@/components/common/GlobalSearch.vue";
import ToastHost from "@/components/common/ToastHost.vue";
// @ts-ignore 单文件 vendor 无类型声明（原 2009 年 UMD 脚本，文件尾部已补 ESM 默认导出）
import qrcodeLib from "@/vendor/qrcode-generator.js";

// 平台向 v2：导航收敛。永嘉知识库（本地知识库）下沉为内容底座，由“全局搜索/AI/云游”触达；
// 文化寻宝并入 3D 云游模块内的小入口。路由保留不删，仅从主导航隐藏。
// 板块一：AI 视频生成工坊；板块二：AR 互动寻宝（运营模板化玩法预览）；
// 板块三：智能伴侣（AI 伴游，即平台生成的 Agent 实例）；数据看板：政务运营口径。
const navs = [
  { to: "/", label: "首页" },
  { to: "/video", label: "视频生成" },
  { to: "/ar", label: "AR 互动" },
  { to: "/space", label: "3D 云游" },
  { to: "/scenes", label: "场景管理" },
  { to: "/agent", label: "智能伴侣" },
  { to: "/dashboard", label: "数据看板" },
];

/** 全屏路由（3D 大屏巡航）：隐藏平台顶栏与页脚，让内容独占整屏 */
const route = useRoute();
const fullscreen = computed(() => route.meta?.fullscreen === true);

const modeLabel = ref<string>("");
const offline = ref(false);

onMounted(async () => {
  try {
    const res = await fetch("/api/health");
    const body = (await res.json()) as {
      code: number;
      data?: { status: string; llm: string; weather: string; mockLlm: boolean };
    };
    const d = body.data;
    if (d?.mockLlm) modeLabel.value = "本地演示模式 · 智能体剧本回放";
    else if (d?.llm === "missing-key") modeLabel.value = "LLM 未配置 · 自动降级剧本";
    else modeLabel.value = "在线模式";
  } catch {
    offline.value = true;
    modeLabel.value = "无法连接服务端";
  }
});

/* ---------- 扫码体验：真二维码（编码当前访问地址的手机端入口） ---------- */
/* 与 ar/DemoQr.vue 的「演示假码」不同：这里必须可真实扫描跳转。
   地址取当前 origin + /m/——云端访问时即公网地址；演示机用局域网 IP 打开时
   自动变成局域网地址，现场无外网手机也能扫开（同一 WiFi 即可）。 */
const qrOpen = ref(false);
const qrDataUrl = ref("");
const mobileUrl = `${window.location.origin}/m/`;
const qrIsLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);

function openQr() {
  if (!qrDataUrl.value) {
    const qr = qrcodeLib(0, "M");
    qr.addData(mobileUrl);
    qr.make();
    qrDataUrl.value = qr.createDataURL(8, 4);
  }
  qrOpen.value = true;
}
function onQrKey(e: KeyboardEvent) {
  if (e.key === "Escape") qrOpen.value = false;
}
onMounted(() => window.addEventListener("keydown", onQrKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onQrKey));
</script>

<template>
  <div class="shell" :class="{ 'shell--full': fullscreen }">
    <header v-if="!fullscreen" class="topbar">
      <div class="page topbar__inner">
        <RouterLink to="/" class="topbar__brand">
          <SiteLogo />
        </RouterLink>
        <nav class="topbar__nav">
          <RouterLink
            v-for="n in navs"
            :key="n.to"
            :to="n.to"
            class="topbar__link"
            :class="{
              'topbar__link--on':
                $route.path === n.to || (n.to !== '/' && $route.path.startsWith(n.to + '/')),
            }"
          >
            {{ n.label }}
          </RouterLink>
        </nav>
        <div class="topbar__right">
          <WeatherClock />
          <GlobalSearch />
          <button type="button" class="qr-btn" @click="openQr" title="手机扫码打开手机端">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <g fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="8" height="8" />
                <rect x="13" y="3" width="8" height="8" />
                <rect x="3" y="13" width="8" height="8" />
              </g>
              <path d="M13 13h3v3h-3zM19 13h2v2h-2zM13 19h2v2h-2zM17 17h4v4h-4z" fill="currentColor" />
            </svg>
            扫码体验
          </button>
          <!-- Android APK 下载：文件在 public/app/，随构建进 dist，云端静态托管直接可下 -->
          <a class="qr-btn qr-btn--app" href="/app/yongjia-xinyou-v1.0.apk" download="永嘉新游-Android-v1.0.apk" title="下载 Android 安装包（离线演示版）">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3v12" />
                <path d="M7 11l5 5 5-5" />
                <path d="M4 21h16" />
              </g>
            </svg>
            APP 下载
          </a>
          <span v-if="offline" class="mode-chip mode-chip--off">离线</span>
          <span v-else-if="modeLabel" class="mode-chip">{{ modeLabel }}</span>
        </div>
      </div>
    </header>

    <main class="shell__main">
      <RouterView v-slot="{ Component }">
        <Transition name="fade" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>

    <footer v-if="!fullscreen" class="footer">
      <div class="page footer__inner">
        <div class="footer__slogan font-serif-sc">让永嘉的故事，被人记住。</div>
        <div class="footer__meta">
          永嘉文旅 AI-Agent 平台（板块一·视频生成 / 板块二·AR 互动 / 板块三·智能伴侣）｜AI×OPC 2026 永嘉农商杯创新创业大赛 · 参赛作品
        </div>
        <div class="footer__note">平台内所有演示数据均标注「演示」｜知识内容来自公开资料，见各条目来源</div>
      </div>
    </footer>

    <Transition name="fade">
      <div v-if="qrOpen" class="qr-mask" @click.self="qrOpen = false">
        <div class="qr-card" role="dialog" aria-modal="true" aria-label="扫码体验手机端">
          <button type="button" class="qr-card__x" aria-label="关闭" @click="qrOpen = false">×</button>
          <p class="qr-card__title">扫码体验手机端</p>
          <img v-if="qrDataUrl" :src="qrDataUrl" alt="手机端入口二维码" class="qr-card__img" />
          <p class="qr-card__url">{{ mobileUrl }}</p>
          <p class="qr-card__hint">
            {{ qrIsLocal
              ? "当前是本机地址（localhost），手机扫不开——请改用「局域网 IP:3000」打开本页后再扫码"
              : "手机相机扫码直达手机端，无需手动输入网址" }}
          </p>
        </div>
      </div>
    </Transition>

    <ToastHost />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background:
    radial-gradient(1200px 500px at 80% -10%, rgba(62, 198, 184, 0.06), transparent 60%),
    radial-gradient(900px 420px at -10% 30%, rgba(124, 143, 245, 0.05), transparent 55%),
    var(--bg-base);
}
.shell__main {
  flex: 1;
  display: flex;
  flex-direction: column;
}

/* 全屏路由：内容独占整屏，不出现平台滚动 */
.shell--full {
  height: 100vh;
  min-height: 0;
  overflow: hidden;
}
.shell--full .shell__main {
  min-height: 0;
  overflow: hidden;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 50;
  background: rgba(10, 18, 32, 0.78);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-bottom: 1px solid rgba(35, 54, 79, 0.7);
}
.topbar__inner {
  height: 60px;
  display: flex;
  align-items: center;
  gap: 24px;
}
.topbar__brand {
  display: inline-flex;
  flex: none;
}
/* 单行自适应：导航紧跟品牌居左，搜索/天气/模式标识贴最右 */
.topbar__nav {
  flex: none;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}
.topbar__link {
  padding: 7px 10px;
  font-size: 15px;
  color: var(--text-secondary);
  border-radius: 8px;
  white-space: nowrap;
  transition: all 0.18s ease;
}
.topbar__link:hover {
  color: var(--text-primary);
  background: rgba(62, 198, 184, 0.08);
}
.topbar__link--on {
  color: var(--primary);
  background: var(--primary-soft);
}
.topbar__right {
  flex: none;
  min-width: 0;
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}
.mode-chip {
  font-size: 12px;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px 10px;
  white-space: nowrap;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  background: rgba(22, 38, 63, 0.5);
}
.mode-chip--off {
  color: var(--danger);
  border-color: rgba(248, 113, 113, 0.4);
}

.footer {
  margin-top: 60px;
  border-top: 1px solid rgba(35, 54, 79, 0.6);
  padding: 26px 0 30px;
  background: rgba(8, 14, 26, 0.5);
}
.footer__inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}
.footer__slogan {
  font-size: 17px;
  color: var(--text-secondary);
  letter-spacing: 0.1em;
}
.footer__meta {
  font-size: 13px;
  color: var(--text-dim);
}
.footer__note {
  font-size: 12px;
  color: rgba(100, 116, 143, 0.7);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 扫码体验：头部入口 + 二维码弹层（真码，白底保证扫码对比度） */
.qr-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--primary);
  border: 1px solid rgba(62, 198, 184, 0.45);
  border-radius: 999px;
  padding: 3px 11px;
  background: rgba(62, 198, 184, 0.08);
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.18s ease;
}
.qr-btn:hover {
  background: rgba(62, 198, 184, 0.16);
  border-color: rgba(62, 198, 184, 0.7);
}
/* APP 下载按钮是 <a>：去掉下划线、继承 qr-btn 胶囊样式 */
.qr-btn--app {
  text-decoration: none;
}
.qr-mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(4, 10, 20, 0.72);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: grid;
  place-items: center;
}
.qr-card {
  position: relative;
  width: min(320px, calc(100vw - 48px));
  background: #fff;
  color: #17233b;
  border-radius: 14px;
  padding: 22px 20px 18px;
  text-align: center;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
}
.qr-card__x {
  position: absolute;
  top: 6px;
  right: 12px;
  border: 0;
  background: none;
  font-size: 22px;
  line-height: 1;
  color: #7a8699;
  cursor: pointer;
}
.qr-card__title {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.06em;
}
.qr-card__img {
  display: block; /* Tailwind preflight 已将 img 重置为 block，text-align 无法居中 */
  width: 208px;
  height: auto;
  margin-inline: auto;
  image-rendering: pixelated;
  border-radius: 8px;
}
.qr-card__url {
  margin: 10px 0 6px;
  font-size: 12px;
  color: #33475f;
  word-break: break-all;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.qr-card__hint {
  margin: 0;
  font-size: 11.5px;
  color: #7a8699;
  line-height: 1.6;
}

/* 窄屏兜底：放不下时导航折到第二行（仅中小窗口触发，常规桌面保持单行） */
@media (max-width: 1120px) {
  .topbar__inner {
    flex-wrap: wrap;
    height: auto;
    gap: 6px;
    padding-top: 8px;
    padding-bottom: 8px;
  }
  .topbar__nav {
    order: 3;
    width: 100%;
    justify-content: center;
    padding: 4px 0 2px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .topbar__right {
    margin-left: auto;
  }
}
</style>
