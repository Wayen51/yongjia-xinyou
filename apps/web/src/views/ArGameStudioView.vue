<script setup lang="ts">
/**
 * 板块二 · AR 互动：运营端创建台
 * 三步：① 选节日模板 → ② AI 生成剧情谜题（可编辑） → ③ 地图打点定位·发布
 * AI 生成走后端 /api/ar/ai/generate：配置了 LLM 走真实模型，否则本地模板编排，前端无感。
 */
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "@/api/client";
import ArMap from "@/components/ar/ArMap.vue";
import type { ArMapMarker } from "@/components/ar/types";
import { distanceM } from "@/lib/geo";
import { toast } from "@/lib/toast";
import { NPC_OPTIONS, npcPortraitSrc } from "@/lib/npc";
import type { ArCoupon, ArPoi, ArTemplate, ArTemplateStation } from "@/types/api";

const router = useRouter();

const steps = [
  { id: 1, name: "选模板", hint: "节日玩法基调" },
  { id: 2, name: "AI 生成剧情", hint: "谜题与奖励" },
  { id: 3, name: "地图打点", hint: "定位与发布" },
];
const step = ref(1);
const busy = ref(false);

const templates = ref<ArTemplate[]>([]);
const pois = ref<ArPoi[]>([]);
const coupons = ref<ArCoupon[]>([]);
const aiNotice = ref("");

const BILLBOARDS = [
  { file: "billboard-lantern.webp", label: "灯笼" },
  { file: "billboard-lotus-lamp.webp", label: "莲花灯" },
  { file: "billboard-treasure.webp", label: "宝箱" },
  { file: "billboard-fu-bag.webp", label: "福袋" },
  { file: "billboard-gift-box.webp", label: "礼盒" },
  { file: "billboard-coupon.webp", label: "券符" },
  { file: "billboard-scroll.webp", label: "卷轴" },
  { file: "billboard-nannan-sprite.webp", label: "楠楠" },
];
/** NPC 引导员选项：统一取自 lib/npc，file 为 assets/ar/billboard 下的真实素材文件名 */
const NPCS = NPC_OPTIONS;

interface DraftStation {
  poi_id: string;
  name: string;
  task: string;
  question: string;
  answer: string;
  hint: string;
  explanation: string;
  billboard: string;
  npc: string;
  reward_coupon_id: string;
  geofence_radius_m: number;
}

const form = reactive({
  name: "",
  template_id: "culture",
  theme_name: "",
  difficulty: "medium",
  point_count: 4,
  start_date: new Date().toISOString().slice(0, 10),
  end_date: "2026-12-31",
  completion_badge: "永嘉文化达人",
  intro: "",
  outro: "",
});

const stations = ref<DraftStation[]>([]);
const poiKeyword = ref("");

const currentTemplate = computed(() => templates.value.find((t) => t.id === form.template_id));
const chosenIds = computed(() => stations.value.map((s) => s.poi_id));
const poiOf = (id: string) => pois.value.find((p) => p.id === id);

const markers = computed<ArMapMarker[]>(() =>
  stations.value.map((s, i) => {
    const poi = poiOf(s.poi_id);
    return {
      id: s.poi_id,
      name: s.name,
      lat: poi?.lat ?? 0,
      lng: poi?.lng ?? 0,
      radius: s.geofence_radius_m,
      order: i + 1,
      state: i === 0 ? "current" : "pending",
      sub: s.task,
    };
  }),
);

const filteredPois = computed(() => {
  const kw = poiKeyword.value.trim();
  const list = kw ? pois.value.filter((p) => p.name.includes(kw) || p.id.includes(kw.toUpperCase())) : pois.value;
  return list.slice(0, 40);
});

onMounted(async () => {
  try {
    const [tpl, poi, cps] = await Promise.all([api.arTemplates(), api.arPois(), api.arCoupons()]);
    templates.value = tpl.templates;
    pois.value = poi.points;
    coupons.value = cps.coupons;
    form.template_id = tpl.default || "culture";
    form.theme_name = currentTemplate.value?.name || "";
    form.completion_badge = `${currentTemplate.value?.festival || "永嘉"}达人`;
  } catch (e) {
    toast((e as Error).message || "基础数据加载失败", "error");
  }
});

function pickTemplate(id: string) {
  const tpl = templates.value.find((t) => t.id === id);
  form.template_id = id;
  form.theme_name = tpl?.name || "";
  form.completion_badge = `${tpl?.festival || "永嘉"}达人`;
  form.intro = tpl?.intro || "";
  form.outro = tpl?.outro || "";
}

