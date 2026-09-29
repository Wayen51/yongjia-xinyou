#!/usr/bin/env node
/**
 * 知识库数值字段归一化（缺口 B-04）
 *
 * 背景：seed/knowledge_seed_v3.json 里 POI 的票价/游玩时长、商家的价格区间都是人读的
 *       字符串（"50元" / "3-4小时" / "10-15元/个"），无法参与行程预算与时长计算。
 *       本脚本把它们解析成可计算的数值字段：
 *         POI：ticket      -> avg_cost_cny
 *              duration    -> avg_duration_min
 *         BIZ：price_range -> avg_cost_cny
 *
 * 规则：
 *   - 票价/价格：含「免费 / 含在…门票内」→ 0；否则取「第一个带数字的价格段」的中值。
 *     价格区间取第一段（如「3-5元/碗，15-30元/斤」只看 60 元那段的「3-5元/碗」），
 *     并先剥离括号补充说明，避免把「（包筏约300-500元）」算进来。
 *   - 时长：含「小时」按 ×60 折算，区间取中值，分钟取整。
 *   - 默认只填 null，不覆盖已有数值（幂等）；`--force` 才按规则重算全部。
 *
 * 用法：
 *   node scripts/normalize-knowledge.mjs          # 只补空
 *   node scripts/normalize-knowledge.mjs --force  # 全量重算
 *   node scripts/normalize-knowledge.mjs --check  # 只体检不落盘
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.resolve(__dirname, "../apps/server/src/db/seed/knowledge_seed_v3.json");

const FORCE = process.argv.includes("--force");
const CHECK = process.argv.includes("--check");

/** 取出字符串里的所有数字 */
function numsOf(s) {
  return (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

/**
 * 解析票价 / 价格区间 -> 人民币（元，整数）
 * @param {string|null|undefined} raw
 * @returns {number|null}
 */
export function parseCostCny(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // 免费 / 含在其它景点门票内 => 无独立花费
  if (/免费|含在/.test(s)) return 0;
  // 剥离括号补充说明，避免把「（包筏约300-500元）」计入
  const cleaned = s.replace(/[（(][^）)]*[）)]/g, " ");
  // 按中文/英文顿号、逗号、分号切段，取第一个带数字的段
  const segs = cleaned.split(/[，,；;、]/).map((x) => x.trim());
  const seg = segs.find((x) => /\d/.test(x)) ?? cleaned;
  const nums = numsOf(seg);
  if (!nums.length) return null;
  return Math.round(mean(nums));
}

/**
 * 解析游玩时长 -> 分钟（整数）
 * @param {string|null|undefined} raw
 * @returns {number|null}
 */
export function parseDurationMin(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const nums = numsOf(s);
  if (!nums.length) return null;
  const isHour = /小时|時|时|h(?:our)?/i.test(s);
  const minutes = isHour ? mean(nums) * 60 : mean(nums);
  return Math.round(minutes);
}

function main() {
  const json = JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));
  const items = json.items ?? [];
  const report = {
    total: items.length,
    cost: { filled: 0, already: 0, noSource: 0 },
    duration: { filled: 0, already: 0, noSource: 0 },
    samples: [],
  };
  const remaining = { cost: [], duration: [] };

  for (const it of items) {
    // ---- 费用 ----
    if (it.avg_cost_cny == null) {
      const cost = parseCostCny(it.ticket ?? it.price_range);
      if (cost == null) {
        report.cost.noSource += 1;
        remaining.cost.push(it.id);
      } else {
        it.avg_cost_cny = cost;
        report.cost.filled += 1;
        if (report.samples.length < 12) {
          report.samples.push(`${it.id} ${it.name}：「${it.ticket ?? it.price_range}」-> ${cost} 元`);
        }
      }
    } else {
      report.cost.already += 1;
      if (FORCE) {
        const cost = parseCostCny(it.ticket ?? it.price_range);
        if (cost != null) it.avg_cost_cny = cost;
      }
    }

    // ---- 时长（仅 POI 有 duration） ----
    if (it.avg_duration_min == null) {
      const min = parseDurationMin(it.duration);
      if (min == null) {
        report.duration.noSource += 1;
      } else {
        it.avg_duration_min = min;
        report.duration.filled += 1;
      }
    } else {
      report.duration.already += 1;
      if (FORCE) {
        const min = parseDurationMin(it.duration);
        if (min != null) it.avg_duration_min = min;
      }
    }
  }

  console.log("=== 知识库数值归一化（B-04）===");
  console.log(`条目总数：${report.total}`);
  console.log(
    `avg_cost_cny    ：新填 ${report.cost.filled} ｜ 原有 ${report.cost.already} ｜ 无来源 ${report.cost.noSource}`,
  );
  console.log(
    `avg_duration_min：新填 ${report.duration.filled} ｜ 原有 ${report.duration.already} ｜ 无来源 ${report.duration.noSource}`,
  );
  if (report.samples.length) {
    console.log("\n-- 解析样例 --");
    for (const s of report.samples) console.log("  " + s);
  }

  if (CHECK) {
    console.log("\n[--check] 仅体检，未写入文件。");
    return;
  }

  if (!FORCE && !report.cost.filled && !report.duration.filled) {
    console.log("\n没有需要补全的字段（幂等，无需写盘）。");
    return;
  }

  fs.writeFileSync(SEED_PATH, JSON.stringify(json, null, 2) + "\n", "utf8");
  console.log(`\n已写入：${path.relative(process.cwd(), SEED_PATH)}`);
}

// 直接执行时才跑 main（被 import 时不跑）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
