/**
 * AI 辅助提示词引擎（板块一核心能力）
 *
 * - 用户只给一句画面描述 → 这里把它“美化 + 精准化”成可交付的视频生成提示词。
 * - 演示默认走本地规则增强（零依赖、永不翻车）；
 *   当 `MOCK_LLM=false` 且配置了 LLM Key 时，自动升级为真实 LLM 润色，失败自动回退本地。
 * - 注意：本模块只负责提示词与分镜编排，不真实生成画面；
 *   最终成片由运营内容组提供并替换（演示态用示意封面兜底）。
 */
import { config } from "../lib/config.ts";
import { chatCompletions } from "../lib/llm-adapter.ts";
import { searchKnowledge } from "../db/db.ts";
import type {
  KbHit,
  VideoEnhanceResult,
  VideoStyle,
} from "@zhiyou/shared";
import { getVideoStyle } from "./styles.ts";

export interface EnhanceInput {
  prompt: string;
  styleId: string;
  shotCount?: number;
}

/** 永嘉特色词汇 → 自动从本地智库联想出处（分镜 kb_refs 的事实源） */
const KB_KEYWORDS = [
  "石桅岩", "楠溪江", "狮子岩", "竹筏", "古村", "苍坡", "芙蓉", "丽水街", "岩头",
  "永嘉书院", "瓯窑", "青瓷", "麦饼", "素面", "乌牛早茶", "梯田", "昆曲",
  "永嘉学派", "山水诗", "耕读", "陶公洞", "龙湾潭", "崖下库", "百丈瀑",
  "岭上人家", "烤全羊", "金粉饺", "非遗", "木雕", "民宿", "晒秋", "茗岙",
];

const STYLE_LOOK: Record<string, { look: string; light: string; motion: string; mood: string; extra: string }> = {
  documentary: {
    look: "纪实纪录片质感，真实自然的光影与人文细节，不刻意摆拍",
    light: "优先清晨/傍晚的自然光，轮廓与纹理层次分明",
    motion: "沉稳克制的缓慢运镜，摇臂与轨道平滑过渡",
    mood: "克制而温暖，保留现场真实声音氛围",
    extra: "构图上多用三分法与框景，突出人物与地域的关系",
  },
  ancient: {
    look: "古风东方美学，水墨意境与绢本质感，暖金与黛青交融",
    light: "柔和散射光，薄雾与逆光勾勒风物轮廓",
    motion: "含蓄缓慢的推拉摇移，留白处静置呼吸",
    mood: "诗画般宁静，讲究留白与韵律",
    extra: "参考宋画构图，宜用扇面/卷轴式取景，点缀书卷、茶烟、廊影",
  },
  vlog: {
    look: "现代旅行 Vlog 质感，画面明亮通透，生活感十足",
    light: "日光充足的高调画面，逆光带轻微柔光晕",
    motion: "手持微晃带来临场感，跟拍与自拍切换自然",
    mood: "轻快松弛，像朋友边走边聊",
    extra: "多用前景遮挡转场与快剪，字幕气泡风格活泼",
  },
  aerial: {
    look: "高空航拍山河大片，超清画质与空气透视，恢弘通透",
    light: "利用晨昏低角度光线强化山体立体感与江面反光",
    motion: "无人机大范围环绕、拉升、贴地飞行，运动感强",
    mood: "壮阔自由，云海与江流皆有灵气",
    extra: "航线避免急转，让画面如画卷缓缓展开",
  },
  creative: {
    look: "品牌宣传片质感，高对比张力，色彩浓烈富有冲击",
    light: "舞台化布光与自然光混用，重点元素轮廓高光",
    motion: "快节奏蒙太奇，卡点切换与变速推拉",
    mood: "热烈昂扬，信息密度高",
    extra: "多景别混剪 + 图形转场，结尾收束到品牌意象",
  },
};

