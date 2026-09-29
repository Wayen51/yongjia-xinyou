<template>
  <div ref="hostRef" class="mv">
    <canvas ref="canvasRef" class="mv__canvas"></canvas>

    <!-- 控件 -->
    <div v-if="state === 'ready'" class="mv__hud">
      <button class="mv__hudbtn" type="button" title="重置视角" @click="resetView">⟲</button>
      <button
        class="mv__hudbtn"
        type="button"
        :class="{ 'is-on': autoRotateOn }"
        title="自动环绕"
        @click="toggleAutoRotate"
      >
        ✧
      </button>
      <button
        class="mv__hudbtn"
        type="button"
        :class="{ 'is-on': wireframeOn }"
        title="线框模式"
        @click="toggleWireframe"
      >
        ◫
      </button>
      <button class="mv__hudbtn" type="button" title="全屏" @click="toggleFullscreen">
        {{ isFullscreen ? "⤡" : "⤢" }}
      </button>
    </div>

    <div v-if="state === 'ready'" class="mv__tip">
      单指/鼠标拖拽旋转 · 滚轮缩放 · 双指平移
    </div>

    <div v-if="state === 'ready' && textureMissing" class="mv__notice">
      外部贴图未能加载，当前以纯色材质呈现
    </div>

    <!-- 加载 -->
    <div v-if="state === 'loading'" class="mv__mask">
      <div class="mv__ring">
        <svg viewBox="0 0 44 44" class="mv__ring-svg">
          <circle cx="22" cy="22" r="19" class="mv__ring-bg" />
          <circle
            cx="22"
            cy="22"
            r="19"
            class="mv__ring-fg"
            :style="{ strokeDashoffset: 119.4 - (119.4 * progress) / 100 }"
          />
        </svg>
        <span class="mv__ring-pct">{{ progress }}%</span>
      </div>
      <p class="mv__masktxt">实景模型加载中</p>
      <p class="mv__masksub">{{ lodLabel }} · 首次加载后浏览器会缓存</p>
    </div>

    <!-- 失败 / 不支持 -->
    <div v-else-if="state === 'error'" class="mv__mask">
      <p class="mv__masktxt">{{ fallbackText }}</p>
      <button class="yj-btn yj-btn--primary" type="button" @click="reload">重新加载</button>
      <img v-if="posterUrl" :src="posterUrl" class="mv__poster" alt="模型占位图" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

interface ViewerConfig {
  model?: {
    name?: string;
    source_triangles?: number;
    texture?: { embedded?: boolean; external_uri?: string };
  };
  lod?: {
    desktop?: { file: string; size_mb?: number };
    mobile?: { file: string; size_mb?: number };
  };
  viewer?: {
    default_camera?: { position?: number[]; target?: number[]; fov?: number };
    controls?: {
      auto_rotate?: boolean;
      auto_rotate_speed?: number;
      min_distance?: number;
      max_distance?: number;
      max_polar_angle?: number;
    };
    lighting?: { environment_map?: string };
    background?: { color?: string; show_ground?: boolean; ground_color?: string };
  };
}

const props = withDefaults(
  defineProps<{
    configUrl?: string;
    modelUrl?: string;
    posterUrl?: string;
    autoRotate?: boolean;
    showGround?: boolean;
  }>(),
  {
    configUrl: "/assets/3d/red-buildings-config.json",
    modelUrl: "",
    posterUrl: "/assets/3d/shiwei-poster.webp",
    autoRotate: true,
    showGround: true,
  }
);

const emit = defineEmits<{
  (e: "loaded", info: { triangles: number; source: string }): void;
  (e: "error"): void;
}>();

const hostRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const state = ref<"loading" | "ready" | "error">("loading");
const progress = ref(0);
const autoRotateOn = ref(props.autoRotate);
const wireframeOn = ref(false);
const isFullscreen = ref(false);
const textureMissing = ref(false);
const lodLabel = ref("实景模型");
const fallbackText = ref("模型加载失败");

