<script setup lang="ts">
/**
 * 板块二 · 游戏内 Agent 对话坞（楠楠随行）
 *
 * 把「静态 NPC 问答」升级为可对话的随行 Agent：
 * - 右下悬浮球，点击展开对话面板，不遮挡 AR 画面
 * - 自动携带游戏上下文（当前场景 / 目标点位 / 距离 / 是否在围栏内 / 进度），
 *   因此「给点提示」「怎么走」这类短指令也能被正确理解
 * - 快捷指令随状态变化：围栏外问方向、围栏内问典故、答完问下一站
 * - 复用 /api/chat 的 SSE 通道（token 流式 + tool_call 过程可见）
 *
 * 演示口径：对话为真实 Agent 通道（MOCK_LLM=false 时为真实大模型；否则走剧本回放），
 * 位置上下文来自浏览器模拟定位。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { chatSse } from "@/api/client";
import type { PlanDiffPayload } from "@/types/api";

const props = withDefaults(
  defineProps<{
    /** 游戏上下文：用于把短指令补全成完整问题 */
    context?: {
      gameName?: string;
      sceneName?: string;
      poiName?: string;
      distance?: number;
      inside?: boolean;
      collected?: boolean;
      solved?: number;
      total?: number;
    };
    sessionId?: string;
  }>(),
  { context: () => ({}), sessionId: "ar-player" }
);

interface Msg {
  id: number;
  role: "user" | "ai";
  text: string;
  tools: string[];
  streaming?: boolean;
  error?: boolean;
}

const open = ref(false);
const input = ref("");
const msgs = ref<Msg[]>([]);
const sending = ref(false);
const scroller = ref<HTMLDivElement | null>(null);
const hasUnread = ref(false);
let seq = 0;
let ctrl: AbortController | null = null;

const ctx = computed(() => props.context);

/** 上下文摘要：面板顶部常驻，让评委一眼看到 Agent「知道自己在哪」 */
const ctxLine = computed(() => {
  const c = ctx.value;
  const bits: string[] = [];
  if (c.sceneName) bits.push(c.sceneName);
  if (c.poiName) bits.push(`目标 ${c.poiName}`);
  if (typeof c.distance === "number") bits.push(`${Math.round(c.distance)}m`);
  if (c.inside) bits.push("已在寻宝范围");
  if (typeof c.solved === "number" && c.total) bits.push(`进度 ${c.solved}/${c.total}`);
  return bits.join(" · ") || "等待定位…";
});

/** 快捷指令随游戏状态变化，避免问出与当下无关的问题 */
const quickChips = computed(() => {
  const c = ctx.value;
  if (c.collected) {
    return ["这个场景还有什么值得看？", "帮我规划下一站", "把今天的行程整理一下"];
  }
  if (c.inside) {
    return [`讲讲${c.poiName || "这里"}的典故`, "题目给点提示", "附近还有什么好玩的"];
  }
  return [`${c.poiName || "目标"}在哪个方向？`, "怎么走过去最快", "附近有什么可以顺路看的"];
});

