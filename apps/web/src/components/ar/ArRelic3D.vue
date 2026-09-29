<script setup lang="ts">
/**
 * 板块二 · AR 互动：围栏内「虚拟信物」3D 互动舞台
 *
 * 把原先的一张 2D 贴图（billboard_url）升级为可交互的实时 3D 信物：
 * - 程序化建模（灯笼 / 莲花灯 / 卷轴 / 宝箱 / 礼盒 / 福袋 / 券 / 灵珠），按站点 billboard 自动切换，无需额外 3D 资产
 * - 单指拖动旋转 · 双指捏合 / 滚轮缩放 · 点击收集（粒子迸发）
 * - 进场浮现动画 + 悬浮光环 + 环绕粒子
 * - WebGL 不可用或初始化失败时自动降级为原贴图，保证演示不白屏
 *
 * 演示口径：定位来自浏览器模拟、奖励为 mock 券；此处 3D 为呈现层增强，不做真实空间锚定。
 */
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as THREE from "three";

const props = withDefaults(
  defineProps<{
    /** 信物键：站点数据 billboard 字段，如 "billboard-lantern.webp" */
    relic?: string;
    /** 降级贴图：billboard_url */
    fallbackUrl?: string;
    /** 点位名，用于无贴图时的 alt */
    label?: string;
    /** 是否已收集（答对/打卡后置灰、停粒子） */
    collected?: boolean;
  }>(),
  { relic: "", fallbackUrl: "", label: "", collected: false }
);

const emit = defineEmits<{ (e: "collect"): void }>();

const hostRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const state = ref<"loading" | "ready" | "error">("loading");

/* ---------------- Three.js 句柄 ---------------- */
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let relicRoot: THREE.Group | null = null;
let halo: THREE.Mesh | null = null;
let halo2: THREE.Mesh | null = null;
let dust: THREE.Points | null = null;
let dustGeo: THREE.BufferGeometry | null = null;
let dustMat: THREE.PointsMaterial | null = null;
let pedestal: THREE.Mesh | null = null;
let glowDisc: THREE.Mesh | null = null;
let dustTex: THREE.Texture | null = null;
let glowTex: THREE.Texture | null = null;
let burstPoints: THREE.Points | null = null;
let burstGeo: THREE.BufferGeometry | null = null;
let burstMat: THREE.PointsMaterial | null = null;
let burstT = -1;
let raf = 0;
let resizeObserver: ResizeObserver | null = null;
let disposed = false;
let clock: THREE.Clock | null = null;

const BASE_SCALE = 1.14;
let appearT = 0;
let camDist = 3.35;
let camTargetDist = 3.35;

/* ---------------- 交互状态 ---------------- */
let dragging = false;
let lastPointX = 0;
let lastPointY = 0;
let spinVX = 0;
let tiltVY = 0;
let downAt = 0;
let downX = 0;
let downY = 0;
let movedPx = 0;
const pointers = new Map<number, { x: number; y: number }>();
let pinchBase = 0;
let pinchDist = 0;

/* ---------------- 材质 ---------------- */
function gold() {
  return new THREE.MeshStandardMaterial({
    color: 0xe8b84b,
    metalness: 0.9,
    roughness: 0.26,
    emissive: 0x6b4a10,
    emissiveIntensity: 0.5,
  });
}
function jade() {
  return new THREE.MeshStandardMaterial({
    color: 0x3ec6b8,
    metalness: 0.25,
    roughness: 0.28,
    emissive: 0x15847a,
    emissiveIntensity: 0.6,
  });
}
function paper() {
  return new THREE.MeshStandardMaterial({ color: 0xf1e2c2, metalness: 0.02, roughness: 0.9 });
}
function lacquer(color = 0xd94f33) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.22,
    roughness: 0.52,
    emissive: color,
    emissiveIntensity: 0.22,
  });
}
function coreGlow() {
  return new THREE.MeshStandardMaterial({
    color: 0xfff0c0,
    emissive: 0xffb838,
    emissiveIntensity: 1.35,
    roughness: 0.35,
    metalness: 0.1,
  });
}

