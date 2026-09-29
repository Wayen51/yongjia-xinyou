/**
 * 行程数据校验（改过行程数据后必跑）
 *
 *   cd apps/server && npm run verify:itinerary
 *
 * 为什么要有这个脚本：行程数据横跨两处——内联在 src/itinerary/plan.ts 的 CLASSIC_PLAN，
 * 以及 src/db/seed/itinerary_plans.json 里的 7 条主题线。两边都必须与
 * knowledge_seed_v3.json 对齐（id 存在、名字逐字一致、成本可溯源、indoor 一致），
 * 且自身的预算与 sources 必须自洽。人眼核过一次，但下次改数据不会有人再核；脚本会。
 *
 * 校验项：
 *   ① 条目 id 真实存在于知识库
 *   ② 条目 name 与知识库逐字一致（卡片要能点进知识库详情）
 *   ③ indoor 与知识库一致（暴雨降级靠它挑室内点）
 *   ④ cost_cny 与知识库 avg_cost_cny 一致
 *   ⑤ budget_total_cny == 所有 cost_cny 之和
 *   ⑥ sources == 所有条目 id 的去重集合
 *   ⑦ 时间格式合法、日内不重叠、start 早于 end
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../src/lib/config.ts";
import { planTemplates } from "../src/itinerary/plan.ts";

type KbItem = { id: string; name: string; avg_cost_cny?: number | null; indoor?: boolean | null };

const kb = JSON.parse(
  fs.readFileSync(path.join(config.seedDir, "knowledge_seed_v3.json"), "utf8"),
) as { items: KbItem[] };
const kbById = new Map(kb.items.map((i) => [i.id, i]));

const TIME = /^(\d{2}:\d{2}|次日\d{2}:\d{2})$/;
function mins(t: string): number {
  const m = t.match(/(\d{2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
}

const errors: string[] = [];
const warnings: string[] = [];
let stationCount = 0;

const plans = planTemplates();
console.log(`\n行程方案 ${plans.length} 条 | 知识库 ${kb.items.length} 条\n`);

for (const plan of plans) {
  const tag = `[${plan.key}]`;
  const planErrors: string[] = [];
  const usedIds: string[] = [];
  let sum = 0;

  plan.days.forEach((d, di) => {
    if (d.day !== di + 1) planErrors.push(`${tag} day 编号不连续：${d.day}`);
    if (d.items.length < 3 || d.items.length > 5) {
      warnings.push(`${tag} day${d.day} 站点 ${d.items.length} 个（建议 3-5）`);
    }
    let prevEnd: number | null = null;

    for (const it of d.items) {
      stationCount++;
      usedIds.push(it.id);
      sum += it.cost_cny;

      /* 契约 */
      if (!TIME.test(it.start) || !TIME.test(it.end)) {
        planErrors.push(`${tag} 时间格式异常 ${it.id}：${it.start}~${it.end}`);
      }
      if (typeof it.indoor !== "boolean") planErrors.push(`${tag} indoor 非布尔 ${it.id}`);
      if (typeof it.cost_cny !== "number") planErrors.push(`${tag} cost_cny 非数值 ${it.id}`);
      // 跨夜站点（17:30~次日08:00）不参与「同日」时间轴比较，它的 end 在第二天
      const overnight = it.start.includes("次日") || it.end.includes("次日");
      if (!overnight) {
        if (mins(it.start) >= mins(it.end)) {
          planErrors.push(`${tag} start 不早于 end ${it.id}：${it.start}~${it.end}`);
        }
        if (prevEnd !== null && mins(it.start) < prevEnd) {
          warnings.push(`${tag} 与上一站时间重叠 ${it.id}`);
        }
        prevEnd = mins(it.end);
      }

      /* ① id 存在性 */
      const k = kbById.get(it.id);
      if (!k) {
        planErrors.push(`${tag} 条目 id 不存在于知识库：${it.id}`);
        continue;
      }
      /* ② name 逐字一致 */
      if (k.name !== it.name) {
        planErrors.push(`${tag} name 不一致 ${it.id}：行程="${it.name}" 知识库="${k.name}"`);
      }
      /* ③ indoor 一致 */
      if (k.indoor != null && k.indoor !== it.indoor) {
        planErrors.push(`${tag} indoor 冲突 ${it.id} ${k.name}：行程=${it.indoor} 知识库=${k.indoor}`);
      }
      /* ④ 成本可溯源 */
      if (k.avg_cost_cny != null && k.avg_cost_cny !== it.cost_cny) {
        warnings.push(`${tag} cost 与知识库不符 ${it.id}：行程=${it.cost_cny} 知识库=${k.avg_cost_cny}`);
      }
    }
  });

  /* ⑤ 预算自洽 */
  if (sum !== plan.budget_total_cny) {
    planErrors.push(`${tag} 预算不符：明细和=${sum} 声明 budget_total_cny=${plan.budget_total_cny}`);
  }
  /* ⑥ sources 集合相等 */
  const declared = [...new Set(plan.sources ?? [])].sort();
  const actual = [...new Set(usedIds)].sort();
  if (declared.join() !== actual.join()) {
    planErrors.push(`${tag} sources 与明细不一致：声明 ${declared.length} 条 / 实际去重 ${actual.length} 条`);
  }

  errors.push(...planErrors);
  const flag = planErrors.length ? "FAIL" : " OK ";
  console.log(
    `  ${flag} ${tag.padEnd(14)} ${plan.days.length}天 ${String(usedIds.length).padStart(2)}站 ¥${plan.budget_total_cny}`,
  );
}

if (warnings.length) {
  console.log(`\n提示 ${warnings.length} 条（不阻断）：`);
  for (const w of warnings) console.log(`  ! ${w}`);
}

if (errors.length) {
  console.error(`\n校验失败 ${errors.length} 项：`);
  for (const e of errors) console.error(`  x ${e}`);
  process.exit(1);
}

console.log(`\n全部通过：${plans.length} 条方案 / ${stationCount} 个站点引用\n`);
