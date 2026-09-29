<script setup lang="ts">
/**
 * 板块二 · AR 实景叠加舞台
 *
 * 把「地图定位 + 3D 信物」升级为真正的 AR 叠加画面：
 * - 后置摄像头实时画面作为底（getUserMedia），虚拟信物叠加在实景之上
 * - 设备指南针（deviceorientation）驱动方位环，箭头实时指向目标点位
 * - 进入围栏 → 信物从实景中浮现；点击收集（复用 ArRelic3D 的程序化建模）
 * - 三级降级，保证任何设备都能演示：
 *     ① camera  实景 AR（真实摄像头）
 *     ② pano    全景模拟 AR（该景点 360° 全景图当底 + 同一套叠加层）
 *     ③ plain   程序化底 + 提示（连全景素材也缺时兜底）
 * - 无指南针时自动切换「模拟方位」并缓慢扫描，避免演示时箭头死住
 *
 * 演示口径：定位来自浏览器模拟；摄像头画面不做真实空间锚定（无 SLAM），
 * 但方位/距离/围栏判定均为真实计算，页面标注「演示模拟 · DEMO」。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import ArRelic3D from "./ArRelic3D.vue";
import { bearingDeg, compassLabel } from "@/lib/geo";

type Mode = "idle" | "camera" | "pano" | "plain";

const props = withDefaults(
  defineProps<{
    /** 目标点位名（显示在 HUD 上） */
    poiName?: string;
    /** 场景名（如「石桅岩」），用于全景模拟文案 */
    sceneName?: string;
    /** 信物键：站点 billboard 字段，交给 ArRelic3D 程序化建模 */
    relic?: string;
    /** 信物降级贴图 */
    fallbackUrl?: string;
    /** 全景图路径：摄像头不可用时当底 */
    panorama?: string;
    /** 是否在围栏内（进入后信物才浮现） */
    inside?: boolean;
    /** 距目标米数 */
    distance?: number;
    /** 围栏半径（米） */
    radius?: number;
    /** 我的位置 */
    me?: { lat: number; lng: number } | null;
    /** 目标位置 */
    target?: { lat: number; lng: number } | null;
    /** 是否已收集 */
    collected?: boolean;
    /** 是否默认自动尝试开摄像头（移动端 true；桌面演示建议 false 免得弹窗） */
    autoStart?: boolean;
  }>(),
  {
    poiName: "",
    sceneName: "",
    relic: "",
    fallbackUrl: "",
    panorama: "",
    inside: false,
    distance: 0,
    radius: 60,
    me: null,
    target: null,
    collected: false,
    autoStart: false,
  }
);

const emit = defineEmits<{ (e: "collect"): void; (e: "mode-change", m: Mode): void }>();

const videoRef = ref<HTMLVideoElement | null>(null);
const mode = ref<Mode>("idle");
const camError = ref("");
const heading = ref(0);
/** 设备是否真的提供了指南针；没有则用模拟扫描 */
const hasCompass = ref(false);
const simHeading = ref(0);

let stream: MediaStream | null = null;
let simTimer = 0;
let orientationBound = false;

/* ---------------- 方位 ---------------- */
/** 目标方位角（正北 0°，顺时针）；缺坐标时返回 null */
const targetBearing = computed(() => {
  const t = props.target;
  const m = props.me;
  if (!t || !m) return null;
  return bearingDeg(m.lat, m.lng, t.lat, t.lng);
});

/** 当前朝向：优先真实指南针，无则模拟扫描 */
const currentHeading = computed(() => (hasCompass.value ? heading.value : simHeading.value));

/** 目标相对当前朝向的偏角（-180~180，正值=目标在右手边） */
const delta = computed(() => {
  if (targetBearing.value == null) return null;
  let d = targetBearing.value - currentHeading.value;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
});

/** 目标是否已在视野正前方（±25°）——用于点亮「已对准」提示 */
const aimed = computed(() => delta.value != null && Math.abs(delta.value) <= 25);

const bearingText = computed(() =>
  targetBearing.value == null ? "方位未知" : `${compassLabel(targetBearing.value)} ${Math.round(targetBearing.value)}°`
);

