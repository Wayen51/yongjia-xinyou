<template>
  <div ref="hostRef" class="pano">
    <canvas ref="canvasRef" class="pano__canvas"></canvas>

    <!-- 热点层：由 Three.js 每帧投影定位 -->
    <div class="pano__hotlayer">
      <button
        v-for="(h, i) in hotspots"
        :key="h.id"
        :ref="(el) => setHotEl(el, i)"
        class="pano__hot"
        type="button"
        :title="h.title"
        @click="emit('hotspot', h)"
      >
        <span class="pano__hot-dot">
          <span class="pano__hot-ico">{{ hotspotIcon(h.icon) }}</span>
        </span>
        <span class="pano__hot-label">{{ h.name }}</span>
      </button>
    </div>

    <!-- 控件 -->
    <div v-if="ui" class="pano__hud">
      <button class="pano__hudbtn" type="button" title="放大" @click="setFov(fov - 8)">＋</button>
      <button class="pano__hudbtn" type="button" title="缩小" @click="setFov(fov + 8)">－</button>
      <button
        class="pano__hudbtn"
        type="button"
        title="重置视角"
        @click="resetView"
      >
        ⟲
      </button>
      <button
        class="pano__hudbtn"
        :class="{ 'is-on': gyroOn }"
        type="button"
        title="陀螺仪环视（手机）"
        @click="toggleGyro"
      >
        ◉
      </button>
      <button
        class="pano__hudbtn"
        type="button"
        title="自动旋转"
        :class="{ 'is-on': autoRotateOn }"
        @click="toggleAutoRotate"
      >
        ✧
      </button>
      <button class="pano__hudbtn" type="button" title="全屏" @click="toggleFullscreen">
        {{ isFullscreen ? "⤡" : "⤢" }}
      </button>
    </div>

    <div v-if="ui && state === 'ready' && autoRotateOn && !gyroOn" class="pano__tip">
      按住拖拽环视 · 滚轮缩放
    </div>

    <!-- 加载 / 失败 -->
    <div v-if="state !== 'ready'" class="pano__mask">
      <template v-if="state === 'loading'">
        <div class="yj-spinner"></div>
        <p class="pano__masktxt">
          全景加载中
          <span v-if="progress > 0" class="pano__pct">{{ progress }}%</span>
        </p>
      </template>
      <template v-else>
        <p class="pano__masktxt">全景素材加载失败</p>
        <button class="yj-btn yj-btn--primary" type="button" @click="reload">重试</button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as THREE from "three";
import type { PanoHotspot } from "@/types/api";

const props = withDefaults(
  defineProps<{
    panorama: string;
    hotspots?: PanoHotspot[];
    initialYaw?: number;
    initialPitch?: number;
    initialFov?: number;
    autoRotate?: boolean;
    /** 巡航目标视角：变化时相机平滑转过去（大屏巡航用） */
    target?: { yaw: number; pitch: number; fov?: number } | null;
    /** 是否允许用户拖拽/缩放（巡航演示时关闭，防误触） */
    interactive?: boolean;
    /** 是否显示缩放/重置/陀螺仪等控件（巡航演示时关闭） */
    ui?: boolean;
  }>(),
  {
    hotspots: () => [],
    initialYaw: 0,
    initialPitch: 0,
    initialFov: 75,
    autoRotate: true,
    target: null,
    interactive: true,
    ui: true,
  }
);

const emit = defineEmits<{
  (e: "hotspot", h: PanoHotspot): void;
  (e: "error"): void;
}>();

const hostRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const state = ref<"loading" | "ready" | "error">("loading");
const progress = ref(0);
const fov = ref(props.initialFov);
const gyroOn = ref(false);
const autoRotateOn = ref(props.autoRotate);
const isFullscreen = ref(false);

