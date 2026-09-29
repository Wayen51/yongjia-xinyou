/**
 * 板块二 · AR 互动：运营端「AI 生成剧情/谜题」
 * 双路：配置了 LLM 用真实模型（失败自动回落），否则走本地模板编排（mock）。
 * 两条路输出同一 JSON schema，前端无感。
 */
import { config } from "../lib/config.ts";
import { chatCompletions } from "../lib/llm-adapter.ts";
import { getArTemplate, listArPois, loadJson, type ArCoupon, type ArPoi, type ArTemplate } from "../db/db.ts";

export interface GeneratedStation {
  poi_id: string;
  name: string;
  task: string;
  question: string;
  answer: string;
  hint: string;
  reward: { type: string; name: string; value: number };
}

export interface GeneratedStory {
  mode: "mock" | "llm";
  template_id: string;
  theme_name: string;
  intro: string;
  outro: string;
  stations: GeneratedStation[];
  notice: string;
}

const DIFFICULTY_HINT: Record<string, string> = {
  easy: "（难度：简单 · 题目贴近常识）",
  medium: "（难度：中等 · 需结合现场观察）",
  hard: "（难度：困难 · 需联系永嘉文史）",
};

const TASK_POOL = ["实地寻踪", "文脉解谜", "舌尖记忆", "山水留影", "古村问答"];

/** 除模板自带点位外，可从点位库补充的候选（按主题相关性排序） */
const THEME_POI_HINT: Record<string, string[]> = {
  culture: ["POI-004", "POI-005", "POI-006", "POI-008", "POI-011"],
  midautumn: ["POI-007", "POI-012", "POI-001", "POI-002", "POI-003"],
  spring: ["POI-004", "POI-005", "POI-006", "POI-008", "POI-010"],
  "national-day": ["POI-010", "POI-012", "POI-009", "POI-001", "POI-013"],
};

function coupons(): ArCoupon[] {
  return loadJson<{ coupons: ArCoupon[] }>("ar_coupons_seed.json").coupons;
}

function pickStations(templateId: string, poiIds: string[], want: number): ArPoi[] {
  const all = listArPois();
  const byId = new Map(all.map((p) => [p.id, p]));
  const prefer = THEME_POI_HINT[templateId] ?? [];
  const order = [...new Set([...poiIds, ...prefer])];
  const chosen: ArPoi[] = [];
  for (const id of order) {
    const poi = byId.get(id);
    if (poi && !chosen.some((c) => c.id === poi.id)) chosen.push(poi);
    if (chosen.length >= want) break;
  }
  // 候选不足时按类型补齐（优先 culture/food，避免全是远景山景）
  if (chosen.length < want) {
    const filler = all
      .filter((p) => !chosen.some((c) => c.id === p.id))
      .sort((a, b) => (a.type === "scenic" ? 1 : 0) - (b.type === "scenic" ? 1 : 0));
    for (const poi of filler) {
      chosen.push(poi);
      if (chosen.length >= want) break;
    }
  }
  return chosen.slice(0, want);
}