/* ---------------- 接近度 ---------------- */
/** 0~1：进入围栏为 1，三倍半径外为 0 */
const approach = computed(() => {
  const r = Math.max(1, props.radius);
  return Math.max(0, Math.min(1, 1 - props.distance / (r * 3)));
});

const remainText = computed(() => {
  if (props.inside) return "已进入寻宝范围";
  const left = Math.max(0, props.distance - props.radius);
  return left > 950 ? `还需走近 ${(left / 1000).toFixed(1)} km` : `还需走近 ${Math.round(left)} m`;
});

const modeLabel = computed(
  () => ({ idle: "待启动", camera: "实景 AR", pano: "全景模拟 AR", plain: "静态叠加" })[mode.value]
);

/* ---------------- 摄像头 ---------------- */
async function startCamera() {
  camError.value = "";
  if (!navigator.mediaDevices?.getUserMedia) {
    camError.value = "当前环境不支持摄像头（需 HTTPS 或 localhost）";
    fallbackToPano();
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    const v = videoRef.value;
    if (v) {
      v.srcObject = stream;
      await v.play().catch(() => void 0);
    }
    mode.value = "camera";
    emit("mode-change", "camera");
  } catch (err) {
    const name = (err as { name?: string })?.name || "";
    camError.value =
      name === "NotAllowedError"
        ? "摄像头未授权"
        : name === "NotFoundError"
          ? "未找到可用摄像头"
          : "摄像头不可用";
    fallbackToPano();
  }
}

function fallbackToPano() {
  mode.value = props.panorama ? "pano" : "plain";
  emit("mode-change", mode.value);
}

function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  if (videoRef.value) videoRef.value.srcObject = null;
}

/** 手动在 实景 / 全景 之间切换（演示时随时降级，永不黑屏） */
function toggleMode() {
  if (mode.value === "camera") {
    stopCamera();
    fallbackToPano();
  } else {
    void startCamera();
  }
}

/* ---------------- 指南针 ---------------- */
function onOrientation(e: DeviceOrientationEvent) {
  const wk = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
  if (typeof wk === "number" && Number.isFinite(wk)) {
    // iOS：webkitCompassHeading 已是「正北为 0、顺时针」
    heading.value = (wk + 360) % 360;
    hasCompass.value = true;
    return;
  }
  if (e.alpha == null || !Number.isFinite(e.alpha)) return;
  // Android：alpha 为逆时针偏角，换算成顺时针罗盘方位
  heading.value = (360 - e.alpha) % 360;
  // 只有 absolute 事件才是真罗盘；相对事件仅用于驱动画面，不标记为真实罗盘
  if (e.absolute === true) hasCompass.value = true;
}

async function bindCompass() {
  if (orientationBound) return;
  type PermissibleCtor = { requestPermission?: () => Promise<"granted" | "denied"> };
  const Ctor = (window.DeviceOrientationEvent ?? undefined) as (PermissibleCtor & typeof DeviceOrientationEvent) | undefined;
  try {
    if (Ctor?.requestPermission) {
      const res = await Ctor.requestPermission();
      if (res !== "granted") return;
    }
    window.addEventListener("deviceorientationabsolute", onOrientation as EventListener, true);
    window.addEventListener("deviceorientation", onOrientation as EventListener, true);
    orientationBound = true;
  } catch {
    /* 无权限：保留模拟方位 */
  }
}

/** 无指南针时缓慢扫描，保证箭头与方位环始终有动效 */
function startSimHeading() {
  simTimer = window.setInterval(() => {
    if (hasCompass.value) return;
    simHeading.value = (simHeading.value + 1.6) % 360;
  }, 60);
}

/* ---------------- 生命周期 ---------------- */
onMounted(() => {
  startSimHeading();
  if (props.autoStart) {
    void bindCompass();
    void startCamera();
  }
});

watch(
  () => props.autoStart,
  (v) => {
    if (v && mode.value === "idle") {
      void bindCompass();
      void startCamera();
    }
  }
);

onBeforeUnmount(() => {
  stopCamera();
  window.clearInterval(simTimer);
  if (orientationBound) {
    window.removeEventListener("deviceorientationabsolute", onOrientation as EventListener, true);
    window.removeEventListener("deviceorientation", onOrientation as EventListener, true);
  }
});

