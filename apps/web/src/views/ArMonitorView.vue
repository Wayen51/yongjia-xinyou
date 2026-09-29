<script setup lang="ts">
/**
 * 运营端 · 玩家位置监控（后台管理大屏）
 * 把玩家端原来那套大屏布局独立出来，用于运营人员在后台查看游客实时位置、进度与点位到访分布。
 * 数据口径：本机设备使用浏览器实时定位；其余玩家为演示轨迹（明确标注「演示」），不做伪造。
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "@/api/client";
import ArMap from "@/components/ar/ArMap.vue";
import type { ArMapMarker } from "@/components/ar/types";
import { bearingDeg, compassLabel, distanceM, fmtDistance, stepToward } from "@/lib/geo";
import { openPlayerEntry } from "@/lib/playerEntry";
import { useGeolocation } from "@/lib/useGeolocation";
import type { ArPlayConfig, ArRecordsResp } from "@/types/api";

const route = useRoute();
const router = useRouter();
const gameId = computed(() => String(route.params.id));

interface Tracked {
  id: string;
  name: string;
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  updatedAt: number;
  doneCount: number;
  targetIndex: number;
  completed: boolean;
  isSelf: boolean;
}

const config = ref<ArPlayConfig | null>(null);
const records = ref<ArRecordsResp | null>(null);
const loading = ref(true);
const error = ref("");
const paused = ref(false);
const selectedId = ref("");

/* ---------- 本机实时定位 ---------- */
const { supported: geoSup, status: geoStatus, coords: geoCoords, error: geoError, active: geoActive, located: geoLocated, toggle: geoToggle } = useGeolocation();
const gpsActive = computed(() => geoActive.value && geoLocated.value);

const geoStatusText = computed(() => {
  switch (geoStatus.value) {
    case "idle":
      return "未开启（当前显示演示数据）";
    case "requesting":
      return "正在请求定位…";
    case "active":
      return gpsActive.value ? "定位中 · 实时上报" : "等待首次定位…";
    case "denied":
      return "权限被拒绝";
    case "unsupported":
      return "浏览器不支持定位";
    default:
      return "定位异常";
  }
});

/* ---------- 演示玩家：围绕点位生成可解释的轨迹 ---------- */
const DEMO_NAMES = ["阿岩", "小楠", "林夕", "老周", "可儿", "石头", "七七", "阿May"];
const players = ref<Tracked[]>([]);

function seedDemo() {
  const pts = config.value?.points ?? [];
  if (!pts.length) return;
  players.value = DEMO_NAMES.slice(0, Math.min(DEMO_NAMES.length, Math.max(3, pts.length + 2))).map((name, i) => {
    const done = i % Math.max(1, pts.length);
    const targetIndex = done % pts.length;
    const t = pts[targetIndex];
    // 以目标点位为中心，用确定性的角度/半径散布，避免每次刷新位置乱跳
    const ang = (i * 137.5 * Math.PI) / 180;
    const r = 180 + ((i * 97) % 420);
    const dLat = (r * Math.cos(ang)) / 111000;
    const dLng = (r * Math.sin(ang)) / (111000 * Math.cos((t.lat * Math.PI) / 180) || 1);
    return {
      id: `demo-${i}`,
      name,
      lat: t.lat + dLat,
      lng: t.lng + dLng,
      accuracy: 12 + ((i * 7) % 26),
      heading: Math.round((i * 53) % 360),
      speed: 1.1 + ((i % 5) * 0.3),
      updatedAt: Date.now() - i * 4000,
      doneCount: done + (done > 0 ? 1 : 0),
      targetIndex,
      completed: false,
      isSelf: false,
    };
  });
}

