<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, chatSse, DEMO_CONSOLE } from "@/api/client";
import { useSessionStore } from "@/stores/session";
import { toast } from "@/lib/toast";
import { parseSourceSegments } from "@/lib/rich";
import type { CompanionRecommendResp, DemoPlan, PlanDiffPayload, ShortcutItem } from "@/types/api";
import ItineraryPlan from "@/components/agent/ItineraryPlan.vue";
import PlanDiff from "@/components/agent/PlanDiff.vue";
import PlanSideBody from "@/components/agent/PlanSideBody.vue";

/* ---------- 消息模型 ---------- */
type Block =
  | { kind: "text"; text: string }
  | { kind: "tool"; tool: string; args: string; status: "running" | "done"; summary?: string }
  | { kind: "plan"; data: DemoPlan }
  | { kind: "diff"; data: PlanDiffPayload };

interface ChatMsg {
  role: "user" | "ai";
  blocks: Block[];
  streaming?: boolean;
  errorText?: string;
  /** 回落本地剧本时的技术原因，仅作悬停提示——给现场排查用，不干扰评委观感 */
  errorHint?: string;
}

const router = useRouter();
const route = useRoute();
const store = useSessionStore();
/** 是否运行在手机端 App（/m/）：行程入口行为不同——手机端点浮窗/对话内链接进全屏行程页，PC 端保持右侧栏 + 窄屏抽屉 */
const isMobileApp = computed(() => route.name === "m-agent");
const msgs = ref<ChatMsg[]>([]);
const input = ref("");
const streaming = ref(false);
const abortCtrl = ref<AbortController | null>(null);
const listEl = ref<HTMLElement | null>(null);
const shortcuts = ref<ShortcutItem[]>([]);

/* ---------- 输入栏：快捷技能 / 语音输入 ---------- */

/* 这两颗按钮原先都是纯装饰，点了没有任何反应（评委会点）。现在：
   ① ⚡ 展开快捷技能浮层，复用侧栏那份 shortcuts，不新增数据源；
   ② 🎤 接 Web Speech API 真语音输入，浏览器不具备该能力时**整个按钮不渲染**，
      而不是留一个点不动的图标。 */

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const W = window as unknown as {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
};
const SR_Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;

/** 是否渲染语音按钮：只在浏览器真支持时才出现 */
const speechSupported = computed(() => Boolean(SR_Ctor));
const listening = ref(false);
const speechCtrl = ref<SpeechRecognitionLike | null>(null);
/** 识别结果追加到「点下麦克风时」已输入的内容之后，避免把用户已打的字覆盖掉 */
let speechBase = "";

function toggleVoice() {
  if (listening.value) {
    speechCtrl.value?.stop();
    return;
  }
  if (!SR_Ctor) return;
  const rec = new SR_Ctor();
  rec.lang = "zh-CN";
  rec.continuous = false;
  rec.interimResults = true;
  speechBase = input.value.trim();
  rec.onresult = (ev) => {
    let said = "";
    for (let i = 0; i < ev.results.length; i++) said += ev.results[i][0]?.transcript ?? "";
    input.value = speechBase ? `${speechBase} ${said}` : said;
  };
  // Chrome 的识别走在线服务：现场没网、麦克风被拒、非安全上下文都会落到这里。
  // 必须明确告知用户，否则又是一次「点了没反应」。
  rec.onerror = (ev) => {
    listening.value = false;
    speechCtrl.value = null;
    toast(ev.error === "not-allowed" ? "麦克风权限被拒绝，请在浏览器里允许" : "语音识别不可用，请改用文字输入", "error");
  };
  rec.onend = () => {
    listening.value = false;
    speechCtrl.value = null;
  };
  speechCtrl.value = rec;
  listening.value = true;
  try {
    rec.start();
  } catch {
    listening.value = false;
    speechCtrl.value = null;
    toast("语音识别启动失败，请改用文字输入", "error");
  }
}

onBeforeUnmount(() => speechCtrl.value?.stop());

const skillOpen = ref(false);
function pickSkill(prompt: string) {
  skillOpen.value = false;
  void send(prompt);
}

/* 新增：搜索、筛选、导出、反馈 */
const searchText = ref("");
const filterType = ref<"all" | "text" | "tool" | "plan" | "diff">("all");
const autoScroll = ref(true);
const feedbackMap = ref<Record<number, "up" | "down">>({});

const TOOL_LABEL: Record<string, string> = {
  weather_query: "查询实时天气",
  kb_search: "检索永嘉知识库",
  kb_get: "读取知识条目",
  search_knowledge: "检索永嘉知识库",
  query_weather: "查询实时天气",
  recommend_pois: "智能推荐景点",
  build_itinerary: "编排行程",
  replan_itinerary: "重排行程",
  book_hotel: "模拟预订住宿",
  reserve_restaurant: "模拟预订餐厅",
};

function toolLabel(t: string) {
  return TOOL_LABEL[t] || t;
}

/* 右侧：最新行程 / 最新 diff */
const latestPlan = computed<DemoPlan | null>(() => {
  for (let i = msgs.value.length - 1; i >= 0; i--) {
    const b = msgs.value[i].blocks.find((x) => x.kind === "plan");
    if (b && b.kind === "plan") return b.data;
  }
  return null;
});
const latestDiff = computed<PlanDiffPayload | null>(() => {
  for (let i = msgs.value.length - 1; i >= 0; i--) {
    const b = msgs.value[i].blocks.find((x) => x.kind === "diff");
    if (b && b.kind === "diff") return b.data;
  }
  return null;
});

/* 窄屏（≤1024px）：右侧行程栏被隐藏，改用底部抽屉展示「变更卡 + 基础行程（原方案）」；
   手机端 App 进一步升级为全屏行程页（planPage）：浮窗 / 对话内链接打开，可一键返回对话。
   全屏页是 AgentView 内的覆盖层而非新路由——对话消息（msgs）在本组件内存里，
   走真路由会卸载组件丢掉整个对话，覆盖层则天然保留状态。 */
const sheetOpen = ref(false);
const planPage = ref(false);
const hasPlan = computed(() => !!(latestPlan.value || latestDiff.value));
function openPlanView() {
  if (isMobileApp.value) planPage.value = true;
  else sheetOpen.value = true;
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    sheetOpen.value = false;
    planPage.value = false;
  }
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