function scrollToEnd() {
  void nextTick(() => {
    const el = scroller.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

/** 把用户短指令 + 上下文拼成一句自然语言，交给 Agent */
function composeMessage(raw: string): string {
  const c = ctx.value;
  const parts: string[] = [];
  if (c.gameName) parts.push(`我正在玩《${c.gameName}》`);
  if (c.sceneName) parts.push(`人在${c.sceneName}`);
  else if (c.poiName) parts.push(`我正在去${c.poiName}的路上`);
  if (c.poiName) parts.push(`目标是「${c.poiName}」`);
  if (typeof c.distance === "number") parts.push(`距离还有约 ${Math.round(c.distance)} 米`);
  if (c.inside) parts.push("已经进入寻宝范围");
  if (typeof c.solved === "number" && c.total) parts.push(`已完成 ${c.solved}/${c.total} 个点位`);
  if (!parts.length) return raw;
  return `${parts.join("，")}。${raw}`;
}

async function send(preset?: string) {
  const raw = (preset ?? input.value).trim();
  if (!raw || sending.value) return;
  input.value = "";
  open.value = true;

  const userMsg: Msg = { id: ++seq, role: "user", text: raw, tools: [] };
  const aiMsg: Msg = { id: ++seq, role: "ai", text: "", tools: [], streaming: true };
  msgs.value.push(userMsg, aiMsg);
  scrollToEnd();

  sending.value = true;
  ctrl?.abort();
  ctrl = new AbortController();

  try {
    await chatSse(
      props.sessionId,
      composeMessage(raw),
      {
        onToken: (t) => {
          aiMsg.text += t;
          scrollToEnd();
        },
        onToolCall: (d) => {
          const name = String((d as { name?: string; tool?: string }).name ?? (d as { tool?: string }).tool ?? "工具");
          aiMsg.tools.push(name);
          scrollToEnd();
        },
        onPlan: () => {
          aiMsg.tools.push("生成行程");
        },
        onPlanDiff: (_d: PlanDiffPayload) => {
          aiMsg.tools.push("行程调整");
        },
        onDone: () => {
          aiMsg.streaming = false;
        },
        onError: (_code, message, fallback) => {
          aiMsg.streaming = false;
          aiMsg.error = true;
          aiMsg.text = aiMsg.text || `${message}${fallback ? "（已降级为剧本回放）" : ""}`;
        },
      },
      ctrl.signal
    );
  } catch (err) {
    aiMsg.streaming = false;
    aiMsg.error = true;
    if ((err as { name?: string })?.name !== "AbortError") {
      aiMsg.text = aiMsg.text || "对话通道暂时不可用，请稍后再试。";
    }
  } finally {
    aiMsg.streaming = false;
    sending.value = false;
    if (!open.value) hasUnread.value = true;
    scrollToEnd();
  }
}

/** 状态变化时自动欢迎一次，让 Agent 主动开口（演示更完整） */
watch(
  () => [ctx.value.poiName, ctx.value.inside] as const,
  (val, old) => {
    const poi = val?.[0];
    const inside = val?.[1];
    const prevInside = old?.[1];
    if (!msgs.value.length) {
      msgs.value.push({
        id: ++seq,
        role: "ai",
        tools: [],
        text: `我是楠楠，你的随行向导。${poi ? `本次目标是「${poi}」，` : ""}${inside ? "你已经进入寻宝范围，可以开始探索了。" : "走到目标附近再问我，我会给你提示。"}`,
      });
      hasUnread.value = true;
      return;
    }
    if (inside && !prevInside && poi) {
      msgs.value.push({
        id: ++seq,
        role: "ai",
        tools: [],
        text: `已进入「${poi}」的寻宝范围，虚拟信物出现了。需要提示随时叫我。`,
      });
      hasUnread.value = true;
    }
  },
  { immediate: true }
);

function toggle() {
  open.value = !open.value;
  if (open.value) {
    hasUnread.value = false;
    scrollToEnd();
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void send();
  }
}

onBeforeUnmount(() => ctrl?.abort());
</script>

<template>
  <div class="dock" :class="{ 'dock--open': open }">
    <!-- 展开面板 -->
    <transition name="dock-pop">
      <section v-if="open" class="dock__panel">
        <header class="dock__head">
          <img class="dock__avatar" src="/assets/brand/nannan-avatar.png" alt="楠楠" />
          <div class="dock__who">
            <b>楠楠</b>
            <span>随行向导 · Agent</span>
          </div>
          <button class="dock__close" type="button" aria-label="收起" @click="toggle">✕</button>
        </header>
        <p class="dock__ctx">{{ ctxLine }}</p>

        <div ref="scroller" class="dock__body">
          <div v-for="m in msgs" :key="m.id" class="dock__row" :class="`dock__row--${m.role}`">
            <img v-if="m.role === 'ai'" class="dock__mini" src="/assets/brand/nannan-avatar.png" alt="" />
            <div class="dock__bubble" :class="{ 'is-error': m.error }">
              <p v-if="m.text || m.streaming" class="dock__text">
                {{ m.text }}<i v-if="m.streaming" class="dock__caret" />
              </p>
              <p v-else class="dock__text dock__text--dim">思考中…</p>
              <div v-if="m.tools.length" class="dock__tools">
                <span v-for="(t, i) in m.tools" :key="i" class="dock__tool">{{ t }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="dock__chips">
          <button v-for="c in quickChips" :key="c" type="button" :disabled="sending" @click="send(c)">
            {{ c }}
          </button>
        </div>

        <div class="dock__input">
          <input
            v-model="input"
            type="text"
            placeholder="问问楠楠…"
            :disabled="sending"
            @keydown="onKeydown"
          />
          <button type="button" :disabled="sending || !input.trim()" @click="send()">
            {{ sending ? "…" : "发送" }}
          </button>
        </div>
      </section>
    </transition>

    <!-- 悬浮球 -->
    <button class="dock__orb" type="button" :aria-label="open ? '收起楠楠' : '召唤楠楠'" @click="toggle">
      <img src="/assets/brand/nannan-avatar.png" alt="楠楠" />
      <i class="dock__ring" />
      <span v-if="hasUnread && !open" class="dock__badge">1</span>
    </button>
  </div>
</template>

<style scoped>
.dock {
  position: absolute;
  right: 12px;
  bottom: 74px;
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  pointer-events: none;
}
.dock > * {
  pointer-events: auto;
}

/* ---------- 悬浮球 ---------- */
.dock__orb {
  position: relative;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: 1.5px solid rgba(62, 198, 184, 0.6);
  background: rgba(8, 14, 24, 0.86);
  padding: 0;
  overflow: visible;
  cursor: pointer;
  backdrop-filter: blur(8px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
}
.dock__orb img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  display: block;
}
.dock__ring {
  position: absolute;
  inset: -5px;
  border-radius: 50%;
  border: 1px solid rgba(62, 198, 184, 0.5);
  animation: dock-pulse 2.6s ease-out infinite;
  pointer-events: none;
}
@keyframes dock-pulse {
  0% {
    transform: scale(0.92);
    opacity: 0.8;
  }
  100% {
    transform: scale(1.24);
    opacity: 0;
  }
}
.dock__badge {
  position: absolute;
  right: -3px;
  top: -3px;
  min-width: 17px;
  height: 17px;
  border-radius: 9px;
  background: #e8503a;
  color: #fff;
  font-size: 10px;
  line-height: 17px;
  text-align: center;
  padding: 0 4px;
}

/* ---------- 面板 ---------- */
.dock__panel {
  width: min(84vw, 322px);
  max-height: min(58vh, 430px);
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  background: rgba(9, 15, 26, 0.94);
  border: 1px solid var(--border);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(14px);
  overflow: hidden;
}
.dock-pop-enter-active,
.dock-pop-leave-active {
  transition: opacity 0.2s ease, transform 0.24s cubic-bezier(0.34, 1.4, 0.64, 1);
}
.dock-pop-enter-from,
.dock-pop-leave-to {
  opacity: 0;
  transform: translateY(14px) scale(0.96);
}

.dock__head {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--border);
}
.dock__avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  object-fit: cover;
}
.dock__who {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}
.dock__who b {
  font-size: 12.5px;
  color: var(--text-primary);
}
.dock__who span {
  font-size: 10px;
  color: var(--text-dim);
}
.dock__close {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: var(--text-dim);
  font-size: 13px;
  cursor: pointer;
  padding: 2px 4px;
}
.dock__ctx {
  margin: 0;
  padding: 6px 12px;
  font-size: 10px;
  color: var(--accent);
  background: rgba(62, 198, 184, 0.07);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dock__body {
  flex: 1;
  min-height: 96px;
  overflow-y: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.dock__row {
  display: flex;
  gap: 6px;
  align-items: flex-start;
}
.dock__row--user {
  justify-content: flex-end;
}
.dock__mini {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  flex: 0 0 auto;
  object-fit: cover;
  margin-top: 1px;
}
.dock__bubble {
  max-width: 84%;
  padding: 7px 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--border);
}
.dock__row--user .dock__bubble {
  background: rgba(62, 198, 184, 0.16);
  border-color: rgba(62, 198, 184, 0.34);
}
.dock__bubble.is-error {
  border-color: rgba(232, 80, 58, 0.5);
  background: rgba(232, 80, 58, 0.1);
}
.dock__text {
  margin: 0;
  font-size: 12px;
  line-height: 1.68;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}
.dock__text--dim {
  color: var(--text-dim);
}
.dock__caret {
  display: inline-block;
  width: 2px;
  height: 12px;
  margin-left: 2px;
  vertical-align: -2px;
  background: var(--accent);
  animation: dock-blink 0.9s steps(2) infinite;
}
@keyframes dock-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}
.dock__tools {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
.dock__tool {
  font-size: 9.5px;
  padding: 1.5px 6px;
  border-radius: var(--radius-pill);
  background: rgba(62, 198, 184, 0.14);
  color: var(--accent);
  border: 1px solid rgba(62, 198, 184, 0.28);
}

.dock__chips {
  display: flex;
  gap: 6px;
  padding: 0 12px 8px;
  overflow-x: auto;
  scrollbar-width: none;
}
.dock__chips::-webkit-scrollbar {
  display: none;
}
.dock__chips button {
  flex: 0 0 auto;
  padding: 5px 10px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-secondary);
  font-size: 10.5px;
  cursor: pointer;
  white-space: nowrap;
}
.dock__chips button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}
.dock__chips button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dock__input {
  display: flex;
  gap: 6px;
  padding: 8px 10px 10px;
  border-top: 1px solid var(--border);
}
.dock__input input {
  flex: 1;
  min-width: 0;
  padding: 8px 11px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
}
.dock__input input:focus {
  border-color: var(--accent);
}
.dock__input button {
  flex: 0 0 auto;
  padding: 0 14px;
  border-radius: var(--radius-pill);
  border: 0;
  background: linear-gradient(135deg, var(--accent), var(--success, #30d08c));
  color: #06210f;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.dock__input button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
