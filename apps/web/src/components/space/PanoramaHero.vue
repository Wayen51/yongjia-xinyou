<template>
  <div ref="hostRef" class="phero" :class="{ 'is-ready': state === 'ready' }">
    <!-- 海报层：首帧即时可见，也是 WebGL 不可用时的降级形态 -->
    <img
      v-if="poster && !posterFailed"
      :src="poster"
      alt=""
      class="phero__poster"
      aria-hidden="true"
      @error="posterFailed = true"
    />
    <canvas ref="canvasRef" class="phero__canvas" aria-hidden="true"></canvas>

    <div v-if="scrim" class="phero__veil" aria-hidden="true"></div>
    <div class="phero__vig" aria-hidden="true"></div>

    <div class="phero__slot"><slot /></div>
  </div>
</template>

<script setup lang="ts">
/**
 * 全景氛围层（PanoramaHero）
 *
 * 用途：把「3D 全景」提到页面首屏当主视觉，取代静态封面图与 2D 伪 3D 动画。
 *
 * 与 PanoViewer 的分工：PanoViewer 是业务查看器（热点投影 / 陀螺仪 / 巡航接管），
 * 本组件只做氛围背景——慢速横移 + 指针视差，不接管交互，也不拦截任何手势。
 *
 * 降级链：WebGL 不可用 / 纹理加载失败 → 静态海报 + 缓慢平移（保留「在动」的观感）。
 * 性能：非视口内或标签页隐藏时停掉 rAF；DPR 上限 1.5；不生成 mipmap。
 */
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as THREE from "three";

const props = withDefaults(
  defineProps<{
    /** 等距柱状全景图 URL */
    panorama: string;
    /** 同场景的低分辨率版本：小屏优先使用，桌面版失败时兜底重试 */
    mobilePanorama?: string;
    /** 加载期间与降级时展示的静态海报 */
    poster?: string;
    /** 自动横移速度（度/秒），0 为静止 */
    speed?: number;
    /** 初始俯仰角（负值略微俯视，更像「站在山水前」） */
    pitch?: number;
    /** 初始视场角；竖屏会自动放宽，避免只能看到全景的一条缝 */
    fov?: number;
    /** 指针视差：鼠标移动时视角轻微跟随 */
    parallax?: boolean;
    /** 视差幅度（度） */
    parallaxRange?: number;
    /** 压暗遮罩，保证叠加文字可读 */
    scrim?: boolean;
  }>(),
  {
    mobilePanorama: "",
    poster: "",
    speed: 2.2,
    pitch: -4,
    fov: 82,
    parallax: true,
    parallaxRange: 5,
    scrim: true,
  }
);

const emit = defineEmits<{
  (e: "ready"): void;
  (e: "error"): void;
}>();

const hostRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const state = ref<"loading" | "ready" | "error">("loading");
const posterFailed = ref(false);

const SPHERE_RADIUS = 500;
/** 竖屏时放宽视场角，否则全景只露出中间一条 */
const PORTRAIT_FOV_BOOST = 16;

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let sphere: THREE.Mesh | null = null;
let texture: THREE.Texture | null = null;
let resizeObserver: ResizeObserver | null = null;
let intersectObserver: IntersectionObserver | null = null;

let raf = 0;
let disposed = false;
/** 是否在视口内（IntersectionObserver 维护） */
let onScreen = true;
/** 标签页是否隐藏 */
let hidden = false;
/** 用户是否开启了「减弱动效」 */
let reduceMotion = false;
/** 是否为细指针设备（指针视差只在这类设备上有意义），只探测一次 */
let parallaxCapable = false;

let lon = 0;
let lat = props.pitch;
/** 指针视差：当前值与目标值，逐帧缓动 */
let pxNow = 0;
let pxGoal = 0;
let pyNow = 0;
let pyGoal = 0;

let lastTime = 0;
let idleUntil = 0;
/** 轮次令牌：换图后作废此前在途的加载回调 */
let loadToken = 0;

const lookVec = new THREE.Vector3();

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function detectWebGL(): boolean {
  try {
    const test = document.createElement("canvas");
    return !!(test.getContext("webgl2") || test.getContext("webgl"));
  } catch {
    return false;
  }
}

