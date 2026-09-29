/**
 * 构建：node scripts/build.mjs  —— 编译 server(tsc)，再打包 web / mobile(vite build)。
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 从 workspace 应用视角解析依赖的真实 CLI 入口（读其 package.json 的 bin 字段）：
 * vite/typescript 新版 exports 不再暴露 "bin/vite.js"、"bin/tsc" 等子路径，
 * 直接 require.resolve 子路径会抛 ERR_PACKAGE_PATH_NOT_EXPORTED。
 * 与 scripts/dev.mjs、scripts/run.mjs 保持同一套解析逻辑。
 */
const binOf = (workspaceApp, dep) => {
  const req = createRequire(path.join(root, "apps", workspaceApp, "package.json"));
  const pj = req.resolve(`${dep}/package.json`);
  const meta = JSON.parse(readFileSync(pj, "utf8"));
  const rel = typeof meta.bin === "string" ? meta.bin : Object.values(meta.bin ?? {})[0];
  if (!rel) throw new Error(`找不到 ${dep} 的 bin 入口`);
  return path.join(path.dirname(pj), rel);
};

function run(step, bin, args, cwd) {
  console.log(`\n== ${step} ==`);
  const res = spawnSync(process.execPath, [bin, ...args], { cwd, stdio: "inherit" });
  if (res.status !== 0) {
    console.error(`[build] ${step} 失败 (code=${res.status})`);
    process.exit(res.status ?? 1);
  }
}

run("server · tsc", binOf("server", "typescript"), ["-p", "tsconfig.json"], path.join(root, "apps", "server"));
// tsc 只产出 .js；schema.sql 与 seed/*.json 是运行时读取的资产（config.seedDir / loadJson 都是
// fs 读文件，不走 import），必须同步进 dist，否则 `npm start` 启动即 ENOENT，
// 或者更隐蔽：dist 里留着上一次的旧副本 → 源码改对了、接口返回还是老内容。
// 实现集中在 apps/server/scripts/copy-assets.mjs，与 `apps/server` 自身的 build 脚本共用一份，避免两处口径漂移。
run(
  "server · 运行时资产 (schema.sql + seed)",
  path.join(root, "apps", "server", "scripts", "copy-assets.mjs"),
  [],
  path.join(root, "apps", "server"),
);
run("web · vite build", binOf("web", "vite"), ["build"], path.join(root, "apps", "web"));
run("mobile · vite build", binOf("mobile", "vite"), ["build"], path.join(root, "apps", "mobile"));
console.log("\n构建完成：apps/server/dist + apps/web/dist + apps/mobile/dist");