/** 每 2 秒推进一次演示轨迹：缓慢走向目标点位，进围栏即记一次到访 */
function tick() {
  if (paused.value) return;
  const pts = config.value?.points ?? [];
  if (!pts.length) return;
  const now = Date.now();
  players.value = players.value.map((p) => {
    const t = pts[p.targetIndex];
    if (!t) return p;
    const d = distanceM(p.lat, p.lng, t.lat, t.lng);
    const heading = bearingDeg(p.lat, p.lng, t.lat, t.lng);
    if (d <= t.geofence_radius_m) {
      const nextIndex = (p.targetIndex + 1) % pts.length;
      return {
        ...p,
        heading,
        doneCount: Math.min(pts.length, p.doneCount + 1),
        targetIndex: nextIndex,
        completed: p.doneCount + 1 >= pts.length,
        updatedAt: now,
      };
    }
    return {
      ...p,
      ...stepToward(p, t, 0.05),
      heading,
      updatedAt: now,
    };
  });
}

/* ---------- 汇总 ---------- */
const selfPlayer = computed<Tracked | null>(() => {
  const c = geoCoords.value;
  if (!gpsActive.value || !c) return null;
  const pts = config.value?.points ?? [];
  let targetIndex = 0;
  let best = Number.POSITIVE_INFINITY;
  pts.forEach((p, i) => {
    const d = distanceM(c.lat, c.lng, p.lat, p.lng);
    if (d < best) {
      best = d;
      targetIndex = i;
    }
  });
  return {
    id: "self",
    name: "本机设备（你）",
    lat: c.lat,
    lng: c.lng,
    accuracy: c.accuracy ?? 0,
    heading: c.heading ?? null,
    speed: c.speed ?? null,
    updatedAt: Date.now(),
    doneCount: 0,
    targetIndex,
    completed: false,
    isSelf: true,
  };
});

const all = computed<Tracked[]>(() => {
  const list = [...players.value];
  if (selfPlayer.value) list.unshift(selfPlayer.value);
  return list;
});

const selected = computed(() => all.value.find((p) => p.id === selectedId.value) ?? all.value[0] ?? null);

const points = computed(() => config.value?.points ?? []);

/** 单个玩家的实时状态：距目标距离 / 是否在围栏内 / 方位 */
function statusOf(p: Tracked) {
  const t = points.value[p.targetIndex];
  if (!t) return { distance: 0, inside: false, direction: "—", target: null, done: p.completed };
  const d = distanceM(p.lat, p.lng, t.lat, t.lng);
  return {
    distance: d,
    inside: d <= t.geofence_radius_m,
    direction: compassLabel(bearingDeg(p.lat, p.lng, t.lat, t.lng)),
    target: t,
    done: p.completed,
  };
}

const withinCount = computed(() => all.value.filter((p) => statusOf(p).inside).length);
const onlineCount = computed(() => all.value.length);

const markers = computed<ArMapMarker[]>(() =>
  points.value.map((p, i) => ({
    id: p.poi_id,
    name: p.poi_name,
    lat: p.lat,
    lng: p.lng,
    radius: p.geofence_radius_m,
    order: i + 1,
    state: "pending",
    sub: `围栏 ${p.geofence_radius_m}m`,
  })),
);

/** 其他玩家（地图上的小圆点） */
const peers = computed(() =>
  all.value
    .filter((p) => p.id !== selected.value?.id)
    .map((p) => {
      const s = statusOf(p);
      return {
        id: p.id,
        name: p.name,
        lat: p.lat,
        lng: p.lng,
        state: s.done ? "done" : s.inside ? "inside" : "outside",
      };
    }),
);

const selectedStatus = computed(() => (selected.value ? statusOf(selected.value) : null));

/** 点位到访分布：多少个玩家走过该点位 */
const visitStats = computed(() =>
  points.value.map((p, i) => {
    const count = all.value.filter((x) => x.doneCount > i).length;
    return { point: p, count, pct: all.value.length ? Math.round((count / all.value.length) * 100) : 0 };
  }),
);

