/**
 * 跨包管理器并行启动 server + web + mobile
 * （本机 Windows 上 pnpm 的 .pnpm junction 易损坏，统一用 node 直启）。
 * 运行：node scripts/dev.mjs
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 解析依赖包的真实 CLI 入口（读 package.json 的 bin 字段）：
 * tsx/vite 新版 exports 不再暴露 "dist/cli.mjs"/"bin/vite.js"，
 * 直接 require.resolve 会抛 ERR_PACKAGE_PATH_NOT_EXPORTED。
 */
const binOf = (pkgJsonDir, dep) => {
  const req = createRequire(path.join(pkgJsonDir, "package.json"));
  const pj = req.resolve(`${dep}/package.json`);
  const meta = JSON.parse(readFileSync(pj, "utf8"));
  const rel = typeof meta.bin === "string" ? meta.bin : Object.values(meta.bin ?? {})[0];
  if (!rel) throw new Error(`找不到 ${dep} 的 bin 入口`);
  return path.join(path.dirname(pj), rel);
};

const children = [];

function boot(name, cwd, ...args) {
  const child = spawn(process.execPath, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
    windowsHide: false,
  });
  child.on("exit", (code) => {
    console.log(`[dev] ${name} 退出 (code=${code})`);
    shutdown(code);
  });
  children.push(child);
  console.log(`[dev] ${name} 已启动 -> ${args[0]}`);
}

function shutdown(code) {
  for (const c of children) {
    try {
      c.kill("SIGTERM");
    } catch {
      /* noop */
    }
  }
  setTimeout(() => process.exit(code ?? 0), 300);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const serverBin = binOf(path.join(root, "apps", "server"), "tsx");
const webBin = binOf(path.join(root, "apps", "web"), "vite");
const mobileBin = binOf(path.join(root, "apps", "mobile"), "vite");

boot("server(3000)", root, serverBin, "watch", path.join(root, "apps", "server", "src", "index.ts"));
boot("web(5173)", path.join(root, "apps", "web"), webBin);
boot("mobile(5174)", path.join(root, "apps", "mobile"), mobileBin);