/** 逐镜头叙事模板：为任意风格兜底一套 8s 分镜语法 */
const SHOT_BANK: Array<{ scene: string; action: string }> = [
  { scene: "开篇定场", action: "由远及近交代地点全貌与季节氛围，建立空间关系" },
  { scene: "细节铺陈", action: "中景捕捉风物细节与纹理，让环境有可触摸的温度" },
  { scene: "人物入画", action: "人物与场景互动，动作自然，情绪带动叙事推进" },
  { scene: "特色特写", action: "最具辨识度的特写画面，强化记忆点与质感" },
  { scene: "过程流转", action: "以时间流逝感连接前后语境，如晨昏、光影、步履" },
  { scene: "情感空镜", action: "收束画面留出余韵，让情绪在空镜中沉淀" },
  { scene: "节奏回望", action: "快速回闪关键元素，加强整体结构感" },
  { scene: "终章升华", action: "宏阔收尾，点题升华，为成片画上句号" },
];

function clampShotCount(n: number): number {
  const v = Math.round(Number.isFinite(n) ? n : 3);
  return Math.min(Math.max(v, 1), 8);
}

function cleanPrompt(p: string): string {
  return p.replace(/\s+/g, " ").trim();
}

function styleDef(styleId: string): { style: VideoStyle; look: (typeof STYLE_LOOK)[string] } {
  const style = getVideoStyle(styleId) ?? getVideoStyle("documentary")!;
  const look = STYLE_LOOK[style.id] ?? STYLE_LOOK.documentary;
  return { style, look };
}

/**
 * 关键词 → 知识库条目召回：多取几条候选，**名称直接命中关键词的条目优先**。
 * 否则按 rating 取首条会把"石桅岩"召回成"楠溪书院"（书院条目正文提到石桅岩且评分高），
 * 主体风物反被配角抢戏。
 */
function pickKbItem(kw: string) {
  const res = searchKnowledge({ q: kw, limit: 5 });
  const named = res.items.find((it) => it.name.includes(kw) || kw.includes(it.name));
  return named ?? res.items[0];
}

/** 从描述中联想知识库条目（仅本地联想，不依赖大模型） */
function localKbHits(raw: string): KbHit[] {
  const hits: KbHit[] = [];
  const seen = new Set<string>();
  for (const kw of KB_KEYWORDS) {
    if (!raw.includes(kw)) continue;
    try {
      const it = pickKbItem(kw);
      if (!it || seen.has(it.id)) continue;
      seen.add(it.id);
      hits.push({ id: it.id, name: it.name, domain: it.domain });
      if (hits.length >= 4) break;
    } catch {
      /* 智库不可用时静默跳过 */
    }
  }
  return hits;
}

/**
 * 为 LLM 准备「永嘉真实素材卡」：命中关键词 → 条目名 + 摘要（截断到 140 字）。
 * 与 localKbHits 同源但多带摘要正文——LLM 光知道地名仍会瞎编，
 * 把知识库的真实风貌描述喂进去，扩写才能落在永嘉的真山真水上。
 */
function localKbMaterial(raw: string, max = 4): Array<KbHit & { summary: string }> {
  const out: Array<KbHit & { summary: string }> = [];
  const seen = new Set<string>();
  for (const kw of KB_KEYWORDS) {
    if (!raw.includes(kw)) continue;
    try {
      const it = pickKbItem(kw);
      if (!it || seen.has(it.id)) continue;
      seen.add(it.id);
      const summary = (it.summary || it.content || "").replace(/\s+/g, " ").trim().slice(0, 140);
      out.push({ id: it.id, name: it.name, domain: it.domain, summary });
      if (out.length >= max) break;
    } catch {
      /* 智库不可用时静默跳过 */
    }
  }
  return out;
}

