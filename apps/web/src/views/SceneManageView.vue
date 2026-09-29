<script setup lang="ts">
/**
 * 永嘉 3D 景点场景管理（运营端）
 *
 * 场景是「3D 云游 / 效果展示 / AR 寻宝」三处共用的底座，本页负责：
 * - 场景总览：数量、启用状态、热点总数、AR 锚点对游戏点位的覆盖率
 * - 场景编辑：名称/描述/主题色/标签/排序/上下线
 * - 素材绑定：全景图、缩略图、热点文件、3D 模型
 * - AR 锚点：经纬度 + 围栏半径（AR 寻宝直接读这份坐标）
 * - 默认视角：yaw / pitch / fov（云游与效果展示的入场机位）
 * - 热点编辑：热点的名称、朝向、图标、讲解文案，可随时回退到素材文件
 *
 * 演示口径：热点默认读 public 素材 JSON；一旦在本页保存过，就写入数据库覆盖，
 * 不改动原始素材文件（可一键「恢复素材热点」还原）。
 */
import { computed, onMounted, ref } from "vue";
import { api } from "@/api/client";
import PanoViewer from "@/components/space/PanoViewer.vue";
import { toast } from "@/lib/toast";
import type { PanoHotspot, SceneHotspot, SceneRecord, SceneStats } from "@/types/api";

const scenes = ref<SceneRecord[]>([]);
const stats = ref<SceneStats | null>(null);
const loading = ref(true);
const keyword = ref("");

/** 编辑中的草稿（深拷贝，取消即丢弃） */
const draft = ref<SceneRecord | null>(null);
/** 抽屉处于「新建」还是「编辑」：决定保存走 POST 还是 PATCH */
const isNew = ref(false);
const editTab = ref<"base" | "assets" | "anchor" | "hotspots">("base");
const saving = ref(false);
/** 热点是否被改过：只有改过才写库，避免把「读素材」冻结成「自定义」 */
const hotspotsMode = ref<"file" | "custom">("file");
const preview = ref<SceneRecord | null>(null);
const previewHotspot = ref<SceneHotspot | null>(null);

const TABS: Array<{ id: typeof editTab.value; label: string }> = [
  { id: "base", label: "基础信息" },
  { id: "assets", label: "素材绑定" },
  { id: "anchor", label: "AR 锚点" },
  { id: "hotspots", label: "热点编排" },
];

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase();
  if (!k) return scenes.value;
  return scenes.value.filter(
    (s) =>
      s.name.toLowerCase().includes(k) ||
      s.id.toLowerCase().includes(k) ||
      s.poi_id.toLowerCase().includes(k)
  );
});

const statCards = computed(() => [
  { label: "场景总数", value: stats.value?.total ?? 0, hint: "永嘉 3D 景点场景" },
  { label: "已启用", value: stats.value?.enabled ?? 0, hint: "云游/展示可见" },
  { label: "热点总数", value: stats.value?.hotspot_count ?? 0, hint: "可讲解点位" },
  {
    label: "锚点覆盖",
    value: `${stats.value?.covered_by_games ?? 0}/${stats.value?.anchored ?? 0}`,
    hint: `已挂到 AR 游戏点位（共 ${stats.value?.games ?? 0} 个游戏）`,
  },
]);

/** SceneHotspot → PanoViewer 需要的形状（补齐可选字段） */
function asPano(list: SceneHotspot[]): PanoHotspot[] {
  return list.map((h) => ({
    id: h.id,
    name: h.name,
    position: h.position,
    icon: h.icon || "pin",
    title: h.title,
    content: h.content,
    source: h.source || "",
    action: h.action || { type: "info", target: "" },
  }));
}

async function load() {
  loading.value = true;
  try {
    const [list, st] = await Promise.all([api.scenes(), api.sceneStats()]);
    scenes.value = list.scenes;
    stats.value = st;
  } catch (e) {
    toast((e as Error).message || "加载失败", "error");
  } finally {
    loading.value = false;
  }
}

function openEdit(s: SceneRecord) {
  draft.value = JSON.parse(JSON.stringify(s)) as SceneRecord;
  hotspotsMode.value = s.hotspots_source;
  editTab.value = "base";
  isNew.value = false;
}

/**
 * 新建场景：复用同一个抽屉，只是保存时改走 POST。
 *
 * 此前本页只能改已有场景（`api.sceneCreate` 一直闲置），新增场景得手改数据库，
 * 演示时「加一个景点」这件事做不了。默认值刻意与后端 `createScene` 的兜底一致，
 * 免得前端塞空值、后端再兜一遍，两边口径漂移。
 */