function isSmallScreen(): boolean {
  return window.innerWidth < 900 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/** 小屏优先用压缩版；没有压缩版就用原图 */
function pickPrimaryUrl(): string {
  if (isSmallScreen() && props.mobilePanorama) return props.mobilePanorama;
  return props.panorama;
}

/* ---------------- 初始化 ---------------- */

function init() {
  const host = hostRef.value;
  const canvas = canvasRef.value;
  if (!host || !canvas) return;

  if (!detectWebGL()) {
    state.value = "error";
    emit("error");
    return;
  }

  let webgl: THREE.WebGLRenderer;
  try {
    webgl = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "low-power" });
  } catch {
    state.value = "error";
    emit("error");
    return;
  }
  renderer = webgl;
  // 氛围层不需要高精度：限制 DPR 换取稳定帧率
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight), false);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(props.fov, host.clientWidth / Math.max(1, host.clientHeight), 0.1, 1100);
  camera.position.set(0, 0, 0);

  const geometry = new THREE.SphereGeometry(SPHERE_RADIUS, 64, 40);
  // 内翻球面：相机位于球心，看到的是纹理内壁
  geometry.scale(-1, 1, 1);
  sphere = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x0a1220 }));
  scene.add(sphere);

  resize();
  loadPanorama(pickPrimaryUrl());

  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(host);
  } else {
    window.addEventListener("resize", resize);
  }

  if (typeof IntersectionObserver !== "undefined") {
    intersectObserver = new IntersectionObserver(
      (entries) => {
        onScreen = entries.some((e) => e.isIntersecting);
        syncLoop();
      },
      { rootMargin: "120px" }
    );
    intersectObserver.observe(host);
  }

  if (parallaxCapable) window.addEventListener("pointermove", onPointerMove);
  document.addEventListener("visibilitychange", onVisibilityChange);
}

function resize() {
  const host = hostRef.value;
  if (!host || !renderer || !camera) return;
  const w = Math.max(1, host.clientWidth);
  const h = Math.max(1, host.clientHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = props.fov + (camera.aspect < 1 ? PORTRAIT_FOV_BOOST : 0);
  camera.updateProjectionMatrix();
  drawOnce();
}

/* ---------------- 纹理 ---------------- */

function loadPanorama(url: string, isRetry = false) {
  if (!url) {
    state.value = "error";
    emit("error");
    return;
  }
  const my = ++loadToken;
  state.value = "loading";

  new THREE.TextureLoader().load(
    url,
    (tex) => {
      if (disposed || my !== loadToken) {
        tex.dispose();
        return;
      }
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.mapping = THREE.EquirectangularReflectionMapping;
      // wrapS=Repeat 消除经度方向接缝；wrapT=Clamp 避免两极重复采样
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      texture?.dispose();
      texture = tex;

      const mat = sphere?.material as THREE.MeshBasicMaterial | undefined;
      if (mat) {
        mat.map = tex;
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
      }
      state.value = "ready";
      emit("ready");
      syncLoop();
    },
    undefined,
    () => {
      if (disposed || my !== loadToken) return;
      // 桌面版失败时退到同场景压缩版再试一次，仍失败才走海报兜底
      const retryUrl = !isRetry && props.mobilePanorama && url !== props.mobilePanorama ? props.mobilePanorama : "";
      if (retryUrl) {
        loadPanorama(retryUrl, true);
        return;
      }
      state.value = "error";
      emit("error");
      syncLoop();
    }
  );
}

/* ---------------- 视角与渲染 ---------------- */

function applyCamera() {
  if (!camera) return;
  const range = props.parallax && parallaxCapable ? props.parallaxRange : 0;
  const pitch = clamp(lat + pyNow * range, -80, 80);
  const yaw = lon + pxNow * range * 1.6;
  lookVec.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - pitch), THREE.MathUtils.degToRad(yaw));
  camera.lookAt(lookVec);
}

function drawOnce() {
  if (!renderer || !scene || !camera || disposed) return;
  applyCamera();
  renderer.render(scene, camera);
}

