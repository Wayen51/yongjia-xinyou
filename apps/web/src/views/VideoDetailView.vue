<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "@/api/client";
import { DEMO_FINAL_VIDEO } from "@/lib/assets";
import type { VideoProjectDetail, VideoStyleResp } from "@/types/api";

const route = useRoute();
const router = useRouter();
const id = String(route.params.id);

const detail = ref<VideoProjectDetail | null>(null);
const styles = ref<VideoStyleResp["styles"]>([]);
const running = ref(true);
const loading = ref(true);
let timer: ReturnType<typeof setInterval> | null = null;

const COVERS = [
  "/assets/hero/hero-nanxi.webp",
  "/assets/3d/shiwei-poster.webp",
  "/assets/img/kb/poi-002-cover.webp",
  "/assets/img/kb/cul-005-cover.webp",
  "/assets/img/kb/biz-003-cover.webp",
  "/assets/img/kb/poi-007-cover.webp",
  "/assets/img/kb/cul-012-cover.webp",
];
const coverOf = (i: number) => COVERS[i % COVERS.length];

const ST_META: Record<string, { label: string; tone: string }> = {
  scripting: { label: "脚本编排中", tone: "tone-warn" },
  generating: { label: "镜头生成中", tone: "tone-run" },
  stitching: { label: "拼接中", tone: "tone-run" },
  done: { label: "已完成", tone: "tone-ok" },
  failed: { label: "生成失败", tone: "tone-bad" },
};
const styleName = (s: string) => styles.value.find((x) => x.id === s)?.name || s;
/** 当前成片风格对应的示例片段（运营内容组提供，可能为空） */
const sampleClip = computed(() => styles.value.find((x) => x.id === detail.value?.style)?.sample_clip || "");

