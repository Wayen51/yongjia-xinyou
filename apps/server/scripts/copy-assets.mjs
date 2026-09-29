/**
 * 把 `tsc` 不产出的运行时资产同步进 dist：
 *
 *   apps/server/src/db/schema.sql  +  src/db/seed/**（跳过 .bak）
 *     → apps/server/dist/db/
 *
 * 为什么必须有这个脚本（真实踩过的坑，别删）
 * ------------------------------------------
 * `tsc -p tsconfig.json` 只产出 .js。而 `config.seedDir` / `db.ts` / `loadJson()` 是
 * **运行时按路径 fs.readFileSync 读 JSON**，不是 `import` —— 所以 tsc 永远不会把它们带进 dist。
 * 于是只要有人（或 AI）在 `apps/server` 里直接跑 `npm run build`，
 * `dist/db/seed/` 就会一直停留在**上一次 `node scripts/build.mjs` 的旧副本**上：
 *
 *   源码改对了 → 接口返回还是老内容 → 人会去怀疑逻辑、怀疑缓存，就是想不到产物是旧的。
 *
 * P2-2（暴雨重排动态化）就踩在这里：`rain.ts` 已是动态实现、`mock_agent_script.json` 已改成
 * `{rain_intro}` 占位符，但 dist 里的种子 JSON 还是写死「你现在正在石桅岩」的旧版，
 * 于是**变更卡是动态的、旁白却是写死的**——一个自相矛盾的中间态，比全旧更难看出问题。
 *
 * 调用方：
 *   · `apps/server` 的 `npm run build`（tsc 之后自动跑）
 *   · 仓库根 `scripts/build.mjs`（复用本脚本，不重复实现同一份拷贝逻辑）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, "..");
const srcDb = path.join(serverDir, "src", "db");
const distDb = path.join(serverDir, "dist", "db");

if (!fs.existsSync(srcDb)) {
  console.error(`[copy-assets] 源目录不存在：${srcDb}`);
  process.exit(1);
}

fs.mkdirSync(distDb, { recursive: true });
fs.copyFileSync(path.join(srcDb, "schema.sql"), path.join(distDb, "schema.sql"));
fs.cpSync(path.join(srcDb, "seed"), path.join(distDb, "seed"), {
  recursive: true,
  // 备份文件不随包发布，与根构建脚本口径一致
  filter: (p) => !p.endsWith(".bak"),
});

const seedCount = fs.readdirSync(path.join(distDb, "seed")).length;
console.log(`   -> apps/server/dist/db/{schema.sql, seed/ (${seedCount} 个文件)}`);