const FALLBACK_COLOR = 0xbfa08c;

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let controls: OrbitControls | null = null;
let modelRoot: THREE.Group | null = null;
let ground: THREE.Mesh | null = null;
let envTexture: THREE.Texture | null = null;
/** GLB 未内嵌贴图时，从同目录挂载的外部漫反射贴图 */
let externalTexture: THREE.Texture | null = null;
/** 等待外部贴图注入的材质列表 */
let externalMapTargets: THREE.MeshStandardMaterial[] = [];
/** 地面渐隐蒙版，同时复用为接触阴影的 alpha */
let groundFade: THREE.Texture | null = null;
let contactShadow: THREE.Mesh | null = null;
let raf = 0;
let resizeObserver: ResizeObserver | null = null;
let disposed = false;
let initialCam = { position: [0, 5, 15], target: [0, 2, 0], fov: 50 };
let currentModelUrl = "";
let lastCfg: ViewerConfig = {};

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
  return window.innerWidth < 1024 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/* ---------------- 初始化 ---------------- */
async function init() {
  const host = hostRef.value;
  const canvas = canvasRef.value;
  if (!host || !canvas) return;

  if (!detectWebGL()) {
    state.value = "error";
    fallbackText.value = "当前浏览器不支持 WebGL";
    emit("error");
    return;
  }

  let cfg: ViewerConfig = {};
  try {
    cfg = await fetch(props.configUrl).then((r) => r.json());
  } catch {
    /* 配置缺失时走默认值 */
  }
  if (disposed) return;

  let webgl: THREE.WebGLRenderer;
  try {
    webgl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch {
    state.value = "error";
    emit("error");
    return;
  }
  renderer = webgl;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, Math.max(1, host.clientHeight), false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearAlpha(0);

  scene = new THREE.Scene();
  // 背景交给容器 CSS 渐变：画布保持透明，得到柔和中心高光，而不是一块死黑
  scene.background = null;

  const camCfg = cfg.viewer?.default_camera;
  initialCam = {
    position: camCfg?.position ?? [0, 5, 15],
    target: camCfg?.target ?? [0, 2, 0],
    fov: camCfg?.fov ?? 50,
  };

  camera = new THREE.PerspectiveCamera(
    initialCam.fov,
    host.clientWidth / Math.max(1, host.clientHeight),
    0.1,
    4000
  );
  camera.position.set(...(initialCam.position as [number, number, number]));

  // 环境光照：优先使用项目交付的等距柱状环境贴图
  const envUrl = cfg.viewer?.lighting?.environment_map;
  if (envUrl) {
    try {
      envTexture = await new THREE.TextureLoader().loadAsync(envUrl);
      envTexture.mapping = THREE.EquirectangularReflectionMapping;
      envTexture.colorSpace = THREE.SRGBColorSpace;
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envRT = pmrem.fromEquirectangular(envTexture);
      scene.environment = envRT.texture;
      pmrem.dispose();
    } catch {
      scene.environment = null;
    }
  }
  if (disposed) return;

  // 补光：柔和半球光，保证无环境贴图时模型也能看清
  const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x1a2a3a, 1.35);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 1.6);
  dir.position.set(18, 30, 22);
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0x8fb8ff, 0.5);
  fill.position.set(-22, 14, -16);
  scene.add(fill);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  controls.autoRotate = autoRotateOn.value;
  controls.autoRotateSpeed = cfg.viewer?.controls?.auto_rotate_speed ?? 1.0;
  controls.minDistance = cfg.viewer?.controls?.min_distance ?? 3;
  controls.maxDistance = cfg.viewer?.controls?.max_distance ?? 200;
  controls.maxPolarAngle = cfg.viewer?.controls?.max_polar_angle ?? Math.PI / 2 + 0.08;
  controls.target.set(...(initialCam.target as [number, number, number]));

  resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(host);

  document.addEventListener("fullscreenchange", onFullscreenChange);

  // LOD 选择
  const small = isSmallScreen();
  const modelUrl = props.modelUrl || (small ? cfg.lod?.mobile?.file : cfg.lod?.desktop?.file) || "";
  const sizeMb = small ? cfg.lod?.mobile?.size_mb : cfg.lod?.desktop?.size_mb;
  lodLabel.value = `${small ? "移动端精简版" : "桌面端高清版"}${sizeMb ? ` · ${sizeMb} MB` : ""}`;

  if (!modelUrl) {
    state.value = "error";
    emit("error");
    return;
  }

  currentModelUrl = modelUrl;
  lastCfg = cfg;
  loadModel(modelUrl, cfg);
  animate();
}

