/**
 * 暴雨重规划校验（改过 rain.ts / 方案数据 / 暴雨剧本后必跑）
 *
 *   cd apps/server && npm run verify:rain
 *
 * 为什么要有这个脚本：
 * P2-2 之前，暴雨变更卡是**剧本写死**的——它和用户正在看的那条方案本来就可能对不上，
 * 只是没人跑出来看。P2-2 改成「按当前方案现算」后，一致性从「人肉保证」变成了
 * 「代码保证」，但只有**遍历所有方案模板**才算真的证明它成立。
 * 演示现场最刺眼的 bug 莫过于：变更卡移除了一个方案里根本不存在的景点，
 * 或者「新增」了一个方案里本来就有的点，或者预算合计对不上右侧的方案卡。
 *
 * 校验项：
 *   ① removed / rescheduled 的 id 一定来自该方案
 *   ② added 的 id 一定不在该方案里，且 indoor 必须为 true
 *   ③ 预算：before == 方案实价，after == before + Σ新增费用，delta == after - before
 *   ④ sources == removed ∪ added 的去重集合
 *   ⑤ 过夜项（住宿 / 跨天）永远不会被移除
 *   ⑥ changes 条数 == removed + added + rescheduled
 *   ⑦ 旁白占位符全部有值；剧本引用的占位符必须在 narration 里存在
 *   ⑧ 边界：全室内方案走「无需变更」分支且预算不变；空方案 / null 不抛异常
 */
import type { DemoPlan, PlanItem } from "@zhiyou/shared";
import { CLASSIC_PLAN, planTemplates } from "../src/itinerary/plan.ts";
import { indoorAltPool, replanForRain } from "../src/itinerary/rain.ts";
import { loadJson } from "../src/db/db.ts";

const errors: string[] = [];
const warnings: string[] = [];

const pool = indoorAltPool();

// CLASSIC_PLAN 是内联兜底线，`itinerary_plans.json` 里也有一条同 key 的 classic-2d——
// 两者内容一致，按 key 去重，避免同一条线被查两遍（也免得把「9 条」这种虚数写进结论）。
const byKey = new Map<string, DemoPlan>();
for (const p of [CLASSIC_PLAN, ...planTemplates()]) {
  const k = (p as { key?: string }).key ?? "classic-2d";
  if (!byKey.has(k)) byKey.set(k, p);
}
const plans: DemoPlan[] = [...byKey.values()];

const keyOf = (p: DemoPlan) => (p as { key?: string }).key ?? "classic-2d";
const itemsOf = (p: DemoPlan | null | undefined): PlanItem[] =>
  (p?.days ?? []).flatMap((d) => d.items ?? []);

/**
 * 独立复述一遍「过夜项」的判定，刻意不复用 rain.ts 的内部函数：
 * 复用就等于自证，这里要的是「从需求出发再写一次」的交叉校验。
 */
const looksOvernight = (it: PlanItem) =>
  it.end.includes("次日") || /客栈|民宿|酒店|宾馆/.test(it.name);

const PLACEHOLDER = /\{(\w+)\}/g;

console.log(`\n暴雨重规划 | 方案 ${plans.length} 条 | 室内候选池 ${pool.length} 条\n`);