function openCreate() {
  draft.value = {
    id: "",
    name: "",
    poi_id: "",
    description: "",
    panorama: "",
    thumbnail: "",
    hotspots_file: "",
    hotspots: [],
    hotspots_source: "file",
    model_3d: "",
    ar_lat: null,
    ar_lng: null,
    ar_radius_m: 60,
    default_yaw: 0,
    default_pitch: -10,
    default_fov: 75,
    tags: [],
    theme_color: "#3ec6b8",
    enabled: true,
    sort_order: 99,
    visit_count: 0,
    updated_at: "",
  };
  hotspotsMode.value = "file";
  editTab.value = "base";
  isNew.value = true;
}

function closeEdit() {
  draft.value = null;
  isNew.value = false;
}

async function save() {
  const d = draft.value;
  if (!d) return;
  if (!d.name.trim()) {
    toast("场景名称不能为空", "error");
    return;
  }
  // 场景 id 会进 URL 与素材路径，限死字符集；留空则由后端生成 scene-xxxxxx
  const newId = d.id.trim();
  if (isNew.value && newId && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(newId)) {
    toast("场景 ID 只能用字母、数字、下划线和连字符", "error");
    return;
  }
  saving.value = true;
  try {
    const payload: Record<string, unknown> = {
      name: d.name,
      poi_id: d.poi_id,
      description: d.description,
      panorama: d.panorama,
      thumbnail: d.thumbnail,
      hotspots_file: d.hotspots_file,
      model_3d: d.model_3d,
      ar_lat: d.ar_lat,
      ar_lng: d.ar_lng,
      ar_radius_m: d.ar_radius_m,
      default_yaw: d.default_yaw,
      default_pitch: d.default_pitch,
      default_fov: d.default_fov,
      tags: d.tags,
      theme_color: d.theme_color,
      enabled: d.enabled,
      sort_order: d.sort_order,
    };
    // 只有动过热点才提交：'file' 表示回退到素材文件，'custom' 表示保存自定义编排
    const originalMode = scenes.value.find((x) => x.id === d.id)?.hotspots_source;
    if (hotspotsMode.value !== originalMode) {
      payload.hotspots = hotspotsMode.value === "file" ? null : d.hotspots;
    } else if (hotspotsMode.value === "custom") {
      payload.hotspots = d.hotspots;
    }
    if (isNew.value) {
      if (newId) payload.id = newId;
      await api.sceneCreate(payload);
      toast(`已新建场景：${d.name}`, "success");
    } else {
      await api.sceneUpdate(d.id, payload);
      toast(`已保存：${d.name}`, "success");
    }
    closeEdit();
    load();
  } catch (e) {
    toast((e as Error).message || (isNew.value ? "新建失败" : "保存失败"), "error");
  } finally {
    saving.value = false;
  }
}

async function toggleEnabled(s: SceneRecord) {
  try {
    await api.sceneUpdate(s.id, { enabled: !s.enabled });
    toast(`${s.name} ${s.enabled ? "已下线" : "已启用"}`, "info");
    load();
  } catch (e) {
    toast((e as Error).message || "操作失败", "error");
  }
}

async function removeScene(s: SceneRecord) {
  if (!window.confirm(`确认删除场景「${s.name}」？AR 寻宝的点位坐标不会受影响，但云游与展示将不再包含该场景。`)) return;
  try {
    await api.sceneDelete(s.id);
    toast("已删除", "info");
    load();
  } catch (e) {
    toast((e as Error).message || "删除失败", "error");
  }
}

/* ---------- 热点编辑 ---------- */
function addHotspot() {
  const d = draft.value;
  if (!d) return;
  d.hotspots.push({
    id: `hotspot-${Date.now().toString(36).slice(-4)}`,
    name: "新热点",
    position: { yaw: 0, pitch: 0 },
    icon: "pin",
    title: "新热点",
    content: "",
  });
  hotspotsMode.value = "custom";
}

function removeHotspot(i: number) {
  const d = draft.value;
  if (!d) return;
  d.hotspots.splice(i, 1);
  hotspotsMode.value = "custom";
}

function markHotspotsCustom() {
  hotspotsMode.value = "custom";
}

function useFileHotspots() {
  hotspotsMode.value = "file";
  toast("已切换为「素材文件热点」，保存后生效", "info");
}