function startLoop() {
  if (raf || disposed) return;
  lastTime = 0;
  raf = requestAnimationFrame(animate);
}

function stopLoop() {
  if (!raf) return;
  cancelAnimationFrame(raf);
  raf = 0;
}

/** 只在「可见 + 未隐藏 + 已就绪」时占用 rAF，避免离屏页面空转 GPU */
function syncLoop() {
  if (!disposed && onScreen && !hidden && state.value === "ready") startLoop();
  else stopLoop();
}

function animate(now: number) {
  raf = requestAnimationFrame(animate);
  if (!renderer || !scene || !camera || disposed) return;

  const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
  lastTime = now;

  if (lon > 360) lon -= 360;
  if (lon < -360) lon += 360;

  // 自动横移：用户刚动过鼠标时先停一会儿，避免与指针视差互相打架
  if (props.speed > 0 && !reduceMotion && performance.now() > idleUntil) {
    lon -= props.speed * dt;
  }

  pxNow += (pxGoal - pxNow) * 0.06;
  pyNow += (pyGoal - pyNow) * 0.06;

  drawOnce();
}

/* ---------------- 事件 ---------------- */

function onPointerMove(e: PointerEvent) {
  pxGoal = clamp((e.clientX / Math.max(1, window.innerWidth)) * 2 - 1, -1, 1);
  pyGoal = clamp((e.clientY / Math.max(1, window.innerHeight)) * 2 - 1, -1, 1);
  idleUntil = performance.now() + 2600;
}

function onVisibilityChange() {
  hidden = document.hidden;
  syncLoop();
}

/* ---------------- 生命周期 ---------------- */

onMounted(() => {
  reduceMotion = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  parallaxCapable = !!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
  init();
});

watch(
  () => [props.panorama, props.mobilePanorama] as const,
  () => {
    if (disposed || !renderer) return;
    loadPanorama(pickPrimaryUrl());
  }
);

onBeforeUnmount(() => {
  disposed = true;
  loadToken++;
  stopLoop();
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("resize", resize);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  resizeObserver?.disconnect();
  resizeObserver = null;
  intersectObserver?.disconnect();
  intersectObserver = null;
  sphere?.geometry.dispose();
  (sphere?.material as THREE.Material | undefined)?.dispose();
  texture?.dispose();
  texture = null;
  renderer?.dispose();
  renderer = null;
  scene = null;
  camera = null;
  sphere = null;
});
</script>

<style scoped>
.phero {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  /* 刻意透明：全景与海报都不可用时，让父层自己的静态兜底露出来 */
  background: transparent;
  isolation: isolate;
}

.phero__poster {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: opacity var(--dur-deliberate) var(--ease-out);
}
/* WebGL 就绪后海报与画布交叉淡入，避免切换时的黑闪 */
.phero.is-ready .phero__poster {
  opacity: 0;
}
/* 降级形态：没有 WebGL 也要「在动」，用缓慢推拉保留沉浸感 */
.phero:not(.is-ready) .phero__poster {
  animation: phero-drift 28s ease-in-out infinite alternate;
}

.phero__canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  opacity: 0;
  transition: opacity var(--dur-deliberate) var(--ease-out);
}
.phero.is-ready .phero__canvas {
  opacity: 1;
}

@keyframes phero-drift {
  from {
    transform: scale(1.06) translate3d(0, 0, 0);
  }
  to {
    transform: scale(1.18) translate3d(-2.5%, -1.5%, 0);
  }
}

/* 文本可读性遮罩：上下压暗 + 主色氛围（可整体关闭） */
.phero__veil {
  position: absolute;
  inset: 0;
  z-index: 1;
  background:
    linear-gradient(180deg, rgba(10, 18, 32, 0.68) 0%, rgba(10, 18, 32, 0.22) 42%, rgba(10, 18, 32, 0.94) 100%),
    radial-gradient(1100px 520px at 16% 26%, rgba(62, 198, 184, 0.14), transparent 62%);
}
.phero__vig {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background: radial-gradient(130% 105% at 50% 45%, transparent 52%, rgba(5, 10, 18, 0.55) 100%);
}

.phero__slot {
  position: absolute;
  inset: 0;
  z-index: 2;
}
</style>
