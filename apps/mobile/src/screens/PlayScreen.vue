<script setup lang="ts">
/**
 * 板块二 · AR 互动：玩家端（手机样式界面）
 * 手机外壳承载全部玩法内容：实时定位 → 按位置推送附近内容 → 进入围栏 → 3D 互动信物 → 打卡/答题 → 领券 → 排行
 * 演示口径：优先使用浏览器实时定位（watchPosition），无权限时回落到模拟定位；奖励为 mock 券，不做真实核销。
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "@/api/client";
import ArMap from "@/components/ar/ArMap.vue";
import ArRelic3D from "@/components/ar/ArRelic3D.vue";
import ArCameraStage from "@/components/ar/ArCameraStage.vue";
import ArAgentDock from "@/components/ar/ArAgentDock.vue";
import DemoQr from "@/components/ar/DemoQr.vue";
import type { ArMapMarker } from "@/components/ar/types";
import { bearingDeg, compassLabel, distanceM, fmtDistance, offsetPoint, stepToward } from "@/lib/geo";
import { guideAudioUrl } from "@/lib/assets";
import { npcPortraitSrc } from "@/lib/npc";
import { useGeolocation } from "@/lib/useGeolocation";
import { toast } from "@/lib/toast";
import type {
  ArClaimResp,
  ArFenceResp,
  ArPlayConfig,
  ArProgress,
  ArRecordsResp,
  ArSubmitResp,
  SceneRecord,
} from "@/types/api";

const route = useRoute();
const router = useRouter();
const gameId = computed(() => String(route.params.gameId));

const PLAYER_KEY = "demo-player";
const PLAYER_NAME = "演示游客";

type Phase = "intro" | "play" | "done";
const phase = ref<Phase>("intro");
const config = ref<ArPlayConfig | null>(null);
const error = ref("");
const loading = ref(true);

const player = ref<{ lat: number; lng: number } | null>(null);
const activeIndex = ref(0);
const fence = ref<ArFenceResp | null>(null);
const answer = ref("");
const result = ref<ArSubmitResp | null>(null);
const progress = ref<ArProgress | null>(null);
const records = ref<ArRecordsResp | null>(null);
const voucher = ref<ArClaimResp | null>(null);
const showVoucher = ref(false);
const busy = ref(false);
const soundOn = ref(true);
const checkinPending = ref<string | null>(null);

/* ---------- 手机屏幕内的 Tab 导航 ---------- */
type Tab = "mission" | "ar" | "map" | "nearby" | "rank";
const tab = ref<Tab>("mission");
const TABS: Array<{ key: Tab; label: string; svg: string }> = [
  {
    key: "mission",
    label: "任务",
    svg: '<path d="M12 3v18M5 8.5 12 3l7 5.5M5 15.5 12 21l7-5.5" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  {
    key: "ar",
    label: "AR实景",
    svg: '<rect x="2.6" y="7" width="18.8" height="13" rx="3.2" stroke="currentColor" stroke-width="1.7" fill="none"/><circle cx="12" cy="13.4" r="3.5" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M9.2 7 10.6 4.6h2.8L14.8 7" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/>',
  },
  {
    key: "map",
    label: "地图",
    svg: '<path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M9 4v14M15 6v14" stroke="currentColor" stroke-width="1.4" fill="none"/>',
  },
  {
    key: "nearby",
    label: "附近",
    svg: '<circle cx="12" cy="10" r="3" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M12 21c4-4.5 6-7.6 6-11a6 6 0 1 0-12 0c0 3.4 2 6.5 6 11Z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/>',
  },
  {
    key: "rank",
    label: "排行",
    svg: '<path d="M5 20h14M7 20V10M12 20V4M17 20v-7" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
  },
];
function setTab(t: Tab) {
  tab.value = t;
}

