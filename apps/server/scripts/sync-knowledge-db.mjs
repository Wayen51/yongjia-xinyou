/**
 * 把种子里的知识库 content 对齐进**已存在的运行库**（apps/server/data/zhiyou.db）
 *
 * 为什么需要这个脚本（merge-knowledge-content.mjs 之后的第二步）：
 *   db.ts 的 seedKnowledgeIfEmpty() 只在 knowledge_items 表为空时整表播种。
 *   演示机/开发机的库早就有 106 条数据（还积累了 scene_views 真实埋点等），
 *   只改种子 + build + 重启 → 接口依旧返回旧 content。
 *   删库重灌又会丢掉真实埋点（违反红线 11 的精神），所以走精准 UPDATE。
 *
 * 口径：
 *   - 读 **dist/db/seed**（服务实际使用的副本），并先与 src 版本比哈希，
 *     不一致直接拦下（防止对着陈旧 dist 同步）；
 *   - 只 UPDATE knowledge_items.content，其余列一律不碰；
 *   - 幂等：内容已一致时变更 0 行，可反复执行；
 *   - 写前建议停服务（node:sqlite 持库连接），脚本带 busy_timeout 兜底。
 *
 * 用法（在 apps/server 目录下）：
 *   node scripts/sync-knowledge-db.mjs            # 执行同步
 *   node scripts/sync-knowledge-db.mjs --check    # 只比对不写
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, "..");
const distSeed = path.join(serverDir, "dist", "db", "seed", "knowledge_seed_v3.json");
const srcSeed = path.join(serverDir, "src", "db", "seed", "knowledge_seed_v3.json");
const dbPath = path.join(serverDir, "data", "zhiyou.db");
const checkOnly = process.argv.includes("--check");

const fail = (msg) => {
  console.error(`[sync-db] ✗ ${msg}`);
  process.exit(1);
};

fs.existsSync(distSeed) || fail(`dist 种子不存在，先 npm run build：${distSeed}`);
fs.existsSync(dbPath) || fail(`运行库不存在：${dbPath}（服务启动过才会生成）`);

const hash = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
if (fs.existsSync(srcSeed) && hash(srcSeed) !== hash(distSeed)) {
  fail("src 与 dist 的 knowledge_seed_v3.json 不一致，先 npm run build（红线 8）");
}

const seed = JSON.parse(fs.readFileSync(distSeed, "utf8"));
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA busy_timeout=5000");

const rows = db.prepare("SELECT id, content FROM knowledge_items").all();
const dbMap = new Map(rows.map((r) => [r.id, r.content]));

const missing = seed.items.filter((i) => !dbMap.has(i.id)).map((i) => i.id);
missing.length && fail(`数据库缺少种子 id ${missing.length} 条：${missing.join(", ")}`);

const pending = seed.items.filter((i) => dbMap.get(i.id) !== i.content);
console.log(`[sync-db] 库内 ${rows.length} 条 | 待更新 ${pending.length} 条${checkOnly ? "（--check 不写）" : ""}`);

if (checkOnly) process.exit(pending.length === 0 ? 0 : 2);

if (pending.length) {
  const stmt = db.prepare("UPDATE knowledge_items SET content = ? WHERE id = ?");
  db.exec("BEGIN");
  try {
    for (const item of pending) stmt.run(item.content, item.id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    fail(`更新失败已回滚：${err.message}`);
  }
}

const after = new Map(
  db.prepare("SELECT id, content FROM knowledge_items").all().map((r) => [r.id, r.content])
);
const mismatch = seed.items.filter((i) => after.get(i.id) !== i.content).map((i) => i.id);
if (mismatch.length) fail(`读回校验不一致：${mismatch.join(", ")}`);

const cnt = db.prepare("SELECT COUNT(*) AS c FROM knowledge_items").get();
console.log(`[sync-db] ✓ ${cnt.c} 条 content 与 dist 种子完全一致`);
db.close();