function onCollect() {
  emit("collect");
}
</script>

<template>
  <div class="stage" :class="[`stage--${mode}`, { 'stage--inside': inside, 'stage--aimed': aimed }]">
    <!-- ① 实景底：摄像头 -->
    <video
      v-show="mode === 'camera'"
      ref="videoRef"
      class="stage__base"
      playsinline
      muted
      autoplay
    />
    <!-- ② 全景模拟底 -->
    <div v-if="mode === 'pano'" class="stage__base stage__base--pano" :style="{ backgroundImage: `url(${panorama})` }" />
    <!-- ③ 程序化底 -->
    <div v-if="mode === 'plain'" class="stage__base stage__base--plain" />

    <!-- 实景观感增强：暗角 + 扫描线 -->
    <div class="stage__vignette" />
    <div v-if="mode !== 'idle'" class="stage__scan" />

    <!-- HUD 四角 -->
    <i class="stage__corner stage__corner--tl" />
    <i class="stage__corner stage__corner--tr" />
    <i class="stage__corner stage__corner--bl" />
    <i class="stage__corner stage__corner--br" />

    <!-- 顶部信息条 -->
    <div class="stage__top">
      <span class="stage__chip" :class="{ 'is-live': mode === 'camera' }">
        <i class="stage__dot" />{{ modeLabel }}
      </span>
      <span class="stage__poi">{{ poiName || "—" }}</span>
      <span class="stage__bearing">
        {{ bearingText }}
        <em v-if="!hasCompass && mode !== 'idle'">模拟方位</em>
      </span>
    </div>

    <!-- 中央：信物 / 锁定指引 -->
    <div class="stage__center">
      <!-- 进入围栏：信物浮现 -->
      <div v-if="inside" class="stage__relic">
        <div class="stage__rings">
          <i /><i /><i />
        </div>
        <ArRelic3D
          class="stage__relic-body"
          :relic="relic"
          :fallback-url="fallbackUrl"
          :label="poiName"
          :collected="collected"
          @collect="onCollect"
        />
        <p class="stage__relic-tip">
          <b>{{ collected ? "已收集" : "虚拟信物已浮现" }}</b>
          <i>{{ collected ? "该点位奖励已入袋" : "点击信物即可收集" }}</i>
        </p>
      </div>

      <!-- 未进入围栏：方向锁定框 -->
      <div v-else class="stage__lock">
        <div class="stage__lock-frame" :style="{ transform: `rotate(${delta ?? 0}deg)` }">
          <span class="stage__lock-arrow">▲</span>
        </div>
        <p class="stage__lock-title">{{ remainText }}</p>
        <p class="stage__lock-sub">
          <template v-if="aimed">方向已对准，继续前进</template>
          <template v-else-if="delta == null">等待定位…</template>
          <template v-else>
            目标在{{ delta > 0 ? "右" : "左" }}手侧 {{ Math.abs(Math.round(delta)) }}°
          </template>
        </p>
      </div>
    </div>

    <!-- 底部：接近度 -->
    <div class="stage__bottom">
      <div class="stage__bar">
        <i :style="{ width: `${Math.round((inside ? 1 : approach) * 100)}%` }" />
      </div>
      <div class="stage__stat">
        <span><b>{{ Math.round(distance) }}</b> m 到目标</span>
        <span>围栏 {{ radius }} m</span>
        <span>{{ inside ? "判定：范围内" : "判定：范围外" }}</span>
      </div>
    </div>

    <!-- 启动门：浏览器要求用户手势才允许开摄像头 -->
    <div v-if="mode === 'idle'" class="stage__gate">
      <div class="stage__gate-card">
        <h4>AR 实景寻宝</h4>
        <p>开启摄像头，在真实画面里找到藏在「{{ sceneName || "永嘉景点" }}」的虚拟信物</p>
        <button class="stage__gate-btn" type="button" @click="startCamera">开启 AR 实景</button>
        <button class="stage__gate-link" type="button" @click="fallbackToPano">
          {{ panorama ? "不授权，用全景模拟演示" : "不授权，继续静态叠加" }}
        </button>
      </div>
    </div>

    <!-- 右下：模式切换 -->
    <button v-if="mode !== 'idle'" class="stage__switch" type="button" @click="toggleMode">
      {{ mode === "camera" ? "切全景" : "切实景" }}
    </button>

    <p v-if="camError" class="stage__err">{{ camError }} · 已自动降级</p>
    <span class="stage__demo">演示模拟 · DEMO</span>
  </div>
