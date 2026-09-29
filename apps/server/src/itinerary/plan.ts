import { randomUUID } from "node:crypto";
import type { DemoPlan } from "@zhiyou/shared";
import { loadJson, saveItinerary } from "../db/db.ts";

export type PlanPayload = DemoPlan & { id: string; key: string };

/**
 * 结构化行程的唯一数据源（HTTP 接口、对话链路、卡片三处共用，永远同源）。
 *
 * 两条来源：
 *   · CLASSIC_PLAN —— 一直存在的两日山水线。保留为「经典两日游」，同时也是
 *     所有主题都匹配不上、又没说天数时的兜底方案。
 *   · itinerary_plans.json —— 新增的 7 条主题线：
 *     亲子 / 耕读文化 / 美食 / 摄影 / 非遗手作 / 三日深度 / 三日慢游。
 *
 * 数据约束（由 scripts/verify-itinerary.ts 逐条把关，改了数据务必跑一遍）：
 *   ① 每个条目的 id 必须真实存在于 knowledge_seed_v3.json；
 *   ② 条目 name 与知识库逐字一致（卡片可点击跳知识库详情）；
 *   ③ budget_total_cny 必须等于该行程所有 cost_cny 之和；
 *   ④ sources 必须等于所有条目 id 的去重集合；
 *   ⑤ indoor 标记必须与知识库的 indoor 字段一致（暴雨降级依赖它挑室内点）。
 */
export const CLASSIC_PLAN: PlanPayload = {
  id: "it_classic_2d",
  key: "classic-2d",
  title: "永嘉楠溪江经典两日游",
  days: [
    {
      day: 1,
      theme: "上游山水 · 石桅岩线",
      items: [
        { id: "POI-001", name: "石桅岩景区", start: "09:00", end: "12:30", cost_cny: 50, indoor: false, reason: "上午光线好，浙南天柱全程约 3.5 小时" },
        { id: "BIZ-007", name: "岭上人家烤全羊", start: "13:00", end: "14:30", cost_cny: 1150, indoor: false, reason: "石桅岩出来 10 分钟车程，人多拼一只更划算" },
        { id: "POI-020", name: "楠溪书院", start: "15:00", end: "16:30", cost_cny: 0, indoor: true, reason: "下午回景区内书院歇脚，耕读文化过渡" },
        { id: "BIZ-022", name: "永嘉聚龙阁客栈", start: "17:30", end: "次日08:00", cost_cny: 225, indoor: false, reason: "住鹤盛镇，第二天顺路下中游" },
      ],
    },
    {
      day: 2,
      theme: "中游古村 · 岩头人文线",
      items: [
        { id: "POI-010", name: "苍坡古村", start: "09:00", end: "11:00", cost_cny: 25, indoor: false, reason: "以文房四宝布局的宋村，晨游墨池最出片" },
        { id: "BIZ-001", name: "永嘉麦饼（经典咸菜鲜肉馅）", start: "11:30", end: "12:30", cost_cny: 13, indoor: false, reason: "岩头镇老街上就有，干粮午餐两相宜" },
        { id: "POI-012", name: "丽水街（岩头村）", start: "13:00", end: "15:00", cost_cny: 15, indoor: false, reason: "300 米廊檐下逛店铺，午后遮阴正好" },
        { id: "POI-002", name: "狮子岩景区", start: "15:30", end: "17:30", cost_cny: 0, indoor: false, reason: "傍晚看夕阳洒在江心双屿，收尾楠溪江" },
      ],
    },
  ],
  budget_total_cny: 1478,
  budget_note: "按 2 人同行、烤全羊 10 人拼单折算人均约 740 元",
  sources: ["POI-001", "POI-002", "POI-010", "POI-012", "POI-020", "BIZ-001", "BIZ-007", "BIZ-022"],
};

/** 主题线种子数据的形状（与 seed/itinerary_plans.json 对齐） */
type SeedPlan = {
  key: string;
  title: string;
  days: DemoPlan["days"];
  budget_total_cny: number;
  budget_note?: string;
  sources: string[];
};

let seedCache: SeedPlan[] | null = null;

function seedPlans(): SeedPlan[] {
  if (!seedCache) {
    seedCache = loadJson<{ plans: SeedPlan[] }>("itinerary_plans.json").plans ?? [];
  }
  return seedCache;
}

/**
 * 主题路由表：theme 认「口味」，days 认「天数」。
 *
 * theme 词表刻意写得具体（认「瓯窑」，不认「推荐」），因为要把纯问答挡在外面——
 * 「永嘉学派是什么」既没有行程动词也没有天数，主题词只有在与「帮我/推荐/想要」
 * 这类求助语气组合时才计数，否则问一个景点名就会弹出整张行程卡。
 */