/* 当前可见消息（按搜索与类型筛选） */
const visibleMsgs = computed(() => {
  return msgs.value
    .map((m, idx) => ({ m, idx }))
    .filter(({ m }) => {
      let ok = true;
      if (filterType.value !== "all") {
        const t = filterType.value;
        ok = m.blocks.some((b) => b.kind === t);
      }
      if (!ok) return false;
      const kw = searchText.value.trim().toLowerCase();
      if (!kw) return true;
      if (m.role === "user") {
        return m.blocks.some((b) => b.kind === "text" && b.text.toLowerCase().includes(kw));
      }
      return m.blocks.some((b) => {
        if (b.kind === "text") return b.text.toLowerCase().includes(kw);
        if (b.kind === "tool") return `${toolLabel(b.tool)} ${b.args}`.toLowerCase().includes(kw);
        if (b.kind === "plan") return JSON.stringify(b.data).toLowerCase().includes(kw);
        if (b.kind === "diff") return JSON.stringify(b.data).toLowerCase().includes(kw);
        return false;
      });
    });
});

function scrollDown() {
  if (!autoScroll.value) return;
  nextTick(() => {
    const el = listEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}
watch([msgs, streaming], scrollDown, { deep: true });
watch(autoScroll, (v) => v && scrollDown());

onMounted(async () => {
  try {
    const resp = await api.shortcuts();
    const order = resp.default_display?.length ? resp.default_display : [];
    const map = new Map(resp.shortcuts.map((s) => [s.id, s]));
    shortcuts.value = order.map((id) => map.get(id)).filter((s): s is ShortcutItem => !!s);
    if (!shortcuts.value.length) shortcuts.value = resp.shortcuts.slice(0, 4);
  } catch {
    shortcuts.value = [];
  }
});

/* ---------- 发送 ---------- */
async function send(text?: string) {
  const msg = (text ?? input.value).trim();
  if (!msg || streaming.value) return;
  input.value = "";
  msgs.value.push({ role: "user", blocks: [{ kind: "text", text: msg }] });
  msgs.value.push({ role: "ai", blocks: [], streaming: true });
  // 必须取回数组中的响应式代理再改：直接改裸对象 ai.blocks 不会触发依赖更新，
  // 右侧「实时行程」的 latestPlan / latestDiff 是 computed，会永久缓存住空值。
  const ai = msgs.value[msgs.value.length - 1] as ChatMsg;

  const ctrl = new AbortController();
  abortCtrl.value = ctrl;
  streaming.value = true;

  const pushText = (t: string) => {
    const last = ai.blocks[ai.blocks.length - 1];
    if (last && last.kind === "text") last.text += t;
    else ai.blocks.push({ kind: "text", text: t });
  };
  const pushTool = (d: Record<string, unknown>) => {
    const tool = String(d.tool || "");
    const args = d.args ? JSON.stringify(d.args).slice(0, 120) : "";
    const status = d.status === "done" ? "done" : "running";
    const last = ai.blocks[ai.blocks.length - 1];
    if (last && last.kind === "tool" && last.status === "running" && last.tool === tool && status === "done") {
      last.status = "done";
      last.summary = String(d.result_summary ?? d.summary ?? "完成");
    } else {
      ai.blocks.push({ kind: "tool", tool, args, status, summary: status === "done" ? String(d.result_summary ?? d.summary ?? "完成") : undefined });
    }
  };

  try {
    await chatSse(
      store.sessionId,
      msg,
      {
        onToken: (t) => {
          pushText(t);
          scrollDown();
        },
        onToolCall: (d) => pushTool(d),
        onPlan: (d) => {
          const data = (d && "itinerary" in d ? (d.itinerary as unknown) : d) as DemoPlan;
          ai.blocks.push({ kind: "plan", data });
          toast(isMobileApp.value ? "已生成行程，点「实时行程」或对话内链接查看" : "已生成行程，见右侧行程卡", "success");
        },
        onPlanDiff: (d) => {
          ai.blocks.push({ kind: "diff", data: d });
          toast(isMobileApp.value ? "暴雨重排完成：点「实时行程」查看变更" : "暴雨重排完成：查看行程变更", "success");
        },
        onDone: () => {},
        onError: (code, message, fallback, reason) => {
          ai.errorText = fallback ? "已切换本地演示模式" : message || `出错了（${code}）`;
          ai.errorHint = fallback ? reason : undefined;
        },
      },
      ctrl.signal,
    );
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      ai.errorText = "已停止生成";
    } else {
      ai.errorText = (e as Error).message || "网络异常，请重试";
    }
  } finally {
    ai.streaming = false;
    streaming.value = false;
    abortCtrl.value = null;
  }
}

function stop() {
  abortCtrl.value?.abort();
}

/* ---------- 演示控制台 ---------- */
async function fireRain() {
  try {
    await api.demoWeather(store.sessionId, "rain");
    store.setMockRain(true);
    toast("已注入 14:00-18:00 暴雨天气（当前会话）", "success");
    await send("我现在在永嘉旅游，下午突然下暴雨了，帮我重新规划这段时间的行程，换成室内活动，品质不要降。");
  } catch {
    toast("模拟天气设置失败", "error");
  }
}
async function restoreWeather() {
  try {
    await api.demoWeather(store.sessionId, "normal");
    store.setMockRain(false);
    toast("天气已恢复正常", "success");
  } catch {
    toast("设置失败", "error");
  }
}

function goWiki(q: string) {
  router.push({ path: "/wiki", query: { q } });
}

/* ---------- 板块三 · 智能伴侣：位置 / 节日应季推荐（演示用模拟坐标） ---------- */
const REC_SPOTS = [
  { label: "石桅岩", lat: 28.267, lng: 120.782 },
  { label: "岩头 · 丽水街", lat: 28.174, lng: 120.756 },
  { label: "永嘉书院", lat: 28.103, lng: 120.672 },
  { label: "大若岩 · 十二峰", lat: 28.317, lng: 120.594 },
];
const REC_SCENES = [
  { label: "中秋应景 · 夜游", festival: "mid_autumn", intent: "sight", context: "中秋夜游，边赏月边逛" },
  { label: "打卡本地美食", festival: "daily", intent: "food", context: "想吃地道的楠溪江美食" },
  { label: "非遗手作体验", festival: "daily", intent: "craft", context: "想亲手做一次非遗手工" },
  { label: "下雨 · 室内避雨", festival: "daily", intent: "craft", context: "下暴雨了，想去室内" },
  { label: "全家遛娃", festival: "daily", intent: "explore", context: "带小朋友慢节奏玩" },
];
const recSpot = ref(REC_SPOTS[0].label);
const recScene = ref(REC_SCENES[0].label);
const rec = ref<CompanionRecommendResp | null>(null);
const recLoading = ref(false);
const recErr = ref("");
async function fetchRec() {
  const spot = REC_SPOTS.find((s) => s.label === recSpot.value);
  const scene = REC_SCENES.find((s) => s.label === recScene.value);
  if (!spot || !scene) return;
  recLoading.value = true;
  recErr.value = "";
  try {
    rec.value = await api.companionRecommend({
      lat: spot.lat,
      lng: spot.lng,
      location_name: spot.label,
      festival: scene.festival,
      intent: scene.intent,
      context: scene.context,
    });
  } catch (e) {
    rec.value = null;
    recErr.value = e instanceof Error ? e.message : "推荐服务暂不可用";
  } finally {
    recLoading.value = false;
  }
}

/* ---------- 新增交互：清空 / 搜索 / 筛选 / 导出 / 反馈 ---------- */
function clearChat() {
  if (!msgs.value.length) return;
  if (streaming.value) stop();
  msgs.value = [];
  searchText.value = "";
  filterType.value = "all";
  feedbackMap.value = {};
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportChat(format: "markdown" | "json") {
  if (!msgs.value.length) {
    toast("当前没有可导出的对话", "info");
    return;
  }
  if (format === "json") {
    downloadFile(`nannan-chat-${Date.now()}.json`, JSON.stringify(msgs.value, null, 2), "application/json");
    toast("对话已导出为 JSON", "success");
    return;
  }
  const lines: string[] = ["# 楠楠对话记录\n", `> 导出时间：${new Date().toLocaleString()}\n`];
  msgs.value.forEach((m) => {
    lines.push(m.role === "user" ? "**用户：**" : "**楠楠：**");
    m.blocks.forEach((b) => {
      if (b.kind === "text") lines.push(b.text);
      if (b.kind === "tool") lines.push(`[工具] ${toolLabel(b.tool)}：${b.summary || b.args || "执行中"}`);
      if (b.kind === "plan") lines.push(`[行程] ${b.data.title || "已生成行程"}`);
      if (b.kind === "diff") lines.push(`[行程变更] ${b.data.banner || b.data.change_summary || "暴雨重排"}`);
    });
    lines.push("");
  });
  downloadFile(`nannan-chat-${Date.now()}.md`, lines.join("\n"), "text/markdown");
  toast("对话已导出为 Markdown", "success");
}

function feedback(idx: number, type: "up" | "down") {
  feedbackMap.value[idx] = type;
  toast(type === "up" ? "已标记为有帮助" : "已记录反馈，我们会继续改进", "success");
}
</script>

<template>
  <div class="agent" :class="{ 'agent--m': isMobileApp }">
    <!-- 左侧边栏 -->
    <aside class="agent__sidebar">
      <div class="sidebar__brand">
        <img class="brand-mark" src="/assets/brand/nannan-avatar.png" alt="楠楠" />
        <span class="brand-name">楠楠</span>
      </div>
      <button class="sidebar__new" @click="clearChat">+ 新对话</button>
      <div class="sidebar__section-title">快捷指令</div>
      <div class="sidebar__shortcuts">
        <button
          v-for="s in shortcuts"
          :key="s.id"
          class="sidebar__chip"
          @click="send(s.prompt)"
        >{{ s.title }}</button>
      </div>
      <div class="sidebar__section-title">此刻 · 楠楠推荐</div>
      <div class="rec-panel">
        <select v-model="recSpot" class="rec-select" title="演示位置（模拟 GPS）">
          <option v-for="s in REC_SPOTS" :key="s.label" :value="s.label">{{ s.label }}</option>
        </select>
        <select v-model="recScene" class="rec-select" title="场景 / 节令">
          <option v-for="s in REC_SCENES" :key="s.label" :value="s.label">{{ s.label }}</option>
        </select>
        <button class="rec-go" :disabled="recLoading" @click="fetchRec">
          {{ recLoading ? "楠楠思考中…" : "召唤楠楠 · 看推荐" }}
        </button>
        <p v-if="recErr" class="rec-err">{{ recErr }}</p>
        <template v-if="rec">
          <div v-if="rec.items.length" class="rec-list">
            <div class="rec-head">{{ rec.location_name }} · {{ rec.festival_label }}应季</div>
            <div v-for="it in rec.items" :key="it.id" class="rec-item">
              <div class="rec-line">
                <button class="rec-name" @click="goWiki(it.name)">{{ it.name }}</button>
                <span class="rec-type" :class="`rec-type--${it.type}`">{{ it.type }}</span>
              </div>
              <p class="rec-reason">{{ it.reason }}</p>
              <p class="rec-meta">
                {{ it.indoor ? "室内 · " : "" }}{{ it.avg_cost_cny != null ? `人均 ¥${it.avg_cost_cny} · ` : "" }}评分 {{ it.rating }}
              </p>
            </div>
          </div>
          <p v-else class="rec-empty">暂未命中合适推荐，换个场景试试。</p>
        </template>
      </div>
      <div class="sidebar__section-title">工具</div>
      <div class="sidebar__tools">
        <button @click="exportChat('markdown')">导出 Markdown</button>
        <button @click="exportChat('json')">导出 JSON</button>
      </div>
      <div class="sidebar__section-title">帮助</div>
      <div class="sidebar__tools">
        <button @click="toast('如遇问题请通过右下角反馈入口提交', 'info')">意见反馈</button>
      </div>
    </aside>

    <!-- 主内容 -->
    <main class="agent__main">
      <!-- 顶部工具栏 -->
      <header class="agent__header">
        <div class="header__title">AI 伴游 · 楠楠</div>
        <div class="header__actions">
          <input
            v-model="searchText"
            class="header__search"
            placeholder="搜索当前对话…"
            type="text"
          />
          <select
            v-model="filterType"
            class="header__filter"
            title="按消息类型筛选"
            aria-label="按消息类型筛选"
          >
            <option value="all">全部类型</option>
            <option value="text">文本</option>
            <option value="tool">工具调用</option>
            <option value="plan">行程</option>
            <option value="diff">变更</option>
          </select>
          <button
            class="header__toggle"
            :class="{ 'is-active': autoScroll }"
            @click="autoScroll = !autoScroll"
            title="开启/关闭自动滚动"
          >自动滚动</button>
        </div>
      </header>

      <!-- 演示控制台 -->
      <div v-if="DEMO_CONSOLE" class="demo-console yj-card">
        <div class="demo-console__info">
          <span class="demo-console__dot"></span>
          <b>评委演示控制台</b>
          <span class="demo-console__hint">Mock 天气按会话注入 · 仅演示环境显示</span>
        </div>
        <div class="demo-console__actions">
          <span v-if="store.mockWeather === 'rain'" class="yj-tag yj-tag--danger">14:00-18:00 暴雨模拟中</span>
          <button class="yj-btn yj-btn--danger yj-btn--sm" :disabled="store.mockWeather === 'rain'" @click="fireRain">
            ⚡ 模拟突发暴雨（Killer Demo）
          </button>
          <button class="yj-btn yj-btn--ghost yj-btn--sm" :disabled="store.mockWeather !== 'rain'" @click="restoreWeather">
            ↺ 恢复正常天气
          </button>
        </div>
      </div>

      <!-- 消息列表 -->
      <div ref="listEl" class="chat-list yj-scroll">
        <!-- 空态欢迎 -->
        <div v-if="!msgs.length" class="welcome">
          <img class="welcome__avatar" src="/assets/brand/nannan-welcome.png" alt="楠楠" />
          <h1 class="welcome__title">嗨，我是 <span class="font-serif-sc">楠楠</span></h1>
          <p class="welcome__sub">
            我把永嘉的山水、文化、烟火装进了知识库。想怎么玩，尽管说——
          </p>
          <div class="welcome__chips">
            <button
              v-for="s in shortcuts"
              :key="s.id"
              class="welcome__chip"
              @click="send(s.prompt)"
            >{{ s.title }}</button>
          </div>
        </div>

        <!-- 无搜索结果 -->
        <div v-else-if="!visibleMsgs.length" class="no-result">
          没有找到匹配“<strong>{{ searchText }}</strong>”或当前筛选类型的消息
          <br />
          <button class="chip" @click="searchText = ''; filterType = 'all'">清除筛选</button>
        </div>

        <!-- 消息 -->
        <template v-else>
          <template v-for="{ m, idx } in visibleMsgs" :key="idx">
            <!-- 用户 -->
            <div v-if="m.role === 'user'" class="row row--user">
              <div class="bubble bubble--user">{{ m.blocks[0]?.kind === 'text' ? m.blocks[0].text : '' }}</div>
            </div>

            <!-- AI -->
            <div v-else class="row row--ai">
              <img class="avatar avatar--ai" src="/assets/brand/nannan-avatar.png" alt="楠楠" />
              <div class="bubble bubble--ai">
                <template v-for="(b, bi) in m.blocks" :key="bi">
                  <div v-if="b.kind === 'text'" class="rich">
                    <template v-for="(seg, si) in parseSourceSegments(b.text)" :key="si">
                      <template v-if="seg.t === 'txt'"><span style="white-space: pre-wrap">{{ seg.v }}</span></template>
                      <button v-else class="src-badge" @click="goWiki(seg.v)">来源：{{ seg.v }}</button>
                    </template>
                    <span v-if="m.streaming && bi === m.blocks.length - 1 && b.text" class="yj-caret"></span>
                  </div>

                  <div v-if="b.kind === 'tool'" class="tool">
                    <span v-if="b.status === 'running'" class="yj-spinner" style="width: 12px; height: 12px"></span>
                    <span v-else class="tool__ok">✓</span>
                    <span class="tool__label">{{ toolLabel(b.tool) }}</span>
                    <span v-if="b.args" class="tool__args">{{ b.args }}</span>
                    <span v-if="b.status === 'done' && b.summary" class="tool__sum">{{ b.summary }}</span>
                  </div>

                  <div v-if="b.kind === 'plan'" class="block-card">
                    <ItineraryPlan :plan="b.data" />
                    <button v-if="isMobileApp" class="plan-jump" @click="planPage = true">
                      查看完整行程 →
                    </button>
                  </div>

                  <div v-if="b.kind === 'diff'" class="block-card">
                    <PlanDiff :diff="b.data" />
                    <button v-if="isMobileApp" class="plan-jump" @click="planPage = true">
                      查看行程变更 →
                    </button>
                  </div>
                </template>

                <div v-if="m.errorText" class="offline-chip" :title="m.errorHint">{{ m.errorText }}</div>
                <div v-if="m.streaming && !m.blocks.some((x) => x.kind === 'text' || x.kind === 'tool')" class="typing">
                  <span class="yj-spinner" style="width: 13px; height: 13px"></span>
                  楠楠正在思考…
                </div>

                <!-- 反馈 -->
                <div v-if="!m.streaming" class="feedback">
                  <button
                    class="feedback__btn"
                    :class="{ 'is-active': feedbackMap[idx] === 'up' }"
                    title="有帮助"
                    @click="feedback(idx, 'up')"
                  >👍</button>
                  <button
                    class="feedback__btn"
                    :class="{ 'is-active': feedbackMap[idx] === 'down' }"
                    title="没帮助"
                    @click="feedback(idx, 'down')"
                  >👎</button>
                </div>
              </div>
            </div>
          </template>
        </template>
      </div>

      <!-- 底部输入栏 -->
      <div class="composer">
        <!-- 快捷技能浮层：数据来自与侧栏同一份 shortcuts -->
        <div v-if="skillOpen" class="skills">
          <div class="skills__head">
            <span>快捷技能</span>
            <button class="skills__close" title="收起" @click="skillOpen = false">×</button>
          </div>
          <div v-if="shortcuts.length" class="skills__list">
            <button v-for="s in shortcuts" :key="s.id" class="skills__chip" @click="pickSkill(s.prompt)">
              {{ s.title }}
            </button>
          </div>
          <p v-else class="skills__empty">快捷技能加载中…</p>
        </div>

        <div class="composer__bar">
          <button
            class="composer__icon"
            :class="{ 'is-on': skillOpen }"
            title="快捷技能"
            :aria-expanded="skillOpen"
            @click="skillOpen = !skillOpen"
          >⚡</button>
          <textarea
            v-model="input"
            class="composer__input yj-scroll"
            rows="1"
            placeholder="问楠楠：吃住行玩，直接说…"
            aria-label="向楠楠提问"
            @keydown.enter.exact.prevent="send()"
          ></textarea>
          <button v-if="streaming" class="composer__send composer__send--stop" @click="stop">停止</button>
          <button v-else class="composer__send" :disabled="!input.trim()" @click="send()">发送</button>
          <!-- 不支持语音识别的浏览器不渲染此按钮，避免死控件 -->
          <button
            v-if="speechSupported"
            class="composer__icon"
            :class="{ 'is-on': listening }"
            :title="listening ? '停止录音' : '语音输入'"
            @click="toggleVoice"
          >{{ listening ? "⏹" : "🎤" }}</button>
        </div>
        <div class="composer__hint">楠楠基于本地知识库回答，行程信息仅供参考 · Enter 发送 / Shift+Enter 换行</div>
      </div>
    </main>

    <!-- 右侧行程卡（≥1025px） -->
    <aside class="agent__side card-panel">
      <div class="side__head">
        <span class="side__title">实时行程</span>
        <span v-if="store.mockWeather === 'rain'" class="yj-tag yj-tag--danger">暴雨进行中</span>
      </div>
      <div class="side__body yj-scroll">
        <PlanSideBody :plan="latestPlan" :diff="latestDiff" />
      </div>
    </aside>

    <!-- 窄屏（≤1024px）：行程抽屉入口 + 底部抽屉，保证手机端也能看「基础行程（原方案）」；
         手机端 App 点浮窗进全屏行程页（planPage），PC 窄窗口仍走抽屉 -->
    <button
      class="plan-fab"
      :class="{ 'plan-fab--on': hasPlan }"
      aria-haspopup="dialog"
      :aria-expanded="isMobileApp ? planPage : sheetOpen"
      @click="openPlanView"
    >
      <span class="plan-fab__ic" aria-hidden="true">🗺</span>
      <span>实时行程</span>
      <span v-if="latestDiff" class="plan-fab__badge">原方案</span>
      <span v-else-if="hasPlan" class="plan-fab__dot" aria-hidden="true"></span>
    </button>

    <Transition name="plan-sheet">
      <div v-if="sheetOpen" class="plan-sheet-mask" @click.self="sheetOpen = false">
        <section class="plan-sheet" role="dialog" aria-modal="true" aria-label="实时行程">
          <div class="plan-sheet__bar" aria-hidden="true"></div>
          <div class="plan-sheet__head">
            <span class="side__title">实时行程</span>
            <span v-if="store.mockWeather === 'rain'" class="yj-tag yj-tag--danger">暴雨进行中</span>
            <button class="plan-sheet__close" aria-label="收起" @click="sheetOpen = false">✕</button>
          </div>
          <div class="plan-sheet__body yj-scroll">
            <PlanSideBody
              :plan="latestPlan"
              :diff="latestDiff"
              empty-hint="在下方输入框告诉楠楠你的计划，行程会实时出现在这里。"
            />
          </div>
        </section>
      </div>
    </Transition>

    <!-- 手机端全屏行程页：浮窗 / 对话内「查看完整行程 →」打开，顶部按钮跳回对话 -->
    <Transition name="plan-page">
      <div v-if="planPage" class="plan-page" role="dialog" aria-modal="true" aria-label="实时行程">
        <header class="plan-page__bar">
          <button type="button" class="plan-page__back" @click="planPage = false">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
            返回对话
          </button>
          <span class="plan-page__title">实时行程</span>
          <span v-if="store.mockWeather === 'rain'" class="yj-tag yj-tag--danger">暴雨进行中</span>
        </header>
        <div class="plan-page__body yj-scroll">
          <PlanSideBody
            :plan="latestPlan"
            :diff="latestDiff"
            empty-hint="回到对话告诉楠楠你的计划，行程会实时出现在这里。"
          />
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.agent {
  display: flex;
  flex: 1;
  min-height: 0;
  background: var(--bg-page, #081018);
}

/* ---------- 左侧边栏 ---------- */
.agent__sidebar {
  width: 220px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 14px;
  background: linear-gradient(180deg, #0d1218, #0a0e14);
  border-right: 1px solid var(--border, rgba(62, 198, 184, 0.12));
  color: #e8eef2;
}
.sidebar__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 4px 10px;
}
.brand-mark {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: "Noto Serif SC", serif;
  font-weight: 700;
  color: #04231f;
  background: linear-gradient(135deg, #55d8c8, #2ab5a8);
  box-shadow: 0 0 16px rgba(62, 198, 184, 0.35);
  object-fit: cover;
}
.brand-name {
  font-weight: 700;
  font-size: 16px;
  letter-spacing: 0.06em;
}
.sidebar__new {
  width: 100%;
  border: 1px solid rgba(62, 198, 184, 0.35);
  background: rgba(62, 198, 184, 0.12);
  color: var(--primary, #3ec6b8);
  border-radius: 10px;
  padding: 9px 12px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.16s ease;
}
.sidebar__new:hover {
  background: rgba(62, 198, 184, 0.22);
  box-shadow: var(--glow-primary, 0 0 10px rgba(62, 198, 184, 0.25));
}
.sidebar__section-title {
  font-size: 11px;
  color: #8895a3;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin: 8px 4px 0;
}
.sidebar__shortcuts {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sidebar__chip,
.sidebar__tools button {
  text-align: left;
  border: none;
  background: transparent;
  color: #c3ccd4;
  padding: 7px 10px;
  border-radius: 8px;
  font-size: 12.5px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.sidebar__chip:hover,
.sidebar__tools button:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}
.sidebar__tools {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* ---------- 主内容 ---------- */
.agent__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}
.agent__header {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--border, rgba(62, 198, 184, 0.12));
  background: var(--bg-panel, #0d141c);
}
.header__title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary, #e8eef2);
}
.header__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 顶部控件（搜索框 / 类型筛选 / 自动滚动）：
   桌面统一 36px 高、10px 圆角；下拉框去原生外观 + 自定义箭头，
   option 强制深色配色（防系统深色模式下深底深字），键盘聚焦有可见环。 */
.header__search,
.header__filter,
.header__toggle {
  height: 36px;
  box-sizing: border-box;
  border: 1px solid rgba(62, 198, 184, 0.3);
  background: var(--bg-elevated, #0f1a23);
  border-radius: 10px;
  outline: none;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    background 0.15s ease;
}
.header__search {
  width: 180px;
  color: var(--text-primary, #e8eef2);
  padding: 0 12px;
  font-size: 13px;
}
.header__search::placeholder {
  color: #8b99a6;
}
.header__search:hover,
.header__filter:hover,
.header__toggle:hover {
  border-color: rgba(62, 198, 184, 0.5);
}
.header__search:focus-visible,
.header__filter:focus-visible,
.header__toggle:focus-visible {
  border-color: rgba(62, 198, 184, 0.72);
  box-shadow: 0 0 0 3px rgba(62, 198, 184, 0.18);
}
.header__filter {
  /* 去原生外观，用自绘 chevron，跨浏览器一致 */
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  min-width: 124px;
  padding: 0 34px 0 12px;
  color: var(--text-primary, #e8eef2);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  /* 让原生弹出的 option 列表跟随深色主题 */
  color-scheme: dark;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237fd4ca' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 11px center;
  background-size: 12px;
}
.header__filter option {
  background: #0f1a23;
  color: #e8eef2;
}
.header__filter:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.header__toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 14px;
  color: #9aa7b3;
  font-size: 12.5px;
  white-space: nowrap;
  cursor: pointer;
}
.header__toggle.is-active {
  border-color: rgba(62, 198, 184, 0.5);
  color: var(--primary, #3ec6b8);
  background: rgba(62, 198, 184, 0.1);
}

/* demo console */
.demo-console {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border-color: rgba(248, 113, 113, 0.28);
  background: linear-gradient(120deg, rgba(248, 113, 113, 0.07), var(--bg-panel) 50%);
}
.demo-console__info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-primary);
}
.demo-console__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger);
  box-shadow: 0 0 8px rgba(248, 113, 113, 0.8);
}
.demo-console__hint {
  font-size: 12px;
  color: var(--text-dim);
}
.demo-console__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* chat list */
.chat-list {
  flex: 1;
  overflow-y: auto;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
}

/* welcome */
.welcome {
  margin: auto;
  text-align: center;
  max-width: 520px;
  padding: 30px 10px;
}
.welcome__avatar {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  margin: 0 auto 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: "Noto Serif SC", serif;
  font-weight: 700;
  font-size: 32px;
  color: #04231f;
  background: linear-gradient(135deg, #55d8c8, #2ab5a8);
  box-shadow: 0 0 34px rgba(62, 198, 184, 0.35);
  object-fit: cover;
}
.welcome__title {
  font-size: 26px;
  margin: 0 0 8px;
  color: var(--text-primary, #e8eef2);
}
.welcome__sub {
  color: var(--text-secondary, #aab4bd);
  font-size: 14.5px;
  line-height: 1.7;
  margin: 0 0 22px;
}
.welcome__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
}
.welcome__chip {
  cursor: pointer;
  border: 1px solid rgba(62, 198, 184, 0.35);
  background: rgba(62, 198, 184, 0.1);
  color: var(--primary, #3ec6b8);
  font-size: 13px;
  border-radius: 999px;
  padding: 8px 16px;
  transition: all 0.16s ease;
}
.welcome__chip:hover {
  background: rgba(62, 198, 184, 0.22);
  box-shadow: var(--glow-primary, 0 0 12px rgba(62, 198, 184, 0.25));
}

.no-result {
  margin: auto;
  text-align: center;
  color: var(--text-secondary, #aab4bd);
  font-size: 14px;
  padding: 30px;
}
.no-result button {
  margin-top: 12px;
}

/* messages */
.row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.row--user {
  justify-content: flex-end;
}
.row--ai {
  justify-content: flex-start;
}
.avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: "Noto Serif SC", serif;
  font-weight: 700;
  color: #04231f;
  background: linear-gradient(135deg, #55d8c8, #2ab5a8);
  box-shadow: 0 0 12px rgba(62, 198, 184, 0.3);
  object-fit: cover;
  font-size: 15px;
  flex: none;
  margin-top: 2px;
}
.bubble {
  max-width: 78%;
  padding: 12px 15px;
  border-radius: 14px;
  font-size: 14.5px;
  line-height: 1.7;
}
.bubble--user {
  background: linear-gradient(135deg, rgba(62, 198, 184, 0.9), rgba(62, 198, 184, 0.72));
  color: #04231f;
  border-bottom-right-radius: 4px;
  white-space: pre-wrap;
}
.bubble--ai {
  background: var(--bg-elevated, #0f1a23);
  border: 1px solid var(--border, rgba(62, 198, 184, 0.12));
  border-bottom-left-radius: 4px;
  min-width: 0;
}
.bubble--ai .rich {
  white-space: normal;
  word-break: break-word;
}
.src-badge {
  display: inline-block;
  margin: 0 3px;
  vertical-align: middle;
  cursor: pointer;
  font-size: 11.5px;
  color: var(--primary, #3ec6b8);
  border: 1px solid rgba(62, 198, 184, 0.4);
  background: rgba(62, 198, 184, 0.1);
  border-radius: 999px;
  padding: 1px 9px;
  transition: all 0.15s ease;
}
.src-badge:hover {
  background: rgba(62, 198, 184, 0.3);
}
.tool {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--text-secondary);
  background: rgba(22, 38, 63, 0.7);
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 6px 10px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.tool__ok {
  color: var(--success);
}
.tool__label {
  color: var(--text-primary);
}
.tool__args {
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  color: var(--text-dim);
}
.tool__sum {
  color: var(--text-dim);
}
.block-card {
  margin-top: 8px;
}
.offline-chip {
  margin-top: 8px;
  font-size: 12px;
  color: var(--accent);
  border: 1px dashed rgba(232, 184, 75, 0.4);
  border-radius: 8px;
  padding: 6px 10px;
  display: inline-block;
}
.typing {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-dim);
  margin-top: 4px;
}
.feedback {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  opacity: 0.7;
  transition: opacity 0.16s ease;
}
.bubble--ai:hover .feedback {
  opacity: 1;
}
.feedback__btn {
  border: 1px solid var(--border, rgba(62, 198, 184, 0.18));
  background: transparent;
  border-radius: 6px;
  padding: 3px 7px;
  font-size: 13px;
  cursor: pointer;
  filter: grayscale(0.5);
}
.feedback__btn.is-active {
  background: rgba(62, 198, 184, 0.15);
  border-color: rgba(62, 198, 184, 0.45);
  filter: grayscale(0);
}

/* composer */
.composer {
  flex: none;
  min-width: 0;
  padding: 10px 18px 14px;
  border-top: 1px solid var(--border, rgba(62, 198, 184, 0.12));
  background: var(--bg-panel, #0d141c);
}
.composer__bar {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  min-width: 0;
  padding: 8px 12px;
  background: var(--bg-elevated, #0f1a23);
  border: 1px solid var(--border, rgba(62, 198, 184, 0.18));
  border-radius: 16px;
  box-shadow: 0 2px 14px rgba(0, 0, 0, 0.25);
}
.composer__icon {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: #8895a3;
  font-size: 16px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}
.composer__icon:hover {
  background: rgba(62, 198, 184, 0.1);
  color: var(--primary, #3ec6b8);
}
/* 已展开 / 正在录音：给一个明确的选中态，否则用户不知道按钮是否生效 */
.composer__icon.is-on {
  background: rgba(62, 198, 184, 0.18);
  color: var(--primary, #3ec6b8);
  box-shadow: 0 0 0 1px rgba(62, 198, 184, 0.4) inset;
}
/* 快捷技能浮层：跟在输入框上方，不走绝对定位，免得遮挡消息列表 */
.skills {
  margin: 0 0 8px;
  padding: 10px 12px;
  background: var(--bg-elevated, #0f1a23);
  border: 1px solid var(--border, rgba(62, 198, 184, 0.18));
  border-radius: 12px;
}
.skills__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary, #8895a3);
  letter-spacing: 0.08em;
  margin-bottom: 8px;
}
.skills__close {
  border: none;
  background: transparent;
  color: #8895a3;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
}
.skills__close:hover {
  color: var(--primary, #3ec6b8);
}
.skills__list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.skills__chip {
  border: 1px solid var(--border, rgba(62, 198, 184, 0.2));
  background: transparent;
  color: var(--text-primary, #e8eef2);
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.skills__chip:hover {
  border-color: rgba(62, 198, 184, 0.5);
  background: rgba(62, 198, 184, 0.1);
  color: var(--primary, #3ec6b8);
}
.skills__empty {
  margin: 0;
  font-size: 12px;
  color: var(--text-tertiary, #6b7785);
}
.composer__input {
  /* min-width:0 关键：flex 子项默认 min-width:auto，窄屏不收缩会把发送/语音按钮挤出栏外重叠 */
  flex: 1 1 0%;
  min-width: 0;
  width: 100%;
  resize: none;
  border: none;
  background: transparent;
  color: var(--text-primary, #e8eef2);
  font-size: 14px;
  line-height: 1.6;
  padding: 6px 2px;
  outline: none;
  max-height: 120px;
  overflow-y: auto;
  scrollbar-width: thin;
}
/* 隐藏 Windows/Android WebKit 文本框滚动条上下箭头，避免压在占位文字上 */
.composer__input::-webkit-scrollbar {
  width: 4px;
}
.composer__input::-webkit-scrollbar-thumb {
  background: rgba(136, 149, 163, 0.45);
  border-radius: 2px;
}
.composer__input::-webkit-scrollbar-track,
.composer__input::-webkit-scrollbar-button {
  display: none;
}
.composer__send {
  flex: 0 0 auto;
  white-space: nowrap;
  border: none;
  border-radius: 10px;
  padding: 8px 16px;
  font-size: 13px;
  background: var(--primary, #3ec6b8);
  color: #04231f;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.composer__send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.composer__send--stop {
  background: var(--danger);
  color: #fff;
}
.composer__hint {
  text-align: center;
  font-size: 11px;
  color: #5d6c78;
  margin-top: 8px;
}

/* ---------- 右侧行程卡 ---------- */
.agent__side {
  width: 380px;
  flex: none;
  min-width: 0;
}
.card-panel {
  background: var(--bg-panel, #0d141c);
  border: 1px solid var(--border, rgba(62, 198, 184, 0.12));
  border-radius: var(--radius-card, 12px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.side__head {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.side__title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}
.side__body {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* ---------- 窄屏行程抽屉（G-06） ---------- */
.plan-fab {
  display: none;
  position: fixed;
  /* 手机端限宽列（--yjm-gutter 由 .yjm-root 定义）时贴列右缘；PC 端无该变量，回退 14px */
  right: max(14px, calc(var(--yjm-gutter, 0px) + 14px));
  bottom: 104px;
  z-index: 60;
  align-items: center;
  gap: 7px;
  padding: 10px 15px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  background: rgba(13, 20, 28, 0.94);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.45);
}
.plan-fab--on {
  border-color: rgba(62, 198, 184, 0.5);
  color: var(--primary, #3ec6b8);
  box-shadow: 0 10px 26px rgba(62, 198, 184, 0.22);
}
.plan-fab__ic {
  font-size: 14px;
}
.plan-fab__badge {
  font-size: 10px;
  font-weight: 600;
  color: #0a0e14;
  background: #ffd27d;
  border-radius: 99px;
  padding: 2px 7px;
}
.plan-fab__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--primary, #3ec6b8);
}
.plan-sheet-mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(6, 10, 18, 0.62);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: flex-end;
}
.plan-sheet {
  width: 100%;
  max-height: 78vh;
  background: var(--bg-panel, #0d141c);
  border-top: 1px solid var(--border, rgba(62, 198, 184, 0.12));
  border-radius: 16px 16px 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-bottom: env(safe-area-inset-bottom);
}
.plan-sheet__bar {
  flex: none;
  width: 42px;
  height: 4px;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.22);
  margin: 8px auto 0;
}
.plan-sheet__head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px 10px;
  border-bottom: 1px solid var(--border);
}
.plan-sheet__close {
  margin-left: auto;
  flex: none;
  width: 30px;
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(10, 18, 32, 0.6);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
}
.plan-sheet__close:hover {
  color: var(--primary);
  border-color: var(--primary);
}
.plan-sheet__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.plan-sheet-enter-active,
.plan-sheet-leave-active {
  transition: opacity 0.22s ease;
}
.plan-sheet-enter-active .plan-sheet,
.plan-sheet-leave-active .plan-sheet {
  transition: transform 0.26s ease;
}
.plan-sheet-enter-from,
.plan-sheet-leave-to {
  opacity: 0;
}
.plan-sheet-enter-from .plan-sheet,
.plan-sheet-leave-to .plan-sheet {
  transform: translateY(100%);
}

/* ---------- 手机端全屏行程页（覆盖层，保留对话状态） ---------- */
.plan-page {
  position: fixed;
  top: 0;
  bottom: 0;
  /* 手机端限宽列：贴列居中（--yjm-gutter 由 .yjm-root 定义）；PC 端无该变量回退 0 */
  left: var(--yjm-gutter, 0px);
  right: auto;
  width: min(100vw, 520px);
  z-index: 95;
  display: flex;
  flex-direction: column;
  background: var(--bg-page, #081018);
}
.plan-page__bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: calc(env(safe-area-inset-top, 0px) + 12px) 14px 12px;
  border-bottom: 1px solid var(--border, rgba(62, 198, 184, 0.12));
  background: var(--bg-panel, #0d141c);
}
.plan-page__back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(62, 198, 184, 0.35);
  background: rgba(62, 198, 184, 0.1);
  color: var(--primary, #3ec6b8);
  border-radius: 10px;
  padding: 8px 13px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.plan-page__back svg {
  width: 13px;
  height: 13px;
}
.plan-page__back:active {
  background: rgba(62, 198, 184, 0.22);
}
.plan-page__title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary, #e8eef2);
}
.plan-page__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 14px calc(20px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.plan-page-enter-active,
.plan-page-leave-active {
  transition: opacity 0.2s ease, transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}
.plan-page-enter-from,
.plan-page-leave-to {
  opacity: 0;
  transform: translateY(22px);
}

/* 对话内「查看完整行程 →」链接按钮（仅手机端渲染） */
.plan-jump {
  margin-top: 10px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid rgba(62, 198, 184, 0.4);
  background: rgba(62, 198, 184, 0.1);
  color: var(--primary, #3ec6b8);
  border-radius: 999px;
  padding: 7px 14px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s ease;
}
.plan-jump:active {
  background: rgba(62, 198, 184, 0.24);
}

/* ---------- 侧栏 · 应季推荐（板块三） ---------- */
.rec-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 2px;
}
.rec-select {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  color: #dfe7ed;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  padding: 7px 8px;
  font-size: 12px;
  outline: none;
}
.rec-select option {
  color: #0a0e14;
  background: #fff;
}
.rec-go {
  border: 1px solid rgba(62, 198, 184, 0.4);
  background: rgba(62, 198, 184, 0.12);
  color: #55d8c8;
  border-radius: 8px;
  padding: 7px 8px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.rec-go:hover:not(:disabled) {
  background: rgba(62, 198, 184, 0.22);
}
.rec-go:disabled {
  opacity: 0.55;
  cursor: default;
}
.rec-err {
  margin: 0;
  font-size: 11.5px;
  color: #ff9b8f;
  line-height: 1.5;
}
.rec-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 6px;
  border: 1px dashed rgba(62, 198, 184, 0.28);
  border-radius: 10px;
  background: rgba(62, 198, 184, 0.05);
}
.rec-head {
  font-size: 11px;
  color: #7fd8cd;
  margin: 2px 4px 0;
}
.rec-item {
  padding: 7px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
}
.rec-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.rec-name {
  border: none;
  background: none;
  padding: 0;
  text-align: left;
  color: #e9f2f6;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  line-height: 1.3;
}
.rec-name:hover {
  color: #55d8c8;
  text-decoration: underline;
}
.rec-type {
  flex: none;
  font-size: 10px;
  border-radius: 99px;
  padding: 1px 7px;
  color: #0a0e14;
}
.rec-type--美食 {
  background: #ffd27d;
}
.rec-type--非遗体验 {
  background: #b9c8ff;
}
.rec-type--山水景点 {
  background: #7ee0b8;
}
.rec-type--休闲住宿 {
  background: #e6b7ff;
}
.rec-reason {
  margin: 4px 0 0;
  font-size: 11px;
  color: #aab6c0;
  line-height: 1.55;
}
.rec-meta {
  margin: 3px 0 0;
  font-size: 10.5px;
  color: #71828f;
}
.rec-empty {
  margin: 0;
  font-size: 12px;
  color: #8b98a4;
  text-align: center;
  padding: 8px 4px;
}

@media (max-width: 1280px) {
  .agent__sidebar {
    display: none;
  }
  .agent__side {
    width: 340px;
  }
}
@media (max-width: 1024px) {
  .agent__side {
    display: none;
  }
  /* 右侧栏隐藏时，用悬浮按钮唤起行程抽屉 */
  .plan-fab {
    display: inline-flex;
  }
  /* 平板：控件允许换行，搜索框弹性伸缩，不再被 120px 定宽挤压 */
  .header__actions {
    flex-wrap: wrap;
    row-gap: 8px;
  }
  .header__search {
    width: auto;
    flex: 1 1 140px;
    min-width: 0;
  }
}
@media (max-width: 640px) {
  /* 手机：头部两行结构；所有可点控件 ≥40px 触摸高度，
     输入/下拉字号 ≥16px 防止 iOS Safari 聚焦自动放大页面 */
  .agent__header {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    padding: 10px 14px;
  }
  .header__actions {
    justify-content: stretch;
    gap: 10px;
  }
  .header__search {
    flex: 1 1 100%;
    height: 40px;
    font-size: 16px;
  }
  .header__filter {
    flex: 1 1 132px;
    min-width: 0;
    height: 40px;
    padding: 0 34px 0 12px;
    font-size: 16px;
    background-position: right 12px center;
  }
  .header__toggle {
    flex: 0 0 auto;
    height: 40px;
    min-width: 96px;
    font-size: 13px;
  }
  .bubble {
    max-width: 90%;
  }
  .composer__hint {
    display: none;
  }
  /* 输入栏：收窄内边距，图标/发送按钮固定不收缩，输入框吃掉剩余空间；
     输入字号 16px 防 iOS Safari 聚焦自动放大 */
  .composer {
    padding: 8px 12px 12px;
  }
  .composer__bar {
    gap: 6px;
    padding: 6px 8px;
    border-radius: 14px;
  }
  .composer__icon {
    width: 36px;
    height: 36px;
    font-size: 17px;
  }
  .composer__input {
    font-size: 16px;
    line-height: 1.5;
    padding: 8px 2px;
  }
  .composer__send {
    min-height: 38px;
    padding: 8px 14px;
  }
}
/* 超窄屏（iPhone SE / 320-360px 安卓）：再压一档间距，保证一行不溢出 */
@media (max-width: 360px) {
  .composer {
    padding: 8px 10px 10px;
  }
  .composer__bar {
    gap: 4px;
    padding: 6px;
  }
  .composer__icon {
    width: 34px;
    height: 34px;
  }
  .composer__send {
    padding: 8px 12px;
  }
}

/* ---------- 手机端 App（/m/）：布局跟 520px 限宽列走，不看视口宽度 ----------
   桌面浏览器/投屏打开 /m/ 时视口 >1024px，若沿用上面的媒体查询会在限宽列里
   渲染出 PC 三栏布局（侧栏 + 380px 右行程卡全挤在 520px 里）。
   用路由驱动的 .agent--m 强制移动端形态：对齐 ≤1024 与 ≤640 两档规则，
   PC 运营端（无 .agent--m）不受任何影响。 */
.agent--m .agent__sidebar,
.agent--m .agent__side {
  display: none;
}
.agent--m .plan-fab {
  display: inline-flex;
}
.agent--m .agent__header {
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  padding: 10px 14px;
}
.agent--m .header__actions {
  justify-content: stretch;
  flex-wrap: wrap;
  row-gap: 8px;
}
.agent--m .header__search {
  flex: 1 1 100%;
  width: auto;
  height: 40px;
  font-size: 16px;
}
.agent--m .header__filter {
  flex: 1 1 132px;
  min-width: 0;
  height: 40px;
  padding: 0 34px 0 12px;
  font-size: 16px;
  background-position: right 12px center;
}
.agent--m .header__toggle {
  flex: 0 0 auto;
  height: 40px;
  min-width: 96px;
  font-size: 13px;
}
.agent--m .bubble {
  max-width: 90%;
}
.agent--m .composer {
  padding: 8px 12px 12px;
}
.agent--m .composer__bar {
  gap: 6px;
  padding: 6px 8px;
  border-radius: 14px;
}
.agent--m .composer__icon {
  width: 36px;
  height: 36px;
  font-size: 17px;
}
.agent--m .composer__input {
  font-size: 16px;
  line-height: 1.5;
  padding: 8px 2px;
}
.agent--m .composer__send {
  min-height: 38px;
  padding: 8px 14px;
}
.agent--m .composer__hint {
  display: none;
}
</style>