async function poll() {
  try {
    const d = await api.videoById(id);
    detail.value = d;
    if (d.status === "done" || d.status === "failed") {
      running.value = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
  } catch {
    /* 忽略单次失败 */
  }
}

async function load() {
  try {
    const st = await api.videoStyles();
    styles.value = st.styles;
  } catch {
    /* ignore */
  }
  loading.value = false;
  await poll();
  if (running.value) {
    timer = setInterval(poll, 700);
  }
}

async function regenerate() {
  if (!detail.value) return;
  if (!window.confirm("将重新执行镜头生成与拼接（沿用现有脚本），确定开始？")) return;
  running.value = true;
  detail.value = { ...detail.value, status: "generating", progress_pct: 0, flow_log: [], output: undefined };
  try {
    await api.videoRegenerate(id);
  } catch {
    /* ignore */
  }
  if (!timer) timer = setInterval(poll, 700);
}

async function remove() {
  if (!window.confirm("确认删除该项目？")) return;
  await api.videoDelete(id);
  router.push("/video");
}

function fmtTs(s: string) {
  return s ? s.replace("T", " ").slice(0, 19) : "";
}
function fmtClock(s: string) {
  return s ? s.slice(11, 19) : "";
}

const doneShots = computed(() => detail.value?.shots.filter((x) => x.status === "done").length ?? 0);
const isRunning = computed(() => {
  const d = detail.value;
  return running.value && !!d && !["done", "failed"].includes(d.status);
});
const progress = computed(() => detail.value?.progress_pct ?? 0);

onMounted(load);
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div class="page page-wide py-8">
    <div v-if="loading" class="text-center text-secondary py-20">加载中…</div>

    <template v-else-if="detail">
      <!-- 头部 -->
      <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div class="flex items-center gap-3 min-w-0">
          <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="router.push('/video')">← 列表</button>
          <h1 class="text-xl font-bold truncate">{{ detail.title }}</h1>
          <span v-if="detail.status" class="yj-tag" :class="ST_META[detail.status]?.tone">
            {{ ST_META[detail.status]?.label }}
          </span>
        </div>
        <div class="flex gap-2">
          <button class="yj-btn yj-btn--ghost yj-btn--sm" @click="router.push('/video/new')">新创作</button>
          <button class="yj-btn yj-btn--sm" style="border-color: var(--border)" :disabled="isRunning" @click="regenerate">
            重新生成
          </button>
          <button class="yj-btn yj-btn--danger yj-btn--sm" @click="remove">删除</button>
        </div>
      </div>

      <!-- 进度（生成中） -->
      <div v-if="isRunning" class="yj-card mb-5">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm">{{ detail.stage_label || "处理中" }}</span>
          <span class="text-xs font-mono-sc text-secondary">{{ progress }}%</span>
        </div>
        <div class="prog"><div class="prog__fill" :style="{ width: Math.max(progress, 2) + '%' }" /></div>
      </div>

      <div class="grid gap-5" style="grid-template-columns: minmax(0, 1fr) 360px">
        <!-- 主区 -->
        <div class="space-y-5">
          <!-- 播放器：生成完成后挂载演示成片 -->
          <div>
            <div class="player">
              <video
                v-if="detail.status === 'done'"
                class="player__video"
                :src="DEMO_FINAL_VIDEO"
                :poster="coverOf(0)"
                controls
                playsinline
                preload="metadata"
              />
              <template v-else>
                <div class="player__img player__img--dim" />
                <div class="player__shade" />
                <div class="player__center">
                  <span v-if="isRunning" class="spinner-lg" />
                  <span v-else class="text-sm text-secondary">成片生成失败，可点击「重新生成」重试</span>
                </div>
              </template>
            </div>
            <div class="player__meta">
              <span class="yj-tag yj-tag--poi">{{ styleName(detail.style) }}</span>
              <span class="text-xs font-mono-sc text-secondary">
                {{ detail.settings?.resolution }} · {{ detail.settings?.fps }}fps · {{ detail.settings?.aspect }}
              </span>
            </div>
          </div>

          <!-- 风格示例片段（运营内容组提供，随成片风格变化） -->
          <div v-if="sampleClip" class="yj-card">
            <div class="flex items-center justify-between mb-3">
              <div class="section-title" style="font-size: 16px">风格示例片段</div>
              <span class="yj-tag yj-tag--poi">{{ styleName(detail.style) }}</span>
            </div>
            <video class="sample-clip" :src="sampleClip" :poster="coverOf(0)" controls playsinline preload="metadata" />
            <p class="text-xs text-dim mt-2 leading-relaxed">
              该片段用于说明此风格的运镜与调性；本项目正式成片以上方「演示成片」为准。
            </p>
          </div>

          <div v-if="detail.output" class="yj-card" style="border-color: rgba(232, 184, 75, 0.4)">
            <div class="flex flex-wrap items-center gap-3">
              <div>
                <div class="text-sm font-bold">
                  演示成片 · {{ detail.output.format.toUpperCase() }} · {{ detail.output.resolution }}
                </div>
                <p class="text-xs text-secondary mt-1">{{ detail.output.deliverable }}</p>
              </div>
              <div class="flex-1" />
              <a class="yj-btn yj-btn--primary yj-btn--sm" :href="DEMO_FINAL_VIDEO" download>下载成片</a>
            </div>
            <p class="text-xs text-dim mt-2 leading-relaxed">{{ detail.output.notice }}</p>
          </div>

          <!-- 提示词对照 -->
          <div class="yj-card">
            <div class="section-title mb-3" style="font-size: 16px">AI 提示词精修对照</div>
            <div class="prompt-grid">
              <div class="prompt-box">
                <div class="prompt-box__label">原始描述</div>
                <p class="text-sm whitespace-pre-wrap">{{ detail.user_prompt }}</p>
              </div>
              <div class="prompt-box prompt-box--good">
                <div class="prompt-box__label">精修提示词</div>
                <p class="text-sm leading-relaxed">{{ detail.enriched_prompt }}</p>
              </div>
            </div>
            <p class="text-xs text-danger mt-3">负面规避：{{ detail.negative_prompt }}</p>
          </div>

          <!-- 分镜明细 -->
          <div class="yj-card">
            <div class="flex items-center justify-between mb-3">
              <div class="section-title" style="font-size: 16px">分镜脚本 · {{ detail.shots.length }} 镜头</div>
              <span class="text-xs text-secondary font-mono-sc">
                {{ doneShots }}/{{ detail.shots.length }} 完成 · 每镜 {{ detail.settings?.note || "8s" }}
              </span>
            </div>
            <div class="space-y-3">
              <div v-for="s in detail.shots" :key="s.shot_id" class="shot-row" :class="{ 'shot-row--run': s.status === 'generating', 'shot-row--ok': s.status === 'done' }">
                <img :src="coverOf(s.shot_id - 1)" alt="" class="shot-row__img" />
                <div class="shot-row__main min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="yj-tag yj-tag--poi" style="min-width: 42px; justify-content: center">镜 {{ s.shot_id }}</span>
                    <span class="text-sm font-medium">{{ s.description }}</span>
                  </div>
                  <p class="text-xs text-secondary mt-1.5 leading-relaxed line-clamp-2">{{ s.prompt }}</p>
                  <div v-if="s.kb_refs.length" class="flex gap-1.5 mt-1.5 flex-wrap">
                    <span v-for="r in s.kb_refs" :key="r" class="yj-tag">智库锚点 · {{ r }}</span>
                  </div>
                </div>
                <div class="shot-row__state shrink-0">
                  <i class="dot" :class="s.status === 'done' ? 'ok' : s.status === 'generating' ? 'run' : s.status === 'failed' ? 'bad' : 'dim'" />
                  <span class="text-xs text-secondary">{{
                    s.status === "done" ? "完成" : s.status === "generating" ? "生成中" : s.status === "failed" ? "失败" : "待生成"
                  }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 侧栏：运行日志与元信息 -->
        <div class="space-y-5">
          <div class="yj-card">
            <div class="section-title mb-3" style="font-size: 15px">运行日志</div>
            <ol class="log-list">
              <li v-for="(f, i) in detail.flow_log" :key="i" class="log-item">
                <span class="log-item__dot" />
                <div class="min-w-0">
                  <p class="text-xs leading-relaxed text-secondary">{{ f.msg }}</p>
                  <span class="font-mono-sc text-[10px] text-dim">{{ fmtClock(f.ts) }}</span>
                </div>
              </li>
            </ol>
          </div>

          <div class="yj-card">
            <div class="section-title mb-3" style="font-size: 15px">项目信息</div>
            <dl class="kv">
              <dt>风格</dt>
              <dd>{{ styleName(detail.style) }}</dd>
              <dt>分镜</dt>
              <dd>{{ detail.shot_count }} 镜头</dd>
              <dt>画质</dt>
              <dd class="font-mono-sc">{{ detail.settings?.resolution }} {{ detail.settings?.fps }}fps</dd>
              <dt>成片时长</dt>
              <dd class="font-mono-sc">{{ detail.settings?.total_duration_sec }}s</dd>
              <dt>创建时间</dt>
              <dd>{{ fmtTs(detail.created_at) }}</dd>
            </dl>
          </div>

          <div class="yj-card" style="border-color: rgba(62,198,184,.3)">
            <p class="text-xs leading-relaxed text-secondary">
              <b style="color: var(--primary)">说明</b>：演示环境不调用真实视频大模型。生成完成后，上方播放器挂载的是运营内容组提供的演示成片，分镜脚本可直接导出用于真实成片制作。
            </p>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tone-ok {
  color: var(--success);
  border-color: rgba(74, 222, 128, 0.4);
  background: rgba(74, 222, 128, 0.1);
}
.tone-run {
  color: #93c5fd;
  border-color: rgba(62, 198, 184, 0.4);
  background: rgba(62, 198, 184, 0.12);
}
.tone-warn {
  color: var(--warning);
  border-color: rgba(251, 191, 36, 0.4);
  background: rgba(251, 191, 36, 0.1);
}
.tone-bad {
  color: var(--danger);
  border-color: rgba(248, 113, 113, 0.4);
  background: rgba(248, 113, 113, 0.1);
}
.text-dim {
  color: var(--text-dim);
}
.prog {
  height: 8px;
  border-radius: 999px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  overflow: hidden;
}
.prog__fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary), #7ee8dc);
  transition: width 0.5s ease;
}
.player {
  position: relative;
  border-radius: 14px;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  border: 1px solid var(--border);
}
.player__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.player__img--dim {
  background: linear-gradient(135deg, #0d1830, #101c30 70%);
}
.player__shade {
  position: absolute;
  inset: 0;
  background: radial-gradient(transparent 40%, rgba(4, 8, 16, 0.4));
  pointer-events: none;
}
.player__center {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
}
.spinner-lg {
  width: 46px;
  height: 46px;
  border: 3px solid rgba(62, 198, 184, 0.25);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.player__video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  background: #000;
}
.sample-clip {
  width: 100%;
  display: block;
  border-radius: 12px;
  background: #000;
  border: 1px solid var(--border);
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.player__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
}
.prompt-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
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
.shot-row {
  display: flex;
  gap: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px;
  background: var(--bg-base);
}
.shot-row--run {
  border-color: var(--primary);
  box-shadow: var(--glow-primary);
}
.shot-row--ok {
  border-color: rgba(62, 198, 184, 0.3);
}
.shot-row__img {
  width: 120px;
  height: 68px;
  object-fit: cover;
  border-radius: 8px;
  flex-shrink: 0;
}
.shot-row__state {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  justify-content: center;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
}
.dot.ok {
  background: var(--success);
}
.dot.run {
  background: var(--warning);
  animation: pulse 0.8s infinite;
}
.dot.bad {
  background: var(--danger);
}
.dot.dim {
  background: var(--text-dim);
}
@keyframes pulse {
  50% {
    opacity: 0.4;
  }
}
.log-list {
  list-style: none;
  padding: 0;
  margin: 0;
  position: relative;
}
.log-item {
  display: flex;
  gap: 10px;
  padding-bottom: 10px;
  position: relative;
}
.log-item::before {
  content: "";
  position: absolute;
  left: 3px;
  top: 10px;
  bottom: 0;
  width: 1px;
  background: var(--border);
}
.log-item:last-child::before {
  display: none;
}
.log-item__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-top: 4px;
  background: var(--primary);
  flex-shrink: 0;
  position: relative;
  z-index: 1;
  box-shadow: 0 0 0 3px var(--primary-soft);
}
.kv {
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 8px 12px;
  margin: 0;
}
.kv dt {
  color: var(--text-dim);
  font-size: 12px;
}
.kv dd {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  word-break: break-all;
}
</style>