const PLAN_ROUTES: Array<{ key: string; days: number; theme: RegExp }> = [
  { key: "family-1d", days: 1, theme: /亲子|孩子|带娃|小朋友|儿童|一家人|家庭/ },
  { key: "food-1d", days: 1, theme: /美食|小吃|寻味|麦饼|烤全羊|素面|粉干|金粉饺|舌尖|吃什么/ },
  { key: "culture-1d", days: 1, theme: /文化|耕读|古村|书院|学派|人文|历史/ },
  { key: "photo-2d", days: 2, theme: /摄影|拍照|出片|机位|日出|日落|云海|梯田|晨雾/ },
  { key: "craft-2d", days: 2, theme: /手作|手工|拉坯|陶艺|瓯窑|非遗|研学|体验课|工坊/ },
  { key: "deep-3d", days: 3, theme: /深度|全景|全线|玩透|玩遍/ },
  { key: "slow-3d", days: 3, theme: /慢游|慢节奏|休闲|不累|老人|爸妈|悠闲|放松/ },
];

/** 只说了天数、没说口味时的默认线 */
const DAY_DEFAULT: Record<number, string> = { 1: "culture-1d", 2: "classic-2d", 3: "deep-3d" };

/** 主题命中给 3 分；天数相符 +1、不符 -2（压制「说好三日却给一日线」这种错配） */
const W_THEME = 3;
const W_DAY_HIT = 1;
const W_DAY_MISS = -2;

/** 从自然语言里读天数；读不到返回 null，交给主题词决定 */
export function parseDays(message: string): number | null {
  if (/一日|1日|一天|单日|当天/.test(message)) return 1;
  if (/两日|2日|两天|二日|周末/.test(message)) return 2;
  if (/三日|3日|三天/.test(message)) return 3;
  return null;
}

/**
 * 选线：先看口味，再看天数。
 *
 * 分数不到 W_THEME 就说明「没说出明确口味」（光说个天数只能拿到 ±1 分），
 * 此时按天数取默认线，而不是让某个主题线以 1 分侥幸胜出——否则「两日游」
 * 会被 photo-2d 这种排在前面、恰好也是两日的线抢走。
 */
export function matchPlanKey(message: string): string {
  const days = parseDays(message);
  let bestKey: string | null = null;
  let bestScore = 0;
  for (const r of PLAN_ROUTES) {
    let score = 0;
    if (r.theme.test(message)) score += W_THEME;
    if (days != null) score += r.days === days ? W_DAY_HIT : W_DAY_MISS;
    if (score > bestScore) {
      bestScore = score;
      bestKey = r.key;
    }
  }
  if (bestKey && bestScore >= W_THEME) return bestKey;
  if (days != null && DAY_DEFAULT[days]) return DAY_DEFAULT[days];
  return CLASSIC_PLAN.key;
}

/** 按 key 取方案模板，找不到则退回经典线（宁可给兜底，不可让对话挂掉） */
function templateOf(key: string): Omit<PlanPayload, "id"> {
  if (key === CLASSIC_PLAN.key) return CLASSIC_PLAN;
  const seed = seedPlans().find((p) => p.key === key);
  if (!seed) return CLASSIC_PLAN;
  return {
    key: seed.key,
    title: seed.title,
    days: seed.days,
    budget_total_cny: seed.budget_total_cny,
    budget_note: seed.budget_note,
    sources: seed.sources,
  };
}

/** 每次生成给一个新的 id：同一份模板可反复落库、可做版本对比 */
function materialize(key: string): PlanPayload {
  return { ...templateOf(key), id: "it_" + randomUUID().slice(0, 8) };
}

/** 生成一份行程并落库——REST 接口与对话链路走的是同一条路径 */
export function generatePlan(sessionId = "anon", message = ""): PlanPayload {
  const plan = materialize(matchPlanKey(message));
  saveItinerary(plan.id, sessionId, plan);
  return plan;
}

/** 显式指定方案（演示台「直接看某条线」用），非法 key 退回经典线 */
export function generatePlanByKey(key: string, sessionId = "anon"): PlanPayload {
  const plan = materialize(key);
  saveItinerary(plan.id, sessionId, plan);
  return plan;
}

/** 全部方案模板（经典线 + 7 条主题线），供校验脚本与演示台枚举 */
export function planTemplates(): Array<Omit<PlanPayload, "id">> {
  return [CLASSIC_PLAN, ...seedPlans()];
}

// G-04 已接线：主题路由（PLAN_ROUTES）+ 天数解析（parseDays）+ 选线（matchPlanKey）2026-09-11