/** 状态栏时钟 */
const clock = ref("");
function tickClock() {
  const d = new Date();
  clock.value = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* ---------- 实时定位（浏览器 watchPosition） ---------- */
const {
  supported: geoSup,
  status: geoStatus,
  coords: geoCoords,
  error: geoError,
  active: geoActive,
  located: geoLocated,
  toggle: geoToggle,
} = useGeolocation();
/** 定位已生效（拿到真实坐标） */
const gpsActive = computed(() => geoActive.value && geoLocated.value);
const gpsAccuracy = computed(() => geoCoords.value?.accuracy ?? null);
const gpsHeading = computed(() => geoCoords.value?.heading ?? null);
/** 是否自动跟随「最近的未通关点位」，随位置变化切换内容 */
const autoFollow = ref(true);
const scanning = ref(false);
const scanHint = ref("");
const stamp = ref(false);

const gpsDotClass = computed(() => {
  switch (geoStatus.value) {
    case "active":
      return "on";
    case "requesting":
      return "wait";
    case "denied":
    case "error":
    case "unsupported":
      return "off";
    default:
      return "idle";
  }
});

const accuracyLabel = computed(() => {
  const a = gpsAccuracy.value;
  if (a == null) return "";
  if (a <= 30) return `高精度 ±${Math.round(a)}m`;
  if (a <= 120) return `中等 ±${Math.round(a)}m`;
  return `粗略 ±${Math.round(a)}m`;
});

const gpsStatusLabel = computed(() => {
  switch (geoStatus.value) {
    case "idle":
      return "未开启";
    case "requesting":
      return "定位中…";
    case "active":
      return accuracyLabel.value || "定位中…";
    case "denied":
      return "权限被拒绝";
    case "unsupported":
      return "浏览器不支持";
    default:
      return "定位异常";
  }
});

/** 真实坐标持续回写玩家位置（实时定位的核心） */
watch(
  () => geoCoords.value,
  (c) => {
    if (c) player.value = { lat: c.lat, lng: c.lng };
  },
);

const current = computed(() => config.value?.points[activeIndex.value] ?? null);
const total = computed(() => config.value?.points.length ?? 0);
const solved = computed(() => new Set(progress.value?.solved ?? []));

/* ---------- 场景底座 · 把当前点位映射到「永嘉 3D 景点场景」 ----------
   AR 实景的全景降级底、Agent 的场景上下文、3D 展示都取这一份数据 */
const scenes = ref<SceneRecord[]>([]);
const sceneOfCurrent = computed(() => scenes.value.find((s) => s.poi_id === current.value?.poi_id) ?? null);
const sceneName = computed(() => sceneOfCurrent.value?.name ?? current.value?.poi_name ?? "");
const scenePanorama = computed(() => sceneOfCurrent.value?.panorama ?? "");

/* ---------- POI 语音导览（运营内容组提供的 guide-poi-*.mp3） ---------- */
const guideEl = ref<HTMLAudioElement | null>(null);
const guidePlaying = ref(false);
const guideUrl = computed(() => guideAudioUrl(current.value?.poi_id));
function toggleGuide() {
  const el = guideEl.value;
  if (!el || !guideUrl.value) return;
  if (el.paused) {
    void el.play().catch(() => toast("浏览器拦截了自动播放，请再点一次「听讲解」", "info"));
  } else {
    el.pause();
  }
}
/** 切换点位时停止上一段讲解 */
watch(activeIndex, () => {
  guidePlaying.value = false;
  guideEl.value?.pause();
});
const claimedSet = computed(() => new Set(progress.value?.claimed ?? []));
const reach = computed(() => {
  if (!player.value || !current.value) return 9999;
  return distanceM(player.value.lat, player.value.lng, current.value.lat, current.value.lng);
});
/** 前端即时判定，服务端 checkin 为正式口径 */
const inside = computed(() => !!current.value && reach.value <= current.value.geofence_radius_m);
const answered = computed(() => !!current.value && solved.value.has(current.value.poi_id));
const allDone = computed(() => total.value > 0 && (progress.value?.points_done ?? 0) >= total.value);

/** 随行 Agent（楠楠）的上下文：让她「知道」玩家现在在哪、还差多远、走到第几站 */
const agentContext = computed(() => ({
  gameName: config.value?.name,
  sceneName: sceneName.value,
  poiName: current.value?.poi_name,
  distance: reach.value,
  inside: inside.value,
  collected: answered.value,
  solved: progress.value?.points_done ?? 0,
  total: total.value,
}));

const markers = computed<ArMapMarker[]>(() =>
  (config.value?.points ?? []).map((p, i) => ({
    id: p.poi_id,
    name: p.poi_name,
    lat: p.lat,
    lng: p.lng,
    radius: p.geofence_radius_m,
    order: i + 1,
    state: solved.value.has(p.poi_id) ? "solved" : i === activeIndex.value ? "current" : "pending",
    sub: `第 ${i + 1} 站`,
  })),
);

const progressPct = computed(() => (total.value ? Math.round(((progress.value?.points_done ?? 0) / total.value) * 100) : 0));

/* ---------- 位置感知内容：按与「我的位置」的距离动态生成 ---------- */
const located = computed(() => {
  const me = player.value;
  return (config.value?.points ?? [])
    .map((p, i) => {
      const d = me ? distanceM(me.lat, me.lng, p.lat, p.lng) : Number.POSITIVE_INFINITY;
      const bearing = me ? bearingDeg(me.lat, me.lng, p.lat, p.lng) : 0;
      return {
        point: p,
        index: i,
        distance: d,
        direction: me ? compassLabel(bearing) : "",
        inside: me ? d <= p.geofence_radius_m : false,
        solved: solved.value.has(p.poi_id),
      };
    })
    .sort((a, b) => a.distance - b.distance);
});

/** 附近内容：距离最近的前 5 个（随位置实时刷新） */
const nearby = computed(() => located.value.slice(0, 5));

/** 最近的「未通关」点位索引，用于自动跟随 */
const nearestIndex = computed(() => {
  const open = located.value.find((x) => !x.solved);
  return (open ?? located.value[0])?.index ?? -1;
});
const nearestPoint = computed(() => (nearestIndex.value >= 0 ? config.value?.points[nearestIndex.value] ?? null : null));

const withinCount = computed(() => located.value.filter((x) => x.inside).length);

const currentBearing = computed(() =>
  player.value && current.value ? bearingDeg(player.value.lat, player.value.lng, current.value.lat, current.value.lng) : null,
);
const currentDir = computed(() => (currentBearing.value == null ? "" : compassLabel(currentBearing.value)));

/** 当前位置的一句话描述（内容随位置变化） */
const locationSummary = computed(() => {
  const n = nearestPoint.value;
  if (!n || !player.value) return "正在定位…";
  const d = distanceM(player.value.lat, player.value.lng, n.lat, n.lng);
  if (d <= n.geofence_radius_m) return `你已在「${n.poi_name}」围栏内，虚拟信物已激活`;
  if (d <= 1200) return `你在「${n.poi_name}」附近，约 ${fmtDistance(d)}`;
  return `距最近点位「${n.poi_name}」约 ${fmtDistance(d)}`;
});

/** 平均围栏半径，用于开场信息展示 */
const avgRadius = computed(() => {
  const pts = config.value?.points ?? [];
  if (!pts.length) return 0;
  return Math.round(pts.reduce((s, p) => s + p.geofence_radius_m, 0) / pts.length);
});

function sfx(name: string) {
  if (!soundOn.value) return;
  const audio = new Audio(`/assets/ar/audio/${name}`);
  audio.volume = 0.5;
  void audio.play().catch(() => undefined);
}

async function load() {
  loading.value = true;
  try {
    config.value = await api.arPlay(gameId.value);
    progress.value = {
      solved: [],
      claimed: [],
      points_done: 0,
      total_points: config.value.points.length,
      completed: false,
      score: 0,
    };
  } catch (e) {
    error.value = (e as Error).message || "游戏不可用";
  } finally {
    loading.value = false;
  }
}

function start() {
  phase.value = "play";
  activeIndex.value = 0;
  tab.value = "mission";
  focusStation();
  sfx("sfx-ar-appear.mp3");
}

/** 把玩家放到当前目标约 800 米外，模拟"还没走到"（仅演示模拟使用） */
function focusStation() {
  const t = current.value;
  if (!t) return;
  const near = offsetPoint(t.lat, t.lng, 620, 430);
  player.value = near;
  fence.value = null;
  answer.value = "";
  result.value = null;
}

/** 切换目标点位；move=true 时把模拟位置拉到点位附近（实时定位时不动真实坐标） */
function selectStation(i: number, move = false) {
  if (i < 0 || i >= total.value) return;
  activeIndex.value = i;
  fence.value = null;
  answer.value = "";
  result.value = null;
  if (move) focusStation();
}

/** 手动选点：关闭自动跟随，避免被「最近点位」立刻覆盖 */
function pickStation(i: number) {
  autoFollow.value = false;
  selectStation(i, !gpsActive.value);
  tab.value = "mission";
}

function stepCloser() {
  if (!current.value || !player.value) return;
  player.value = stepToward(player.value, current.value, 0.55);
}

function jumpTo() {
  if (!current.value) return;
  player.value = { lat: current.value.lat + 0.00006, lng: current.value.lng + 0.00006 };
}

function reset() {
  focusStation();
}

/** 互动 · 雷达扫描：按当前位置揭示附近点位 */
async function scan() {
  if (scanning.value) return;
  scanning.value = true;
  scanHint.value = "";
  sfx("sfx-ar-appear.mp3");
  await new Promise((r) => setTimeout(r, 1200));
  scanning.value = false;
  const near = located.value[0];
  scanHint.value = near
    ? `扫描到 ${located.value.length} 个点位，最近「${near.point.poi_name}」${fmtDistance(near.distance)}（${near.direction}）`
    : "附近暂无可扫描点位";
  toast(scanHint.value, "success");
}

/** 互动 · 到达打卡：进入围栏后的显式操作（服务端校验为正式口径） */
async function checkinNow() {
  const poi = current.value;
  if (!poi || !player.value) return;
  if (!inside.value) {
    const gap = Math.max(0, reach.value - poi.geofence_radius_m);
    return toast(`仍在围栏外，再走近约 ${fmtDistance(gap)}`, "error");
  }
  busy.value = true;
  try {
    fence.value = await api.arCheckin(gameId.value, {
      poi_id: poi.poi_id,
      lat: player.value.lat,
      lng: player.value.lng,
      playerKey: PLAYER_KEY,
      userName: PLAYER_NAME,
    });
    stamp.value = true;
    sfx("sfx-enter-fence.mp3");
    toast(`已在「${poi.poi_name}」打卡`, "success");
    setTimeout(() => (stamp.value = false), 2600);
  } catch (e) {
    toast((e as Error).message || "打卡失败", "error");
  } finally {
    busy.value = false;
  }
}

function onMapClick(ll: { lat: number; lng: number }) {
  if (gpsActive.value) {
    toast("实时定位已开启，地图仅作预览", "info");
    return;
  }
  player.value = ll;
}

/** 实时定位开启后，自动跟随最近的未通关点位 —— 内容随位置切换 */
watch(nearestIndex, (i) => {
  if (!gpsActive.value || !autoFollow.value || i < 0 || i === activeIndex.value) return;
  selectStation(i, false);
});

/** 进入围栏自动签到（每点位一次）+ 把内容切回「任务」 */
watch(
  inside,
  async (isIn) => {
    const poi = current.value;
    if (!isIn || !poi || answered.value || checkinPending.value === poi.poi_id) return;
    tab.value = "mission";
    checkinPending.value = poi.poi_id;
    try {
      const res = await api.arCheckin(gameId.value, {
        poi_id: poi.poi_id,
        lat: player.value!.lat,
        lng: player.value!.lng,
        playerKey: PLAYER_KEY,
        userName: PLAYER_NAME,
      });
      fence.value = res;
      if (res.can_play) sfx("sfx-enter-fence.mp3");
    } catch {
      /* 演示态忽略网络抖动 */
    } finally {
      checkinPending.value = null;
    }
  },
  { immediate: true },
);

async function submit() {
  const poi = current.value;
  if (!poi || !answer.value.trim()) return toast("请输入你的答案", "error");
  busy.value = true;
  try {
    const res = await api.arSubmit(gameId.value, {
      poi_id: poi.poi_id,
      answer: answer.value,
      distance_m: Math.round(reach.value),
      playerKey: PLAYER_KEY,
      userName: PLAYER_NAME,
    });
    result.value = res;
    if (res.progress) progress.value = res.progress;
    sfx(res.correct ? "sfx-correct.mp3" : "sfx-wrong.mp3");
    if (res.correct && allDone.value) {
      phase.value = "done";
      sfx("sfx-chest-open.mp3");
      records.value = await api.arRecords(gameId.value);
    }
  } catch (e) {
    toast((e as Error).message || "提交失败", "error");
  } finally {
    busy.value = false;
  }
}

async function claim() {
  const poi = current.value;
  if (!poi?.reward_coupon_id) return;
  busy.value = true;
  try {
    const res = await api.arClaim(gameId.value, {
      coupon_id: poi.reward_coupon_id,
      playerKey: PLAYER_KEY,
      userName: PLAYER_NAME,
    });
    voucher.value = res;
    showVoucher.value = true;
    sfx("sfx-reward.mp3");
    records.value = await api.arRecords(gameId.value);
    if (progress.value) progress.value = { ...progress.value, claimed: res.claimed };
  } catch (e) {
    toast((e as Error).message || "领取失败", "error");
  } finally {
    busy.value = false;
  }
}

async function next() {
  if (activeIndex.value < total.value - 1) {
    selectStation(activeIndex.value + 1, !gpsActive.value);
    tab.value = "mission";
    sfx("sfx-ar-appear.mp3");
  } else {
    phase.value = "done";
    records.value = await api.arRecords(gameId.value);
  }
}

async function finish() {
  records.value = await api.arRecords(gameId.value);
}

/** 再玩一次：重置服务端进度并回到开场 */
async function replay() {
  await load();
  phase.value = "play";
  activeIndex.value = 0;
  tab.value = "mission";
  focusStation();
}

/** 加载场景底座：失败不影响寻宝主流程，仅 AR 全景降级底为空 */
async function loadScenes() {
  try {
    const r = await api.scenes(true);
    scenes.value = r.scenes;
  } catch {
    scenes.value = [];
  }
}

let clockTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  tickClock();
  clockTimer = setInterval(tickClock, 20000);
  void load();
  void loadScenes();
});
onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer);
});
watch(allDone, (v) => {
  if (v && phase.value === "play") finish();
});
</script>