/** 本地规则增强：把一句话描述扩写成可执行的高质量视频提示词 */
function localEnhance(raw: string, n: number, styleId: string): VideoEnhanceResult {
  const { style, look } = styleDef(styleId);
  const kb = localKbHits(raw);
  const kbNames = kb.map((k) => k.name).join("、");
  const locRef = kbNames ? `，画面主场景锚定「${kbNames}」的真实风貌` : "";
  const core = `${raw}${locRef}`;

  const enriched_prompt =
    `“${core}”。` +
    `风格：${style.name}。` +
    `质感：${look.look}。` +
    `光影：${look.light}。` +
    `运镜：${look.motion}。` +
    `情绪：${look.mood}。` +
    `构图：${look.extra}。` +
    `成片参数：${style.resolution} / ${style.fps}fps / ${style.aspect}，` +
    `专业电影级调色，细节丰富、色彩自然，无字幕无水印纯净画面。`;

  const negative_prompt =
    `模糊抖动、画面畸变、人物变形、重复纹理、过曝欠曝、边缘闪烁、` +
    `多余文字、水印 logo、低分辨率、色彩断层` +
    (style.id === "ancient" ? "、现代金属感、荧光色、赛博光效" : "");

  const shot_topics = Array.from({ length: n }, (_, i) => {
    const t = SHOT_BANK[i % SHOT_BANK.length];
    const kbPart = kb[i % Math.max(kb.length, 1)]?.name ?? "";
    return `${t.scene}｜${t.action}${kbPart ? `（画面落点：${kbPart}）` : ""}`;
  });

  return {
    mode: "local",
    enriched_prompt,
    negative_prompt,
    settings: {
      resolution: style.resolution,
      fps: style.fps,
      aspect: style.aspect,
      total_duration_sec: n * 8,
      note: "AI 分镜单镜头固定 8 秒（NexaFrame 镜头时序）",
    },
    shot_topics,
    kb_hits: kb,
  };
}

/**
 * 真实 LLM 导演级扩写：
 * 不是同义词润色——要求模型保留用户原意，从主体/环境/时间天气/景别构图/光影色调/
 * 运镜/人物动作/氛围/质感九个维度把一句话扩成一段可拍摄的镜头语言；
 * 并注入①所选风格的具体影像语言（STYLE_LOOK）②永嘉知识库真实素材摘要，
 * 防止模型输出空泛模板、或编造不属于永嘉的景物。异常一律回退本地。
 */
