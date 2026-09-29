/**
 * 暴雨重规划：动态重排引擎（缺口 B-05 → P2-2）
 *
 * 背景（P2-2 之前的形态）
 * ----------------------
 * `mock_agent_script.json` 的 `rain_replan` 剧本里，`plan_diff` 是**静态文案**：
 * 写死「移除 POI-001 石桅岩 / 新增 POI-018 瓯窑博物馆 + BIZ-030 体验课 / 预算 1478→1618」。
 * 旧代码只做了半件事 —— `adaptDiffBudget()` 把预算数字对齐到当前方案，
 * `removed` / `added` / `rescheduled` 与旁白文案仍逐字照发。于是当用户看的是别的线时：
 *   · 变更卡会移除一个**根本不在当前方案里**的景点；
 *   · 新增的室内点可能**已经在方案里**（亲子一日线本来就含 BIZ-030 体验课）；
 *   · 旁白句句都在说「你现在正在石桅岩」，而石桅岩可能排在后天上午。
 *
 * 现在改为**按当前方案现算**（本文件是唯一实现，对话链路与 REST 接口共用）：
 *   ① 识别「与暴雨时段重叠的户外景点」→ 移除 + 改期；
 *   ② 从室内候选池挑补位点（排除已在方案中的），按时长贴合腾出的空档；
 *   ③ 预算 before 取方案实价、delta 取新增项实价，after = before + delta；
 *   ④ 汇总文案与旁白按实际条目名生成。
 *
 * 与 `plan.ts` 的约束一致：id / name 必须来自知识库，卡片可点击跳知识库详情。
 */

import type { DemoPlan, PlanDiffPayload, PlanItem } from "@zhiyou/shared";
import { loadJson } from "../db/db.ts";

/**
 * 暴雨预警时段 14:00–18:00。
 *
 * 与剧本 `weather_query` 的 result_summary 口径一致：「午后雷阵雨，14:00-18:00 雨势最强」。
 * 之所以框成「午后」而不是「今天下午一场雨」：后者会让 Day2/Day3 的户外点被判定为受影响，
 * 而「今天的雨淋不到后天」——按日重复的天气过程才能同时覆盖 1 日 / 2 日 / 3 日方案而不自相矛盾。
 */
const RAIN_FROM_MIN = 14 * 60;
const RAIN_TO_MIN = 18 * 60;

/** 最多补几个室内点。剧本里是 2 个（博物馆 + 手作），保持同一量级，避免把变更卡堆满 */
const MAX_INDOOR_PICKS = 2;

/* ==================== 室内替代候选池 ==================== */

/**
 * 室内替代候选池条目（seed/rain_replan_script.json → indoor_alternatives_pool）。
 *
 * 这份数据此前**从未被任何代码加载**，是纯死数据；P2-2 接线后启用。
 */
export interface IndoorAlt {
  id: string;
  name: string;
  duration_min: number;
  cost_cny: number;
  quality: string;
  suitable_for?: string[];
  note?: string;
}

let poolCache: IndoorAlt[] | null = null;

export function indoorAltPool(): IndoorAlt[] {
  if (!poolCache) {
    const pack = loadJson<{ indoor_alternatives_pool?: IndoorAlt[] }>("rain_replan_script.json");
    poolCache = pack.indoor_alternatives_pool ?? [];
  }
  return poolCache;
}

/* ==================== 时间工具 ==================== */