/* ---------------- 模型加载 ---------------- */
function loadModel(url: string, cfg: ViewerConfig) {
  state.value = "loading";
  progress.value = 0;
  const loader = new GLTFLoader();

  loader.load(
    url,
    (gltf) => {
      if (disposed || !scene) return;
      const tris = buildModel(gltf.scene, cfg);
      state.value = "ready";
      emit("loaded", { triangles: tris, source: url });
      // 贴图补齐是锦上添花：先让模型可交互，外观再异步补上
      void attachExternalTexture(cfg, url);
    },
    (evt) => {
      if (evt.total > 0) {
        progress.value = clamp(Math.round((evt.loaded / evt.total) * 100), 0, 100);
      } else if (evt.loaded > 0) {
        // 服务端未返回 Content-Length 时用渐进值示意
        progress.value = Math.min(96, progress.value + 1);
      }
    },
    () => {
      if (disposed) return;
      state.value = "error";
      fallbackText.value = "实景模型加载失败";
      emit("error");
    }
  );
}

function buildModel(inner: THREE.Object3D, cfg: ViewerConfig): number {
  if (!scene || !camera || !controls) return 0;

  modelRoot = new THREE.Group();
  modelRoot.add(inner);
  scene.add(modelRoot);

  // RealityScan 等摄影测量工具常导出 Z 轴向上；若模型在 Y 轴上明显扁平则转正
  const rawBox = new THREE.Box3().setFromObject(inner);
  const rawSize = rawBox.getSize(new THREE.Vector3());
  const flat = rawSize.y < Math.max(rawSize.x, rawSize.z) * 0.5;
  if (flat) inner.rotation.x = -Math.PI / 2;

  // 材质兜底：先铺纯色避免纯白/全黑，同时记下缺图材质，稍后用外部贴图补齐
  externalMapTargets = [];
  let tris = 0;
  inner.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry;
    if (geo) tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const mat = m as THREE.MeshStandardMaterial;
      if (!mat) continue;
      if (!mat.map) {
        externalMapTargets.push(mat);
        mat.color = new THREE.Color(FALLBACK_COLOR);
        mat.roughness = Math.max(0.6, mat.roughness ?? 0.8);
        mat.metalness = Math.min(0.08, mat.metalness ?? 0);
      }
      mat.side = THREE.FrontSide;
      mat.needsUpdate = true;
    }
  });
  textureMissing.value = false;

  // 居中并贴地
  const box = new THREE.Box3().setFromObject(modelRoot);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  modelRoot.position.x -= center.x;
  modelRoot.position.z -= center.z;
  modelRoot.position.y -= box.min.y;

  const radius = Math.max(size.x, size.z, size.y * 1.4) * 0.5;
  const target = new THREE.Vector3(0, size.y * 0.42, 0);

  // 相机适配：保证模型完整入画
  const fovRad = THREE.MathUtils.degToRad(camera.fov);
  const aspect = Math.max(0.6, camera.aspect);
  const distV = radius / Math.tan(fovRad / 2);
  const distH = radius / (Math.tan(fovRad / 2) * aspect);
  const dist = Math.max(distV, distH) * 1.28;

  const dirVec = new THREE.Vector3(0.62, 0.42, 0.72).normalize();
  camera.position.copy(target).addScaledVector(dirVec, dist);
  camera.near = Math.max(0.05, dist / 400);
  camera.far = dist * 20;
  camera.updateProjectionMatrix();

  controls.target.copy(target);
  controls.minDistance = Math.max(1, radius * 0.35);
  controls.maxDistance = dist * 3.2;
  controls.update();

  // 地面 + 接触阴影：用径向渐隐做 alpha 蒙版，消除生硬的地面圆边，并让模型「坐」在地上
  if (props.showGround && cfg.viewer?.background?.show_ground !== false) {
    const groundColor = new THREE.Color(cfg.viewer?.background?.ground_color ?? "#16263f");
    groundFade = makeRadialFadeTexture();
    const geo = new THREE.CircleGeometry(radius * 3.6, 72);
    const mat = new THREE.MeshStandardMaterial({
      color: groundColor,
      roughness: 0.95,
      metalness: 0,
      alphaMap: groundFade,
      transparent: true,
      depthWrite: false,
    });
    ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.012;
    ground.renderOrder = 0;
    scene.add(ground);

    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x05090f,
      alphaMap: groundFade,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    });
    contactShadow = new THREE.Mesh(new THREE.CircleGeometry(radius * 1.7, 64), shadowMat);
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.y = 0.004;
    contactShadow.renderOrder = 1;
    scene.add(contactShadow);
  }

  return Math.round(tris);
}