async function llmEnhance(raw: string, n: number, styleId: string): Promise<VideoEnhanceResult | null> {
  const style = getVideoStyle(styleId) ?? getVideoStyle("documentary")!;
  const look = STYLE_LOOK[style.id];
  const material = localKbMaterial(raw);

  const styleLines = look
    ? [
        `影像质感：${look.look}`,
        `光影基调：${look.light}`,
        `镜头运动：${look.motion}`,
        `情绪氛围：${look.mood}`,
        `构图要点：${look.extra}`,
      ].join("\n")
    : "（该风格无额外镜头语言要求，依据风格简介自行把握）";

  const materialBlock = material.length
    ? material.map((m) => `- ${m.name}：${m.summary || "（无摘要，依据地名与常识演绎）"}`).join("\n")
    : "（无直接命中条目：依据用户描述，合理演绎浙江永嘉楠溪江流域的山水、古村与烟火风貌，不得编造其他地区的知名地标）";

  const sys = [
    "你是「永嘉新游」县域文旅平台的视频导演兼提示词工程师，",
    "擅长把普通人一句朴素的拍摄想法，导演级扩写成可直接交给视频生成大模型的专业提示词。\n",
    "工作原则：",
    "1. 保留用户描述中的全部关键元素与原意，只做扩充与具象化，不得删减或更换主题；",
    "   用户未提到的具体地名、人物不得编造，画面演绎优先依据「永嘉参考素材」。",
    "2. 扩写必须是实质性的：自然覆盖画面主体与关键风物、场景环境、时间/季节/天气、景别与构图、",
    "   光影与色调、镜头运动方式、人物动作或烟火细节、氛围情绪、画面质感这九个维度；",
    "   每个细节都要能被镜头直接拍出来，禁止空洞形容词堆砌。",
    "3. enriched_prompt 写成一段连贯流畅的中文（不要分条、不要「质感：」「运镜：」这类标签词头），不少于 220 字。",
    "4. shot_topics 每条对应一个 8 秒镜头，必须具体到「景别 + 运镜 + 画面内容 + 光影或细节」，",
    "   镜头之间有叙事推进；严禁使用「开篇定场、细节铺陈、情感空镜、终章升华、节奏回望」等模板套话。",
    "5. 严格融合给定的风格语言与技术参数；negative_prompt 结合本题材给 8~12 项具体禁忌。\n",
    "只输出 JSON，不要任何解释或 Markdown 代码块。",
  ].join("");

  const user = [
    `【风格】${style.name}：${style.desc}`,
    styleLines,
    `【技术参数】${style.resolution} / ${style.fps}fps / ${style.aspect}；共 ${n} 个镜头，单镜 8 秒，总时长 ${n * 8} 秒。`,
    "【永嘉参考素材】（来自本地知识库，优先采用其中真实风物与细节）",
    materialBlock,
    "【用户原始描述】",
    raw,
    "",
    "【输出 JSON（只输出 JSON）】",
    `{"enriched_prompt":"扩写后的完整视频提示词（一段连贯中文，≥220字）","negative_prompt":"结合题材的8~12项负面提示词","shot_topics":["镜头1：景别+运镜+具体画面+光影细节","镜头2：……"]}`,
  ].join("\n");

  try {
    const text = await chatCompletions(
      [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      { temperature: 0.8, timeoutMs: 40_000 },
    );
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd <= jsonStart) {
      console.warn(`[enhancer] LLM 返回非 JSON（len=${text.length}），回落本地：${text.slice(0, 120)}`);
      return null;
    }
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as {
      enriched_prompt?: string;
      negative_prompt?: string;
      shot_topics?: string[];
    };
    // 模型偶发偷懒：只回一句轻度改写（<80 字）或分镜不成数组，视为不合格，回落本地结构化结果
    if (!parsed.enriched_prompt || parsed.enriched_prompt.trim().length < 80 || !Array.isArray(parsed.shot_topics) || !parsed.shot_topics.length) {
      console.warn(`[enhancer] LLM 扩写不合格（prompt ${parsed.enriched_prompt?.trim().length ?? 0} 字 / shots ${Array.isArray(parsed.shot_topics) ? parsed.shot_topics.length : "非数组"}），回落本地`);
      return null;
    }
    return {
      mode: "llm",
      enriched_prompt: parsed.enriched_prompt.trim(),
      negative_prompt: (parsed.negative_prompt || "").trim() || "模糊、抖动、水印、畸变",
      settings: {
        resolution: style.resolution,
        fps: style.fps,
        aspect: style.aspect,
        total_duration_sec: n * 8,
        note: `AI 分镜（${parsed.shot_topics.length} 镜头）· LLM 导演级扩写`,
      },
      shot_topics: parsed.shot_topics.slice(0, n).map((s) => s.replace(/^\d+[.、]?\s*/, "").trim()),
      kb_hits: material.map(({ id, name, domain }) => ({ id, name, domain })),
    };
  } catch (e) {
    console.warn(`[enhancer] LLM 扩写异常，回落本地：${(e as Error)?.message || e}`);
    return null;
  }
}

export async function enhancePrompt(input: EnhanceInput): Promise<VideoEnhanceResult> {
  const raw = cleanPrompt(input.prompt);
  const n = clampShotCount(input.shotCount ?? 3);
  const useLLM = config.mockLlm === false && Boolean(config.llmApiKey) && Boolean(config.llmBaseUrl);
  if (useLLM) {
    const llm = await llmEnhance(raw, n, input.styleId);
    if (llm) return llm;
    // LLM 偶发抖动（HTTP/超时/JSON 不合规）时隔 0.8s 重试一次，
    // 避免演示现场直接把本地模板暴露给评委
    await new Promise((r) => setTimeout(r, 800));
    const retry = await llmEnhance(raw, n, input.styleId);
    if (retry) return retry;
  }
  return localEnhance(raw, n, input.styleId);
}

/** 纯本地预览（用于前端“AI 优化提示词”即时展示，不依赖 LLM） */
export function previewEnhance(input: EnhanceInput): VideoEnhanceResult {
  const raw = cleanPrompt(input.prompt);
  return localEnhance(raw, clampShotCount(input.shotCount ?? 3), input.styleId);
}