<template>
  <div class="play-page">
    <div v-if="loading" class="text-center text-secondary py-16">加载中…</div>

    <div v-else-if="error" class="yj-card text-center py-14">
      <img class="guide" src="/assets/ar/guide/guide-location-fail.webp" alt="无法进入" />
      <h2 class="font-bold mt-4">{{ error }}</h2>
      <p class="text-sm text-secondary mt-2">该游戏可能为草稿或已下线，请回到运营端发布后再体验。</p>
      <button class="yj-btn yj-btn--ghost mt-4" @click="router.push('/')">返回游戏列表</button>
    </div>

    <template v-else-if="config">
      <!-- 演示台工具条 -->
      <div class="toolbar">
        <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="router.push('/')">← 游戏列表</button>
        <div class="toolbar__title">
          <b class="text-sm">{{ config.name }}</b>
          <span class="yj-tag yj-tag--accent">手机端预览</span>
          <span class="text-xs text-dim">{{ config.id }}</span>
        </div>
        <div class="toolbar__acts">
          <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="soundOn = !soundOn">
            {{ soundOn ? '音效 开' : '音效 关' }}
          </button>
          <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="router.push('/ar/' + config.id)">运营端</button>
          <button class="yj-btn yj-btn--primary yj-btn--sm" @click="router.push(`/ar/${config.id}/monitor`)">
            位置监控
          </button>
        </div>
      </div>

      <!-- 手机 -->
      <div class="stage">
        <div class="phone" :style="{ '--tpl-color': config.theme.primary || 'var(--color-brand-500)' }">
          <span class="phone__island" />
          <span class="phone__side phone__side--power" />
          <span class="phone__side phone__side--vol" />

          <div class="screen">
            <!-- 状态栏 -->
            <div class="statusbar">
              <span class="statusbar__time">{{ clock }}</span>
              <span class="statusbar__icons">
                <svg width="17" height="11" viewBox="0 0 17 11" aria-hidden="true">
                  <rect x="0" y="7" width="3" height="4" rx="1" fill="currentColor" />
                  <rect x="4.6" y="5" width="3" height="6" rx="1" fill="currentColor" />
                  <rect x="9.2" y="2.6" width="3" height="8.4" rx="1" fill="currentColor" />
                  <rect x="13.8" y="0" width="3" height="11" rx="1" fill="currentColor" opacity="0.35" />
                </svg>
                <svg width="26" height="12" viewBox="0 0 26 12" aria-hidden="true">
                  <rect x="0.6" y="1" width="21" height="10" rx="3" stroke="currentColor" stroke-opacity="0.45" fill="none" stroke-width="1.2" />
                  <rect x="2.2" y="2.6" width="15" height="6.8" rx="1.8" fill="currentColor" />
                  <path d="M23.4 4.4v3.2c1.5-.5 1.5-2.7 0-3.2Z" fill="currentColor" fill-opacity="0.45" />
                </svg>
              </span>
            </div>

            <!-- App 头部 -->
            <header class="appbar">
              <div class="appbar__left">
                <span class="appbar__dot" />
                <div style="min-width: 0">
                  <div class="appbar__name">{{ current?.poi_name || config.name }}</div>
                  <div class="appbar__sub">
                    第 {{ activeIndex + 1 }} / {{ total }} 站 · 积分 {{ progress?.score ?? 0 }}
                  </div>
                </div>
              </div>
              <div class="ring" :style="{ '--p': progressPct + '%' }">
                <span>{{ progressPct }}%</span>
              </div>
            </header>

            <!-- 屏幕内容 -->
            <main class="screen__body">
              <!-- 开场 -->
              <template v-if="phase === 'intro'">
                <div class="intro__hero">
                  <img class="intro__img" src="/assets/ar/guide/guide-ar-intro.webp" alt="AR 使用引导" />
                  <span class="intro__badge">AR 实景寻宝 · 演示</span>
                </div>
                <p class="text-xs text-secondary mt-3">
                  本玩法使用「浏览器实时定位 + 3D 互动虚拟信物」，无需专用设备；走到点位附近即可看到可旋转、缩放、点击收集的 3D 信物。
                </p>
                <ul class="rules">
                  <li>① 开启实时定位（或点击地图模拟移动）</li>
                  <li>② 进入虚线围栏后虚拟物出现，回答谜题</li>
                  <li>③ 答对解锁下一站并获得商户券（演示）</li>
                </ul>
                <div class="stat-row">
                  <div><b>{{ total }}</b><span>个点位</span></div>
                  <div><b>{{ config.total_rewards }}</b><span>张奖励券</span></div>
                  <div><b>{{ avgRadius }}m</b><span>平均围栏</span></div>
                </div>
                <p class="text-xs text-dim mt-3">{{ config.intro }}</p>
                <button class="yj-btn yj-btn--primary w-full mt-4" @click="start">开始寻宝</button>
              </template>

              <!-- 通关 -->
              <template v-else-if="phase === 'done'">
                <img class="guide-img" src="/assets/ar/guide/guide-celebration.webp" alt="通关庆祝" />
                <h3 class="text-center font-bold mt-3">恭喜通关 · {{ config.completion_badge || '永嘉探索者' }}</h3>
                <p class="text-xs text-secondary mt-2 text-center">{{ config.outro }}</p>
                <div class="stat-row mt-3">
                  <div><b>{{ progress?.score ?? 0 }}</b><span>积分</span></div>
                  <div><b>{{ progress?.claimed.length ?? 0 }}</b><span>已领券</span></div>
                  <div><b>{{ total }}</b><span>通关点位</span></div>
                </div>
                <img class="poster mt-3" src="/assets/ar/share/poster-achievement.webp" alt="成就海报" />
                <div class="flex gap-2 mt-3">
                  <button class="yj-btn yj-btn--ghost w-full" @click="router.push('/ar/' + config.id)">回到运营端</button>
                  <button class="yj-btn yj-btn--primary w-full" @click="replay">再玩一次</button>
                </div>
              </template>

              <!-- 寻宝中 -->
              <template v-else-if="phase === 'play' && current">
                <!-- Tab · 任务 -->
                <template v-if="tab === 'mission'">
                  <!-- 实时定位 -->
                  <div class="live">
                    <div class="live__head">
                      <span class="live__dot" :class="gpsDotClass" />
                      <b class="text-xs">实时定位</b>
                      <span class="text-xs text-dim" style="margin-left: auto">{{ gpsStatusLabel }}</span>
                    </div>
                    <div class="live__coords">
                      <span class="font-mono-sc text-xs">
                        {{ player ? `${player.lat.toFixed(5)}, ${player.lng.toFixed(5)}` : '—' }}
                      </span>
                      <span v-if="gpsActive" class="yj-tag yj-tag--indoor">实时</span>
                    </div>
                    <p class="text-xs text-secondary mt-1">{{ locationSummary }}</p>
                    <div class="flex gap-2 mt-2">
                      <button class="yj-btn yj-btn--primary yj-btn--sm" :disabled="!geoSup" @click="geoToggle">
                        {{ geoActive ? '停止定位' : '开启实时定位' }}
                      </button>
                      <button class="yj-btn yj-btn--ghost yj-btn--sm" :disabled="scanning" @click="scan">
                        {{ scanning ? '扫描中…' : '扫描附近' }}
                      </button>
                    </div>
                    <p v-if="geoError" class="text-xs mt-2" style="color: var(--color-warning)">{{ geoError }}</p>
                    <label v-if="gpsActive" class="live__follow">
                      <input v-model="autoFollow" type="checkbox" />
                      <span>自动跟随最近未通关点位</span>
                    </label>
                    <p v-if="scanHint && !scanning" class="text-xs text-dim mt-1">{{ scanHint }}</p>
                  </div>

                  <!-- 方位指引 -->
                  <div v-if="player" class="bearing">
                    <span class="bearing__arrow" :style="{ transform: `rotate(${currentBearing ?? 0}deg)` }" />
                    <span class="text-xs">
                      目标在 <b style="color: var(--color-info)">{{ currentDir }}</b>
                      ，{{ fmtDistance(reach) }}（围栏 {{ current.geofence_radius_m }}m）
                    </span>
                  </div>

                  <!-- 虚拟物：围栏内为可互动 3D 信物，围栏外为淡显引导图 -->
                  <div class="viewport" :class="{ 'viewport--in': inside }">
                    <ArRelic3D
                      v-if="inside"
                      :key="current.poi_id"
                      :relic="current.billboard"
                      :fallback-url="current.billboard_url"
                      :label="current.poi_name"
                      :collected="answered"
                      @collect="checkinNow"
                    />
                    <img v-else class="billboard billboard--faint" src="/assets/ar/guide/guide-outside-fence.webp" alt="尚未进入围栏" />
                    <span class="viewport__badge" :class="inside ? 'ok' : 'idle'">
                      {{ inside ? '已进入围栏 · 虚拟物已激活' : `距离 ${fmtDistance(reach)}（围栏 ${current.geofence_radius_m}m）` }}
                    </span>
                    <span v-if="inside && fence" class="viewport__npc">{{ fence.tip }}</span>
                    <button
                      v-if="inside && !answered"
                      class="yj-btn yj-btn--primary yj-btn--sm viewport__checkin"
                      :disabled="busy"
                      @click="checkinNow"
                    >
                      到达打卡
                    </button>
                    <span v-if="stamp" class="viewport__stamp">已打卡 ✓</span>
                  </div>

                  <!-- 题目 -->
                  <div class="q">
                    <div class="q__npc">
                      <img class="q__npc-img" :src="npcPortraitSrc(current.npc)" :alt="current.npc" loading="lazy" />
                      <div class="q__npc-meta">
                        <span class="yj-tag yj-tag--poi">{{ current.task_type === 'quiz' ? '问答' : '解谜' }}</span>
                        <span class="text-xs text-dim line-clamp-1">NPC：{{ current.npc }}</span>
                      </div>
                      <button
                        v-if="guideUrl"
                        class="yj-btn yj-btn--ghost yj-btn--sm q__npc-guide"
                        :class="{ 'is-on': guidePlaying }"
                        @click="toggleGuide"
                      >
                        {{ guidePlaying ? '暂停讲解' : '听讲解' }}
                      </button>
                    </div>
                    <audio
                      ref="guideEl"
                      :src="guideUrl || undefined"
                      preload="none"
                      @play="guidePlaying = true"
                      @pause="guidePlaying = false"
                      @ended="guidePlaying = false"
                    />
                    <p class="text-sm leading-relaxed">{{ current.question }}</p>

                    <div v-if="!answered" class="mt-3 flex gap-2 answer-row">
                      <input
                        v-model="answer"
                        class="yj-input answer-row__input"
                        :disabled="!inside"
                        :placeholder="inside ? '输入答案，如「306米」' : '先进入围栏才能作答'"
                        @keyup.enter="submit"
                      />
                      <button class="yj-btn yj-btn--primary" :disabled="!inside || busy" @click="submit">提交</button>
                    </div>

                    <div v-if="result && !result.correct" class="mt-3 hint">
                      <b>再想想：</b>{{ result.hint }}
                    </div>

                    <div v-if="answered" class="mt-3 answer">
                      <div class="text-sm"><b>答案：</b>{{ result?.expected || '已答对' }}</div>
                      <p class="text-xs text-secondary mt-1">{{ result?.explanation || `${current.poi_name} 已通关` }}</p>

                      <div v-if="current.reward_coupon_id" class="reward">
                        <img v-if="current.coupon_image" :src="current.coupon_image" :alt="current.reward_name" />
                        <div style="flex: 1; min-width: 0">
                          <div class="text-sm font-bold line-clamp-1">{{ current.reward_name }}</div>
                          <div class="text-xs text-dim">通关奖励 · 演示券</div>
                        </div>
                        <button
                          v-if="!claimedSet.has(current.reward_coupon_id)"
                          class="yj-btn yj-btn--primary yj-btn--sm"
                          :disabled="busy"
                          @click="claim"
                        >
                          领取
                        </button>
                        <span v-else class="yj-tag yj-tag--accent">已领取</span>
                      </div>

                      <button class="yj-btn yj-btn--ghost w-full mt-3" @click="next">
                        {{ activeIndex < total - 1 ? '前往下一站 →' : '查看通关结果 →' }}
                      </button>
                    </div>
                  </div>

                  <!-- 演示模拟兜底 -->
                  <div v-if="!gpsActive" class="gps">
                    <div class="gps__row">
                      <span class="text-xs text-dim">演示模拟（无定位权限时使用）</span>
                      <span class="text-xs font-mono-sc">{{ player?.lat.toFixed(5) }}, {{ player?.lng.toFixed(5) }}</span>
                    </div>
                    <div class="flex gap-2 mt-2">
                      <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="stepCloser">走近一步</button>
                      <button class="yj-btn yj-btn--primary yj-btn--sm" @click="jumpTo">一键到位</button>
                      <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="reset">回到 800m 外</button>
                    </div>
                  </div>
                </template>

                <!-- Tab · AR 实景（摄像头叠加 / 全景降级，共用同一套围栏与收集逻辑） -->
                <template v-else-if="tab === 'ar'">
                  <div class="sect-head">
                    <b class="text-sm">AR 实景寻宝</b>
                    <span class="text-xs text-dim">{{ scenePanorama ? '摄像头不可用时自动全景降级' : '静态叠加模式' }}</span>
                  </div>
                  <div class="ar-stage">
                    <ArCameraStage
                      :poi-name="current.poi_name"
                      :scene-name="sceneName"
                      :relic="current.billboard"
                      :fallback-url="current.billboard_url"
                      :panorama="scenePanorama"
                      :inside="inside"
                      :distance="reach"
                      :radius="current.geofence_radius_m"
                      :me="player"
                      :target="{ lat: current.lat, lng: current.lng }"
                      :collected="answered"
                      @collect="checkinNow"
                    />
                  </div>
                  <p class="text-xs text-dim mt-2">
                    实景模式需要授权摄像头（HTTPS 或 localhost）；未授权时自动降级为「{{ sceneName }}」全景模拟 AR，
                    方位箭头、围栏判定与信物收集逻辑完全一致。需要模拟移动请到「任务」页使用演示按钮。
                  </p>
                </template>

                <!-- Tab · 地图 -->
                <template v-else-if="tab === 'map'">
                  <div class="sect-head">
                    <b class="text-sm">寻宝地图 · 地理围栏</b>
                    <span class="text-xs text-dim">{{ gpsActive ? '实时定位中' : '模拟定位' }}</span>
                  </div>
                  <ArMap
                    :markers="markers"
                    :player="player"
                    :active-id="current?.poi_id ?? null"
                    scene="overview"
                    :height="300"
                    interactive
                    :accuracy="gpsActive ? gpsAccuracy : null"
                    :heading="gpsActive ? gpsHeading : null"
                    :route-target="{ lat: current.lat, lng: current.lng }"
                    :route-label="fmtDistance(reach)"
                    :scanning="scanning"
                    :me-label="gpsActive ? '实时定位' : '模拟位置'"
                    :pick-tip="gpsActive ? '实时定位已开启 · 地图仅作预览' : '点击地图 = 移动我的位置（模拟）'"
                    @map-click="onMapClick"
                  />
                  <div class="stat-row mt-3">
                    <div><b>{{ withinCount }}</b><span>围栏内点位</span></div>
                    <div><b>{{ fmtDistance(reach) }}</b><span>距目标</span></div>
                    <div><b>{{ currentDir || '—' }}</b><span>目标方位</span></div>
                  </div>
                  <p class="text-xs text-dim mt-3">
                    蓝色精度圈为定位误差范围，虚线为前往当前目标的连线；关闭实时定位时点击地图可模拟移动。
                  </p>
                </template>

                <!-- Tab · 附近 -->
                <template v-else-if="tab === 'nearby'">
                  <div class="sect-head">
                    <b class="text-sm">附近内容 · 实时</b>
                    <span class="text-xs text-dim">按与你的距离排序</span>
                  </div>
                  <div class="flex flex-col gap-2">
                    <button
                      v-for="row in located"
                      :key="row.point.poi_id"
                      class="pl"
                      :class="{ 'pl--on': row.index === activeIndex, 'pl--done': row.solved, 'pl--in': row.inside }"
                      @click="pickStation(row.index)"
                    >
                      <span class="pl__dir">{{ row.direction || '·' }}</span>
                      <div style="flex: 1; min-width: 0; text-align: left">
                        <div class="text-sm font-bold line-clamp-1">{{ row.point.poi_name }}</div>
                        <div class="text-xs text-dim line-clamp-1">
                          {{ fmtDistance(row.distance) }} · 围栏 {{ row.point.geofence_radius_m }}m ·
                          {{ row.point.reward_name || '无奖励' }}
                        </div>
                      </div>
                      <span v-if="row.solved" class="yj-tag yj-tag--accent">已通关</span>
                      <span v-else-if="row.inside" class="yj-tag yj-tag--indoor">已到达</span>
                      <span v-else class="pl__no">{{ row.index + 1 }}</span>
                    </button>
                  </div>
                  <p class="text-xs text-dim mt-3">
                    共 {{ total }} 站 · 当前 {{ withinCount }} 个点位已在围栏内
                    <template v-if="gpsActive">· 自动跟随{{ autoFollow ? '已开启' : '已关闭' }}</template>
                  </p>
                </template>

                <!-- Tab · 排行 -->
                <template v-else>
                  <div class="sect-head">
                    <b class="text-sm">通关排行</b>
                    <span class="yj-tag">演示数据</span>
                  </div>
                  <div v-if="records" class="flex flex-col gap-2">
                    <div v-for="r in records.leaderboard" :key="r.rank" class="rank">
                      <span class="rank__no" :class="{ 'rank__no--top': r.rank <= 3 }">{{ r.rank }}</span>
                      <span class="text-sm" style="flex: 1">{{ r.user_name }}</span>
                      <span class="text-xs font-mono-sc" style="color: var(--color-brand-500)">{{ r.score }}</span>
                    </div>
                    <div class="rank__summary">
                      参与 {{ records.summary.participants }} 人 · 通关率 {{ records.summary.completion_rate }}% ·
                      发券 {{ records.summary.coupons_claimed }} 张
                    </div>
                  </div>
                  <div v-else class="text-xs text-dim py-6 text-center">完成第一站后加载排行</div>

                  <div class="sect-head mt-4">
                    <b class="text-sm">我的进度</b>
                  </div>
                  <div class="stat-row">
                    <div><b>{{ progress?.points_done ?? 0 }}/{{ total }}</b><span>已解锁</span></div>
                    <div><b>{{ progress?.score ?? 0 }}</b><span>积分</span></div>
                    <div><b>{{ progress?.claimed.length ?? 0 }}</b><span>已领券</span></div>
                  </div>
                </template>
              </template>
            </main>

            <!-- 随行 Agent：楠楠（悬浮球 + 对话面板，知道玩家当前位置与进度） -->
            <ArAgentDock
              v-if="phase === 'play'"
              :context="agentContext"
              :session-id="`ar-${config.id}-${PLAYER_KEY}`"
            />

            <!-- 底部 Tab -->
            <nav v-if="phase === 'play'" class="tabbar">
              <button
                v-for="t in TABS"
                :key="t.key"
                class="tabbar__item"
                :class="{ on: tab === t.key }"
                @click="setTab(t.key)"
              >
                <span class="tabbar__ico">
                  <svg viewBox="0 0 24 24" aria-hidden="true" v-html="t.svg" />
                  <i v-if="t.key === 'nearby' && withinCount > 0" class="tabbar__badge" />
                  <i v-else-if="t.key === 'mission' && inside && !answered" class="tabbar__badge" />
                </span>
                {{ t.label }}
              </button>
            </nav>

            <span class="screen__home" />

            <!-- 领券弹窗（限定在屏幕内） -->
            <div v-if="showVoucher && voucher" class="sheet" @click.self="showVoucher = false">
              <div class="sheet__card">
                <span class="sheet__demo">{{ voucher.demo_label }}</span>
                <img class="sheet__coupon" :src="voucher.coupon_image" :alt="voucher.coupon.name" />
                <h3 class="font-bold mt-3 text-center">{{ voucher.coupon.name }}</h3>
                <p class="text-xs text-secondary mt-1 text-center">{{ voucher.coupon.desc }}</p>
                <p class="text-xs text-dim mt-2 text-center font-mono-sc">券号 {{ voucher.voucher_no }}</p>
                <div class="flex justify-center mt-3">
                  <DemoQr :text="voucher.qr_text" :size="110" caption="演示券码 · 不可真实核销" />
                </div>
                <p class="text-xs text-dim mt-3 text-center">{{ voucher.notice }}</p>
                <button class="yj-btn yj-btn--primary w-full mt-4" @click="showVoucher = false">收下优惠券</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <p class="stage__caption">
        玩家端入口 <span class="font-mono-sc">/play/{{ config.id }}</span> · 手机端打开并允许定位即可体验实时寻宝
      </p>
    </template>
  </div>