function localStory(input: {
  templateId: string;
  themeName?: string;
  difficulty?: string;
  poiIds: string[];
  pointCount: number;
}): GeneratedStory {
  const tpl: ArTemplate | null = getArTemplate(input.templateId);
  const stations = pickStations(input.templateId, input.poiIds, input.pointCount);
  const cps = coupons();
  const diff = DIFFICULTY_HINT[input.difficulty ?? "medium"] ?? DIFFICULTY_HINT.medium;

  const generated: GeneratedStation[] = stations.map((poi, i) => {
    // 优先复用模板中同点位题面（保证内容质量），否则用据点类型编排通用题
    const tplStation = tpl?.stations.find((s) => s.poi_id === poi.id);
    const coupon = cps[i % cps.length];
    const task = tplStation?.task ?? TASK_POOL[i % TASK_POOL.length];
    const question =
      tplStation?.question ??
      `${poi.name}是本场第 ${i + 1} 站。请在实地找到楠楠标记的虚拟物，并说出这里最代表性的一样事物。`;
    const answer = tplStation?.answer ?? `${poi.name}`;
    const hint = tplStation?.hint ?? `走到 ${poi.name} 附近，虚拟物会自动亮起`;
    return {
      poi_id: poi.id,
      name: poi.name,
      task,
      question: `${question}${diff}`,
      answer,
      hint,
      reward: tplStation?.reward ?? { type: coupon.type, name: coupon.name, value: coupon.value },
    };
  });

  return {
    mode: "mock",
    template_id: input.templateId,
    theme_name: input.themeName ?? tpl?.name ?? "永嘉寻宝",
    intro:
      tpl?.intro ??
      "欢迎来到永嘉寻宝！沿楠溪江一路走过古村与山水，找到楠楠留下的虚拟信物，解锁属于你的永嘉故事。",
    outro: tpl?.outro ?? "恭喜通关！你已集齐本场全部印记，永嘉的山水人文会一直记得你这次到访。",
    stations: generated,
    notice: "本地模板编排生成（演示态，可由运营二次编辑后发布）",
  };
}

/** 解析 LLM 返回中的 JSON（容忍 ```json 包裹与前后废话） */
function extractJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function llmStory(input: {
  templateId: string;
  themeName?: string;
  difficulty?: string;
  poiIds: string[];
  pointCount: number;
}): Promise<GeneratedStory | null> {
  const pack = loadJson<{ story_generator: { system: string; template: string } }>("ar_prompt_templates.json");
  const stations = pickStations(input.templateId, input.poiIds, input.pointCount);
  const system = pack.story_generator.system;
  const prompt = pack.story_generator.template
    .replace("{theme_name}", input.themeName ?? getArTemplate(input.templateId)?.name ?? "永嘉寻宝")
    .replace("{festival}", getArTemplate(input.templateId)?.festival ?? "日常")
    .replace("{poi_list}", stations.map((p) => `${p.id}（${p.name}·${p.type}）`).join("、"))
    .replace("{difficulty}", input.difficulty ?? "中等")
    .replace("{question_types}", "选择题、灯谜、填空题");
  try {
    const content = await chatCompletions([
      { role: "system", content: system },
      { role: "user", content: prompt },
    ]);
    const parsed = extractJson(content || "");
    if (!parsed) return null;
    const rawStations = (parsed.stations as Array<Record<string, unknown>>) ?? [];
    const list: GeneratedStation[] = rawStations.map((s, i) => {
      const poi = stations.find((p) => p.id === String(s.poi_id)) ?? stations[i] ?? stations[0];
      const reward = (s.reward as Record<string, unknown>) ?? {};
      return {
        poi_id: poi?.id ?? String(s.poi_id),
        name: poi?.name ?? String(s.name ?? ""),
        task: String(s.task ?? TASK_POOL[i % TASK_POOL.length]),
        question: String(s.question ?? ""),
        answer: String(s.answer ?? ""),
        hint: String(s.hint ?? ""),
        reward: {
          type: String(reward.type ?? "coupon"),
          name: String(reward.name ?? ""),
          value: Number(reward.value ?? 0),
        },
      };
    });
    if (!list.length) return null;
    return {
      mode: "llm",
      template_id: input.templateId,
      theme_name: input.themeName ?? getArTemplate(input.templateId)?.name ?? "永嘉寻宝",
      intro: String(parsed.intro ?? ""),
      outro: String(parsed.outro ?? ""),
      stations: list,
      notice: `由 ${config.llmModel} 生成，运营可编辑后发布`,
    };
  } catch {
    return null;
  }
}

export async function generateStory(input: {
  templateId: string;
  themeName?: string;
  difficulty?: string;
  poiIds: string[];
  pointCount: number;
}): Promise<GeneratedStory> {
  const useLLM = config.mockLlm === false && Boolean(config.llmApiKey) && Boolean(config.llmBaseUrl);
  if (useLLM) {
    const story = await llmStory(input);
    if (story) return story;
  }
  return localStory(input);
}