/* ---------------- 程序化信物建模 ---------------- */
function buildLantern(): THREE.Group {
  const g = new THREE.Group();
  const gld = gold();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.54, 32, 24), lacquer(0xd94f33));
  body.scale.set(1, 0.84, 1);
  g.add(body);
  const ribGeo = new THREE.TorusGeometry(0.54, 0.012, 8, 48);
  for (let i = 0; i < 6; i++) {
    const rib = new THREE.Mesh(ribGeo, gld);
    rib.rotation.y = (i / 6) * Math.PI;
    rib.scale.set(1, 0.84, 1);
    g.add(rib);
  }
  const rimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.08, 24);
  const top = new THREE.Mesh(rimGeo, gld);
  top.position.y = 0.47;
  g.add(top);
  const bot = new THREE.Mesh(rimGeo, gld);
  bot.position.y = -0.47;
  g.add(bot);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8), gld);
  cord.position.y = -0.66;
  g.add(cord);
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), gld);
  knot.position.y = -0.84;
  g.add(knot);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 16), coreGlow());
  g.add(core);
  return g;
}

function buildLotus(): THREE.Group {
  const g = new THREE.Group();
  const jd = jade();
  const petal = new THREE.SphereGeometry(0.24, 16, 12);
  for (let i = 0; i < 10; i++) {
    const p = new THREE.Mesh(petal, jd);
    const a = (i / 10) * Math.PI * 2;
    p.scale.set(0.68, 1.45, 0.24);
    p.position.set(Math.cos(a) * 0.3, 0.02, Math.sin(a) * 0.3);
    p.rotation.y = -a;
    p.rotation.x = -0.42;
    g.add(p);
  }
  for (let i = 0; i < 6; i++) {
    const p = new THREE.Mesh(petal, jd);
    const a = (i / 6) * Math.PI * 2 + 0.3;
    p.scale.set(0.52, 1.0, 0.2);
    p.position.set(Math.cos(a) * 0.16, 0.2, Math.sin(a) * 0.16);
    p.rotation.y = -a;
    p.rotation.x = -0.35;
    g.add(p);
  }
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.14, 18, 14), coreGlow());
  core.position.y = 0.3;
  g.add(core);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 12), coreGlow());
  flame.position.y = 0.5;
  g.add(flame);
  return g;
}

function buildScroll(): THREE.Group {
  const g = new THREE.Group();
  const gld = gold();
  const pp = paper();
  const rollGeo = new THREE.CylinderGeometry(0.1, 0.1, 1.02, 20);
  for (const x of [-0.5, 0.5]) {
    const roll = new THREE.Mesh(rollGeo, pp);
    roll.position.x = x;
    g.add(roll);
  }
  const capGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.09, 20);
  for (const x of [-0.5, 0.5]) {
    for (const y of [-0.51, 0.51]) {
      const cap = new THREE.Mesh(capGeo, gld);
      cap.position.set(x, y, 0);
      g.add(cap);
    }
  }
  const sheet = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.74, 0.04), pp);
  g.add(sheet);
  const seal = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.19, 0.05), lacquer(0xc0392b));
  seal.position.set(0.2, -0.2, 0.05);
  g.add(seal);
  const line = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.02), paper());
  line.position.set(-0.12, 0.12, 0.05);
  g.add(line);
  return g;
}

function buildTreasure(): THREE.Group {
  const g = new THREE.Group();
  const gld = gold();
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a4a24, metalness: 0.06, roughness: 0.74 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 0.72), wood);
  base.position.y = -0.06;
  g.add(base);
  const lid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.36, 0.36, 1.0, 26, 1, false, 0, Math.PI),
    wood
  );
  lid.rotation.z = Math.PI / 2;
  lid.position.y = 0.19;
  g.add(lid);
  for (const x of [-0.34, 0.34]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.52, 0.74), gld);
    band.position.set(x, -0.06, 0);
    g.add(band);
  }
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.1), gld);
  lock.position.set(0, -0.02, 0.37);
  g.add(lock);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.19, 18, 14), coreGlow());
  glow.position.set(0, 0.16, 0);
  g.add(glow);
  return g;
}