</template>

<style scoped>
.play-page {
  max-width: 1100px;
  margin: 0 auto;
  padding: calc(12px + var(--yjm-safe-top)) 14px 56px;
}
.guide {
  width: 240px;
  margin: 0 auto;
  display: block;
  border-radius: var(--radius-md);
}

/* ---------- 演示台工具条 ---------- */
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 0 4px 16px;
}
.toolbar__title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.toolbar__acts {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* ---------- 手机外壳 ---------- */
.stage {
  display: flex;
  justify-content: center;
}
.phone {
  position: relative;
  width: 390px;
  max-width: 100%;
  height: min(800px, calc(100vh - 190px));
  min-height: 560px;
  padding: 11px;
  border-radius: 48px;
  background: linear-gradient(150deg, #38414f 0%, #1b2129 42%, #0e1218 100%);
  box-shadow:
    0 34px 70px rgba(0, 0, 0, 0.6),
    0 0 0 1px rgba(255, 255, 255, 0.06),
    inset 0 1px 1px rgba(255, 255, 255, 0.14);
}
.phone__island {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  width: 108px;
  height: 24px;
  border-radius: 999px;
  background: #04060a;
  z-index: 30;
}
.phone__side {
  position: absolute;
  width: 3px;
  border-radius: 3px;
  background: linear-gradient(180deg, #4a5361, #232a33);
}
.phone__side--power {
  right: -3px;
  top: 168px;
  height: 78px;
}
.phone__side--vol {
  left: -3px;
  top: 140px;
  height: 52px;
}

/* ---------- 屏幕 ---------- */
.screen {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  border-radius: 38px;
  overflow: hidden;
  background:
    radial-gradient(120% 60% at 50% 0%, color-mix(in srgb, var(--tpl-color) 18%, transparent), transparent 62%),
    var(--color-bg-base);
}
.statusbar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 24px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
}
.statusbar__icons {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-secondary);
}
.appbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 16px 12px;
  border-bottom: 1px solid var(--color-line-strong);
}
.appbar__left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.appbar__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--tpl-color);
  box-shadow: 0 0 10px var(--tpl-color);
  flex: none;
}
.appbar__name {
  font-size: 15px;
  font-weight: 700;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.appbar__sub {
  font-size: 11px;
  color: var(--color-text-tertiary);
}
.ring {
  position: relative;
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: conic-gradient(var(--tpl-color) 0 var(--p), rgba(148, 163, 184, 0.16) var(--p) 100%);
  display: grid;
  place-items: center;
}
.ring span {
  position: absolute;
  inset: 5px;
  border-radius: 50%;
  background: var(--color-surface-1);
  display: grid;
  place-items: center;
  font-size: 10px;
  font-weight: 700;
  font-family: var(--font-mono);
  color: var(--color-text-secondary);
}

/* ---------- 屏幕内容 ---------- */
.screen__body {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 12px 14px 18px;
  scrollbar-width: none;
}
.screen__body::-webkit-scrollbar {
  display: none;
}
.guide-img {
  width: 100%;
  border-radius: var(--radius-lg);
}
.intro__hero {
  position: relative;
  border-radius: var(--radius-xl);
  overflow: hidden;
  border: 1px solid var(--color-line-strong);
}
.intro__img {
  display: block;
  width: 100%;
}
.intro__badge {
  position: absolute;
  top: 10px;
  left: 10px;
  font-size: 11px;
  color: var(--color-brand-100);
  border: 1px solid rgba(62, 198, 184, 0.4);
  border-radius: 999px;
  padding: 2px 9px;
  background: rgba(10, 18, 32, 0.62);
}
.rules {
  margin: 10px 0 0;
  padding-left: 16px;
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: var(--lh-normal);
}
.sect-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.stat-row {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.stat-row > div {
  flex: 1;
  min-width: 0;
  text-align: center;
  padding: 9px 5px;
  border: 1px solid var(--color-line-strong);
  border-radius: var(--radius-md);
  background: rgba(22, 38, 63, 0.5);
}
.stat-row b {
  display: block;
  font-size: 15px;
  font-family: var(--font-mono);
  color: var(--tpl-color);
}
.stat-row span {
  font-size: 10px;
  color: var(--color-text-tertiary);
}

/* ---------- 底部 Tab ---------- */
.tabbar {
  flex: none;
  display: flex;
  align-items: stretch;
  border-top: 1px solid var(--color-line-strong);
  background: rgba(10, 18, 32, 0.72);
  backdrop-filter: blur(14px);
  padding-bottom: 6px;
}
.tabbar__item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 9px 0 5px;
  border: none;
  background: transparent;
  color: var(--color-text-tertiary);
  font: inherit;
  font-size: 10px;
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out);
}
.tabbar__item.on {
  color: var(--tpl-color);
}
.tabbar__ico {
  position: relative;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
}
.tabbar__ico svg {
  width: 22px;
  height: 22px;
}
.tabbar__badge {
  position: absolute;
  top: -1px;
  right: -2px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #f87171;
  box-shadow: 0 0 8px rgba(248, 113, 113, 0.9);
}
.screen__home {
  flex: none;
  display: block;
  width: 118px;
  height: 4px;
  margin: 0 auto 7px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.45);
}