const fmtTime = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
};
const agoText = (ts: number) => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s} 秒前`;
  return `${Math.round(s / 60)} 分钟前`;
};

let timer: ReturnType<typeof setInterval> | undefined;

async function load() {
  loading.value = true;
  try {
    config.value = await api.arPlay(gameId.value);
    records.value = await api.arRecords(gameId.value);
    seedDemo();
    selectedId.value = all.value[0]?.id ?? "";
  } catch (e) {
    error.value = (e as Error).message || "加载失败";
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
  timer = setInterval(tick, 2000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div class="monitor">
    <div v-if="loading" class="text-center text-secondary py-16">加载监控数据…</div>

    <div v-else-if="error" class="yj-card text-center py-14">
      <h2 class="font-bold">无法加载该游戏</h2>
      <p class="text-sm text-secondary mt-2">{{ error }}</p>
      <button class="yj-btn yj-btn--ghost mt-4" @click="router.push('/ar')">返回游戏列表</button>
    </div>

    <template v-else-if="config">
      <!-- 头部 -->
      <header class="mon-head">
        <div class="mon-head__left">
          <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="router.push('/ar/' + config.id)">← 返回游戏详情</button>
          <div>
            <div class="mon-head__title">
              <h1>玩家位置监控</h1>
              <span class="yj-tag yj-tag--accent">后台管理</span>
              <span class="yj-tag">{{ config.name }}</span>
            </div>
            <p class="text-xs text-dim">
              用于运营人员查看游客实时位置与进度 · 游戏 ID <span class="font-mono-sc">{{ config.id }}</span>
            </p>
          </div>
        </div>
        <div class="mon-head__acts">
          <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="paused = !paused">
            {{ paused ? '▶ 恢复刷新' : '⏸ 暂停刷新' }}
          </button>
          <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="openPlayerEntry(config.id)">玩家端预览</button>
          <button class="yj-btn yj-btn--primary yj-btn--sm" :disabled="!geoSup" @click="geoToggle">
            {{ geoActive ? '停止本机定位' : '开启本机定位' }}
          </button>
        </div>
      </header>

      <!-- 指标 -->
      <div class="tiles">
        <div class="tile">
          <span class="tile__k">在线玩家</span>
          <b class="tile__v">{{ onlineCount }}</b>
          <span class="tile__s">含本机与演示轨迹</span>
        </div>
        <div class="tile">
          <span class="tile__k">围栏内</span>
          <b class="tile__v" style="color: var(--success)">{{ withinCount }}</b>
          <span class="tile__s">已触发虚拟物</span>
        </div>
        <div class="tile">
          <span class="tile__k">参与人数</span>
          <b class="tile__v">{{ records?.summary.participants ?? 0 }}</b>
          <span class="tile__s">累计进入游戏</span>
        </div>
        <div class="tile">
          <span class="tile__k">通关率</span>
          <b class="tile__v">{{ records?.summary.completion_rate ?? 0 }}%</b>
          <span class="tile__s">全点位完成</span>
        </div>
        <div class="tile">
          <span class="tile__k">已发券</span>
          <b class="tile__v" style="color: var(--accent)">{{ records?.summary.coupons_claimed ?? 0 }}</b>
          <span class="tile__s">演示券</span>
        </div>
      </div>

      <div class="mon-grid">
        <!-- 左：地图 + 列表 -->
        <div class="flex flex-col gap-6">
          <section class="yj-card">
            <div class="flex items-center justify-between mb-3">
              <h2 class="font-bold">玩家实时位置</h2>
              <span class="text-xs text-dim">
                <template v-if="selected">地图聚焦：{{ selected.name }} · 每 2 秒刷新</template>
                <template v-else>暂无玩家位置</template>
              </span>
            </div>
            <ArMap
              :markers="markers"
              :player="selected ? { lat: selected.lat, lng: selected.lng } : null"
              :active-id="selectedStatus?.target?.poi_id ?? null"
              scene="overview"
              :height="420"
              :draggable="false"
              :accuracy="selected?.isSelf ? selected.accuracy : null"
              :heading="selected?.heading ?? null"
              :route-target="selectedStatus?.target ? { lat: selectedStatus.target.lat, lng: selectedStatus.target.lng } : null"
              :route-label="selectedStatus ? fmtDistance(selectedStatus.distance) : ''"
              :me-label="selected ? selected.name : '未定位'"
              :peers="peers"
            />
            <div class="legend">
              <span><i class="lg lg--me" />当前聚焦玩家</span>
              <span><i class="lg lg--inside" />围栏内玩家</span>
              <span><i class="lg lg--outside" />围栏外玩家</span>
              <span><i class="lg lg--poi" />寻宝点位</span>
              <span><i class="lg lg--fence" />地理围栏</span>
            </div>
          </section>

          <section class="yj-card">
            <div class="flex items-center justify-between mb-3">
              <h2 class="font-bold">玩家位置列表</h2>
              <span class="text-xs text-dim">点击任意行，地图与右侧面板会聚焦该玩家</span>
            </div>
            <div class="tbl-wrap">
              <table class="tbl">
                <thead>
                  <tr>
                    <th>玩家</th>
                    <th>当前目标</th>
                    <th>距离</th>
                    <th>方位</th>
                    <th>状态</th>
                    <th>进度</th>
                    <th>上报时间</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="p in all"
                    :key="p.id"
                    :class="{ 'row--on': p.id === selected?.id }"
                    @click="selectedId = p.id"
                  >
                    <td>
                      <span class="who">
                        <i class="who__dot" :class="p.isSelf ? 'who__dot--self' : 'who__dot--demo'" />
                        <span class="who__name">{{ p.name }}</span>
                        <span v-if="p.isSelf" class="yj-tag yj-tag--indoor">实时</span>
                        <span v-else class="yj-tag">演示</span>
                      </span>
                    </td>
                    <td class="text-sm">{{ statusOf(p).target?.poi_name ?? '—' }}</td>
                    <td class="font-mono-sc text-xs">{{ statusOf(p).target ? fmtDistance(statusOf(p).distance) : '—' }}</td>
                    <td class="text-xs" style="color: var(--color-info)">{{ statusOf(p).direction }}</td>
                    <td>
                      <span v-if="statusOf(p).done" class="yj-tag yj-tag--accent">已通关</span>
                      <span v-else-if="statusOf(p).inside" class="yj-tag yj-tag--indoor">围栏内</span>
                      <span v-else class="yj-tag">前往中</span>
                    </td>
                    <td class="text-xs font-mono-sc">{{ p.doneCount }}/{{ points.length }}</td>
                    <td class="text-xs text-dim">{{ fmtTime(p.updatedAt) }}（{{ agoText(p.updatedAt) }}）</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <!-- 右：实时定位 + 点位到访 + 排行 -->
        <aside class="flex flex-col gap-6">
          <section class="yj-card">
            <h2 class="font-bold mb-3">本机实时定位</h2>
            <div class="kv">
              <span>定位状态</span>
              <b :class="gpsActive ? 'ok' : 'dim'">{{ geoStatusText }}</b>
            </div>
            <div class="kv">
              <span>经纬度</span>
              <b class="font-mono-sc text-xs">
                {{ geoCoords ? `${geoCoords.lat.toFixed(6)}, ${geoCoords.lng.toFixed(6)}` : '—' }}
              </b>
            </div>
            <div class="kv">
              <span>精度半径</span>
              <b class="font-mono-sc text-xs">{{ geoCoords?.accuracy != null ? `±${Math.round(geoCoords.accuracy)} m` : '—' }}</b>
            </div>
            <div class="kv">
              <span>设备朝向</span>
              <b class="font-mono-sc text-xs">{{ geoCoords?.heading != null ? `${Math.round(geoCoords.heading)}°` : '—' }}</b>
            </div>
            <div class="kv">
              <span>移动速度</span>
              <b class="font-mono-sc text-xs">{{ geoCoords?.speed != null ? `${geoCoords.speed.toFixed(1)} m/s` : '—' }}</b>
            </div>
            <div class="kv">
              <span>最近点位</span>
              <b class="text-xs">{{ selectedStatus?.target?.poi_name ?? '—' }}</b>
            </div>
            <p v-if="geoError" class="text-xs mt-2" style="color: var(--warning)">{{ geoError }}</p>
            <button class="yj-btn yj-btn--ghost w-full mt-3" :disabled="!geoSup" @click="geoToggle">
              {{ geoActive ? '停止定位' : '开启实时定位' }}
            </button>
            <p class="text-xs text-dim mt-2">
              开启后本机将作为「实时」玩家出现在地图与列表中；未开启时仅展示演示轨迹。
            </p>
          </section>

          <section class="yj-card">
            <div class="flex items-center justify-between mb-3">
              <h2 class="font-bold">点位到访分布</h2>
              <span class="text-xs text-dim">{{ all.length }} 位玩家</span>
            </div>
            <div class="flex flex-col gap-3">
              <div v-for="(s, i) in visitStats" :key="s.point.poi_id">
                <div class="flex items-center justify-between text-xs mb-1">
                  <span class="line-clamp-1">{{ i + 1 }}. {{ s.point.poi_name }}</span>
                  <span class="font-mono-sc" style="color: var(--text-dim)">{{ s.count }} 人</span>
                </div>
                <div class="bar"><span :style="{ width: `${s.pct}%` }" /></div>
              </div>
              <p v-if="!visitStats.length" class="text-xs text-dim">该游戏暂无点位</p>
            </div>
          </section>

          <section class="yj-card">
            <div class="flex items-center justify-between mb-3">
              <h2 class="font-bold">通关排行</h2>
              <span class="yj-tag">服务端数据</span>
            </div>
            <div v-if="records?.leaderboard.length" class="flex flex-col gap-2">
              <div v-for="r in records.leaderboard" :key="r.rank" class="rank">
                <span class="rank__no" :class="{ 'rank__no--top': r.rank <= 3 }">{{ r.rank }}</span>
                <span class="text-sm" style="flex: 1">{{ r.user_name }}</span>
                <span class="text-xs font-mono-sc" style="color: var(--primary)">{{ r.score }}</span>
              </div>
            </div>
            <p v-else class="text-xs text-dim">暂无排行数据</p>
          </section>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.monitor {
  max-width: 1480px;
  margin: 0 auto;
  padding: 24px 20px 64px;
}
.mon-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}
.mon-head__left {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}
.mon-head__title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.mon-head__title h1 {
  font-size: 22px;
  font-weight: 800;
  margin: 0;
}
.mon-head__acts {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* 指标卡 */
.tiles {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}
.tile {
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: rgba(22, 38, 63, 0.45);
}
.tile__k {
  display: block;
  font-size: 12px;
  color: var(--text-dim);
}
.tile__v {
  display: block;
  font-size: 26px;
  line-height: 1.2;
  font-family: var(--font-mono);
  color: var(--text-primary);
}
.tile__s {
  font-size: 11px;
  color: var(--text-dim);
}

.mon-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 20px;
  align-items: start;
}
@media (max-width: 1180px) {
  .mon-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .tiles {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

/* 图例 */
.legend {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-top: 12px;
  font-size: 11px;
  color: var(--text-dim);
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.lg {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}
.lg--me {
  background: var(--color-info);
  box-shadow: 0 0 8px rgba(96, 165, 250, 0.9);
}
.lg--inside {
  background: var(--success);
}
.lg--outside {
  background: rgba(148, 163, 184, 0.95);
}
.lg--poi {
  background: var(--primary);
  border-radius: 3px;
}
.lg--fence {
  background: transparent;
  border: 1.5px dashed rgba(232, 184, 75, 0.8);
}

/* 表格 */
.tbl-wrap {
  overflow-x: auto;
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.tbl th {
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-dim);
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.tbl td {
  padding: 9px 10px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.tbl tbody tr {
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}
.tbl tbody tr:hover {
  background: rgba(96, 165, 250, 0.07);
}
.row--on {
  background: rgba(96, 165, 250, 0.12);
}
.who {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.who__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.who__dot--self {
  background: var(--color-info);
  box-shadow: 0 0 8px rgba(96, 165, 250, 0.9);
}
.who__dot--demo {
  background: rgba(148, 163, 184, 0.95);
}
.who__name {
  font-weight: 600;
}

/* 右侧 */
.kv {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px dashed var(--border);
  font-size: 12px;
}
.kv:last-of-type {
  border-bottom: none;
}
.kv > span {
  color: var(--text-dim);
}
.kv b.ok {
  color: var(--success);
}
.kv b.dim {
  color: var(--text-secondary);
}
.bar {
  height: 6px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.16);
  overflow: hidden;
}
.bar span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--primary), var(--accent));
  transition: width var(--dur-slow) var(--ease-out);
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
  font-weight: 700;
  color: var(--text-dim);
}
.rank__no--top {
  color: var(--accent);
}
</style>