function buildGift(): THREE.Group {
  const g = new THREE.Group();
  const gld = gold();
  const blue = new THREE.MeshStandardMaterial({
    color: 0x2f6fd0,
    metalness: 0.2,
    roughness: 0.5,
    emissive: 0x123a78,
    emissiveIntensity: 0.35,
  });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), blue);
  g.add(box);
  const ribA = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.86, 0.13), gld);
  g.add(ribA);
  const ribB = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.86, 0.86), gld);
  g.add(ribB);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.13, 0.9), blue);
  lid.position.y = 0.45;
  g.add(lid);
  const bowGeo = new THREE.TorusGeometry(0.16, 0.05, 10, 24);
  const b1 = new THREE.Mesh(bowGeo, gld);
  b1.position.set(-0.17, 0.58, 0);
  b1.rotation.z = 0.5;
  g.add(b1);
  const b2 = new THREE.Mesh(bowGeo, gld);
  b2.position.set(0.17, 0.58, 0);
  b2.rotation.z = -0.5;
  g.add(b2);
  return g;
}

function buildFuBag(): THREE.Group {
  const g = new THREE.Group();
  const gld = gold();
  const bag = new THREE.Mesh(new THREE.SphereGeometry(0.5, 28, 20), lacquer(0xc0392b));
  bag.scale.set(1, 0.96, 1);
  g.add(bag);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 0.22, 20), lacquer(0xb0332b));
  neck.position.y = 0.48;
  g.add(neck);
  const tie = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 10, 24), gld);
  tie.position.y = 0.57;
  tie.rotation.x = Math.PI / 2;
  g.add(tie);
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.095, 16, 12), gld);
  knot.position.y = 0.68;
  g.add(knot);
  const fu = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.27, 0.03), gld);
  fu.position.set(0, 0.02, 0.49);
  g.add(fu);
  return g;
}

function buildCoupon(): THREE.Group {
  const g = new THREE.Group();
  const gld = gold();
  const card = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.7, 0.05), paper());
  g.add(card);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.82, 0.02), gld);
  frame.position.z = -0.045;
  g.add(frame);
  const dotGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.09, 10);
  for (let i = 0; i < 7; i++) {
    const dot = new THREE.Mesh(dotGeo, gld);
    dot.rotation.x = Math.PI / 2;
    dot.position.set(0.38, -0.3 + i * 0.1, 0.02);
    g.add(dot);
  }
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.17), jade());
  gem.position.set(-0.33, 0, 0.09);
  g.add(gem);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.035, 0.02), gld);
  bar.position.set(0.14, 0.14, 0.04);
  g.add(bar);
  const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.035, 0.02), gld);
  bar2.position.set(0.08, -0.04, 0.04);
  g.add(bar2);
  return g;
}

function buildSprite(): THREE.Group {
  const g = new THREE.Group();
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 28, 20), coreGlow());
  g.add(orb);
  const r1 = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.02, 10, 48), jade());
  r1.rotation.x = Math.PI / 2.4;
  r1.name = "spin-fast";
  g.add(r1);
  const r2 = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.016, 10, 48), gold());
  r2.rotation.x = -Math.PI / 3;
  r2.rotation.z = 0.4;
  r2.name = "spin-slow";
  g.add(r2);
  const wingMat = new THREE.MeshStandardMaterial({
    color: 0x3ec6b8,
    metalness: 0.2,
    roughness: 0.3,
    emissive: 0x1a7a6e,
    emissiveIntensity: 0.85,
    transparent: true,
    opacity: 0.82,
  });
  const wingGeo = new THREE.SphereGeometry(0.16, 14, 10);
  const w1 = new THREE.Mesh(wingGeo, wingMat);
  w1.scale.set(1.7, 0.7, 0.4);
  w1.position.set(-0.5, 0.08, 0);
  g.add(w1);
  const w2 = new THREE.Mesh(wingGeo, wingMat);
  w2.scale.set(1.7, 0.7, 0.4);
  w2.position.set(0.5, 0.08, 0);
  g.add(w2);
  return g;
}