/* ---------- 实时定位 ---------- */
.live {
  padding: 10px;
  border: 1px solid rgba(96, 165, 250, 0.35);
  border-radius: var(--radius-md);
  background: rgba(96, 165, 250, 0.07);
}
.live__head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.live__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-tertiary);
  flex: none;
}
.live__dot.idle {
  background: var(--color-text-tertiary);
}
.live__dot.wait {
  background: var(--color-warning);
  animation: blink 1s ease-in-out infinite;
}
.live__dot.on {
  background: var(--color-success);
  box-shadow: 0 0 10px rgba(74, 222, 128, 0.85);
  animation: blink 1.8s ease-in-out infinite;
}
.live__dot.off {
  background: var(--color-danger);
}
.live__coords {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  color: var(--color-text-secondary);
}
.live__follow {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--color-text-secondary);
  cursor: pointer;
}
.live__follow input {
  accent-color: var(--tpl-color);
}

/* ---------- 方位指引 ---------- */
.bearing {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding: 7px 10px;
  border: 1px solid var(--color-line-strong);
  border-radius: var(--radius-md);
  background: rgba(22, 38, 63, 0.5);
}
.bearing__arrow {
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-bottom: 12px solid var(--color-info);
  transform-origin: 50% 60%;
  transition: transform var(--dur-base) var(--ease-out);
  flex: none;
}