const SPHERE_RADIUS = 500;
const HOTSPOT_SPHERE = 480;
const ICONS: Record<string, string> = {
  mountain: "⛰",
  water: "≈",
  cave: "◍",
  building: "⌂",
  bridge: "⛩",
  lantern: "❖",
  tree: "❦",
  default: "◆",
};

function hotspotIcon(key: string): string {
  return ICONS[key] ?? ICONS.default;
}

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let sphere: THREE.Mesh | null = null;
let texture: THREE.Texture | null = null;
let raf = 0;
let resizeObserver: ResizeObserver | null = null;
let disposed = false;

let lon = props.initialYaw;
let lat = props.initialPitch;
let vLon = 0;
let vLat = 0;
let isDown = false;
let lastX = 0;
let lastY = 0;
let idleAt = 0;
/** 程序化巡航目标：非空时相机平滑逼近该视角，并接管自动旋转与阻尼 */
let cruiseTarget: { yaw: number; pitch: number; fov?: number } | null = null;

const hotspotVecs: THREE.Vector3[] = [];
const hotEls: (HTMLElement | null)[] = [];
const camDir = new THREE.Vector3();
const tmpVec = new THREE.Vector3();

function setHotEl(el: unknown, i: number) {
  hotEls[i] = (el as HTMLElement | null) ?? null;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

/* ---------------- 初始化 ---------------- */
function init() {
  const canvas = canvasRef.value;
  const host = hostRef.value;
  if (!canvas || !host) return;

  let webgl: THREE.WebGLRenderer;
  try {
    webgl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  } catch {
    state.value = "error";
    emit("error");
    return;
  }
  renderer = webgl;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight, false);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(props.initialFov, host.clientWidth / Math.max(1, host.clientHeight), 0.1, 1100);
  camera.position.set(0, 0, 0);

  const geometry = new THREE.SphereGeometry(SPHERE_RADIUS, 64, 40);
  // 内翻球面，让相机位于球心看到纹理内壁
  geometry.scale(-1, 1, 1);
  const material = new THREE.MeshBasicMaterial({ color: 0x0a1220 });
  sphere = new THREE.Mesh(geometry, material);
  scene.add(sphere);

  buildHotspotVectors();
  loadPanorama(props.panorama);

  resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(host);

  // 交互
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  document.addEventListener("fullscreenchange", onFullscreenChange);

  idleAt = performance.now() + 2600;
  animate();
}