function openPreview(s: SceneRecord) {
  preview.value = s;
  previewHotspot.value = null;
}

onMounted(load);
</script>

<template>
  <div class="page page-wide py-8">
    <!-- 页头 -->
    <div class="flex flex-wrap items-end justify-between gap-4 mb-5">
      <div>
        <h1 class="text-2xl font-bold tracking-wide">永嘉 3D 景点场景管理</h1>
        <p class="section-sub mt-1">
          全景与 3D 素材 → 场景编排 → AR 锚点校准 · 一份场景底座，同时驱动「3D 云游 / 效果展示 / AR 寻宝」
        </p>
        <p class="text-xs text-dim mt-1.5">
          浏览合计 {{ stats?.total_visits ?? 0 }} · 今日新增 {{ stats?.today_visits ?? 0 }} · 真实埋点累计
          {{ stats?.real_visits ?? 0 }}（由展示端打开场景时上报，不再是静态演示值）
        </p>
      </div>
      <div class="flex gap-2">
        <input v-model="keyword" class="yj-input" style="width: 200px" placeholder="搜索场景 / 点位…" />
        <button class="yj-btn yj-btn--primary" @click="openCreate">＋ 新建场景</button>
        <button class="yj-btn yj-btn--ghost" @click="load">刷新</button>
        <button class="yj-btn yj-btn--primary" @click="$router.push('/showcase')">查看 Agent 效果展示</button>
      </div>
    </div>

    <!-- 指标 -->
    <div class="grid gap-4 mb-6" style="grid-template-columns: repeat(4, 1fr)">
      <div v-for="c in statCards" :key="c.label" class="yj-card text-center">
        <div class="text-2xl font-bold font-mono-sc" style="color: var(--primary)">{{ c.value }}</div>
        <div class="text-sm mt-1">{{ c.label }}</div>
        <div class="text-xs text-dim mt-0.5">{{ c.hint }}</div>
      </div>
    </div>

    <div v-if="loading" class="text-center text-secondary py-16">加载中…</div>

    <div v-else-if="filtered.length === 0" class="yj-card text-center py-16">
      <p class="text-secondary">{{ keyword.trim() ? "没有匹配的场景" : "还没有任何场景" }}</p>
      <button class="yj-btn yj-btn--primary mt-4" @click="openCreate">＋ 新建场景</button>
    </div>

    <!-- 场景卡片 -->
    <div v-else class="grid gap-5" style="grid-template-columns: repeat(3, 1fr)">
      <div v-for="s in filtered" :key="s.id" class="yj-card yj-card--hover sc-card">
        <div class="sc-cover" :style="{ '--sc-color': s.theme_color }" @click="openPreview(s)">
          <img
            :src="s.thumbnail || s.panorama"
            :alt="s.name"
            loading="lazy"
            @error="($event.target as HTMLImageElement).src = '/assets/img/kb/poi-001-cover.webp'"
          />
          <div class="sc-cover__shade" />
          <span class="yj-tag sc-cover__poi">{{ s.poi_id || "未关联点位" }}</span>
          <span class="yj-tag sc-cover__state" :class="s.enabled ? 'tone-ok' : 'tone-idle'">
            {{ s.enabled ? "已启用" : "已下线" }}
          </span>
          <div class="sc-cover__meta">
            <span>{{ s.hotspots.length }} 个热点</span>
            <span>
              浏览 {{ s.visit_count }}
              <em v-if="s.visit_today" class="sc-cover__live">今日 +{{ s.visit_today }}</em>
            </span>
            <span>{{ s.default_fov }}° 视场</span>
          </div>
        </div>

        <div class="pt-3">
          <h3 class="font-bold leading-snug line-clamp-1">{{ s.name }}</h3>
          <p class="text-xs text-secondary mt-1 line-clamp-2" style="min-height: 32px">{{ s.description }}</p>

          <div class="flex gap-1 flex-wrap mt-2">
            <span v-for="t in s.tags" :key="t" class="yj-tag" style="font-size: 10px">{{ t }}</span>
            <span v-if="s.hotspots_source === 'custom'" class="yj-tag yj-tag--accent" style="font-size: 10px">
              热点已自定义
            </span>
          </div>

          <div class="sc-anchor">
            <template v-if="s.ar_lat != null && s.ar_lng != null">
              <span class="font-mono-sc">{{ s.ar_lat.toFixed(5) }}, {{ s.ar_lng.toFixed(5) }}</span>
              <span class="text-dim">围栏 {{ s.ar_radius_m }}m</span>
            </template>
            <span v-else class="text-dim">未设置 AR 锚点</span>
          </div>

          <div class="flex items-center justify-between mt-3 gap-2 flex-wrap">
            <span class="text-xs font-mono-sc text-dim">{{ s.id }}</span>
            <div class="flex gap-2">
              <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="openPreview(s)">全景</button>
              <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="openEdit(s)">编辑</button>
              <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="toggleEnabled(s)">
                {{ s.enabled ? "下线" : "启用" }}
              </button>
              <button class="yj-btn yj-btn--danger yj-btn--sm" @click="removeScene(s)">删除</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 全景预览弹层 -->
    <div v-if="preview" class="sc-modal" @click.self="preview = null">
      <div class="sc-modal__card">
        <header class="sc-modal__head">
          <b>{{ preview.name }}</b>
          <span class="text-xs text-dim">{{ preview.poi_id }} · {{ preview.hotspots.length }} 个热点</span>
          <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="preview = null">关闭</button>
        </header>
        <div class="sc-modal__body">
          <PanoViewer
            :panorama="preview.panorama"
            :hotspots="asPano(preview.hotspots)"
            :initial-yaw="preview.default_yaw"
            :initial-pitch="preview.default_pitch"
            :initial-fov="preview.default_fov"
            :auto-rotate="true"
            @hotspot="(h) => (previewHotspot = h as unknown as SceneHotspot)"
          />
        </div>
        <footer class="sc-modal__foot">
          <div v-if="previewHotspot" class="sc-hot">
            <b>{{ previewHotspot.title }}</b>
            <p class="text-xs text-secondary mt-1">{{ previewHotspot.content }}</p>
          </div>
          <p v-else class="text-xs text-dim">拖动画面环视，点击画面中的热点图标查看讲解内容。</p>
        </footer>
      </div>
    </div>

    <!-- 编辑抽屉 -->
    <div v-if="draft" class="sc-drawer" @click.self="closeEdit">
      <aside class="sc-drawer__panel">
        <header class="sc-drawer__head">
          <div style="min-width: 0">
            <b class="line-clamp-1">{{ draft.name || (isNew ? "新建场景" : "") }}</b>
            <span class="text-xs font-mono-sc text-dim">{{ isNew ? "保存后写入场景库" : draft.id }}</span>
          </div>
          <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="closeEdit">取消</button>
          <button class="yj-btn yj-btn--primary yj-btn--sm" :disabled="saving" @click="save">
            {{ saving ? (isNew ? "创建中…" : "保存中…") : isNew ? "创建" : "保存" }}
          </button>
        </header>

        <nav class="sc-drawer__tabs">
          <button
            v-for="t in TABS"
            :key="t.id"
            type="button"
            :class="{ on: editTab === t.id }"
            @click="editTab = t.id"
          >
            {{ t.label }}
          </button>
        </nav>

        <div class="sc-drawer__body">
          <!-- 基础信息 -->
          <template v-if="editTab === 'base'">
            <label v-if="isNew" class="sc-field">
              <span>场景 ID（留空自动生成）</span>
              <input v-model="draft.id" class="yj-input" placeholder="如 scene-yandang-new" />
            </label>
            <label class="sc-field">
              <span>场景名称</span>
              <input v-model="draft.name" class="yj-input" placeholder="如 芙蓉古村" />
            </label>
            <label class="sc-field">
              <span>关联点位 ID</span>
              <input v-model="draft.poi_id" class="yj-input" placeholder="如 POI-001" />
            </label>
            <label class="sc-field">
              <span>场景描述</span>
              <textarea v-model="draft.description" class="yj-input" rows="3" />
            </label>
            <label class="sc-field">
              <span>标签（逗号分隔）</span>
              <input
                class="yj-input"
                :value="draft.tags.join('、')"
                @input="draft.tags = ($event.target as HTMLInputElement).value.split(/[、,，]/).map((x) => x.trim()).filter(Boolean)"
              />
            </label>
            <div class="sc-row">
              <label class="sc-field">
                <span>主题色</span>
                <input v-model="draft.theme_color" type="color" class="sc-color" />
              </label>
              <label class="sc-field">
                <span>排序</span>
                <input v-model.number="draft.sort_order" type="number" class="yj-input" />
              </label>
            </div>
            <label class="sc-switch">
              <input v-model="draft.enabled" type="checkbox" />
              <span>在大屏巡航与 3D 云游中启用该场景</span>
            </label>
          </template>

          <!-- 素材绑定 -->
          <template v-else-if="editTab === 'assets'">
            <label class="sc-field">
              <span>360° 全景图路径</span>
              <input v-model="draft.panorama" class="yj-input" placeholder="/assets/pano/xxx.webp" />
            </label>
            <label class="sc-field">
              <span>缩略图路径</span>
              <input v-model="draft.thumbnail" class="yj-input" />
            </label>
            <label class="sc-field">
              <span>热点素材文件</span>
              <input v-model="draft.hotspots_file" class="yj-input" placeholder="/assets/3d/pano_xxx_hotspots.json" />
            </label>
            <label class="sc-field">
              <span>3D 模型（可选）</span>
              <input v-model="draft.model_3d" class="yj-input" placeholder="/assets/3d/xxx.glb" />
            </label>
            <div class="sc-preview">
              <img v-if="draft.panorama" :src="draft.panorama" alt="全景预览" />
              <p v-else class="text-xs text-dim">未绑定全景图</p>
            </div>
          </template>

          <!-- AR 锚点 -->
          <template v-else-if="editTab === 'anchor'">
            <p class="text-xs text-dim mb-3">
              AR 寻宝直接读取这里的坐标与围栏半径；与「AR 互动 · 点位管理」保持一致即可让寻宝点位落在真实景点上。
            </p>
            <div class="sc-row">
              <label class="sc-field">
                <span>纬度 lat</span>
                <input v-model.number="draft.ar_lat" type="number" step="0.000001" class="yj-input" />
              </label>
              <label class="sc-field">
                <span>经度 lng</span>
                <input v-model.number="draft.ar_lng" type="number" step="0.000001" class="yj-input" />
              </label>
            </div>
            <label class="sc-field">
              <span>围栏半径（米）</span>
              <input v-model.number="draft.ar_radius_m" type="number" class="yj-input" />
            </label>
            <div class="sc-row">
              <label class="sc-field">
                <span>默认 yaw</span>
                <input v-model.number="draft.default_yaw" type="number" class="yj-input" />
              </label>
              <label class="sc-field">
                <span>默认 pitch</span>
                <input v-model.number="draft.default_pitch" type="number" class="yj-input" />
              </label>
              <label class="sc-field">
                <span>视场 fov</span>
                <input v-model.number="draft.default_fov" type="number" class="yj-input" />
              </label>
            </div>
            <div class="sc-note">
              <b>入场机位</b>
              <span>yaw/pitch/fov 决定玩家进入全景与效果展示时的第一视角。</span>
            </div>
          </template>

          <!-- 热点编排 -->
          <template v-else>
            <div class="sc-hotbar">
              <span class="yj-tag" :class="hotspotsMode === 'custom' ? 'yj-tag--accent' : ''">
                {{ hotspotsMode === "file" ? "读自素材文件" : "自定义编排" }}
              </span>
              <span class="text-xs text-dim">{{ draft.hotspots.length }} 个热点</span>
              <div class="flex gap-2" style="margin-left: auto">
                <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="useFileHotspots">恢复素材热点</button>
                <button class="yj-btn yj-btn--primary yj-btn--sm" @click="addHotspot">＋ 新增</button>
              </div>
            </div>

            <div v-for="(h, i) in draft.hotspots" :key="h.id" class="sc-hotcard">
              <div class="sc-hotcard__head">
                <input v-model="h.name" class="yj-input" style="width: 110px" @input="markHotspotsCustom" />
                <input v-model="h.icon" class="yj-input" style="width: 86px" placeholder="icon" @input="markHotspotsCustom" />
                <button class="yj-btn yj-btn--danger yj-btn--sm" @click="removeHotspot(i)">删除</button>
              </div>
              <label class="sc-field">
                <span>标题</span>
                <input v-model="h.title" class="yj-input" @input="markHotspotsCustom" />
              </label>
              <label class="sc-field">
                <span>讲解内容</span>
                <textarea v-model="h.content" class="yj-input" rows="3" @input="markHotspotsCustom" />
              </label>
              <div class="sc-row">
                <label class="sc-field">
                  <span>yaw</span>
                  <input v-model.number="h.position.yaw" type="number" class="yj-input" @input="markHotspotsCustom" />
                </label>
                <label class="sc-field">
                  <span>pitch</span>
                  <input v-model.number="h.position.pitch" type="number" class="yj-input" @input="markHotspotsCustom" />
                </label>
              </div>
            </div>
            <p v-if="!draft.hotspots.length" class="text-xs text-dim py-4 text-center">
              暂无热点，点击「＋ 新增」或「恢复素材热点」
            </p>
          </template>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