async function generate() {
  if (!form.name.trim()) {
    form.name = `${currentTemplate.value?.festival || "永嘉"}寻宝 · ${new Date().getMonth() + 1}月场`;
  }
  busy.value = true;
  try {
    const res = await api.arGenerateStory({
      template_id: form.template_id,
      theme_name: form.theme_name,
      difficulty: form.difficulty,
      poi_ids: chosenIds.value,
      point_count: form.point_count,
    });
    form.intro = res.intro || form.intro;
    form.outro = res.outro || form.outro;
    aiNotice.value = `${res.mode === "llm" ? "LLM 生成" : "本地模板编排"} · ${res.notice}`;
    stations.value = res.stations.map((s: ArTemplateStation, i: number) => {
      const poi = poiOf(s.poi_id);
      const coupon = coupons.value.find((c) => c.name === s.reward?.name) ?? coupons.value[i % coupons.value.length];
      return {
        poi_id: s.poi_id,
        name: poi?.name || s.name,
        task: s.task,
        question: s.question,
        answer: s.answer,
        hint: s.hint,
        explanation: "",
        billboard: BILLBOARDS[i % BILLBOARDS.length].file,
        npc: NPCS[i % NPCS.length].file,
        reward_coupon_id: coupon?.id || "",
        geofence_radius_m: poi?.radius || 50,
      };
    });
    step.value = 2;
    toast(`已生成 ${stations.value.length} 个点位剧情`, "success");
  } catch (e) {
    toast((e as Error).message || "生成失败", "error");
  } finally {
    busy.value = false;
  }
}

function addPoi(poi: ArPoi) {
  if (chosenIds.value.includes(poi.id)) {
    toast(`${poi.name} 已在点位中`, "info");
    return;
  }
  const i = stations.value.length;
  stations.value.push({
    poi_id: poi.id,
    name: poi.name,
    task: ["实地寻踪", "文脉解谜", "舌尖记忆", "山水留影"][i % 4],
    question: `请在 ${poi.name} 找到楠楠留下的虚拟物，说出这里最代表永嘉的一样事物。`,
    answer: poi.name,
    hint: `走到 ${poi.name} 附近，虚拟物会自动亮起`,
    explanation: "",
    billboard: BILLBOARDS[i % BILLBOARDS.length].file,
    npc: NPCS[i % NPCS.length].file,
    reward_coupon_id: coupons.value[i % Math.max(1, coupons.value.length)]?.id || "",
    geofence_radius_m: poi.radius || 50,
  });
  toast(`已加入点位：${poi.name}`, "success");
}

function onMapClick(ll: { lat: number; lng: number }) {
  if (!pois.value.length) return;
  const nearest = pois.value
    .map((p) => ({ p, d: distanceM(ll.lat, ll.lng, p.lat, p.lng) }))
    .sort((a, b) => a.d - b.d)[0];
  if (!nearest) return;
  addPoi(nearest.p);
}