function resize() {
  const host = hostRef.value;
  if (!host || !renderer || !camera) return;
  const w = host.clientWidth;
  const h = Math.max(1, host.clientHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

/* ---------------- 纹理加载 ---------------- */
function loadPanorama(url: string) {
  state.value = "loading";
  progress.value = 0;
  const loader = new THREE.TextureLoader();
  loader.load(
    url,
    (tex) => {
      if (disposed) {
        tex.dispose();
        return;
      }
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.mapping = THREE.EquirectangularReflectionMapping;
      // wrapS=Repeat 消除球面经度方向接缝；wrapT=Clamp 避免两极重复采样
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      texture?.dispose();
      texture = tex;
      if (sphere) {
        const mat = sphere.material as THREE.MeshBasicMaterial;
        mat.map = tex;
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
      }
      state.value = "ready";
    },
    (evt) => {
      if (evt.total > 0) progress.value = Math.round((evt.loaded / evt.total) * 100);
    },
    () => {
      if (disposed) return;
      state.value = "error";
      emit("error");
    }
  );
}

function reload() {
  loadPanorama(props.panorama);
}



// 巡航目标：外部（大屏巡航）下发视角后，交给主循环平滑逼近
watch(
  () => props.target,
  (t) => {
    if (!t) return;
    cruiseTarget = { yaw: t.yaw, pitch: t.pitch, fov: t.fov };
    // 巡航接管视角时清掉拖拽惯性，避免两股力互相打架
    vLon = 0;
    vLat = 0;
    isDown = false;
  }
);

/* ---------------- 热点 ---------------- */
function buildHotspotVectors() {
  hotspotVecs.length = 0;
  hotEls.length = 0;
  for (const h of props.hotspots) {
    const pitch = h.position?.pitch ?? 0;
    const yaw = h.position?.yaw ?? 0;
    const phi = THREE.MathUtils.degToRad(90 - pitch);
    const theta = THREE.MathUtils.degToRad(yaw);
    hotspotVecs.push(new THREE.Vector3().setFromSphericalCoords(HOTSPOT_SPHERE, phi, theta));
  }
}

function updateHotspots() {
  if (!camera || !renderer) return;
  const host = hostRef.value;
  if (!host) return;
  const w = host.clientWidth;
  const h = host.clientHeight;
  camera.getWorldDirection(camDir);

  for (let i = 0; i < hotspotVecs.length; i++) {
    const el = hotEls[i];
    const vec = hotspotVecs[i];
    if (!el || !vec) continue;
    const dir = tmpVec.copy(vec).normalize();
    const facing = dir.dot(camDir);
    if (facing <= 0.12) {
      if (el.style.opacity !== "0") {
        el.style.opacity = "0";
        el.style.pointerEvents = "none";
      }
      continue;
    }
    const p = tmpVec.copy(vec).project(camera);
    const x = (p.x * 0.5 + 0.5) * w;
    const y = (-p.y * 0.5 + 0.5) * h;
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
    el.style.opacity = String(Math.min(1, (facing - 0.12) * 2.6).toFixed(2));
    el.style.pointerEvents = "auto";
  }
}

/* ---------------- 视角 ---------------- */
function applyCamera() {
  if (!camera) return;
  const phi = THREE.MathUtils.degToRad(90 - clamp(lat, -85, 85));
  const theta = THREE.MathUtils.degToRad(lon);
  tmpVec.setFromSphericalCoords(1, phi, theta);
  camera.lookAt(tmpVec);
}

function setFov(next: number) {
  fov.value = clamp(next, 30, 100);
  if (camera) {
    camera.fov = fov.value;
    camera.updateProjectionMatrix();
  }
  idleAt = performance.now() + 2600;
}

function resetView() {
  lon = props.initialYaw;
  lat = props.initialPitch;
  vLon = 0;
  vLat = 0;
  setFov(props.initialFov);
}

function toggleAutoRotate() {
  autoRotateOn.value = !autoRotateOn.value;
  idleAt = performance.now() + 2600;
}

/* ---------------- 交互 ---------------- */
const pointers = new Map<number, { x: number; y: number }>();
let pinchBase = 0;
let pinchFov = 0;

function onPointerDown(e: PointerEvent) {
  if (!props.interactive) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    isDown = true;
    lastX = e.clientX;
    lastY = e.clientY;
    vLon = 0;
    vLat = 0;
  } else if (pointers.size === 2) {
    isDown = false;
    const [a, b] = [...pointers.values()];
    pinchBase = Math.hypot(a.x - b.x, a.y - b.y);
    pinchFov = fov.value;
  }
  canvasRef.value?.setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2 && pinchBase > 0) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    setFov(pinchFov * (pinchBase / Math.max(1, dist)));
    return;
  }
  if (!isDown) return;

  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  const k = 0.12 * (fov.value / 75);
  vLon = -dx * k;
  vLat = dy * k;
  lon += vLon;
  lat = clamp(lat + vLat, -85, 85);
  idleAt = performance.now() + 2600;
}

function onPointerUp(e: PointerEvent) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchBase = 0;
  if (pointers.size === 0) {
    isDown = false;
    idleAt = performance.now() + 2600;
  }
}

function onWheel(e: WheelEvent) {
  if (!props.interactive) return;
  e.preventDefault();
  setFov(fov.value + Math.sign(e.deltaY) * 2.5);
  vLon = 0;
  vLat = 0;
}

/* ---------------- 陀螺仪 ---------------- */
let gyroBase: { alpha: number; beta: number } | null = null;
let gyroLon0 = 0;
let gyroLat0 = 0;

