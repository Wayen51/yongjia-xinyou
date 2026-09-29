/**
 * 单端启动：node scripts/run.mjs web | mobile | server
 * 跨包管理器（npm/pnpm）解析本地 node_modules 中的 CLI。
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 从 workspace 应用（web/server）视角解析其依赖的真实 CLI 入口：
 * tsx/vite 新版 exports 不再暴露 "dist/cli.mjs"/"bin/vite.js"，统一改读各包
 * package.json 的 bin 字段，避免 ERR_PACKAGE_PATH_NOT_EXPORTED。
 */
const binOf = (workspaceApp, dep) => {
  const req = createRequire(path.join(root, "apps", workspaceApp, "package.json"));
  const pj = req.resolve(`${dep}/package.json`);
  const meta = JSON.parse(readFileSync(pj, "utf8"));
  const rel = typeof meta.bin === "string" ? meta.bin : Object.values(meta.bin ?? {})[0];
  if (!rel) throw new Error(`找不到 ${dep} 的 bin 入口`);
  return path.join(path.dirname(pj), rel);
};

const task = process.argv[2];
if (!["web", "mobile", "server"].includes(task)) {
  console.error("用法：node scripts/run.mjs web|mobile|server");
  process.exit(1);
}

// web / mobile 是 Vite 前端工程（各自 cwd 下启动），server 是 tsx 直跑
const isFrontend = task === "web" || task === "mobile";
const bin = isFrontend ? binOf(task, "vite") : binOf("server", "tsx");
const args = isFrontend
  ? [bin]
  : [bin, "watch", path.join(root, "apps", "server", "src", "index.ts")];
const cwd = isFrontend ? path.join(root, "apps", task) : root;

const child = spawn(process.execPath, args, { cwd, stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