/* ---------- 卡片 ---------- */
.sc-cover {
  position: relative;
  border-radius: var(--radius-md);
  overflow: hidden;
  cursor: pointer;
  aspect-ratio: 16 / 9;
  background: var(--bg-elevated);
}
.sc-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.sc-cover__shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 38%, rgba(4, 8, 16, 0.9)),
    linear-gradient(90deg, color-mix(in srgb, var(--sc-color) 42%, transparent), transparent 62%);
}
.sc-cover__poi {
  position: absolute;
  left: 8px;
  top: 8px;
}
.sc-cover__state {
  position: absolute;
  right: 8px;
  top: 8px;
}
.sc-cover__meta {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 8px;
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--text-secondary);
}
/* 今日新增：真实埋点增量，用主色标出来，和静态基线数字区分开 */
.sc-cover__live {
  font-style: normal;
  color: var(--primary);
  margin-left: 2px;
}
.tone-ok {
  color: var(--success);
  border-color: rgba(74, 222, 128, 0.4);
  background: rgba(74, 222, 128, 0.1);
}
.tone-idle {
  color: var(--text-secondary);
  border-color: var(--border);
  background: rgba(107, 120, 145, 0.12);
}
.sc-anchor {
  display: flex;
  gap: 10px;
  align-items: baseline;
  margin-top: 8px;
  padding: 5px 9px;
  border-radius: var(--radius-sm);
  background: rgba(62, 198, 184, 0.07);
  border: 1px solid var(--border);
  font-size: 11px;
}