function buildOrb(): THREE.Group {
  const g = new THREE.Group();
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), jade());
  g.add(orb);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.022, 10, 48), gold());
  ring.rotation.x = Math.PI / 2;
  ring.name = "spin-fast";
  g.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.014, 10, 48), gold());
  ring2.rotation.x = Math.PI / 3;
  ring2.name = "spin-slow";
  g.add(ring2);
  return g;
}

const BUILDERS: Record<string, () => THREE.Group> = {
  "billboard-lantern": buildLantern,
  "billboard-lotus-lamp": buildLotus,
  "billboard-scroll": buildScroll,
  "billboard-treasure": buildTreasure,
  "billboard-gift-box": buildGift,
  "billboard-fu-bag": buildFuBag,
  "billboard-coupon": buildCoupon,
  "billboard-nannan-sprite": buildSprite,
};

function relicKey(file?: string): string {
  const base = (file || "").split("/").pop() || "";
  return base.replace(/\.(webp|png|jpe?g)$/i, "");
}

function makeRelic(): THREE.Group {
  const builder = BUILDERS[relicKey(props.relic)] ?? buildOrb;
  const g = builder();
  g.name = "relic";
  return g;
}

/* ---------------- 贴图 ---------------- */
function dotTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.34, "rgba(255,236,180,0.82)");
  grd.addColorStop(1, "rgba(255,236,180,0)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  const grd = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, "rgba(90,224,206,0.55)");
  grd.addColorStop(0.42, "rgba(62,198,184,0.22)");
  grd.addColorStop(1, "rgba(62,198,184,0)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------------- 场景 ---------------- */
function detectWebGL(): boolean {
  try {
    const t = document.createElement("canvas");
    return !!(t.getContext("webgl2") || t.getContext("webgl"));
  } catch {
    return false;
  }
}

function buildScene() {
  const host = hostRef.value;
  if (!host || !scene) return;

  dustTex = dotTexture();
  glowTex = glowTexture();

  // 基座光环
  halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.88, 0.018, 10, 72),
    new THREE.MeshBasicMaterial({ color: 0xe8b84b, transparent: true, opacity: 0.85 })
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = -0.82;
  scene.add(halo);

  halo2 = new THREE.Mesh(
    new THREE.TorusGeometry(1.14, 0.008, 10, 72),
    new THREE.MeshBasicMaterial({ color: 0x3ec6b8, transparent: true, opacity: 0.55 })
  );
  halo2.rotation.x = Math.PI / 2;
  halo2.position.y = -0.84;
  scene.add(halo2);

  pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(1.34, 1.46, 0.06, 64, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x0a1220, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
  );
  pedestal.position.y = -0.85;
  scene.add(pedestal);

  glowDisc = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 3.4),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false })
  );
  glowDisc.rotation.x = -Math.PI / 2;
  glowDisc.position.y = -0.86;
  scene.add(glowDisc);

  // 环绕尘埃
  const count = 70;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.9 + Math.random() * 0.75;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = -0.6 + Math.random() * 1.7;
    pos[i * 3 + 2] = Math.sin(a) * r;
  }
  dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  dustMat = new THREE.PointsMaterial({
    size: 0.075,
    map: dustTex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.9,
  });
  dust = new THREE.Points(dustGeo, dustMat);
  dust.name = "dust";
  scene.add(dust);

  relicRoot = new THREE.Group();
  relicRoot.scale.setScalar(0.001);
  relicRoot.add(makeRelic());
  relicRoot.position.y = -0.1;
  scene.add(relicRoot);

  void host;
}

function disposeMaterial(mat: THREE.Material | THREE.Material[]) {
  const list = Array.isArray(mat) ? mat : [mat];
  for (const m of list) {
    for (const v of Object.values(m as unknown as Record<string, unknown>)) {
      const tex = v as THREE.Texture;
      if (tex && (tex as THREE.Texture).isTexture) tex.dispose();
    }
    m.dispose();
  }
}

