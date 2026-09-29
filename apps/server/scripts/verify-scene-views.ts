/**
 * 场景浏览埋点校验（改过 scenes 访问量 / scene_views 后必跑）
 *
 *   cd apps/server && npm run verify:scene-views
 *
 * 为什么要有这个脚本：对外访问量是「演示基线 + 真实埋点」两段拼出来的，
 * 看 UI 只能看到总数，看不出：
 *   - 基线是否被埋点逻辑误改（那会让演示数据漂移）
 *   - 上报是否真的落库（而不是只在返回值里加了个 1）
 *   - 「今日」是否按**本地日期**切分（用 UTC 会在东八区早上漏数）
 * 所以这里逐条钉死，且**不复用被测模块的判定**（自己重算日期、自己查表计数），
 * 否则就是自证。
 *
 * 副作用：本脚本会向运行库写入 source='verify-script' 的流水，结束前全部删除并断言复原。
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../src/lib/config.ts";
import {
  getDb,
  getScene,
  initDb,
  listScenes,
  recordSceneView,
  sceneStats,
  sceneVisitBreakdown,
} from "../src/db/db.ts";

const TAG = "verify-script";
const errors: string[] = [];
const warnings: string[] = [];

function check(label: string, cond: boolean, detail = "") {
  if (!cond) errors.push(`${label}${detail ? ` —— ${detail}` : ""}`);
  console.log(`${cond ? "OK  " : "FAIL"} ${label}${detail ? ` · ${detail}` : ""}`);
}

/** 独立复述「本地日期」规则，不复用 db.ts 的 todayStr */
function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 独立查表计数，不复用模块的合并逻辑 */
function rawCount(sceneId: string, todayOnly = false): number {
  const row = (
    todayOnly
      ? getDb().prepare("SELECT COUNT(*) AS c FROM scene_views WHERE scene_id = ? AND view_date = ?").get(sceneId, localToday())
      : getDb().prepare("SELECT COUNT(*) AS c FROM scene_views WHERE scene_id = ?").get(sceneId)
  ) as { c: number };
  return Number(row?.c ?? 0);
}

initDb();

// 幂等：先清掉上一次异常中断可能残留的同源流水，避免被累计进本次断言
getDb().prepare("DELETE FROM scene_views WHERE source = ?").run(TAG);

const seedIds = new Set(
  (
    JSON.parse(fs.readFileSync(path.join(config.seedDir, "scenes_seed.json"), "utf8")) as {
      scenes: Array<{ id: string }>;
    }
  ).scenes.map((s) => s.id),
);

const scenes = listScenes();
console.log(`\n场景浏览埋点校验 | 场景 ${scenes.length} 个 | 本地日期 ${localToday()}\n`);

if (!scenes.length) {
  console.log("FAIL 场景表为空，无法校验（先跑一次服务让它完成种子写入）");
  process.exit(1);
}

/* ---------- ① 口径自洽：visit_count = 基线 + 真实计数 ---------- */
for (const s of scenes) {
  const real = rawCount(s.id);
  const todayReal = rawCount(s.id, true);
  check(
    `[${s.id}] 访问量 = 基线 + 埋点`,
    s.visit_count === s.visit_baseline + real,
    `基线 ${s.visit_baseline} + 埋点 ${real} = ${s.visit_count}`,
  );
  check(`[${s.id}] 今日埋点一致`, s.visit_today === todayReal, `接口 ${s.visit_today} / 查表 ${todayReal}`);
  /* ---------- ② 种子场景的基线仍在（没被埋点逻辑污染） ---------- */
  if (seedIds.has(s.id)) {
    check(`[${s.id}] 种子基线 > 0`, s.visit_baseline > 0, `基线 ${s.visit_baseline}`);
  } else {
    warnings.push(`[${s.id}] 非种子场景（基线应为 0）：基线 ${s.visit_baseline}`);
  }
}

/* ---------- ③ 上报：累计 +3 / 今日 +3 ---------- */
const target = scenes[0];
const before = getScene(target.id)!;
const beforeBreakdown = sceneVisitBreakdown();
const beforeRaw = rawCount(target.id);
const beforeStats = sceneStats();