/** "14:00" → 840；非法值返回 null（宁可跳过该项，也不猜） */
function toMin(v: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function fmtMin(min: number): string {
  const t = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/* ==================== 受影响判定 ==================== */

/**
 * 过夜项（住宿 / 跨天）。
 *
 * 必须单独排除：`classic-2d` 的 `BIZ-022 永嘉聚龙阁客栈` 时段是 `17:30-次日08:00`
 * 且 `indoor: false`，naive 规则会把它当成「与暴雨重叠的户外点」从方案里移除——
 * 下雨不会让人退房。
 */
function isOvernight(it: PlanItem): boolean {
  return /次日/.test(it.end) || /客栈|民宿|酒店|宾馆/.test(it.name);
}

/**
 * 是否是被雨天「撤销」的对象。
 *
 * 只认景点（`POI-*`）：餐饮（`BIZ-*`）下雨不必取消（多数可打包/堂食），
 * 住宿更是照住不误。把 BIZ 一并移除会让变更卡出现「移除岭上人家烤全羊」这种怪句子。
 */
function isScenic(it: PlanItem): boolean {
  return it.id.startsWith("POI-");
}

export interface RainHit {
  day: number;
  item: PlanItem;
}

/** 与暴雨时段重叠（半开区间 [14:00, 18:00)）且受影响的景点 */
export function rainHits(plan: DemoPlan | null | undefined): RainHit[] {
  const hits: RainHit[] = [];
  for (const d of plan?.days ?? []) {
    for (const it of d.items ?? []) {
      if (it.indoor) continue; // 室内本来就不受影响
      if (isOvernight(it)) continue; // 住宿不因下雨取消
      if (!isScenic(it)) continue; // 餐饮/体验留在原处
      const s = toMin(it.start);
      const e = toMin(it.end);
      if (s === null || e === null) continue;
      if (s < RAIN_TO_MIN && e > RAIN_FROM_MIN) hits.push({ day: d.day, item: it });
    }
  }
  return hits;
}

/* ==================== 室内补位 ==================== */

const QUALITY_RANK: Record<string, number> = { 高: 3, 中: 2, 低: 1 };

/**
 * 从候选池挑室内补位点。
 * - 排除已在当前方案中的（避免「新增」一个方案里本来就有的点）；
 * - 排除 note 明确写「不建议」的（如 POI-032 水仙洞「半室内，需乘船；暴雨天不建议」）；
 * - 质量优先，其次时长贴合腾出的空档，累计补够空档即停（最多 MAX_INDOOR_PICKS 个）。
 */
function pickIndoor(pool: IndoorAlt[], plan: DemoPlan, needMin: number): IndoorAlt[] {
  const inPlan = new Set<string>();
  for (const d of plan.days ?? []) for (const it of d.items ?? []) inPlan.add(it.id);

  const cands = pool
    .filter((p) => !inPlan.has(p.id) && !/不建议/.test(p.note ?? ""))
    .sort(
      (a, b) =>
        (QUALITY_RANK[b.quality] ?? 0) - (QUALITY_RANK[a.quality] ?? 0) ||
        Math.abs(a.duration_min - needMin) - Math.abs(b.duration_min - needMin),
    );

  const picked: IndoorAlt[] = [];
  let covered = 0;
  for (const c of cands) {
    if (picked.length >= MAX_INDOOR_PICKS || covered >= needMin) break;
    picked.push(c);
    covered += c.duration_min;
  }
  return picked;
}

/* ==================== 主流程 ==================== */

/**
 * 剧本旁白占位符的取值（token 文案里写 `{rain_intro}` 等，由 engine 替换）。
 *
 * 这里刻意用 type alias 而不是 interface：type alias 具备「隐式索引签名」，
 * 替换函数才能把它当成 `Record<string, string>` 按 key 取值（interface 会编译报错）。
 */
export type RainNarration = {
  rain_intro: string;
  rain_pivot: string;
  rain_wrap: string;
};

export interface RainReplanResult {
  diff: PlanDiffPayload;
  narration: RainNarration;
}

const joinNames = (names: string[]) => names.join("、") || "户外点";

/**
 * 按当前方案重算暴雨 plan_diff。
 *
 * 返回的 `diff` 满足 PlanDiffPayload 契约，且与传入的 `plan` 必然自洽：
 * removed/rescheduled 的 id 一定来自 plan，added 的 id 一定不在 plan 里，
 * budget_recheck.after === plan.budget_total_cny + Σ added.cost_cny。
 *
 * 「无受影响项」是一条**正常分支**而不是错误：方案下午本就排在室内时，
 * 变更卡如实说明「无需调整」，而不是硬凑一个移除项。
 */
export function replanForRain(
  plan: DemoPlan | null | undefined,
  pool: IndoorAlt[] = indoorAltPool(),
): RainReplanResult {
  const hits = plan ? rainHits(plan) : [];

  /* ---------- 分支 B：方案下午本就在室内，如实告知 ---------- */
  if (!plan || hits.length === 0) {
    const before = typeof plan?.budget_total_cny === "number" ? plan.budget_total_cny : 0;
    return {
      diff: {
        banner: "已核对：当前方案不受暴雨影响",
        changes: [],
        removed: [],
        added: [],
        rescheduled: [],
        budget_recheck: {
          before_cny: before,
          after_cny: before,
          delta_cny: 0,
          note: "14:00–18:00 时段的安排都在室内或不受影响，无需变更预算",
        },
        change_summary: "当前方案在 14:00–18:00 没有户外景点，暴雨不影响行程，预算不变",
        sources: [],
      },
      narration: {
        rain_intro: "查到了：永嘉这几天午后多雷阵雨，14:00-18:00 雨势最强。",
        rain_pivot: "别扫兴——雨天的永嘉有另一副面孔。好消息是你下午本来就排在室内，这场雨淋不到你：",
        rain_wrap: "真要出门的话，隔壁坦头村有百姓书屋可以听雨；我也盯着天气，一变就提醒你。",
      },
    };
  }

  /* ---------- 分支 A：有户外景点压在雨段上 → 移除 + 改期 + 室内补位 ---------- */
  const daySet = new Set((plan.days ?? []).map((d) => d.day));
  const hasNextDay = (day: number) => daySet.has(day + 1);

  const removed = hits.map((h) => ({
    id: h.item.id,
    name: h.item.name,
    reason: `${h.item.start}-${h.item.end} 的户外行程正好落在 14:00-18:00 暴雨时段，雨天湿滑有安全风险`,
  }));

  const rescheduled = hits.map((h) => ({
    id: h.item.id,
    name: h.item.name,
    from: `Day${h.day} ${h.item.start}`,
    // 挪到**上午**，而不是「同时段顺延到次日」——
    // 暴雨在本剧本里是「午后雷阵雨」（14:00-18:00 最强），平移到次日同一时段
    // 等于换一天再淋一遍，逻辑上是站不住的。
    to: hasNextDay(h.day) ? "次日 09:00" : "雨后 09:00 出发",
    reason: "挪到上午，避开午后的雷阵雨时段；雨后溪谷水量足，观感反而更好",
  }));

  const needMin = hits.reduce((sum, h) => sum + Math.max(0, (toMin(h.item.end) ?? 0) - (toMin(h.item.start) ?? 0)), 0);
  const picked = pickIndoor(pool, plan, needMin);

  // 室内点从雨段起点顺排，不越过 18:00
  let cursor = RAIN_FROM_MIN;
  const added: PlanItem[] = picked.map((p) => {
    const end = Math.min(cursor + p.duration_min, RAIN_TO_MIN);
    const item: PlanItem = {
      id: p.id,
      name: p.name,
      start: fmtMin(cursor),
      end: fmtMin(end),
      cost_cny: p.cost_cny,
      indoor: true,
      reason: p.note ? `${p.note}；全室内，避雨主力` : "全室内，避雨主力",
    };
    cursor = end;
    return item;
  });

  const before = typeof plan.budget_total_cny === "number" ? plan.budget_total_cny : 0;
  const delta = added.reduce((s, a) => s + (a.cost_cny ?? 0), 0);

  const removedNames = joinNames(removed.map((r) => r.name));
  const addedNames = joinNames(added.map((a) => a.name));
  const firstIndoor = added[0]?.name ?? "室内点";
  const deltaText = `${delta >= 0 ? "+" : ""}${delta}`;

  const changes: PlanDiffPayload["changes"] = [
    ...removed.map((r) => ({ type: "remove" as const, itemId: r.id, reason: r.reason, item: r })),
    ...added.map((a) => ({ type: "add" as const, itemId: a.id, reason: a.reason, item: a })),
    ...rescheduled.map((m) => ({ type: "modify" as const, itemId: m.id, reason: m.reason, item: m })),
  ];

  const sources = [...new Set([...removed.map((r) => r.id), ...added.map((a) => a.id)])];

  const summaryParts = [
    `${removed.length} 个户外点改期`,
    added.length ? `新增 ${added.length} 个室内点（${addedNames}）` : "暂无可补位的室内点",
    `预算 ${deltaText} 元`,
  ];

  return {
    diff: {
      banner: `已为您重排：${removedNames} 移出暴雨时段`,
      changes,
      removed,
      added,
      rescheduled,
      budget_recheck: {
        before_cny: before,
        after_cny: before + delta,
        delta_cny: delta,
        note: added.length
          ? `仅多一笔${addedNames}的费用；${removedNames} 改期不加价`
          : `改期不产生费用；${removedNames} 顺延后再安排`,
      },
      change_summary: summaryParts.join("、"),
      sources,
    },
    narration: {
      rain_intro: `查到了：永嘉这几天午后多雷阵雨，14:00-18:00 雨势最强。你行程里压在雨段上的${removedNames}，得挪一挪。`,
      rain_pivot: `别扫兴——雨天的永嘉有另一副面孔。我把这段时间重排了一版，反而给你补上了${addedNames}：`,
      rain_wrap: `想去的话我帮你把导航和时段都排好；不想进${firstIndoor}，隔壁坦头村还有百姓书屋可以听雨。`,
    },
  };
}
