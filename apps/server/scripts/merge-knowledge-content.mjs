/**
 * 知识库正文（content）合并器 —— 豆包交付物 → knowledge_seed_v3.json
 *
 * 背景与分工（见《知识库正文加深-任务单-给豆包.md》）：
 *   正文撰写 = 豆包；合并落盘 + 校验 = 技术侧。
 *   豆包只交 [{"id":"CUL-001","content":"…"}]，本脚本按 id 把 content
 *   合并进 src/db/seed/knowledge_seed_v3.json，**除 content 外的字段一律不动**。
 *
 * 安全设计（重要，别改成"直接写"）：
 *   1. 默认 dry-run：只校验、输出统计，不碰种子文件；确认无误再加 --apply；
 *   2. --apply 先写时间戳 .bak 备份（copy-assets 只跳过 .bak，不会带进 dist）；
 *   3. 写盘后立刻读回自验：
 *      - 交付的每条 content 与落盘值逐字符一致；
 *      - 除 content 外的所有字段（含 meta / summary / source / tags / 坐标……）
 *        与合并前深比较完全一致；
 *      - items 数量与 id 顺序不变。
 *
 * 用法（在 apps/server 目录下）：
 *   node scripts/merge-knowledge-content.mjs <交付JSON路径>                # dry-run
 *   node scripts/merge-knowledge-content.mjs <交付JSON路径> --apply        # 正式合并
 *   node scripts/merge-knowledge-content.mjs <交付JSON路径> --partial      # 允许子集（返修批次）
 *
 * 退出码：校验失败 = 1（dry-run 与 --apply 均不写盘）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.join(here, "..", "src", "db", "seed", "knowledge_seed_v3.json");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const partial = args.includes("--partial");
const deliveryPath = args.find((a) => !a.startsWith("--"));

if (!deliveryPath) {
  console.error("用法：node scripts/merge-knowledge-content.mjs <交付JSON路径> [--apply] [--partial]");
  process.exit(1);
}

const fail = (msg) => {
  console.error(`[merge] ✗ ${msg}`);
  process.exit(1);
};

// ---------- 读取 ----------
const seedRaw = fs.readFileSync(seedPath, "utf8");
const seed = JSON.parse(seedRaw);
const deliveryAbs = path.resolve(process.cwd(), deliveryPath);
if (!fs.existsSync(deliveryAbs)) fail(`交付文件不存在：${deliveryAbs}`);
const delivery = JSON.parse(fs.readFileSync(deliveryAbs, "utf8"));

Array.isArray(seed.items) || fail("种子文件缺少 items 数组");
Array.isArray(delivery) || fail("交付文件必须是 JSON 数组 [{id, content}]");

// ---------- 结构 / ID 校验 ----------
const badShape = delivery.filter(
  (d) => !d || typeof d.id !== "string" || typeof d.content !== "string"
);
badShape.length && fail(`交付中有 ${badShape.length} 条不是 {id:string, content:string} 结构`);

const empty = delivery.filter((d) => d.content.trim() === "");
empty.length && fail(`空 content：${empty.map((d) => d.id).join(", ")}`);

const dup = delivery.map((d) => d.id).filter((id, i, arr) => arr.indexOf(id) !== i);
dup.length && fail(`交付 id 重复：${[...new Set(dup)].join(", ")}`);

const seedIds = seed.items.map((i) => i.id);
const seedSet = new Set(seedIds);
const deliverIds = delivery.map((d) => d.id);

const unknown = deliverIds.filter((id) => !seedSet.has(id));
unknown.length && fail(`交付中存在种子没有的 id：${unknown.join(", ")}`);

if (!partial) {
  const missing = seedIds.filter((id) => !deliverIds.includes(id));
  missing.length &&
    fail(`全覆盖模式下缺少 ${missing.length} 条：${missing.join(", ")}（返修批次请加 --partial）`);
}

// ---------- 内容规则校验（任务单：100~300 中文字符 / 无旧名 / 无 markdown） ----------
const outOfRange = delivery
  .filter((d) => d.content.length < 100 || d.content.length > 300)
  .map((d) => `${d.id}=${d.content.length}字`);
outOfRange.length && fail(`字数超出 100~300 区间：${outOfRange.join("; ")}`);

const oldName = delivery.filter((d) => d.content.includes("永嘉智游")).map((d) => d.id);
oldName.length && fail(`正文含旧名「永嘉智游」：${oldName.join(", ")}`);

const mdLike = delivery
  .filter((d) => /[#`*_]|\[.+?\]\(.+?\)|^[-*]\s/m.test(d.content))
  .map((d) => d.id);
mdLike.length && fail(`正文疑似含 markdown 符号：${mdLike.join(", ")}`);

// ---------- 重复短语提示（warning，不阻断；返修批次的重点观察项） ----------
const repeatedHits = [];
for (const d of delivery) {
  const clauses = d.content.split(/[，。！？；、：]/).filter((c) => c.length >= 4);
  const hits = new Set();
  for (let i = 0; i < clauses.length; i++) {
    for (let j = 0; j < clauses.length; j++) {
      if (i !== j && clauses[j].includes(clauses[i])) hits.add(clauses[i]);
    }
  }
  if (hits.size) repeatedHits.push(`${d.id}（${[...hits].join(" / ")}）`);
}

const lens = delivery.map((d) => d.content.length);
const avg = (lens.reduce((a, b) => a + b, 0) / lens.length).toFixed(1);
console.log(`[merge] 交付 ${delivery.length} 条 | 字数 min=${Math.min(...lens)} max=${Math.max(...lens)} avg=${avg}`);
if (partial) {
  console.log(`[merge] 模式：--partial 子集合并（种子共 ${seed.items.length} 条）`);
} else {
  console.log(`[merge] 模式：全覆盖（种子 ${seed.items.length} 条，id 集合一致）`);
}
if (repeatedHits.length) {
  console.log(`[merge] ⚠ 发现 ${repeatedHits.length} 条含重复短语（不阻断，建议返修）：`);
  repeatedHits.forEach((h) => console.log(`        - ${h}`));
} else {
  console.log("[merge] 重复短语检测：未发现");
}

// ---------- 深比较辅助：去掉 content 后其余字段是否一致 ----------
const stripContent = (item) => {
  const { content, ...rest } = item;
  return rest;
};

if (!apply) {
  console.log("[merge] dry-run 完成，未写盘。确认后加 --apply 执行合并。");
  process.exit(0);
}

// ---------- 正式合并 ----------
const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
const backupPath = path.join(path.dirname(seedPath), `knowledge_seed_v3.${ts}.bak`);
fs.writeFileSync(backupPath, seedRaw, "utf8");

const beforeSnapshot = seed.items.map((i) => JSON.stringify(stripContent(i)));
const beforeMeta = JSON.stringify(seed.meta);
const beforeIds = [...seedIds];

const byId = new Map(delivery.map((d) => [d.id, d.content]));
let changed = 0;
for (const item of seed.items) {
  if (byId.has(item.id)) {
    if (item.content !== byId.get(item.id)) changed++;
    item.content = byId.get(item.id);
  }
}

fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2) + "\n", "utf8");

// ---------- 读回自验 ----------
const reread = JSON.parse(fs.readFileSync(seedPath, "utf8"));
let ok = true;
const assert = (cond, msg) => {
  console.log(`[merge] ${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) ok = false;
};

assert(reread.items.length === seed.items.length, "items 数量不变");
assert(JSON.stringify(reread.items.map((i) => i.id)) === JSON.stringify(beforeIds), "id 顺序不变");
assert(JSON.stringify(reread.meta) === beforeMeta, "meta 原样未动");

const afterSnapshot = reread.items.map((i) => JSON.stringify(stripContent(i)));
assert(
  afterSnapshot.every((v, i) => v === beforeSnapshot[i]),
  "除 content 外所有字段逐条深比较一致"
);

const allApplied = delivery.every((d) => {
  const item = reread.items.find((i) => i.id === d.id);
  return item && item.content === d.content;
});
assert(allApplied, "交付 content 已逐字符落盘");

if (!ok) {
  console.error(`[merge] ✗ 自验失败！种子备份在：${backupPath}，请人工核对后回滚。`);
  process.exit(1);
}
console.log(`[merge] 合并完成：实际改动 ${changed} 条 | 备份：${path.relative(process.cwd(), backupPath)}`);
console.log("[merge] 提醒：还需 npm run build 把 seed 同步进 dist/db/seed（红线 8）。");