/* ---------- 虚拟物 ---------- */
/* ---------- AR 实景舞台 ---------- */
.ar-stage {
  position: relative;
  margin-top: 12px;
  height: min(56vh, 360px);
  border-radius: var(--radius-lg);
  overflow: hidden;
  border: 1px solid var(--color-line-strong);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.42);
}

.viewport {
  position: relative;
  margin-top: 12px;
  height: 232px;
  border-radius: var(--radius-lg);
  border: 1px dashed var(--color-line-strong);
  background: radial-gradient(circle at 50% 60%, rgba(62, 198, 184, 0.1), rgba(10, 18, 32, 0.9));
  display: grid;
  place-items: center;
  overflow: hidden;
}
.viewport--in {
  border-color: var(--color-accent-500);
  box-shadow: inset 0 0 40px rgba(232, 184, 75, 0.16);
}
.billboard {
  max-height: 155px;
  max-width: 78%;
  animation: appear var(--dur-slow) var(--ease-spring);
  filter: drop-shadow(0 10px 24px rgba(0, 0, 0, 0.5));
}
.billboard--faint {
  opacity: 0.42;
  max-height: 120px;
}
.viewport__badge {
  position: absolute;
  top: 8px;
  left: 8px;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-line-strong);
  background: rgba(10, 18, 32, 0.75);
  color: var(--color-text-secondary);
}
.viewport__badge.ok {
  color: var(--color-success);
  border-color: rgba(74, 222, 128, 0.45);
}
.viewport__npc {
  position: absolute;
  bottom: 8px;
  left: 8px;
  right: 8px;
  font-size: 11px;
  color: var(--color-text-secondary);
  background: rgba(10, 18, 32, 0.75);
  border-radius: var(--radius-sm);
  padding: 4px 8px;
}
.viewport__checkin {
  position: absolute;
  right: 8px;
  bottom: 8px;
  z-index: 6;
}
.viewport__stamp {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: 0.1em;
  color: var(--color-success);
  border: 3px solid rgba(74, 222, 128, 0.7);
  border-radius: var(--radius-lg);
  text-shadow: 0 0 18px rgba(74, 222, 128, 0.7);
  animation: stampIn var(--dur-slow) var(--ease-spring);
  pointer-events: none;
}

