<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "@/api/client";
import { DEMO_FINAL_VIDEO } from "@/lib/assets";
import type {
  VideoEnhanceResult,
  VideoShot,
  VideoShotStatus,
  VideoStatus,
  VideoStyleResp,
} from "@/types/api";

const router = useRouter();

/* ---- 输入 ---- */
const prompt = ref("");
const styleId = ref("documentary");
const shotCount = ref(3);
const styles = ref<VideoStyleResp["styles"]>([]);
const styleMap = computed(() => Object.fromEntries(styles.value.map((s) => [s.id, s])));
const activeStyle = computed(() => styleMap.value[styleId.value]);

/* ---- 状态 ---- */
const busy = ref(false);
const enhancing = ref(false);
const enhance = ref<VideoEnhanceResult | null>(null);
const projectId = ref("");
const phase = ref<"idle" | "running" | "done" | "failed">("idle");
const status = ref<VideoStatus>("scripting");
const progress = ref(0);
const stageLabel = ref("");
const shots = ref<VideoShot[]>([]);
const flowLog = ref<Array<{ stage: string; msg: string; ts: string }>>([]);
const errorMsg = ref("");
let timer: ReturnType<typeof setInterval> | null = null;

const COVERS = [
  "/assets/hero/hero-nanxi.webp",
  "/assets/3d/shiwei-poster.webp",
  "/assets/img/kb/poi-002-cover.webp",
  "/assets/img/kb/cul-005-cover.webp",
  "/assets/img/kb/biz-003-cover.webp",
  "/assets/img/kb/poi-007-cover.webp",
  "/assets/img/kb/cul-012-cover.webp",
  "/assets/img/kb/poi-010-cover.webp",
];
const coverOf = (i: number) => COVERS[i % COVERS.length];

const shotStatusMap: Record<VideoShotStatus, { label: string; cls: string }> = {
  pending: { label: "排队", cls: "dot--dim" },
  generating: { label: "生成中", cls: "dot--run" },
  done: { label: "完成", cls: "dot--ok" },
  failed: { label: "失败", cls: "dot--bad" },
};

async function loadStyles() {
  try {
    const res = await api.videoStyles();
    styles.value = res.styles;
    if (!styleMap.value[styleId.value] && res.styles[0]) styleId.value = res.styles[0].id;
  } catch {
    /* ignore */
  }
}
loadStyles();

function stopTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/* AI 辅助提示词：仅优化预览，不建项目 */
async function runEnhance() {
  if (!prompt.value.trim()) return;
  enhancing.value = true;
  enhance.value = null;
  try {
    enhance.value = await api.videoEnhance({
      prompt: prompt.value.trim(),
      style: styleId.value,
      shot_count: shotCount.value,
    });
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : "提示词优化失败";
  } finally {
    enhancing.value = false;
  }
}

async function tick() {
  if (!projectId.value) return;
  try {
    const s = await api.videoStatus(projectId.value);
    status.value = s.status;
    progress.value = s.progress_pct;
    stageLabel.value = s.stage_label;
    shots.value = s.shots;
    flowLog.value = s.flow_log;
    if (s.status === "done" || s.status === "failed") {
      phase.value = s.status;
      stopTimer();
    }
  } catch {
    /* 轮询偶发失败忽略，等待下次 */
  }
}

async function generate() {
  if (!prompt.value.trim() || busy.value) return;
  busy.value = true;
  errorMsg.value = "";
  enhance.value = null;
  phase.value = "running";
  try {
    const res = await api.createVideo({
      user_prompt: prompt.value.trim(),
      style: styleId.value,
      shot_count: shotCount.value,
    });
    projectId.value = res.id;
    status.value = "scripting";
    progress.value = 0;
    shots.value = [];
    flowLog.value = [];
    await tick();
    timer = setInterval(tick, 700);
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : "创建生成任务失败";
    phase.value = "failed";
    stopTimer();
  } finally {
    busy.value = false;
  }
}

function resetForm() {
  stopTimer();
  phase.value = "idle";
  enhance.value = null;
  projectId.value = "";
  shots.value = [];
  flowLog.value = [];
  errorMsg.value = "";
}

function fmtTime(ts: string) {
  return ts ? ts.slice(11, 19) : "";
}

onUnmounted(stopTimer);

const canSubmit = computed(() => prompt.value.trim().length > 0 && !busy.value);
</script>