function onOrientation(e: DeviceOrientationEvent) {
  if (e.alpha == null || e.beta == null) return;
  if (!gyroBase) {
    gyroBase = { alpha: e.alpha, beta: e.beta };
    gyroLon0 = lon;
    gyroLat0 = lat;
    return;
  }
  let dAlpha = e.alpha - gyroBase.alpha;
  if (dAlpha > 180) dAlpha -= 360;
  if (dAlpha < -180) dAlpha += 360;
  const dBeta = e.beta - gyroBase.beta;
  lon = gyroLon0 - dAlpha;
  lat = clamp(gyroLat0 + dBeta * 0.6, -85, 85);
}

async function toggleGyro() {
  if (gyroOn.value) {
    window.removeEventListener("deviceorientation", onOrientation);
    gyroOn.value = false;
    gyroBase = null;
    return;
  }
  const DOE = window.DeviceOrientationEvent as unknown as {
    requestPermission?: () => Promise<string>;
  };
  try {
    if (DOE && typeof DOE.requestPermission === "function") {
      const res = await DOE.requestPermission();
      if (res !== "granted") return;
    }
    if (!("DeviceOrientationEvent" in window)) return;
    window.addEventListener("deviceorientation", onOrientation);
    gyroOn.value = true;
  } catch {
    gyroOn.value = false;
  }
}

/* ---------------- 全屏 ---------------- */
function toggleFullscreen() {
  const host = hostRef.value;
  if (!host) return;
  if (document.fullscreenElement) {
    void document.exitFullscreen();
  } else {
    void host.requestFullscreen?.();
  }
}

function onFullscreenChange() {
  isFullscreen.value = document.fullscreenElement === hostRef.value;
  // 全屏切换后容器尺寸变化，ResizeObserver 会补一次，这里再兜一次
  setTimeout(resize, 60);
}

/* ---------------- 主循环 ---------------- */
function animate() {
  raf = requestAnimationFrame(animate);
  if (!renderer || !scene || !camera || disposed) return;

  // 大屏巡航：向目标视角平滑逼近（角度取最短弧，避免绕远路）
  if (cruiseTarget && !isDown && !gyroOn.value) {
    const k = 0.055;
    let dLon = cruiseTarget.yaw - lon;
    dLon = ((((dLon + 180) % 360) + 360) % 360) - 180;
    const dLat = cruiseTarget.pitch - lat;
    lon += dLon * k;
    lat = clamp(lat + dLat * k, -85, 85);
    if (cruiseTarget.fov != null) {
      const dFov = cruiseTarget.fov - fov.value;
      if (Math.abs(dFov) > 0.08) {
        fov.value = clamp(fov.value + dFov * k, 30, 100);
        camera.fov = fov.value;
        camera.updateProjectionMatrix();
      }
    }
    if (Math.abs(dLon) < 0.12 && Math.abs(dLat) < 0.12) cruiseTarget = null;
  }

  if (!isDown && !gyroOn.value) {
    lon += vLon;
    lat = clamp(lat + vLat, -85, 85);
    vLon *= 0.94;
    vLat *= 0.94;
    if (Math.abs(vLon) < 0.008) vLon = 0;
    if (Math.abs(vLat) < 0.008) vLat = 0;

    if (lon > 360) lon -= 360;
    if (lon < -360) lon += 360;

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (autoRotateOn.value && !reduce && !cruiseTarget && performance.now() > idleAt && vLon === 0 && vLat === 0) {
      lon -= 0.05;
    }
  }

  applyCamera();
  updateHotspots();
  renderer.render(scene, camera);
}

/* ---------------- 生命周期 ---------------- */
onMounted(() => {
  init();
});

watch(
  () => props.panorama,
  (url) => {
    if (url && renderer) loadPanorama(url);
  }
);

