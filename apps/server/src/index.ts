import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { config } from "./lib/config.ts";
import { initDb } from "./db/db.ts";
import { registerRoutes } from "./routes/index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  initDb();
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await registerRoutes(app);

  // __dirname 在 src 下是 apps/server/src、编译后在 apps/server/dist，
  // 两者同为 apps/server 的下级目录，故统一向上两级即到 apps/*/dist。
  const webDist = path.resolve(__dirname, "../../web/dist");
  const mobileDist = path.resolve(__dirname, "../../mobile/dist");
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: "/" });

    // 手机端（游客 H5）同源托管：网站 /、手机端 /m/，共享同一份 /api 与 /assets。
    // 手机扫码直接打开 http://<局域网IP>:3000/m/，不必再单独跑 5174 开发服务器。
    // 二次注册 fastify-static 必须关掉 decorateReply，否则 reply.sendFile 重复装饰报错。
    const hasMobile = fs.existsSync(mobileDist);
    if (hasMobile) {
      await app.register(fastifyStatic, {
        root: mobileDist,
        prefix: "/m/",
        decorateReply: false,
      });
    }

    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) {
        return reply.code(404).send({ code: 40401, message: "接口不存在" });
      }
      // 手机端是 hash 路由（/#/play/game_x），正常不会走到这里；仅作前缀兜底
      if (hasMobile && (req.url === "/m" || req.url.startsWith("/m/"))) {
        return reply.sendFile("index.html", mobileDist);
      }
      return reply.sendFile("index.html");
    });
  }

  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(`永嘉新游 API 已启动 http://localhost:${config.port} MOCK_LLM=${config.mockLlm}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