<template>
  <div class="page page-wide py-8">
    <!-- 顶部 -->
    <div class="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 class="text-2xl font-bold tracking-wide">AI 视频工坊</h1>
        <p class="section-sub mt-1">
          输入一句画面灵感 → AI 精准化提示词 → 分镜生成与拼接全流程演示。当前为演示模拟模式，成片画面由运营内容组提供替换。
        </p>
      </div>
      <div class="flex gap-2">
        <button class="yj-btn yj-btn--ghost" @click="router.push('/video')">视频列表</button>
      </div>
    </div>

    <!-- minmax(0,1fr)：成片 video / 分镜封面是替换元素，1fr 列默认最小宽度会取其
         原始像素宽（1920），把整列撑爆产生页面横向滚动——显式压到 0 才能锁进容器 -->
    <div class="grid gap-5 studio-grid">
      <!-- 左：创作台 -->
      <div class="space-y-4">
        <div class="yj-card yj-card--pad-lg">
          <div class="section-title mb-1" style="font-size: 16px">① 描述灵感</div>
          <p class="section-sub mb-3">把你脑海中的画面写下来，AI 会帮你把它打磨成专业提示词</p>
          <textarea
            v-model="prompt"
            rows="5"
            class="v-textarea"
            placeholder="例如：清晨的楠溪江上，一只竹筏顺流而下，两岸青山薄雾缭绕，渔翁缓缓撑篙，水面泛起金色波光……"
          />
          <div class="text-right text-xs text-dim mt-1">{{ prompt.length }} 字</div>
        </div>

        <div class="yj-card yj-card--pad-lg">
          <div class="section-title mb-3" style="font-size: 16px">② 成片风格</div>
          <div class="grid gap-2" style="grid-template-columns: repeat(2, 1fr)">
            <button
              v-for="s in styles"
              :key="s.id"
              class="style-chip"
              :class="{ 'style-chip--on': styleId === s.id }"
              @click="styleId = s.id"
            >
              <span class="style-chip__name">{{ s.name }}</span>
              <span class="style-chip__meta">{{ s.resolution }} · {{ s.fps }}fps · {{ s.aspect }}</span>
            </button>
          </div>
          <p v-if="activeStyle" class="text-xs text-secondary mt-3 leading-relaxed">{{ activeStyle.desc }}</p>
          <video
            v-if="activeStyle?.sample_clip"
            class="style-sample"
            :src="activeStyle.sample_clip"
            controls
            playsinline
            muted
            preload="none"
          />
          <p v-if="activeStyle?.sample_clip" class="style-sample__cap">风格示例片段 · 演示素材，非本项目成片</p>
        </div>

        <div class="yj-card yj-card--pad-lg">
          <div class="flex items-center justify-between mb-2">
            <span class="section-title" style="font-size: 16px">③ 分镜数量</span>
            <span class="yj-tag yj-tag--accent">{{ shotCount }} 镜头 · 每镜 8s</span>
          </div>
          <div class="flex gap-2">
            <button
              v-for="n in [1, 2, 3, 4, 5, 6]"
              :key="n"
              class="num-chip"
              :class="{ 'num-chip--on': shotCount === n }"
              @click="shotCount = n"
            >
              {{ n }}
            </button>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <button class="yj-btn yj-btn--ghost" :disabled="!prompt.trim() || enhancing" @click="runEnhance">
            <span v-if="enhancing" class="spinner" /> AI 扩写提示词（预览）
          </button>
          <button class="yj-btn yj-btn--primary yj-btn--lg" :disabled="!canSubmit" @click="generate">
            <span v-if="busy" class="spinner" /> 一键生成演示视频
          </button>
        </div>
        <p v-if="errorMsg" class="text-sm text-danger mt-2">{{ errorMsg }}</p>
      </div>

      <!-- 右：工作台输出 -->
      <div class="yj-card yj-card--pad-lg min-h-[420px]">
        <!-- 空态 -->
        <div v-if="phase === 'idle' && !enhance" class="h-full flex flex-col items-center justify-center text-center opacity-70 py-16">
          <div class="big-icon mb-4">▶</div>
          <p class="font-mono-sc text-lg tracking-widest">AI VIDEO STUDIO</p>
          <p class="text-secondary text-sm mt-2">输入描述后，右侧将呈现：提示词精修 → 分镜脚本 → 逐镜头生成 → NexaFrame 拼接</p>
          <div class="flex gap-6 mt-6 text-xs text-secondary">
            <span>1 · 提示词美化</span>
            <span>2 · 分镜编排</span>
            <span>3 · 镜头生成</span>
            <span>4 · NexaFrame 智能拼接</span>
          </div>
        </div>

        <!-- 提示词美化对照 -->
        <div v-else-if="enhance && phase === 'idle'" class="space-y-4">
          <div class="section-title">AI 扩写后的提示词</div>
          <p class="text-xs text-secondary -mt-2">
            保留你的原意，从场景环境、光影色调、景别构图、运镜与人物细节等维度做导演级扩写（仅预览，不会创建项目）。
          </p>
          <div class="grid gap-3" style="grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)">
            <div class="prompt-box">
              <div class="prompt-box__label">原始描述</div>
              <p class="text-sm whitespace-pre-wrap">{{ prompt }}</p>
            </div>
            <div class="prompt-box prompt-box--good">
              <div class="prompt-box__label">扩写提示词 · {{ enhance.mode === "llm" ? "LLM 导演级扩写" : "本地规则扩写（LLM 不可用时回落）" }}</div>
              <p class="text-sm leading-relaxed">{{ enhance.enriched_prompt }}</p>
            </div>
          </div>
          <div class="yj-card" style="background: rgba(248, 113, 113, 0.08); border-color: rgba(248,113,113,.35)">
            <div class="text-xs mb-1 text-danger">负面提示词（规避项）</div>
            <p class="text-xs text-secondary">{{ enhance.negative_prompt }}</p>
          </div>
          <div>
            <div class="text-sm mb-2 text-secondary">分镜构想（{{ enhance.shot_topics.length }} 镜头）</div>
            <ol class="space-y-2">
              <li v-for="(t, i) in enhance.shot_topics" :key="i" class="flex gap-2 text-sm items-start">
                <span class="yj-tag yj-tag--poi" style="min-width: 34px; justify-content: center">镜{{ i + 1 }}</span>
                <span class="pt-0.5 text-secondary">{{ t }}</span>
              </li>
            </ol>
          </div>
        </div>

        <!-- 运行看板 -->
        <div v-else class="space-y-4">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div class="section-title">生成运行看板</div>
            <div class="flex items-center gap-2">
              <span class="yj-tag" :class="{ 'yj-tag--poi': phase === 'running', 'yj-tag--accent': phase === 'done' }">{{ stageLabel }}</span>
              <span v-if="phase === 'running'" class="text-xs font-mono-sc text-secondary">{{ progress }}%</span>
            </div>
          </div>

          <!-- 进度条 -->
          <div class="prog">
            <div class="prog__fill" :style="{ width: Math.max(progress, 2) + '%' }" />
          </div>

          <!-- 阶段时间线 -->
          <div class="flex flex-wrap gap-2 text-xs">
            <span v-for="(f, i) in flowLog.slice(-7)" :key="i" class="yj-tag font-mono-sc">
              {{ fmtTime(f.ts) }} {{ f.msg }}
            </span>
          </div>

          <!-- 分镜区 -->
          <div v-if="shots.length">
            <div class="text-sm text-secondary mb-2">分镜脚本 · {{ shots.length }} 镜头</div>
            <div class="grid gap-3" style="grid-template-columns: repeat(3, minmax(0, 1fr))">
              <div
                v-for="(s, i) in shots"
                :key="s.shot_id"
                class="shot-card"
                :class="{ 'shot-card--run': s.status === 'generating', 'shot-card--ok': s.status === 'done' }"
              >
                <img :src="coverOf(i)" class="shot-card__cover" alt="" />
                <div class="shot-card__body">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-xs font-bold">镜头 {{ s.shot_id }}</span>
                    <span class="dot-row">
                      <i class="dot" :class="shotStatusMap[s.status]?.cls" />
                      <em>{{ shotStatusMap[s.status]?.label }}</em>
                    </span>
                  </div>
                  <p class="text-xs text-secondary mt-1 line-clamp-2">{{ s.description }}</p>
                  <p class="shot-card__time font-mono-sc">{{ s.duration_sec }}s · AI 渲染</p>
                </div>
              </div>
            </div>
          </div>

          <!-- 完成面板 -->
          <div v-if="phase === 'done'" class="yj-card done-panel">
            <div class="flex items-center gap-3 flex-wrap">
              <div class="text-2xl">🎬</div>
              <div>
                <div class="font-bold">成片已合成 · 演示成片已挂载</div>
                <p class="text-xs text-secondary mt-0.5">
                  {{ shots.length }} 个分镜已完成渲染与拼接 · 演示环境不调用真实视频大模型，成片由运营内容组提供
                </p>
              </div>
            </div>
            <video
              class="done-video"
              :src="DEMO_FINAL_VIDEO"
              controls
              autoplay
              muted
              playsinline
              preload="metadata"
            />
            <div class="flex gap-2 mt-3 flex-wrap">
              <button class="yj-btn yj-btn--primary yj-btn--sm" @click="router.push('/video/' + projectId)">查看详情与分镜</button>
              <a class="yj-btn yj-btn--ghost yj-btn--sm" :href="DEMO_FINAL_VIDEO" download>下载成片</a>
              <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="router.push('/video')">前往列表</button>
              <button class="yj-btn yj-btn--sm" style="border-color: var(--border)" @click="resetForm">再创作一条</button>
            </div>
          </div>
          <div v-else-if="phase === 'failed'" class="yj-card" style="border-color: rgba(248,113,113,.5)">
            <p class="text-danger text-sm">生成中断，请重试</p>
            <button class="yj-btn yj-btn--ghost yj-btn--sm mt-3" @click="resetForm">返回重试</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.text-dim {
  color: var(--text-dim);
}
.text-secondary {
  color: var(--text-secondary);
}
.text-danger {
  color: var(--danger);
}
.v-textarea {
  width: 100%;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.7;
  resize: vertical;
  outline: none;
  transition: border-color 0.18s;
}
.v-textarea:focus {
  border-color: var(--primary);
}
.style-chip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  text-align: left;
  padding: 9px 11px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-base);
  cursor: pointer;
  transition: all 0.15s;
}
.style-chip__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.style-chip__meta {
  font-size: 11px;
  color: var(--text-dim);
  font-family: "JetBrains Mono", monospace;
}
.style-chip--on {
  border-color: var(--primary);
  background: var(--primary-soft);
  box-shadow: 0 0 0 1px var(--primary);
}
.style-sample {
  width: 100%;
  display: block;
  margin-top: 12px;
  border-radius: 10px;
  background: #000;
  border: 1px solid var(--border);
}
.style-sample__cap {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-dim);
}
.num-chip {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-base);
  color: var(--text-secondary);
  cursor: pointer;
  font-weight: 600;
  transition: all 0.15s;
}
.num-chip--on {
  background: var(--accent);
  border-color: var(--accent);
  color: #201503;
}
.prompt-box {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  background: var(--bg-base);
}
.prompt-box--good {
  border-color: rgba(62, 198, 184, 0.4);
  background: var(--primary-soft);
}
.prompt-box__label {
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--primary);
  margin-bottom: 8px;
}
.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.big-icon {
  font-size: 42px;
  color: var(--primary);
  text-shadow: var(--glow-primary);
}
.prog {
  height: 8px;
  border-radius: 999px;
  background: var(--bg-base);
  overflow: hidden;
  border: 1px solid var(--border);
}
.prog__fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary), #7ee8dc);
  border-radius: 999px;
  transition: width 0.5s ease;
  box-shadow: var(--glow-primary);
}
.shot-card {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-base);
  transition: border-color 0.2s, box-shadow 0.2s;
}
.shot-card__cover {
  width: 100%;
  /* 16:9 自然比例替代写死的 92px：宽列下封面不再是压扁的宽条，分镜卡片更接近视频观感 */
  aspect-ratio: 16 / 9;
  height: auto;
  object-fit: cover;
  display: block;
  filter: saturate(0.85);
}
.shot-card__body {
  padding: 10px;
}
.shot-card--run {
  border-color: var(--primary);
  box-shadow: var(--glow-primary);
}
.shot-card--ok {
  border-color: rgba(62, 198, 184, 0.35);
}
.dot-row {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-style: normal;
  font-size: 11px;
  color: var(--text-dim);
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}
.dot--dim {
  background: var(--text-dim);
}
.dot--run {
  background: var(--warning);
  box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.18);
  animation: pulse 0.8s infinite;
}
.dot--ok {
  background: var(--success);
}
.dot--bad {
  background: var(--danger);
}
@keyframes pulse {
  50% {
    opacity: 0.4;
  }
}
.shot-card__time {
  font-size: 10px;
  color: var(--text-dim);
  margin-top: 6px;
}
.done-panel {
  border-color: rgba(232, 184, 75, 0.4);
  background: linear-gradient(135deg, rgba(232, 184, 75, 0.08), transparent 55%);
}
.done-video {
  display: block;
  width: 100%;
  max-width: 100%;
  aspect-ratio: 16 / 9;
  margin-top: 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #000;
}
/* 创作台两栏：窄窗口（<1080px）时左栏不再挤占 380px 固定宽，改为上下堆叠 */
.studio-grid {
  grid-template-columns: 380px minmax(0, 1fr);
}
/* 双保险：网格子项允许收缩到 0，替换元素（video/img）的原始像素宽不再参与轨道计算 */
.studio-grid > * {
  min-width: 0;
}
@media (max-width: 1080px) {
  .studio-grid {
    grid-template-columns: 1fr;
  }
}
</style>