/* ---------------- 贴图补齐 ---------------- */

/** 径向渐隐蒙版：地面渐隐与接触阴影共用同一张 alpha 图 */
function makeRadialFadeTexture(): THREE.Texture {
  const size = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.55, "rgba(255,255,255,0.42)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(cv);
}

/**
 * GLB 未内嵌贴图（config 记 embedded:false），但同目录交付了外部漫反射图。
 * 这里按 GLB 所在目录解析相对路径并挂到缺图材质上；失败则保留纯色兜底并提示。
 */
async function attachExternalTexture(cfg: ViewerConfig, modelUrl: string) {
  const uri = cfg.model?.texture?.external_uri;
  const targets = externalMapTargets;
  if (!uri || !targets.length) return;

  const base = modelUrl.slice(0, modelUrl.lastIndexOf("/") + 1);
  const url = /^(https?:)?\/\//.test(uri) || uri.startsWith("/") ? uri : base + uri;

  try {
    const tex = await new THREE.TextureLoader().loadAsync(url);
    if (disposed) {
      tex.dispose();
      return;
    }
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = renderer?.capabilities.getMaxAnisotropy() ?? 1;
    externalTexture?.dispose();
    externalTexture = tex;
    for (const mat of targets) {
      if (mat.map) continue;
      mat.map = tex;
      // 贴图接管颜色，清掉兜底色避免二次染色
      mat.color.set(0xffffff);
      mat.roughness = 0.86;
      mat.metalness = 0.02;
      mat.needsUpdate = true;
    }
    textureMissing.value = false;
  } catch {
    textureMissing.value = true;
  }
  externalMapTargets = [];
}

function reload() {
  if (!scene || !currentModelUrl) return;
  teardownModel();
  loadModel(currentModelUrl, lastCfg);
}

/* ---------------- 交互 ---------------- */
function resetView() {
  if (!camera || !controls) return;
  const target = controls.target.clone();
  const dirVec = new THREE.Vector3(0.62, 0.42, 0.72).normalize();
  const dist = camera.position.distanceTo(target);
  camera.position.copy(target).addScaledVector(dirVec, dist);
  controls.update();
}

function toggleAutoRotate() {
  autoRotateOn.value = !autoRotateOn.value;
  if (controls) controls.autoRotate = autoRotateOn.value;
}

function toggleWireframe() {
  wireframeOn.value = !wireframeOn.value;
  modelRoot?.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const mat = m as THREE.MeshStandardMaterial;
      if (mat) {
        mat.wireframe = wireframeOn.value;
        mat.needsUpdate = true;
      }
    }
  });
}

function toggleFullscreen() {
  const host = hostRef.value;
  if (!host) return;
  if (document.fullscreenElement) void document.exitFullscreen();
  else void host.requestFullscreen?.();
}