try {
  for (let i = 1; i <= 3; i++) {
    const r = recordSceneView(target.id, TAG);
    const expectReal = before.visit_count - before.visit_baseline + i;
    check(
      `[${target.id}] 第 ${i} 次上报返回体`,
      !!r && r.visit_count === before.visit_count + i && r.visit_today === before.visit_today + i && r.real_visits === expectReal,
      r ? `visit_count ${r.visit_count} / today ${r.visit_today} / real ${r.real_visits}` : "返回 null",
    );
  }
  const after = getScene(target.id)!;
  check(
    `[${target.id}] 落库后累计 +3`,
    after.visit_count === before.visit_count + 3,
    `${before.visit_count} → ${after.visit_count}`,
  );
  check(`[${target.id}] 基线未被改写`, after.visit_baseline === before.visit_baseline, `基线 ${after.visit_baseline}`);
  check("[target] 流水表真的多出 3 条", rawCount(target.id) === beforeRaw + 3, `查表 ${beforeRaw} → ${rawCount(target.id)}`);
  check(
    `[${target.id}] 今日（本地日期）流水同步`,
    rawCount(target.id, true) === before.visit_today + 3,
    `今日 ${rawCount(target.id, true)} 条 / 接口 ${after.visit_today}`,
  );

  /* ---------- ④ 溯源与总览 ---------- */
  const bd = sceneVisitBreakdown();
  check(
    `埋点总览可溯源 source=${TAG}`,
    (bd.by_source[TAG] ?? 0) === 3 && bd.total === beforeBreakdown.total + 3 && bd.date === localToday(),
    `by_source=${JSON.stringify(bd.by_source)} total ${bd.total}`,
  );
  const st = sceneStats();
  check(
    "场景总览 real_visits / today_visits 同步",
    st.total_visits === beforeStats.total_visits + 3 &&
      st.real_visits === beforeStats.real_visits + 3 &&
      st.today_visits === beforeStats.today_visits + 3,
    `total ${beforeStats.total_visits}→${st.total_visits} / real ${beforeStats.real_visits}→${st.real_visits} / today ${beforeStats.today_visits}→${st.today_visits}`,
  );
} catch (e) {
  errors.push(`上报过程中抛异常：${(e as Error).message}`);
} finally {
  /* ---------- ⑥ 清理并断言复原 ---------- */
  getDb().prepare("DELETE FROM scene_views WHERE source = ?").run(TAG);
  const restored = getScene(target.id)!;
  const bd = sceneVisitBreakdown();
  check(
    "清理后访问量复原",
    restored.visit_count === before.visit_count && restored.visit_today === before.visit_today,
    `${before.visit_count} → ${restored.visit_count}`,
  );
  check("清理后埋点总览复原", bd.total === beforeBreakdown.total, `total ${bd.total}`);
}

/* ---------- ⑤ 边界：脏输入不得写库 ---------- */
const dirty: Array<[string, unknown]> = [
  ["不存在的场景", "no-such-scene-xyz"],
  ["空 id", ""],
  ["纯空白 id", "   "],
];
for (const [label, id] of dirty) {
  let r: unknown = "throw";
  try {
    r = recordSceneView(String(id), TAG);
  } catch (e) {
    errors.push(`${label}：抛异常 ${(e as Error).message}`);
  }
  check(`边界 · ${label} 返回 null`, r === null, `实际 ${JSON.stringify(r)}`);
}
const leaked = (getDb().prepare("SELECT COUNT(*) AS c FROM scene_views WHERE source = ?").get(TAG) as { c: number }).c;
check("边界调用未留下脏数据", Number(leaked) === 0, `残留 ${leaked} 条`);

/* ---------- 汇总 ---------- */
if (warnings.length) {
  console.log("\n提示：");
  for (const w of warnings) console.log(`  · ${w}`);
}
if (errors.length) {
  console.log(`\n失败 ${errors.length} 项：`);
  for (const e of errors) console.log(`  · ${e}`);
  process.exit(1);
}
console.log(`\n全部通过：${scenes.length} 个场景的口径自洽 + 上报/溯源/边界/清理\n`);
