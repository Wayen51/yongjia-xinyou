import type { FastifyReply } from "fastify";
import type { DemoPlan, PlanDiffPayload } from "@zhiyou/shared";
import { config } from "../lib/config.ts";
import { chatCompletions } from "../lib/llm-adapter.ts";
import { getLatestItinerary, getSessionWeather, loadJson, listAllKnowledge } from "../db/db.ts";
import { CLASSIC_PLAN, generatePlan } from "../itinerary/plan.ts";
import { replanForRain, type RainNarration } from "../itinerary/rain.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";

type ScriptEvent = {
  event: string;
  delay_ms?: number;
  data: Record<string, unknown>;
};

type Scenario = {
  id: string;
  trigger: { pattern: string };
  events: ScriptEvent[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function writeSse(reply: FastifyReply, event: string, data: unknown) {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function normalizePlanDiff(data: Record<string, unknown>): PlanDiffPayload {
  if (Array.isArray(data.changes)) {
    return data as unknown as PlanDiffPayload;
  }
  const changes: PlanDiffPayload["changes"] = [];
  for (const r of (data.removed as Array<{ id: string; name: string; reason: string }>) || []) {
    changes.push({ type: "remove", itemId: r.id, reason: r.reason, item: r });
  }
  for (const a of (data.added as Array<{ id: string; name: string }>) || []) {
    changes.push({ type: "add", itemId: a.id, reason: (a as { reason?: string }).reason, item: a });
  }
  for (const m of (data.rescheduled as Array<{ id: string; name: string; reason: string }>) || []) {
    changes.push({ type: "modify", itemId: m.id, reason: m.reason, item: m });
  }
  return {
    banner: String(data.change_summary || "已为您重新规划：14:00起暴雨，行程已调整"),
    changes,
    ...data,
  } as PlanDiffPayload;
}

/* ================= 永嘉智库实时检索（RAG） ================= */

const DOMAIN_LABEL: Record<string, string> = {
  poi: "景点",
  culture: "人文",
  business: "商家",
  food: "美食",
  hotel: "住宿",
  event: "活动",
};

function domainLabel(d: string): string {
  return DOMAIN_LABEL[d] || d;
}

/** 把用户一句话切成片段（同时用于 UI 展示本轮检索关键词） */
const SEG_SPLIT = /[\s\u3000，。、,.!?！？；;:：·"“”‘’（）()\[\]【】<>《》/\\|—–-]+/;

function keyPhrases(message: string, max = 4): string[] {
  const out: string[] = [];
  for (const seg of message.split(SEG_SPLIT)) {
    const s = seg.trim();
    if (s.length >= 2 && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 抽取 2~5 字 n-gram 作为检索特征。
 * 中文实体词普遍只有 2~5 字，必须生成子串——否则「永嘉学派是什么」这类自然句
 * 永远命中不了库里名为「永嘉学派」的条目（此前整句 LIKE 正是栽在这里）。
 */
const GRAM_MIN = 2;
const GRAM_MAX = 5;

function charGrams(text: string): Set<string> {
  const grams = new Set<string>();
  for (const seg of text.split(SEG_SPLIT)) {
    const s = seg.trim();
    if (s.length < GRAM_MIN) continue;
    for (let len = Math.min(GRAM_MAX, s.length); len >= GRAM_MIN; len--) {
      for (let i = 0; i + len <= s.length; i++) grams.add(s.slice(i, i + len));
    }
  }
  return grams;
}

interface KbHit {
  id: string;
  name: string;
  domain: string;
  category: string | null;
  summary: string;
  content: string;
  rating: number;
}

/* 命中权重：条目名 > 标签 > 正文；用户原句直接提到条目名则近乎锁定该条 */
const W_VERBATIM = 12;
const W_NAME = 3;
const W_TAG = 2;
const W_TEXT = 0.8;

/**
 * 智库检索：全量候选 + n-gram 重叠度打分（IDF 加权），返回相关度前 N 条。
 * 条目仅百余条，内存打分比逐词 LIKE 召回率高一档，也能天然排出相关度顺序。
 */
function retrieveKnowledge(message: string, limit = 6): KbHit[] {
  const grams = charGrams(message);
  if (!grams.size) return [];

  const items = listAllKnowledge();
  const haystack = (it: typeof items[number]) =>
    `${it.name} ${it.summary || ""} ${it.content || ""} ${(it.tags || []).join(" ")}`;

  // IDF：越少条目包含的 gram 越有区分度（"永嘉"几乎人人有，"学派"才是指向性特征）
  const df = new Map<string, number>();
  for (const g of grams) {
    let n = 0;
    for (const it of items) if (haystack(it).includes(g)) n++;
    df.set(g, n);
  }
  const total = Math.max(items.length, 1);
  const idf = (g: string) => Math.log(1 + total / (1 + (df.get(g) ?? 0)));

  const scored: Array<KbHit & { score: number }> = [];
  for (const it of items) {
    const name = it.name || "";
    const tags = (Array.isArray(it.tags) ? it.tags : []).filter((t): t is string => typeof t === "string");
    const text = `${it.summary || ""} ${it.content || ""}`;
    const verbatim = Boolean(name) && message.includes(name);
    let score = verbatim ? W_VERBATIM : 0;
    let entityHits = 0; // 命中条目名 / 标签的次数
    let longHits = 0; // 正文命中的 ≥3 字 gram 数
    let textHits = 0; // 正文命中的 gram 数
    for (const g of grams) {
      if (name.includes(g)) {
        score += W_NAME * idf(g);
        entityHits++;
      } else if (tags.some((t) => t.includes(g))) {
        score += W_TAG * idf(g);
        entityHits++;
      } else if (text.includes(g)) {
        score += W_TEXT * idf(g);
        textHits++;
        if (g.length >= 3) longHits++;
      }
    }
    // 最小证据门槛：仅靠一个 2 字 gram 命中的属噪声（如"参数""天气"这类 df 极小、
    // IDF 虚高的巧合），必须剔除，否则问手机参数也会被塞进一条麦饼条目。
    if (score <= 0) continue;
    if (!verbatim && entityHits === 0 && longHits === 0 && textHits < 2) continue;
    scored.push({
      id: it.id,
      name,
      domain: String(it.domain ?? ""),
      category: it.category ?? null,
      summary: it.summary || "",
      content: it.content || "",
      rating: Number(it.rating) || 4,
      score,
    });
  }

  return scored
    .sort((a, b) => b.score - a.score || b.rating - a.rating)
    .slice(0, limit)
    .map(({ score: _score, ...rest }) => rest);
}

function buildLlmMessages(
  userMsg: string,
  hits: KbHit[],
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: SYSTEM_PROMPT },
  ];
  if (hits.length) {
    // 素材取 content（详情全文）而不是 summary：summary 只有一句话，模型据此只能答出皮相。
    // 截断放宽到 220 字并在末尾显式省略号，单条不挤占上下文，深度问答才有料。
    const ctx = hits
      .map((h, i) => {
        const brief = (h.content || h.summary || "").replace(/\s+/g, " ").trim();
        const cut = brief.length > 220 ? `${brief.slice(0, 220)}…` : brief;
        return `${i + 1}. ${h.name}（${domainLabel(h.domain)}${h.category ? `·${h.category}` : ""}）：${cut}`;
      })
      .join("\n");
    messages.push({
      role: "system",
      content:
        `你已完成一次"永嘉智库"检索，以下为本轮可用的权威资料，编号即引用标签：\n${ctx}\n` +
        `要求：涉及景点/文化/商家的陈述必须基于上述资料，并以 [来源:条目名] 标注（条目名须与列表一致）；资料未覆盖的内容严禁编造，直接说明"智库里暂无该信息"。`,
    });
  } else {
    messages.push({
      role: "system",
      content:
        `本轮"永嘉智库"未检索到与问题直接相关的条目。` +
        `涉及景点/文化/商家价格等具体事实严禁编造，应如实告知"智库里暂无该信息"，再用通用经验做不涉及具体事实的引导。`,
    });
  }
  messages.push({ role: "user", content: userMsg });
  return messages;
}

function scriptPack(): Scenario[] {
  return loadJson<{ scenarios: Scenario[] }>("mock_agent_script.json").scenarios;
}

/** 触发词正则匹配（剧本由运营维护，正则写坏时按"不命中"处理，不能让聊天整体挂掉） */
function matchesTrigger(s: Scenario, message: string): boolean {
  try {
    return new RegExp(s.trigger.pattern, "i").test(message);
  } catch {
    return false;
  }
}

/** 按 trigger.pattern 顺序匹配演示剧本，全部未命中则取最后一条（兜底剧本） */
function pickScenario(message: string): Scenario {
  const pack = scriptPack();
  return pack.find((s) => matchesTrigger(s, message)) || pack[pack.length - 1];
}

/**
 * 需要补发结构化行程卡的意图。
 *
 * 这里曾经只认「多日游」——因为行程服务当时只有一张两日山水线，一日游/文化/美食
 * 若也发卡就是「问一日文化游、给两日山水线」的错配，宁可不发。
 * 现在行程服务已有 8 条线（经典两日 + 亲子/耕读文化/美食/摄影/非遗手作/三日深度/三日慢游），
 * selectPlan 会按口味与天数选到对得上的那条，所以放开到一日游与主题诉求。
 *
 * 但纯问答仍要挡住：「永嘉学派是什么」不该弹行程卡。所以主题词不单独计分，
 * 只有与「帮我/推荐/想要」这类求助语气组合时才成立——问一个景点名不等于要排行程。
 */
const PLAN_VERB = /规划|行程|路线|攻略|怎么玩|怎么安排|安排一下|玩几天|带我玩|走一趟/;
const DURATION_INTENT = /一日游|1日游|一天|单日|两日游|2日游|两天|二日|周末|三日游|3日游|三天|多日游/;
const THEME_INTENT =
  /亲子|带娃|孩子|家庭|美食|小吃|寻味|文化|耕读|古村|书院|摄影|拍照|出片|手作|手工|非遗|研学|陶艺|瓯窑|深度|全景|慢游|休闲|不累/;
const ASK_VERB = /帮我|推荐|想要|来个|给我|安排|求/;
/** 重规划诉求由暴雨剧本处理，不补发基础行程卡 */
const REPLAN_INTENT = /暴雨|下雨|雨天|淋雨|重新规划|改期|延误/;

function matchesPlanIntent(message: string): boolean {
  if (REPLAN_INTENT.test(message)) return false;
  if (PLAN_VERB.test(message) || DURATION_INTENT.test(message)) return true;
  return THEME_INTENT.test(message) && ASK_VERB.test(message);
}

/**
 * 剧本 token 文案里的旁白占位符替换（P2-2）。
 *
 * 暴雨剧本的几句台词要跟着当前方案变（这次受影响的是石桅岩？丽水街？），
 * 模板留在 JSON 里保持可读与节奏，取值由 `replanForRain()` 按实际方案供给。
 * 未登记的占位符原样保留 —— 宁可露出 `{rain_intro}` 让人一眼看见，也不要静默吞掉模板错误。
 */
function fillNarration(text: string, slots?: RainNarration): string {
  if (!slots || !text.includes("{")) return text;
  const map: Record<string, string> = slots;
  return text.replace(/\{(\w+)\}/g, (raw, key: string) => map[key] ?? raw);
}

/**
 * 回放演示剧本。
 * scenarioId 显式指定时优先使用——"暴雨重规划"这类场景按触发词顺序匹配会串场，
 * 它的 trigger（下雨|暴雨|…）排在 plan_trip（规划|行程|…）之后，而演示原文里两者都有。
 */
export async function replayMock(
  reply: FastifyReply,
  message: string,
  signal?: AbortSignal,
  scenarioId?: string,
  sessionId = "anon",
) {
  const pack = scriptPack();
  const hit = (scenarioId && pack.find((s) => s.id === scenarioId)) || pickScenario(message);

  // 暴雨重规划：变更卡与旁白按「本会话当前正在看的方案」现算（P2-2）。
  // 剧本从此只负责节奏（delay_ms）与台词骨架，内容不再写死——
  // 否则用户看的是主题线时，变更卡会移除一个方案里根本不存在的景点。
  // 会话还没生成过方案时退回经典两日线，与 REST 接口同一兜底口径。
  const rain =
    hit.id === "rain_replan"
      ? replanForRain((getLatestItinerary(sessionId) as DemoPlan | null) ?? CLASSIC_PLAN)
      : null;

  for (const ev of hit.events) {
    if (signal?.aborted) break;
    await sleep(ev.delay_ms ?? 120);
    if (signal?.aborted) break;
    const payload =
      ev.event === "plan_diff"
        ? (rain?.diff ?? normalizePlanDiff(ev.data))
        : ev.event === "plan"
          ? // 剧本只管「何时发卡」，发哪条线由行程服务按口味/天数现算——
            // 剧本里写死一条线，用户问「一日亲子游」也会弹出两日山水线。
            generatePlan(sessionId, message)
          : ev.event === "token"
            ? { ...ev.data, text: fillNarration(String((ev.data as { text?: unknown }).text ?? ""), rain?.narration) }
            : ev.data;
    writeSse(reply, ev.event, payload);
  }
}

export async function runRealOrFallback(reply: FastifyReply, message: string, sessionId?: string) {
  try {
    /* ---- 步骤 1：检索永嘉智库 ---- */
    writeSse(reply, "tool_call", {
      tool: "kb_search",
      args: { domain: "永嘉智库", keyword: message.slice(0, 20) },
      status: "running",
    });
    await sleep(280);
    const phrases = keyPhrases(message);
    const hits = retrieveKnowledge(message);
    const kw = phrases.slice(0, 2).join(" ") || message.slice(0, 20);
    if (hits.length) {
      const names = hits.slice(0, 4).map((h) => h.name).join("、");
      writeSse(reply, "tool_call", {
        tool: "kb_search",
        args: { domain: "永嘉智库", keyword: kw },
        status: "done",
        result_summary: `命中 ${hits.length} 条：${names}${hits.length > 4 ? " 等" : ""}`,
      });
    } else {
      writeSse(reply, "tool_call", {
        tool: "kb_search",
        args: { domain: "永嘉智库", keyword: kw },
        status: "done",
        result_summary: "暂未检索到高度相关条目",
      });
    }
    await sleep(220);

    /* ---- 步骤 2：带资料上下文的真实模型回答 ---- */
    const msgs = buildLlmMessages(message, hits);
    const text = await chatCompletions(msgs);
    const chunks = text.match(/[\s\S]{1,10}/g) || [text];
    for (const c of chunks) {
      await sleep(26);
      writeSse(reply, "token", { text: c });
    }
    // 规划意图：正文仍由真实大模型产出，行程卡数据来自行程服务（与 /api/itinerary/generate
    // 同一条路径、同源落库），条目 id 可回溯知识库。放在正文之后，读起来是"结论 → 行程卡"。
    if (matchesPlanIntent(message)) {
      writeSse(reply, "plan", generatePlan(sessionId, message));
    }

    writeSse(reply, "done", { finishReason: "stop", fallback: false, kb_hits: hits.map((h) => h.name) });
    // 正向留痕：真实链路走通时也记一笔。否则「真跑通」与「静默回落」在服务端同样无声，
    // 只能靠前端表现猜，接了真 key 也判断不了到底有没有用上。
    reply.log.info(
      { model: config.llmModel, kb_hits: hits.length, msg_len: message.length },
      "[agent] 真实 LLM 链路完成",
    );
  } catch (err) {
    /* P2-1：真实链路失败必须留痕。
       这里原先是个哑 catch —— 服务端一行日志都没有，前端只显示「已切换本地演示模式」，
       于是「接了真 key、但每次请求都在悄悄回落演示剧本」这种故障，
       在服务端和演示台上都完全看不出来，等于白接。
       现在：① 服务端按 error 级记录真实原因（含模型与 baseUrl，不含 key）；
             ② 把原因随 error 事件透传给前端，作为悬停提示，便于现场排查。 */
    const reason = err instanceof Error ? err.message : String(err);
    reply.log.error(
      { err, reason, model: config.llmModel, baseUrl: config.llmBaseUrl, mockLlm: config.mockLlm },
      "[agent] 真实 LLM 链路失败，已回落演示剧本",
    );
    writeSse(reply, "error", { code: 50002, fallback: true, message: "已切换本地模式", reason });
    await replayMock(reply, message, undefined, undefined, sessionId);
  }
}

export async function runAgent(
  reply: FastifyReply,
  message: string,
  sessionId?: string,
  signal?: AbortSignal,
) {
  // 演示控制台注入模拟暴雨后，「暴雨重规划」按剧本 id 直接锁定，不走触发词顺序匹配。
  // 原因：演示原文里同时含"暴雨"和"重新规划行程"，按数组顺序会先命中 plan_trip 而演错场景；
  // 同时真实模型链路只产出 prose、不产出 plan_diff，招牌的行程变更卡片必须由剧本保证。
  const rain = scriptPack().find((s) => s.id === "rain_replan");
  if (sessionId && rain && getSessionWeather(sessionId) === "rain" && matchesTrigger(rain, message)) {
    await replayMock(reply, message, signal, "rain_replan", sessionId);
    return;
  }

  if (config.mockLlm) {
    await replayMock(reply, message, signal, undefined, sessionId);
    return;
  }
  await runRealOrFallback(reply, message, sessionId);
}
