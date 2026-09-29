import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { DemoPlan } from "@zhiyou/shared";
import { config } from "../lib/config.ts";
import {
  getItinerary,
  getKnowledge,
  getLatestItinerary,
  getVoucher,
  listVouchers,
  relatedByDomain,
  searchKnowledge,
  setSessionWeather,
  upsertSession,
  videoStats,
  loadJson,
} from "../db/db.ts";
import { issueVoucher } from "../booking/voucher.ts";
import { queryWeather } from "../lib/weather.ts";
import { runAgent, writeSse } from "../agent/engine.ts";
import { CLASSIC_PLAN, generatePlan, generatePlanByKey } from "../itinerary/plan.ts";
import { replanForRain } from "../itinerary/rain.ts";
import { registerVideoRoutes } from "./video.ts";
import { registerArRoutes } from "./ar.ts";
import { registerSceneRoutes } from "./scenes.ts";
import { recommendCompanion } from "../agent/recommend.ts";
import { guardLlmRoute } from "../lib/guard.ts";

function ok<T>(data: T) {
  return { code: 0, data };
}
function fail(code: number, message: string) {
  return { code, message };
}

export async function registerRoutes(app: FastifyInstance) {
  app.get("/api/health", async () =>
    ok({
      status: "ok",
      llm: config.mockLlm ? "mock" : config.llmApiKey ? "configured" : "missing-key",
      db: "ok",
      weather: config.weatherApiKey ? "live" : "mock",
      mockLlm: config.mockLlm,
    }),
  );

  app.get("/api/knowledge", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return ok(searchKnowledge({ q: q.q, domain: q.domain, tag: q.tag, indoor: q.indoor, limit: Number(q.limit || 24) }));
  });

  app.get("/api/knowledge/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = getKnowledge(id);
    if (!item) return reply.code(404).send(fail(40401, "条目不存在"));
    return ok({ item, related: relatedByDomain(item.domain, item.id) });
  });

  app.get("/api/shortcuts", async () => {
    return ok(loadJson("agent_shortcuts.json"));
  });

  app.get("/api/weather", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const sessionId = q.sessionId || "anon";
    if (q.mock === "rain") setSessionWeather(sessionId, "rain");
    // 注意：queryWeather 是 async，必须 await，否则 ok() 收到 Promise 序列化成 {}
    return ok(await queryWeather(sessionId, q.lat ? `坐标(${q.lat},${q.lng})` : "永嘉县"));
  });

  app.post("/api/demo/weather", async (req) => {
    const body = req.body as { sessionId?: string; mock?: string };
    const sessionId = body.sessionId || "anon";
    upsertSession(sessionId);
    setSessionWeather(sessionId, body.mock === "rain" ? "rain" : null);
    return ok({ sessionId, mock: body.mock === "rain" ? "rain" : "normal" });
  });

  app.post("/api/itinerary/generate", async (req) => {
    const body = (req.body || {}) as { sessionId?: string; message?: string; key?: string };
    const sessionId = body.sessionId || "anon";
    // key 直接点名方案；只给 message 时由行程服务按口味 + 天数选线；两者都没有则给经典两日线
    if (body.key) return ok(generatePlanByKey(body.key, sessionId));
    return ok(generatePlan(sessionId, body.message || ""));
  });

  app.post("/api/itinerary/replan", async (req) => {
    const body = (req.body || {}) as { itineraryId?: string; reason?: string; sessionId?: string };
    const sessionId = body.sessionId || "anon";
    setSessionWeather(sessionId, "rain");
    // 与对话链路（agent/engine.ts 的 rain_replan 剧本）复用同一个动态重排核心，
    // 保证「本接口返回的变更卡」与「演示时聊天里弹出的变更卡」口径完全一致。
    // 指定 itineraryId 就用那条线；否则取本会话最近生成的方案；都没有才退经典两日线。
    const existing =
      (body.itineraryId ? getItinerary(body.itineraryId) : getLatestItinerary(sessionId)) ?? CLASSIC_PLAN;
    const { diff } = replanForRain(existing as DemoPlan);
    return ok({ itinerary: existing, changes: diff, reason: body.reason || "weather_rain" });
  });

  app.get("/api/dashboard/overview", async () => {
    const dash = loadJson("dashboard_demo_data.json") as Record<string, unknown>;
    return ok({ ...dash, video_stats: videoStats() });
  });

  app.get("/api/dashboard/insight", async () => {
    // Agent 每日分析：默认取「最近一期」数据日期下的洞察；
    // 同一日期有多条时在当日洞察内轮换（前端「重新分析」每次拉取即模拟一轮新分析）
    const dash = loadJson<{ ai_insights: Array<{ id?: string; date?: string }> }>("dashboard_demo_data.json");
    const list = (dash.ai_insights || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const latestDate = list[0]?.date || null;
    const pool = latestDate ? list.filter((i) => i.date === latestDate) : list;
    const pick = pool[Math.floor(Math.random() * pool.length)] || list[0];
    return ok({ insight: pick, latestDate, poolSize: pool.length, demo: true });
  });

  app.post("/api/game/task", async (req) => {
    const body = (req.body || {}) as { questId?: string };
    const quests = loadJson<{ questions: Array<{ id: string; npc: string; question: string; reward: string; explanation: string }> }>(
      "treasure_quests.json",
    );
    const q = quests.questions.find((x) => x.id === body.questId) || quests.questions[0];
    return ok({
      title: `下一站：继续请教${q.npc}`,
      body: `答对可获得「${q.reward}」。${q.explanation}`,
      demo: true,
    });
  });

  /**
   * 模拟预订凭证（FR-AGT-08）：按已确认的行程发一张带流水号的凭证。
   * 之前这里固定返回模板 example、不收任何参数，前端也从不调用，整条链是死的。
   */
  app.post("/api/booking/voucher", async (req) => {
    const body = (req.body || {}) as {
      sessionId?: string;
      itineraryId?: string;
      itinerary?: DemoPlan;
      guests?: number;
      startDate?: string;
    };
    return ok({ voucher: issueVoucher(body) });
  });

  /** 凭证回查：凭证号念得出来，就该查得到 */
  app.get("/api/booking/voucher/:no", async (req, reply) => {
    const { no } = req.params as { no: string };
    const found = getVoucher(no);
    if (!found) return reply.code(404).send(fail(40401, "凭证不存在"));
    return ok({ voucher: found.payload, issued: found.record });
  });

  /** 凭证发放记录：运营端核对 / 演示现场复述用 */
  app.get("/api/booking/vouchers", async (req) => {
    const q = req.query as { sessionId?: string; limit?: string };
    return ok({ vouchers: listVouchers(q.sessionId, q.limit ? Number(q.limit) : 20) });
  });

  app.get("/api/space/hotspots", async () => {
    return ok(loadJson("pano_hotspots.json"));
  });

  app.post("/api/chat", async (req, reply) => {
    if (!guardLlmRoute(req, reply)) return;
    const body = (req.body || {}) as { sessionId?: string; message?: string };
    const sessionId = body.sessionId || randomUUID();
    const message = (body.message || "").trim();
    upsertSession(sessionId);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    if (!message) {
      writeSse(reply, "error", { code: 40001, message: "请输入消息" });
      writeSse(reply, "done", { finishReason: "error" });
      reply.raw.end();
      return;
    }
    try {
      await runAgent(reply, message, sessionId);
    } catch (err) {
      writeSse(reply, "error", { code: 50001, message: "服务内部错误", fallback: true });
      writeSse(reply, "done", { finishReason: "error" });
    } finally {
      reply.raw.end();
    }
  });

  /* 板块一 · AIGC 视频生成（提示词美化 + 模拟流水线 + NexaFrame） */
  await registerVideoRoutes(app);

  /* 板块二 · AR 互动游戏：运营端创建发布 + 玩家端围栏寻宝领券 */
  await registerArRoutes(app);

  /* 场景底座 · 永嘉 3D 景点场景：3D 云游 / 效果展示 / AR 寻宝共用 */
  await registerSceneRoutes(app);

  /* 板块三 · 智能伴侣：位置 + 节日 + 意图 应季推荐（依据永嘉智库实时计算） */
  app.get("/api/companion/recommend", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const lat = q.lat ? Number(q.lat) : undefined;
    const lng = q.lng ? Number(q.lng) : undefined;
    const res = recommendCompanion({
      lat: Number.isFinite(lat) ? lat : undefined,
      lng: Number.isFinite(lng) ? lng : undefined,
      location_name: q.location_name,
      festival: q.festival || "daily",
      intent: q.intent || "explore",
      context: q.context,
    });
    return ok(res);
  });
}