/* ---------- 弹层 ---------- */
.sc-modal {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(3, 6, 12, 0.78);
  display: grid;
  place-items: center;
  padding: 24px;
  backdrop-filter: blur(4px);
}
.sc-modal__card {
  width: min(1000px, 100%);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  overflow: hidden;
}
.sc-modal__head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.sc-modal__head b {
  font-size: 15px;
}
.sc-modal__head button {
  margin-left: auto;
}
.sc-modal__body {
  position: relative;
  height: min(62vh, 520px);
}
.sc-modal__foot {
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  min-height: 62px;
}
.sc-hot b {
  font-size: 13px;
  color: var(--accent);
}

/* ---------- 抽屉 ---------- */
.sc-drawer {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: rgba(3, 6, 12, 0.66);
  display: flex;
  justify-content: flex-end;
  backdrop-filter: blur(3px);
}
.sc-drawer__panel {
  width: min(520px, 100%);
  height: 100%;
  background: var(--bg-elevated);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}
.sc-drawer__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}
.sc-drawer__head > div {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.sc-drawer__tabs {
  display: flex;
  gap: 4px;
  padding: 10px 16px 0;
}
.sc-drawer__tabs button {
  padding: 6px 12px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12.5px;
  cursor: pointer;
}
.sc-drawer__tabs button.on {
  background: rgba(62, 198, 184, 0.16);
  color: var(--accent);
}
.sc-drawer__body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

/* ---------- 表单 ---------- */
.sc-field {
  display: block;
  margin-bottom: 12px;
}
.sc-field > span {
  display: block;
  font-size: 11.5px;
  color: var(--text-dim);
  margin-bottom: 4px;
}
.sc-row {
  display: flex;
  gap: 10px;
}
.sc-row .sc-field {
  flex: 1;
  min-width: 0;
}
.sc-color {
  width: 100%;
  height: 34px;
  padding: 2px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: transparent;
}
.sc-switch {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-secondary);
}
.sc-preview {
  margin-top: 8px;
  border-radius: var(--radius-md);
  overflow: hidden;
  border: 1px solid var(--border);
}
.sc-preview img {
  width: 100%;
  display: block;
}
.sc-note {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: rgba(62, 198, 184, 0.07);
  border: 1px solid var(--border);
  font-size: 12px;
}
.sc-note b {
  color: var(--accent);
}
.sc-note span {
  color: var(--text-secondary);
}

/* ---------- 热点卡 ---------- */
.sc-hotbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.sc-hotcard {
  padding: 12px;
  margin-bottom: 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.03);
}
.sc-hotcard__head {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.sc-hotcard__head button {
  margin-left: auto;
}
</style>