function disposeGroup(root: THREE.Object3D | null) {
  if (!root) return;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    if (mesh.material) disposeMaterial(mesh.material);
  });
}

function replaceRelic() {
  if (!scene || !relicRoot) return;
  const old = relicRoot.getObjectByName("relic");
  if (old) {
    relicRoot.remove(old);
    disposeGroup(old);
  }
  relicRoot.add(makeRelic());
  appearT = 0;
  relicRoot.rotation.set(0, 0, 0);
  spinVX = 0;
  tiltVY = 0;
}

/* ---------------- 初始化 ---------------- */
function init() {
  const host = hostRef.value;
  const canvas = canvasRef.value;
  if (!host || !canvas) return;

  if (!detectWebGL()) {
    state.value = "error";
    return;
  }

  let webgl: THREE.WebGLRenderer;
  try {
    webgl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch {
    state.value = "error";
    return;
  }
  renderer = webgl;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, Math.max(1, host.clientHeight), false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, host.clientWidth / Math.max(1, host.clientHeight), 0.1, 60);
  camera.position.set(0, 0.75, camDist);
  camera.lookAt(0, 0.15, 0);

  scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x101c30, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(2.4, 4, 3.2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x8fd8ff, 0.8);
  fill.position.set(-3, 1.6, -2.4);
  scene.add(fill);
  const rim = new THREE.PointLight(0xe8b84b, 2.4, 8, 2);
  rim.position.set(0, 0.2, 1.6);
  scene.add(rim);

  buildScene();

  resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(host);

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  clock = new THREE.Clock();
  state.value = "ready";
  resize();
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

/* ---------------- 交互 ---------------- */
function onPointerDown(e: PointerEvent) {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    dragging = true;
    lastPointX = e.clientX;
    lastPointY = e.clientY;
    downAt = performance.now();
    downX = e.clientX;
    downY = e.clientY;
    movedPx = 0;
    spinVX = 0;
  } else if (pointers.size === 2) {
    dragging = false;
    const [a, b] = [...pointers.values()];
    pinchBase = Math.hypot(a.x - b.x, a.y - b.y);
    pinchDist = camTargetDist;
  }
  canvasRef.value?.setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2 && pinchBase > 0) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    camTargetDist = Math.min(5.4, Math.max(2.2, pinchDist * (pinchBase / Math.max(1, d))));
    return;
  }
  if (!dragging || !relicRoot) return;

  const dx = e.clientX - lastPointX;
  const dy = e.clientY - lastPointY;
  lastPointX = e.clientX;
  lastPointY = e.clientY;
  movedPx += Math.abs(dx) + Math.abs(dy);

  spinVX = THREE.MathUtils.clamp(dx * 0.012, -0.32, 0.32);
  tiltVY = THREE.MathUtils.clamp(tiltVY + dy * 0.006, -0.5, 0.5);
  relicRoot.rotation.y += spinVX;
  relicRoot.rotation.x = THREE.MathUtils.clamp(relicRoot.rotation.x + dy * 0.004, -0.6, 0.6);
}

function onPointerUp(e: PointerEvent) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchBase = 0;
  if (pointers.size === 0) {
    dragging = false;
    const isTap = movedPx < 9 && performance.now() - downAt < 340;
    if (isTap && !props.collected) {
      triggerCollect();
    } else if (isTap && props.collected) {
      void downX;
      void downY;
    }
  }
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  camTargetDist = THREE.MathUtils.clamp(camTargetDist + Math.sign(e.deltaY) * 0.28, 2.2, 5.4);
}