</template>

<style scoped>
.stage {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #05080f;
  isolation: isolate;
}

/* ---------- 底 ---------- */
.stage__base {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.stage__base--pano {
  background-size: cover;
  background-position: center;
  animation: stage-pan 26s ease-in-out infinite alternate;
}
.stage__base--plain {
  background:
    radial-gradient(120% 80% at 50% 0%, #16324a 0%, #0a1420 55%, #05080f 100%);
}
@keyframes stage-pan {
  from {
    transform: scale(1.12) translateX(-2%);
  }
  to {
    transform: scale(1.12) translateX(2%);
  }
}

.stage__vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(105% 78% at 50% 46%, rgba(0, 0, 0, 0) 42%, rgba(0, 0, 0, 0.62) 100%);
}
.stage__scan {
  position: absolute;
  left: 0;
  right: 0;
  height: 26%;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(62, 198, 184, 0) 0%, rgba(62, 198, 184, 0.14) 60%, rgba(62, 198, 184, 0) 100%);
  animation: stage-scan 5.6s linear infinite;
}
@keyframes stage-scan {
  0% {
    top: -26%;
  }
  100% {
    top: 100%;
  }
}

/* ---------- HUD 四角 ---------- */
.stage__corner {
  position: absolute;
  width: 18px;
  height: 18px;
  border: 1.5px solid rgba(62, 198, 184, 0.72);
  pointer-events: none;
}
.stage__corner--tl {
  left: 10px;
  top: 52px;
  border-right: 0;
  border-bottom: 0;
}
.stage__corner--tr {
  right: 10px;
  top: 52px;
  border-left: 0;
  border-bottom: 0;
}
.stage__corner--bl {
  left: 10px;
  bottom: 62px;
  border-right: 0;
  border-top: 0;
}
.stage__corner--br {
  right: 10px;
  bottom: 62px;
  border-left: 0;
  border-top: 0;
}

/* ---------- 顶部 ---------- */
.stage__top {
  position: absolute;
  left: 10px;
  right: 10px;
  top: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.stage__chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: var(--radius-pill);
  background: rgba(8, 14, 24, 0.72);
  border: 1px solid var(--border);
  font-size: 10.5px;
  color: var(--text-secondary);
  backdrop-filter: blur(6px);
}
.stage__chip.is-live {
  color: #06210f;
  background: var(--success);
  border-color: transparent;
  font-weight: 600;
}
.stage__dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 6px currentColor;
  animation: stage-blink 1.6s ease-in-out infinite;
}
@keyframes stage-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.25;
  }
}
.stage__poi {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.8);
}
.stage__bearing {
  margin-left: auto;
  font-size: 10.5px;
  color: var(--accent);
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.8);
}
.stage__bearing em {
  font-style: normal;
  margin-left: 4px;
  color: var(--text-dim);
}

/* ---------- 中央 ---------- */
.stage__center {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
}

