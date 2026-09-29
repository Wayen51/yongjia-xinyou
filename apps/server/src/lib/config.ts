import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/lib -> src -> server -> apps -> 仓库根
const ROOT = path.resolve(__dirname, "../../../..");
dotenv.config({ path: path.join(ROOT, ".env") });
dotenv.config({ path: path.join(ROOT, ".env.example") });

// 运行配置：.env 优先，未填时回落到 .env.example（保证无 key 也能演示）
export const config = {
  port: Number(process.env.PORT || 3000),
  mockLlm: (process.env.MOCK_LLM ?? "true") !== "false",
  llmProvider: process.env.LLM_PROVIDER || "mock",
  llmBaseUrl: process.env.LLM_BASE_URL || "",
  llmApiKey: process.env.LLM_API_KEY || "",
  llmModel: process.env.LLM_MODEL || "glm-4-air",
  weatherApiKey: process.env.WEATHER_API_KEY || "",
  demoConsole: (process.env.DEMO_CONSOLE ?? "true") !== "false",
  /** LLM 消耗接口的访问令牌。留空则关闭校验（本地调试）。 */
  chatToken: process.env.CHAT_API_TOKEN || "",
  seedDir: path.resolve(__dirname, "../db/seed"),
  dataDir: path.resolve(__dirname, "../../data"),
  /** 前端静态素材根（3D 全景 / 热点 JSON 的权威来源），供场景管理读取运行时素材。
   *  __dirname = apps/server/src/lib → 上三级到 apps，再进 web/public。
   *  便携分发版（绿色包）可通过 WEB_PUBLIC_DIR 指向构建产物目录（dist 已含 public 全部文件），
   *  避免在包内再复制一份素材；常规部署不设置该变量，路径不变。 */
  webPublicDir: process.env.WEB_PUBLIC_DIR
    ? path.resolve(ROOT, process.env.WEB_PUBLIC_DIR)
    : path.resolve(__dirname, "../../../web/public"),
};