function onFullscreenChange() {
  isFullscreen.value = document.fullscreenElement === hostRef.value;
  setTimeout(resize, 60);
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

function animate() {
  raf = requestAnimationFrame(animate);
  if (!renderer || !scene || !camera || disposed) return;
  controls?.update();
  renderer.render(scene, camera);
}

/* ---------------- 清理 ---------------- */
function teardownModel() {
  if (!scene) return;
  if (modelRoot) {
    scene.remove(modelRoot);
    modelRoot.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const mat = m as THREE.MeshStandardMaterial;
        if (!mat) continue;
        for (const value of Object.values(mat)) {
          const tex = value as THREE.Texture;
          if (tex && (tex as THREE.Texture).isTexture) tex.dispose();
        }
        mat.dispose();
      }
    });
    modelRoot = null;
  }
  if (ground) {
    scene.remove(ground);
    ground.geometry.dispose();
    (ground.material as THREE.Material).dispose();
    ground = null;
  }
  if (contactShadow) {
    scene.remove(contactShadow);
    contactShadow.geometry.dispose();
    (contactShadow.material as THREE.Material).dispose();
    contactShadow = null;
  }
  groundFade?.dispose();
  groundFade = null;
  externalTexture?.dispose();
  externalTexture = null;
  externalMapTargets = [];
  textureMissing.value = false;
}

function cleanupScene() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  document.removeEventListener("fullscreenchange", onFullscreenChange);
  controls?.dispose();
  controls = null;
  envTexture?.dispose();
  envTexture = null;
}

onMounted(() => {
  void init();
});

onBeforeUnmount(() => {
  disposed = true;
  cancelAnimationFrame(raf);
  teardownModel();
  cleanupScene();
  camera = null;
  scene = null;
  renderer?.dispose();
  renderer = null;
});

defineExpose({ resetView, toggleAutoRotate, toggleWireframe, toggleFullscreen });
</script>

<style scoped>
.mv {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  background: radial-gradient(120% 90% at 50% 12%, #14243d 0%, #0a1220 68%);
  overflow: hidden;
  border-radius: var(--radius-lg);
}
.mv__canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}

.mv__hud {
  position: absolute;
  right: 12px;
  bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 3;
}
.mv__hudbtn {
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
.mv__hudbtn:hover {
  border-color: var(--color-brand-500);
  color: var(--color-brand-300);
}
.mv__hudbtn.is-on {
  color: var(--color-bg-base);
  background: var(--color-brand-500);
  border-color: var(--color-brand-500);
}

.mv__tip,
.mv__notice {
  position: absolute;
  left: 12px;
  bottom: 12px;
  padding: 5px 11px;
  font-size: 11.5px;
  border-radius: var(--radius-pill);
  pointer-events: none;
}
.mv__tip {
  color: var(--color-text-secondary);
  background: rgba(10, 18, 32, 0.72);
  border: 1px solid var(--color-line-soft);
}
.mv__notice {
  left: auto;
  right: 12px;
  top: 12px;
  bottom: auto;
  color: var(--color-accent-300);
  background: var(--accent-soft);
  border: 1px solid rgba(232, 184, 75, 0.4);
}

.mv__mask {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  background: linear-gradient(180deg, rgba(10, 18, 32, 0.86), rgba(10, 18, 32, 0.96));
}
.mv__ring {
  position: relative;
  width: 48px;
  height: 48px;
}
.mv__ring-svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}
.mv__ring-bg,
.mv__ring-fg {
  fill: none;
  stroke-width: 3;
}
.mv__ring-bg {
  stroke: var(--color-line-strong);
}
.mv__ring-fg {
  stroke: var(--color-brand-500);
  stroke-linecap: round;
  stroke-dasharray: 119.4;
  transition: stroke-dashoffset var(--dur-fast) linear;
}
.mv__ring-pct {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--color-brand-300);
}
.mv__masktxt {
  margin: 0;
  font-size: 14px;
  color: var(--color-text-primary);
}
.mv__masksub {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-tertiary);
}
.mv__poster {
  margin-top: 8px;
  max-width: min(420px, 80%);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-line-soft);
  opacity: 0.85;
}
</style>