/* ---------- 题目 ---------- */
.q {
  margin-top: 12px;
}
.q__npc {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.q__npc-img {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border-radius: 10px;
  object-fit: cover;
  background: var(--color-bg-base);
  border: 1px solid var(--color-line-strong);
}
.q__npc-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}
.q__npc-guide {
  flex-shrink: 0;
}
.q__npc-guide.is-on {
  border-color: var(--color-brand-500);
  color: var(--color-brand-500);
  background: var(--color-brand-soft);
}
.hint {
  font-size: 12px;
  color: var(--color-warning);
  background: rgba(251, 191, 36, 0.08);
  border: 1px solid rgba(251, 191, 36, 0.28);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
}
/* 答题行：输入框可收缩吃剩余宽、提交按钮不被挤压，窄屏不重叠；
   16px 字号防 iOS Safari 聚焦自动缩放页面 */
.answer-row {
  min-width: 0;
}
.answer-row__input {
  flex: 1 1 0%;
  min-width: 0;
  width: auto;
  font-size: 16px;
}
.answer-row .yj-btn {
  flex: 0 0 auto;
  white-space: nowrap;
}
.answer {
  border-top: 1px dashed var(--color-line-strong);
  padding-top: 10px;
}
.reward {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  padding: 8px;
  border-radius: var(--radius-md);
  border: 1px solid rgba(232, 184, 75, 0.35);
  background: var(--color-accent-soft);
}
.reward img {
  width: 72px;
  height: 42px;
  object-fit: cover;
  border-radius: var(--radius-sm);
}