.stage__relic {
  position: relative;
  width: min(74%, 300px);
  height: min(46%, 300px);
  pointer-events: auto;
  animation: stage-rise 0.72s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
}
.stage__relic-body {
  position: absolute;
  inset: 0;
}
.stage__rings {
  position: absolute;
  inset: -6%;
  pointer-events: none;
}
.stage__rings i {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1px solid rgba(232, 184, 75, 0.5);
  animation: stage-ring 2.8s ease-out infinite;
}
.stage__rings i:nth-child(2) {
  animation-delay: 0.9s;
}
.stage__rings i:nth-child(3) {
  animation-delay: 1.8s;
}
@keyframes stage-ring {
  0% {
    transform: scale(0.62);
    opacity: 0.85;
  }
  100% {
    transform: scale(1.14);
    opacity: 0;
  }
}
@keyframes stage-rise {
  from {
    opacity: 0;
    transform: translateY(22px) scale(0.9);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.stage__relic-tip {
  position: absolute;
  left: 50%;
  bottom: -4px;
  transform: translateX(-50%);
  margin: 0;
  padding: 4px 12px;
  border-radius: var(--radius-pill);
  background: rgba(8, 14, 24, 0.72);
  border: 1px solid var(--border);
  backdrop-filter: blur(6px);
  text-align: center;
  white-space: nowrap;
}
.stage__relic-tip b {
  display: block;
  font-size: 11px;
  color: var(--accent);
}
.stage__relic-tip i {
  font-style: normal;
  font-size: 10px;
  color: var(--text-dim);
}

/* 锁定指引 */
.stage__lock {
  text-align: center;
  padding: 18px 22px;
  border-radius: 18px;
  background: rgba(8, 14, 24, 0.56);
  border: 1px dashed rgba(62, 198, 184, 0.42);
  backdrop-filter: blur(6px);
}
.stage__lock-frame {
  width: 62px;
  height: 62px;
  margin: 0 auto 10px;
  border-radius: 50%;
  border: 1.5px dashed rgba(62, 198, 184, 0.6);
  display: grid;
  place-items: center;
  transition: transform 0.16s linear;
}
.stage__lock-arrow {
  font-size: 15px;
  color: var(--accent);
  text-shadow: 0 0 10px rgba(62, 198, 184, 0.8);
}
.stage__lock-title {
  margin: 0 0 3px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-primary);
}
.stage__lock-sub {
  margin: 0;
  font-size: 11px;
  color: var(--text-dim);
}
.stage--aimed .stage__lock {
  border-color: rgba(48, 208, 140, 0.7);
  box-shadow: 0 0 22px rgba(48, 208, 140, 0.16);
}
.stage--aimed .stage__lock-frame {
  border-color: var(--success);
  border-style: solid;
}
.stage--aimed .stage__lock-arrow {
  color: var(--success);
}

/* ---------- 底部 ---------- */
.stage__bottom {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 10px;
}
.stage__bar {
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.16);
  overflow: hidden;
}
.stage__bar i {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--accent), var(--success, #30d08c));
  transition: width 0.4s ease;
}
.stage__stat {
  display: flex;
  justify-content: space-between;
  margin-top: 5px;
  font-size: 10px;
  color: var(--text-dim);
}
.stage__stat b {
  color: var(--text-primary);
  font-size: 11.5px;
}

/* ---------- 启动门 ---------- */
.stage__gate {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(4, 8, 14, 0.82);
  backdrop-filter: blur(3px);
  padding: 18px;
}
.stage__gate-card {
  max-width: 320px;
  text-align: center;
}
.stage__gate-card h4 {
  margin: 0 0 6px;
  font-size: 16px;
  color: var(--text-primary);
}
.stage__gate-card p {
  margin: 0 0 14px;
  font-size: 12px;
  line-height: 1.65;
  color: var(--text-secondary);
}
.stage__gate-btn {
  width: 100%;
  padding: 11px 0;
  border: 0;
  border-radius: var(--radius-pill);
  background: linear-gradient(135deg, var(--accent), var(--success, #30d08c));
  color: #06210f;
  font-size: 13.5px;
  font-weight: 700;
  cursor: pointer;
}
.stage__gate-link {
  margin-top: 9px;
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--text-dim);
  font-size: 11.5px;
  text-decoration: underline;
  cursor: pointer;
}

/* ---------- 其他 ---------- */
.stage__switch {
  position: absolute;
  right: 10px;
  bottom: 62px;
  padding: 5px 11px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: rgba(8, 14, 24, 0.72);
  color: var(--text-secondary);
  font-size: 10.5px;
  cursor: pointer;
  backdrop-filter: blur(6px);
}
.stage__err {
  position: absolute;
  left: 12px;
  bottom: 56px;
  right: 76px;
  margin: 0;
  font-size: 10px;
  color: #f0a37a;
}
.stage__demo {
  position: absolute;
  right: 10px;
  top: 46px;
  font-size: 9px;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.42);
}
</style>