function move(id: string, dir: -1 | 1) {
  const i = stations.value.findIndex((s) => s.poi_id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= stations.value.length) return;
  const arr = stations.value;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

function removeStation(id: string) {
  stations.value = stations.value.filter((s) => s.poi_id !== id);
}

async function save(publish: boolean) {
  if (!form.name.trim()) return toast("请填写游戏名称", "error");
  if (!stations.value.length) return toast("请至少配置一个点位", "error");
  busy.value = true;
  try {
    const created = await api.arCreateGame({
      name: form.name,
      template_id: form.template_id,
      intro: form.intro,
      outro: form.outro,
      theme: currentTemplate.value?.color,
      start_date: form.start_date,
      end_date: form.end_date,
      completion_badge: form.completion_badge,
      ai_mode: aiNotice.value.includes("LLM") ? "llm" : "mock",
      publish,
      points: stations.value.map((s, i) => ({
        poi_id: s.poi_id,
        order: i + 1,
        billboard: s.billboard,
        task_type: "quiz",
        npc: NPCS.find((n) => n.file === s.npc)?.label || "楠楠",
        question: s.question,
        answer: s.answer,
        hint: s.hint,
        explanation: s.explanation || `${s.name}：${s.answer}`,
        reward_coupon_id: s.reward_coupon_id || null,
        geofence_radius_m: s.geofence_radius_m,
      })),
    });
    toast(publish ? "已发布，玩家端可进入" : "已存为草稿", "success");
    router.push(`/ar/${created.id}`);
  } catch (e) {
    toast((e as Error).message || "保存失败", "error");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="page page-wide py-8">
    <div class="flex flex-wrap items-end justify-between gap-4 mb-5">
      <div>
        <h1 class="text-2xl font-bold tracking-wide">创建 AR 互动游戏</h1>
        <p class="section-sub mt-1">选节日模板 → AI 生成剧情谜题 → 地图打点 → 发布上线</p>
      </div>
      <button class="yj-btn yj-btn--ghost" @click="router.push('/ar')">返回列表</button>
    </div>

    <!-- 步骤条 -->
    <div class="steps mb-6">
      <div
        v-for="s in steps"
        :key="s.id"
        class="steps__item"
        :class="{ 'steps__item--on': step === s.id, 'steps__item--done': step > s.id }"
        @click="step = s.id"
      >
        <span class="steps__no">{{ s.id }}</span>
        <div>
          <div class="font-bold text-sm">{{ s.name }}</div>
          <div class="text-xs text-dim">{{ s.hint }}</div>
        </div>
      </div>
    </div>

    <div class="grid gap-6" style="grid-template-columns: 1fr 360px">
      <div>
        <!-- ① 模板 -->
        <section v-show="step === 1" class="yj-card">
          <h2 class="font-bold mb-3">① 选择节日模板</h2>
          <div class="grid gap-4 mb-5" style="grid-template-columns: repeat(3, 1fr)">
            <button
              v-for="t in templates"
              :key="t.id"
              class="tpl"
              :class="{ 'tpl--on': form.template_id === t.id }"
              :style="{ '--tpl-color': t.color.primary || 'var(--primary)' }"
              @click="pickTemplate(t.id)"
            >
              <img :src="`/assets/ar/theme/${t.id}/card.webp`" :alt="t.name" />
              <div class="tpl__body">
                <div class="font-bold text-sm">{{ t.name }}</div>
                <div class="text-xs text-dim mt-0.5">{{ t.subtitle }}</div>
                <div class="text-xs mt-1" :style="{ color: t.color.primary }">{{ t.festival }}</div>
              </div>
            </button>
          </div>

          <h2 class="font-bold mb-3">游戏信息</h2>
          <div class="grid gap-4" style="grid-template-columns: repeat(2, 1fr)">
            <label class="field">
              <span>游戏名称</span>
              <input v-model="form.name" class="yj-input" placeholder="如：石桅岩文化寻宝" />
            </label>
            <label class="field">
              <span>主题名（用于剧情文案）</span>
              <input v-model="form.theme_name" class="yj-input" />
            </label>
            <label class="field">
              <span>开始日期</span>
              <input v-model="form.start_date" type="date" class="yj-input" />
            </label>
            <label class="field">
              <span>结束日期</span>
              <input v-model="form.end_date" type="date" class="yj-input" />
            </label>
            <label class="field">
              <span>题目难度</span>
              <select v-model="form.difficulty" class="yj-input">
                <option value="easy">简单 · 贴近常识</option>
                <option value="medium">中等 · 需现场观察</option>
                <option value="hard">困难 · 联系永嘉文史</option>
              </select>
            </label>
            <label class="field">
              <span>点位数（{{ form.point_count }}）</span>
              <input v-model.number="form.point_count" type="range" min="2" max="6" class="yj-range" />
            </label>
            <label class="field" style="grid-column: span 2">
              <span>通关徽章</span>
              <input v-model="form.completion_badge" class="yj-input" />
            </label>
          </div>

          <div class="flex justify-end mt-5">
            <button class="yj-btn yj-btn--primary" :disabled="busy" @click="generate">
              {{ busy ? "AI 生成中…" : "② 生成剧情谜题 →" }}
            </button>
          </div>
        </section>

        <!-- ② AI 生成 -->
        <section v-show="step === 2" class="yj-card">
          <div class="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <h2 class="font-bold">② AI 生成剧情谜题</h2>
            <div class="flex gap-2 items-center">
              <span v-if="aiNotice" class="text-xs text-dim">{{ aiNotice }}</span>
              <button class="yj-btn yj-btn--ghost yj-btn--sm" :disabled="busy" @click="generate">重新生成</button>
            </div>
          </div>

          <div class="grid gap-4 mb-4" style="grid-template-columns: repeat(2, 1fr)">
            <label class="field">
              <span>开场剧情</span>
              <textarea v-model="form.intro" class="yj-input" rows="4" />
            </label>
            <label class="field">
              <span>通关结语</span>
              <textarea v-model="form.outro" class="yj-input" rows="4" />
            </label>
          </div>

          <div v-if="!stations.length" class="text-center text-secondary py-10">
            尚未生成，点击右上「重新生成」或回到第 ① 步
          </div>

          <div v-else class="flex flex-col gap-3">
            <div v-for="(s, i) in stations" :key="s.poi_id" class="station">
              <div class="flex items-center justify-between mb-2 gap-2">
                <div class="flex items-center gap-2">
                  <span class="station__no">{{ i + 1 }}</span>
                  <b class="text-sm">{{ s.name }}</b>
                  <span class="yj-tag">{{ s.task }}</span>
                </div>
                <button class="yj-btn yj-btn--danger yj-btn--sm" @click="removeStation(s.poi_id)">移除</button>
              </div>
              <div class="grid gap-3" style="grid-template-columns: repeat(2, 1fr)">
                <label class="field" style="grid-column: span 2">
                  <span>题目</span>
                  <textarea v-model="s.question" class="yj-input" rows="2" />
                </label>
                <label class="field">
                  <span>标准答案</span>
                  <input v-model="s.answer" class="yj-input" />
                </label>
                <label class="field">
                  <span>提示</span>
                  <input v-model="s.hint" class="yj-input" />
                </label>
                <label class="field">
                  <span>虚拟物</span>
                  <select v-model="s.billboard" class="yj-input">
                    <option v-for="b in BILLBOARDS" :key="b.file" :value="b.file">{{ b.label }}</option>
                  </select>
                </label>
                <label class="field">
                  <span>NPC 引导员</span>
                  <div class="npc-pick">
                    <img class="npc-pick__img" :src="npcPortraitSrc(s.npc)" alt="" loading="lazy" />
                    <select v-model="s.npc" class="yj-input">
                      <option v-for="n in NPCS" :key="n.file" :value="n.file">{{ n.label }}</option>
                    </select>
                  </div>
                </label>
                <label class="field" style="grid-column: span 2">
                  <span>通关奖励券</span>
                  <select v-model="s.reward_coupon_id" class="yj-input">
                    <option value="">不设奖励</option>
                    <option v-for="c in coupons" :key="c.id" :value="c.id">{{ c.name }}（{{ c.value_label }}）</option>
                  </select>
                </label>
              </div>
            </div>
          </div>

          <div class="flex justify-between mt-5">
            <button class="yj-btn yj-btn--ghost" @click="step = 1">← 上一步</button>
            <button class="yj-btn yj-btn--primary" @click="step = 3">③ 地图打点 →</button>
          </div>
        </section>

        <!-- ③ 地图打点 -->
        <section v-show="step === 3" class="yj-card">
          <div class="flex items-center justify-between mb-3">
            <h2 class="font-bold">③ 地图打点 · 围栏半径</h2>
            <span class="text-xs text-dim">点击底图自动吸附最近点位，拖动标记可微调位置</span>
          </div>

          <ArMap
            :markers="markers"
            scene="overview"
            :height="420"
            interactive
            draggable
            @map-click="onMapClick"
          />

          <div class="grid gap-4 mt-5" style="grid-template-columns: 1fr 1fr">
            <div>
              <div class="flex items-center gap-2 mb-2">
                <b class="text-sm">点位库</b>
                <input v-model="poiKeyword" class="yj-input" style="max-width: 180px" placeholder="搜索景点/商家" />
              </div>
              <div class="poi-list">
                <button
                  v-for="p in filteredPois"
                  :key="p.id"
                  class="poi"
                  :class="{ 'poi--on': chosenIds.includes(p.id) }"
                  @click="addPoi(p)"
                >
                  <span class="poi__name">{{ p.name }}</span>
                  <span class="text-xs text-dim">{{ p.type }} · 半径 {{ p.radius }}m</span>
                </button>
              </div>
            </div>

            <div>
              <b class="text-sm">已选点位（{{ stations.length }}）</b>
              <div class="flex flex-col gap-2 mt-2">
                <div v-for="(s, i) in stations" :key="s.poi_id" class="sel">
                  <span class="station__no">{{ i + 1 }}</span>
                  <div style="flex: 1; min-width: 0">
                    <div class="text-sm font-bold line-clamp-1">{{ s.name }}</div>
                    <div class="text-xs text-dim line-clamp-1">{{ s.question }}</div>
                  </div>
                  <label class="text-xs text-dim" title="围栏半径（米）">
                    <input v-model.number="s.geofence_radius_m" type="number" min="10" max="300" class="radius" />
                    m
                  </label>
                  <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="move(s.poi_id, -1)">↑</button>
                  <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="move(s.poi_id, 1)">↓</button>
                  <button class="yj-btn yj-btn--danger yj-btn--sm" @click="removeStation(s.poi_id)">×</button>
                </div>
              </div>
            </div>
          </div>

          <div class="flex justify-between mt-5">
            <button class="yj-btn yj-btn--ghost" @click="step = 2">← 上一步</button>
            <div class="flex gap-2">
              <button class="yj-btn yj-btn--ghost" :disabled="busy" @click="save(false)">存为草稿</button>
              <button class="yj-btn yj-btn--primary" :disabled="busy" @click="save(true)">发布上线</button>
            </div>
          </div>
        </section>
      </div>

      <!-- 右栏：实时预览 -->
      <aside class="preview">
        <div class="preview__phone" :style="{ '--tpl-color': currentTemplate?.color.primary || 'var(--primary)' }">
          <div class="preview__head">
            <span class="preview__dot" />
            <b class="text-sm">{{ form.name || "未命名 AR 游戏" }}</b>
          </div>
          <p class="text-xs text-secondary mt-1">{{ form.theme_name }} · {{ currentTemplate?.festival }}</p>
          <img
            class="preview__cover mt-3"
            :src="`/assets/ar/theme/${form.template_id}/card.webp`"
            :alt="form.name"
          />
          <div class="text-xs text-secondary mt-3 line-clamp-4">{{ form.intro || currentTemplate?.intro }}</div>
          <div class="preview__list">
            <div v-for="(s, i) in stations" :key="s.poi_id" class="preview__row">
              <img :src="`/assets/ar/billboard/${s.billboard}`" alt="" />
              <div style="flex: 1; min-width: 0">
                <div class="text-xs font-bold">{{ i + 1 }}. {{ s.name }}</div>
                <div class="text-xs text-dim line-clamp-1">{{ s.task }} · 半径 {{ s.geofence_radius_m }}m</div>
              </div>
            </div>
            <div v-if="!stations.length" class="text-xs text-dim py-4 text-center">点位将在此预览</div>
          </div>
          <div class="preview__foot">
            共 {{ stations.length }} 个点位 · 奖励 {{ stations.filter((s) => s.reward_coupon_id).length }} 张券
          </div>
        </div>
        <p class="text-xs text-dim mt-3">
          演示口径：AI 生成内容为「剧本化演示」，定位使用浏览器模拟，领奖为 mock 券，页面均标注 DEMO。
        </p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.steps {
  display: flex;
  gap: 10px;
}
.steps__item {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--radius-card);
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);
}
.steps__item--on {
  border-color: var(--primary);
  box-shadow: var(--glow-primary);
}
.steps__item--done {
  opacity: 0.78;
}
.steps__no {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  background: var(--primary-soft);
  color: var(--primary);
  flex: none;
}

.tpl {
  text-align: left;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  overflow: hidden;
  background: var(--bg-elevated);
  cursor: pointer;
  padding: 0;
  transition: all var(--dur-fast) var(--ease-out);
}
.tpl--on {
  border-color: var(--tpl-color);
  box-shadow: 0 0 0 3px rgba(62, 198, 184, 0.18);
}
.tpl img {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  display: block;
}
.tpl__body {
  padding: 8px 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field > span {
  font-size: 12px;
  color: var(--text-secondary);
}
.npc-pick {
  display: flex;
  align-items: center;
  gap: 8px;
}
.npc-pick__img {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 8px;
  object-fit: cover;
  background: var(--bg-base);
  border: 1px solid var(--border);
}
.station {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px;
  background: rgba(16, 28, 48, 0.6);
}
.station__no {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 700;
  background: var(--accent-soft);
  color: var(--accent);
  flex: none;
}

.poi-list {
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.poi {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: rgba(22, 38, 63, 0.5);
  cursor: pointer;
  text-align: left;
}
.poi:hover {
  border-color: var(--primary);
}
.poi--on {
  opacity: 0.5;
}
.poi__name {
  font-size: 13px;
}
.sel {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: rgba(22, 38, 63, 0.5);
}
.radius {
  width: 56px;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: 12px;
}

.preview {
  position: sticky;
  top: 76px;
  align-self: start;
}
.preview__phone {
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: 14px;
  background: linear-gradient(180deg, rgba(30, 49, 79, 0.6), rgba(10, 18, 32, 0.92));
  border-top: 3px solid var(--tpl-color);
}
.preview__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.preview__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary);
  box-shadow: var(--glow-primary);
}
.preview__cover {
  width: 100%;
  border-radius: var(--radius-md);
  aspect-ratio: 16 / 9;
  object-fit: cover;
  display: block;
}
.preview__list {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 260px;
  overflow: auto;
}
.preview__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  border-radius: var(--radius-sm);
  background: rgba(10, 18, 32, 0.6);
}
.preview__row img {
  width: 34px;
  height: 34px;
  object-fit: contain;
}
.preview__foot {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