watch(
  () => props.hotspots,
  () => {
    buildHotspotVectors();
  }
);

onBeforeUnmount(() => {
  disposed = true;
  cancelAnimationFrame(raf);
  window.removeEventListener("deviceorientation", onOrientation);
  document.removeEventListener("fullscreenchange", onFullscreenChange);
  resizeObserver?.disconnect();
  const canvas = canvasRef.value;
  if (canvas) {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("wheel", onWheel);
  }
  sphere?.geometry.dispose();
  (sphere?.material as THREE.Material | undefined)?.dispose();
  texture?.dispose();
  renderer?.dispose();
  renderer = null;
  scene = null;
  camera = null;
  sphere = null;
});

defineExpose({ resetView, setFov, toggleFullscreen, toggleGyro, toggleAutoRotate });
</script>

<style scoped>
.pano {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  background: var(--color-bg-base);
  overflow: hidden;
  border-radius: var(--radius-lg);
  touch-action: none;
  cursor: grab;
}
.pano:active {
  cursor: grabbing;
}
.pano__canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.pano__hotlayer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}
.pano__hot {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-out);
  will-change: transform, opacity;
}
.pano__hot-dot {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  font-size: 15px;
  color: var(--color-bg-base);
  background: radial-gradient(circle at 35% 30%, var(--color-brand-300), var(--color-brand-600));
  box-shadow: 0 0 0 4px rgba(62, 198, 184, 0.18), 0 6px 16px rgba(0, 0, 0, 0.45);
  animation: pano-pulse 2.4s var(--ease-out) infinite;
}
.pano__hot:hover .pano__hot-dot {
  background: radial-gradient(circle at 35% 30%, var(--color-accent-300), var(--color-accent-500));
  box-shadow: 0 0 0 6px rgba(232, 184, 75, 0.22), 0 6px 18px rgba(0, 0, 0, 0.5);
}
.pano__hot-label {
  padding: 2px 9px;
  border-radius: var(--radius-pill);
  font-size: 11.5px;
  white-space: nowrap;
  color: var(--color-text-primary);
  background: rgba(10, 18, 32, 0.78);
  border: 1px solid var(--color-line-strong);
  backdrop-filter: blur(4px);
}
@keyframes pano-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 4px rgba(62, 198, 184, 0.18), 0 6px 16px rgba(0, 0, 0, 0.45);
  }
  50% {
    box-shadow: 0 0 0 9px rgba(62, 198, 184, 0.04), 0 6px 16px rgba(0, 0, 0, 0.45);
  }
}

.pano__hud {
  position: absolute;
  right: 12px;
  bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 3;
}
.pano__hudbtn {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  font-size: 15px;
  line-height: 1;
  color: var(--color-text-primary);
  background: rgba(16, 28, 48, 0.82);
  border: 1px solid var(--color-line-strong);
  border-radius: var(--radius-md);
  cursor: pointer;
  backdrop-filter: blur(6px);
  transition: all var(--dur-fast) var(--ease-out);
}
.pano__hudbtn:hover {
  border-color: var(--color-brand-500);
  color: var(--color-brand-300);
}
.pano__hudbtn.is-on {
  color: var(--color-bg-base);
  background: var(--color-brand-500);
  border-color: var(--color-brand-500);
}

.pano__tip {
  position: absolute;
  left: 12px;
  bottom: 12px;
  padding: 5px 11px;
  font-size: 11.5px;
  color: var(--color-text-secondary);
  background: rgba(10, 18, 32, 0.72);
  border: 1px solid var(--color-line-soft);
  border-radius: var(--radius-pill);
  pointer-events: none;
}

.pano__mask {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: linear-gradient(180deg, rgba(10, 18, 32, 0.72), rgba(10, 18, 32, 0.92));
}
.pano__masktxt {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-secondary);
}
.pano__pct {
  margin-left: 6px;
  font-family: var(--font-mono);
  color: var(--color-brand-300);
}
</style>