for (const plan of plans) {
  const tag = `[${keyOf(plan)}]`;
  const errs: string[] = [];
  const dims = `${plan.days.length}天 ${String(itemsOf(plan).length).padStart(2)}站 ¥${plan.budget_total_cny}`;

  const inPlan = new Set(itemsOf(plan).map((i) => i.id));
  const { diff, narration } = replanForRain(plan, pool);
  const removed = diff.removed ?? [];
  const added = diff.added ?? [];
  const rescheduled = diff.rescheduled ?? [];
  const recheck = diff.budget_recheck;

  /* ① removed / rescheduled 必须来自该方案 */
  for (const r of removed) {
    if (!inPlan.has(r.id)) errs.push(`${tag} removed 的 ${r.id} 不在方案里`);
  }
  for (const m of rescheduled) {
    if (!inPlan.has(m.id)) errs.push(`${tag} rescheduled 的 ${m.id} 不在方案里`);
  }

  /* ② added 必须不在方案里，且是室内 */
  for (const a of added) {
    if (inPlan.has(a.id)) errs.push(`${tag} added 的 ${a.id} 已在方案里（不该“新增”）`);
    if (a.indoor !== true) errs.push(`${tag} added 的 ${a.id} 不是室内点`);
  }

  /* ③ 预算三方对齐 */
  if (!recheck) {
    errs.push(`${tag} 缺少 budget_recheck`);
  } else {
    const addSum = added.reduce((s, a) => s + (a.cost_cny ?? 0), 0);
    if (recheck.before_cny !== plan.budget_total_cny) {
      errs.push(`${tag} before_cny=${recheck.before_cny} 与方案实价 ${plan.budget_total_cny} 不符`);
    }
    if (recheck.after_cny !== recheck.before_cny + addSum) {
      errs.push(`${tag} after_cny=${recheck.after_cny} 不等于 before+新增 ${recheck.before_cny + addSum}`);
    }
    if (recheck.delta_cny !== recheck.after_cny - recheck.before_cny) {
      errs.push(`${tag} delta_cny=${recheck.delta_cny} 与 after-before 不符`);
    }
  }

  /* ④ sources 集合 */
  const declared = [...new Set(diff.sources ?? [])].sort().join();
  const actual = [...new Set([...removed.map((r) => r.id), ...added.map((a) => a.id)])].sort().join();
  if (declared !== actual) errs.push(`${tag} sources 与 removed∪added 不一致`);

  /* ⑤ 过夜项绝不能被移除 */
  for (const r of removed) {
    const src = itemsOf(plan).find((i) => i.id === r.id);
    if (src && looksOvernight(src)) {
      errs.push(`${tag} 过夜项被当成户外点移除：${src.name}（${src.start}~${src.end}）`);
    }
  }

  /* ⑥ changes 条数 */
  if (diff.changes.length !== removed.length + added.length + rescheduled.length) {
    errs.push(
      `${tag} changes=${diff.changes.length} 与 removed+added+rescheduled=${removed.length + added.length + rescheduled.length} 不符`,
    );
  }

  /* ⑦ 旁白不能留占位符 */
  const narrationText = Object.values(narration).join("");
  const leaked = [...narrationText.matchAll(PLACEHOLDER)].map((m) => m[0]);
  if (leaked.length) errs.push(`${tag} 旁白残留占位符 ${leaked.join(",")}`);

  /* ⑧ 变更卡文案不能是空的 */
  if (!diff.banner.trim()) errs.push(`${tag} banner 为空`);
  if (!diff.change_summary?.trim()) errs.push(`${tag} change_summary 为空`);

  errors.push(...errs);

  const verdict = removed.length
    ? `移除${removed.length} 新增${added.length} 改期${rescheduled.length} 预算${(recheck?.delta_cny ?? 0) >= 0 ? "+" : ""}${recheck?.delta_cny ?? 0}`
    : "无需变更（14:00-18:00 无户外景点）";
  console.log(`  ${errs.length ? "FAIL" : " OK "} ${tag.padEnd(14)} ${dims}  → ${verdict}`);
}

/* ==================== 剧本占位符与 narration 的契约 ==================== */

const pack = loadJson<{
  scenarios: Array<{ id: string; events: Array<{ event: string; data: { text?: unknown } }> }>;
}>("mock_agent_script.json");
const rainScenario = pack.scenarios.find((s) => s.id === "rain_replan");
const slots = replanForRain(CLASSIC_PLAN, pool).narration;
const slotKeys = new Set(Object.keys(slots));
const usedKeys = new Set<string>();

for (const ev of rainScenario?.events ?? []) {
  const text = ev.data?.text;
  if (typeof text !== "string") continue;
  for (const m of text.matchAll(PLACEHOLDER)) {
    usedKeys.add(m[1]);
    if (!slotKeys.has(m[1])) {
      errors.push(`[剧本] rain_replan 引用了未提供的旁白占位符：{${m[1]}}`);
    }
  }
}
for (const k of slotKeys) {
  if (!usedKeys.has(k)) warnings.push(`[剧本] 旁白占位符 {${k}} 定义了但剧本没用上`);
}

/* ==================== 边界 ==================== */

const edgeCases: Array<[string, DemoPlan | null | undefined]> = [
  ["null 方案", null],
  ["空方案", { title: "空", days: [], budget_total_cny: 0 } as DemoPlan],
  [
    "只有过夜户外项",
    {
      title: "只有过夜项",
      budget_total_cny: 500,
      days: [
        {
          day: 1,
          theme: "过夜",
          items: [
            {
              id: "BIZ-022",
              name: "永嘉聚龙阁客栈",
              start: "17:30",
              end: "次日08:00",
              cost_cny: 500,
              indoor: false,
            },
          ],
        },
      ],
    } as DemoPlan,
  ],
];

for (const [label, p] of edgeCases) {
  try {
    const { diff } = replanForRain(p, pool);
    const n = (diff.removed ?? []).length + (diff.added ?? []).length;
    if (n !== 0) errors.push(`[边界] ${label} 不该产生变更，实际 ${n} 条`);
    console.log(`  ${n === 0 ? " OK " : "FAIL"} [边界] ${label.padEnd(12)} → 无变更`);
  } catch (e) {
    errors.push(`[边界] ${label} 抛异常：${(e as Error).message}`);
  }
}

/* ==================== 汇总 ==================== */

if (warnings.length) {
  console.log(`\n提示 ${warnings.length} 条（不阻断）：`);
  for (const w of warnings) console.log(`  ! ${w}`);
}

if (errors.length) {
  console.error(`\n校验失败 ${errors.length} 项：`);
  for (const e of errors) console.error(`  x ${e}`);
  process.exit(1);
}

console.log(`\n全部通过：${plans.length} 条方案 + ${edgeCases.length} 个边界用例\n`);