/** 点击收集：粒子迸发 + 轻微回弹 */
function triggerCollect() {
  if (!scene || !dustTex) return;
  emit("collect");
  const n = 34;
  const pos = new Float32Array(n * 3);
  const vel: number[] = [];
  for (let i = 0; i < n; i++) {
    let x = 0;
    let y = 0;
    let z = 0;
    do {
      x = Math.random() * 2 - 1;
      y = Math.random() * 2 - 1;
      z = Math.random() * 2 - 1;
    } while (x * x + y * y + z * z > 1 || x * x + y * y + z * z < 0.05);
    vel.push(x * 1.5, y * 1.5 + 0.5, z * 1.5);
    pos[i * 3] = 0;
    pos[i * 3 + 1] = 0.05;
    pos[i * 3 + 2] = 0;
  }
  burstGeo = new THREE.BufferGeometry();
  burstGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  (burstGeo as THREE.BufferGeometry & { userData: { vel: number[] } }).userData.vel = vel;
  burstMat = new THREE.PointsMaterial({
    size: 0.11,
    map: dustTex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  burstPoints = new THREE.Points(burstGeo, burstMat);
  scene.add(burstPoints);
  burstT = 0;

  if (relicRoot) spinVX = 0;
}

/* ---------------- 主循环 ---------------- */
function animate() {
  raf = requestAnimationFrame(animate);
  if (!renderer || !scene || !camera || disposed) return;
  const dt = clock ? Math.min(0.05, clock.getDelta()) : 0.016;
  const t = performance.now() / 1000;

  // 相机推进 / 拉远
  camDist += (camTargetDist - camDist) * Math.min(1, dt * 6);
  camera.position.z = camDist;
  camera.position.y = 0.75 + Math.sin(t * 0.6) * 0.03;
  camera.lookAt(0, 0.15, 0);

  // 进场浮现
  if (appearT < 1) {
    appearT = Math.min(1, appearT + dt / 0.72);
  }
  const ease = 1 + 2.70158 * Math.pow(appearT - 1, 3) + 1.70158 * Math.pow(appearT - 1, 2);
  if (relicRoot) {
    relicRoot.scale.setScalar(Math.max(0.001, BASE_SCALE * ease));
    relicRoot.position.y = -0.1 + (1 - appearT) * -0.5 + Math.sin(t * 1.35) * 0.055;
    relicRoot.rotation.y += spinVX;
    spinVX *= 0.93;
    if (!dragging) {
      relicRoot.rotation.y += 0.0042;
      relicRoot.rotation.x += (0 - relicRoot.rotation.x) * 0.05;
    }
    const fast = relicRoot.getObjectByName("relic")?.getObjectByName("spin-fast");
    const slow = relicRoot.getObjectByName("relic")?.getObjectByName("spin-slow");
    if (fast) fast.rotation.z += dt * 1.5;
    if (slow) slow.rotation.y += dt * 0.7;
  }

  // 光环呼吸
  const breathe = 1 + Math.sin(t * 1.6) * 0.05;
  if (halo) {
    halo.scale.setScalar(breathe);
    (halo.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(t * 1.6) * 0.18;
  }
  if (halo2) {
    halo2.rotation.z += dt * 0.5;
    halo2.scale.setScalar(1 + Math.sin(t * 1.1 + 1) * 0.06);
  }
  if (glowDisc) {
    (glowDisc.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(t * 1.3) * 0.12;
  }

  // 尘埃旋转
  if (dust) {
    dust.rotation.y += dt * 0.28;
    dust.position.y = Math.sin(t * 0.8) * 0.05;
    if (dustMat) dustMat.opacity = props.collected ? 0.28 : 0.9;
  }

  // 收集迸发
  if (burstPoints && burstGeo && burstMat && burstT >= 0) {
    burstT += dt;
    const g = burstGeo as THREE.BufferGeometry & { userData: { vel: number[] } };
    const arr = g.attributes.position as THREE.BufferAttribute;
    const vel = g.userData.vel;
    for (let i = 0; i < arr.count; i++) {
      arr.setX(i, arr.getX(i) + vel[i * 3] * dt);
      arr.setY(i, arr.getY(i) + (vel[i * 3 + 1] - burstT * 1.6) * dt);
      arr.setZ(i, arr.getZ(i) + vel[i * 3 + 2] * dt);
    }
    arr.needsUpdate = true;
    burstMat.opacity = Math.max(0, 1 - burstT / 0.8);
    if (burstT > 0.8) {
      scene.remove(burstPoints);
      burstGeo.dispose();
      burstMat.dispose();
      burstPoints = null;
      burstGeo = null;
      burstMat = null;
      burstT = -1;
    }
  }

  // 已收集：转为青色收束
  if (halo && props.collected) {
    (halo.material as THREE.MeshBasicMaterial).color.setHex(0x3ec6b8);
  } else if (halo) {
    (halo.material as THREE.MeshBasicMaterial).color.setHex(0xe8b84b);
  }

  renderer.render(scene, camera);
}

/* ---------------- 生命周期 ---------------- */
onMounted(() => {
  init();
});

watch(
  () => props.relic,
  () => {
    if (state.value === "ready") replaceRelic();
  }
);

onBeforeUnmount(() => {
  disposed = true;
  cancelAnimationFrame(raf);
  resizeObserver?.disconnect();
  resizeObserver = null;
  const canvas = canvasRef.value;
  if (canvas) {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("wheel", onWheel);
  }
  disposeGroup(relicRoot);
  disposeGroup(halo);
  disposeGroup(halo2);
  disposeGroup(pedestal);
  disposeGroup(glowDisc);
  disposeGroup(dust);
  disposeGroup(burstPoints);
  dustGeo?.dispose();
  dustMat?.dispose();
  burstGeo?.dispose();
  burstMat?.dispose();
  dustTex?.dispose();
  glowTex?.dispose();
  renderer?.dispose();
  renderer = null;
  scene = null;
  camera = null;
  relicRoot = null;
  halo = null;
  halo2 = null;
  pedestal = null;
  glowDisc = null;
  dust = null;
  dustGeo = null;
  dustMat = null;
  burstPoints = null;
  burstGeo = null;
  burstMat = null;
  clock = null;
});
</script>

<template>
  <div ref="hostRef" class="ar3d" :class="{ 'ar3d--collected': collected }">
    <canvas v-if="state !== 'error'" ref="canvasRef" class="ar3d__canvas" />

    <img v-else-if="fallbackUrl" class="ar3d__fallback" :src="fallbackUrl" :alt="label || '虚拟信物'" />

    <div v-else class="ar3d__fallback ar3d__fallback--text">
      <span>3D 信物需要 WebGL 支持</span>
    </div>

    <span v-if="state === 'loading'" class="ar3d__load">虚拟信物生成中…</span>

    <span v-if="state === 'ready'" class="ar3d__hint">
      <b>3D 信物</b>
      <i>拖动旋转 · 双指缩放 · 点击收集</i>
    </span>
  </div>
</template>

<style scoped>
.ar3d {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.ar3d__canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: grab;
}
.ar3d__canvas:active {
  cursor: grabbing;
}

.ar3d__fallback {
  position: absolute;
  inset: 0;
  margin: auto;
  max-height: 155px;
  max-width: 78%;
  object-fit: contain;
  animation: arc-appear var(--dur-slow) var(--ease-spring);
  filter: drop-shadow(0 10px 24px rgba(0, 0, 0, 0.5));
}
.ar3d__fallback--text {
  display: grid;
  place-items: center;
  font-size: 12px;
  color: var(--text-dim);
  text-align: center;
}

.ar3d__load {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-size: 12px;
  color: var(--text-secondary);
}

.ar3d__hint {
  position: absolute;
  right: 8px;
  top: 8px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  padding: 3px 10px;
  border-radius: var(--radius-pill);
  background: rgba(10, 18, 32, 0.62);
  border: 1px solid var(--border);
  pointer-events: none;
  backdrop-filter: blur(4px);
  text-align: right;
}
.ar3d__hint b {
  font-size: 10.5px;
  color: var(--accent);
  letter-spacing: 0.04em;
}
.ar3d__hint i {
  font-style: normal;
  font-size: 10px;
  color: var(--text-dim);
}
.ar3d--collected .ar3d__hint b {
  color: var(--success);
}

@keyframes arc-appear {
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.86);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
</style>