/* ---------- 演示模拟 ---------- */
.gps {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--color-line-strong);
}
.gps__row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.poster {
  width: 100%;
  border-radius: var(--radius-md);
}

/* ---------- 列表 ---------- */
.pl {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--color-line-strong);
  border-radius: var(--radius-sm);
  background: rgba(22, 38, 63, 0.45);
  cursor: pointer;
  width: 100%;
  font: inherit;
  color: inherit;
  text-align: left;
  transition: border-color var(--dur-fast) var(--ease-out);
}
.pl:hover {
  border-color: var(--color-line-strong);
}
.pl--on {
  border-color: var(--tpl-color);
}
.pl--done {
  opacity: 0.72;
}
.pl--in {
  box-shadow: inset 0 0 0 1px rgba(74, 222, 128, 0.35);
}
.pl__no {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 700;
  background: var(--color-brand-soft);
  color: var(--color-brand-500);
  flex: none;
}
.pl__dir {
  width: 32px;
  font-size: 11px;
  color: var(--color-info);
  text-align: center;
  flex: none;
}
.rank {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: rgba(22, 38, 63, 0.45);
}
.rank__no {
  width: 20px;
  text-align: center;
  font-size: 12px;
  color: var(--color-text-tertiary);
  font-weight: 700;
}
.rank__no--top {
  color: var(--color-accent-500);
}
.rank__summary {
  margin-top: 8px;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

/* ---------- 券弹窗（限定在屏幕内） ---------- */
.sheet {
  position: absolute;
  inset: 0;
  z-index: 60;
  border-radius: inherit;
  background: rgba(4, 8, 16, 0.76);
  display: grid;
  place-items: center;
  padding: 16px;
  overflow-y: auto;
}
.sheet__card {
  position: relative;
  width: 100%;
  background: var(--color-surface-1);
  border: 1px solid var(--color-line-strong);
  border-radius: var(--radius-xl);
  padding: 16px;
  box-shadow: var(--shadow-modal);
}
.sheet__demo {
  position: absolute;
  top: 10px;
  right: 12px;
  font-size: 11px;
  color: var(--color-accent-500);
  border: 1px solid rgba(232, 184, 75, 0.4);
  border-radius: var(--radius-pill);
  padding: 2px 8px;
  background: var(--color-accent-soft);
}
.sheet__coupon {
  width: 100%;
  border-radius: var(--radius-md);
  margin-top: 16px;
}

.stage__caption {
  margin: 16px 0 0;
  text-align: center;
  font-size: 12px;
  color: var(--color-text-tertiary);
}

@keyframes appear {
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.86);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes stampIn {
  from {
    opacity: 0;
    transform: rotate(-12deg) scale(1.6);
  }
  to {
    opacity: 1;
    transform: rotate(-12deg) scale(1);
  }
}
@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
</style>


