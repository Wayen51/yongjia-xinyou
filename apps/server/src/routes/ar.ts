/**
 * 板块二 · AR 互动游戏 API
 * 运营端：游戏 CRUD / 点位配置 / 发布下线 / AI 生成剧情
 * 玩家端：配置下发（不含答案）→ 围栏签到 → 提交答案 → 领券 → 排行
 * Demo 口径：定位来自浏览器模拟，奖励为 mock 券，页面须标注「演示模拟·DEMO」
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  arPlayRecords,
  arStats,
  createArGame,
  deleteArGame,
  ensureArRecord,
  getArCoupon,
  getArGame,
  getArRecord,
  listArCoupons,
  listArGames,
  listArPois,
  listArTemplates,
  recordArCheckin,
  recordArClaim,
  recordArSubmit,
  replaceArPoints,
  setArGameStatus,
  updateArGame,
} from "../db/db.ts";
import { checkFence, judgeAnswer } from "../ar/geo.ts";
import { generateStory } from "../ar/generator.ts";
import { guardLlmRoute } from "../lib/guard.ts";

function ok<T>(data: T) {
  return { code: 0, data };
}
function fail(code: number, message: string) {
  return { code, message };
}

const DEFAULT_PLAYER = "demo-player";
const DEFAULT_NAME = "演示游客";

function playerOf(req: FastifyRequest) {
  const body = (req.body || {}) as Record<string, unknown>;
  const query = req.query as Record<string, string | undefined>;
  const key = String(body.playerKey ?? query.playerKey ?? body.sessionId ?? query.sessionId ?? DEFAULT_PLAYER);
  const name = String(body.userName ?? query.userName ?? DEFAULT_NAME);
  return { key, name };
}

/** 玩家端配置：剥离 answer / explanation，避免前端可查答案 */
function toPlayConfig(gameId: string) {
  const game = getArGame(gameId);
  if (!game) return null;
  const { points, ...rest } = game;
  return {
    ...rest,
    points: points.map((p) => ({
      order_index: p.order_index,
      poi_id: p.poi_id,
      poi_name: p.poi_name,
      poi_type: p.poi_type,
      lat: p.lat,
      lng: p.lng,
      geofence_radius_m: p.geofence_radius_m,
      billboard: p.billboard,
      billboard_url: p.billboard_url,
      task_type: p.task_type,
      npc: p.npc,
      question: p.question,
      hint: p.hint,
      answer_len: p.answer.length,
      reward_coupon_id: p.reward_coupon_id,
      reward_name: p.reward_name,
      reward_type: p.reward_type,
      coupon_image: p.coupon_image,
    })),
  };
}

export async function registerArRoutes(app: FastifyInstance) {
  /* ---------- 元数据：模板 / 点位库 / 券 / 统计 ---------- */

  app.get("/api/ar/templates", async () => {
    const templates = listArTemplates();
    const themes: Record<string, Record<string, string>> = {};
    for (const t of templates) themes[t.id] = { ...t.color, name: t.name };
    return ok({ templates, themes, default: templates[0]?.id ?? "culture" });
  });

  app.get("/api/ar/points", async () => ok({ points: listArPois() }));

  app.get("/api/ar/coupons", async () => ok({ coupons: listArCoupons() }));

  app.get("/api/ar/stats", async () => ok(arStats()));

  /* ---------- 运营端：游戏 CRUD ---------- */

  app.get("/api/ar/games", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return ok({ games: listArGames(q.status), stats: arStats() });
  });

  app.post("/api/ar/games", async (req, reply) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const name = String(body.name ?? "").trim();
    if (!name) return reply.code(400).send(fail(40002, "请填写游戏名称"));
    const points = (body.points as Array<Record<string, unknown>>) ?? [];
    if (!points.length) return reply.code(400).send(fail(40003, "请至少配置一个点位"));

    const gameId = createArGame({
      name,
      template_id: String(body.template_id ?? "culture"),
      intro: body.intro ? String(body.intro) : undefined,
      outro: body.outro ? String(body.outro) : undefined,
      theme: (body.theme as Record<string, string>) ?? undefined,
      cover: body.cover ? String(body.cover) : undefined,
      start_date: body.start_date ? String(body.start_date) : undefined,
      end_date: body.end_date ? String(body.end_date) : undefined,
      completion_badge: body.completion_badge ? String(body.completion_badge) : undefined,
      ai_mode: body.ai_mode ? String(body.ai_mode) : "mock",
      points,
    });
    if (body.publish === true) setArGameStatus(gameId, "active");
    return ok(getArGame(gameId));
  });

  app.get("/api/ar/games/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const game = getArGame(id);
    if (!game) return reply.code(404).send(fail(40402, "游戏不存在"));
    return ok(game);
  });

  app.put("/api/ar/games/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getArGame(id)) return reply.code(404).send(fail(40402, "游戏不存在"));
    const body = (req.body || {}) as Record<string, unknown>;
    updateArGame(id, {
      name: body.name ? String(body.name) : undefined,
      intro: body.intro !== undefined ? String(body.intro) : undefined,
      outro: body.outro !== undefined ? String(body.outro) : undefined,
      cover: body.cover ? String(body.cover) : undefined,
      start_date: body.start_date !== undefined ? String(body.start_date) : undefined,
      end_date: body.end_date !== undefined ? String(body.end_date) : undefined,
      completion_badge: body.completion_badge !== undefined ? String(body.completion_badge) : undefined,
      theme_json: body.theme ? JSON.stringify(body.theme) : undefined,
    });
    if (Array.isArray(body.points)) replaceArPoints(id, body.points as Array<Record<string, unknown>>);
    return ok(getArGame(id));
  });

  app.post("/api/ar/games/:id/publish", async (req, reply) => {
    const { id } = req.params as { id: string };
    const game = getArGame(id);
    if (!game) return reply.code(404).send(fail(40402, "游戏不存在"));
    if (!game.points.length) return reply.code(400).send(fail(40004, "请先配置点位再发布"));
    setArGameStatus(id, "active");
    const latest = getArGame(id);
    return ok({ id, status: latest?.status ?? "active", play_url: latest?.play_url, qr_text: latest?.qr_text });
  });

  app.post("/api/ar/games/:id/pause", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getArGame(id)) return reply.code(404).send(fail(40402, "游戏不存在"));
    setArGameStatus(id, "paused");
    return ok({ id, status: "paused" });
  });

  app.delete("/api/ar/games/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getArGame(id)) return reply.code(404).send(fail(40402, "游戏不存在"));
    deleteArGame(id);
    return ok({ id, deleted: true });
  });

  /* ---------- 运营端：AI 生成剧情 ---------- */

  app.post("/api/ar/ai/generate", async (req, reply) => {
    if (!guardLlmRoute(req, reply)) return;
    const body = (req.body || {}) as {
      template_id?: string;
      theme_name?: string;
      difficulty?: string;
      poi_ids?: string[];
      point_count?: number;
    };
    const pointCount = Math.min(Math.max(Math.round(Number(body.point_count) || 4), 1), 8);
    const story = await generateStory({
      templateId: String(body.template_id ?? "culture"),
      themeName: body.theme_name,
      difficulty: body.difficulty,
      poiIds: Array.isArray(body.poi_ids) ? body.poi_ids.map(String) : [],
      pointCount,
    });
    return ok({ ...story, demo: true });
  });

  /* ---------- 玩家端 ---------- */

  async function playConfig(req: FastifyRequest, reply: FastifyReply) {
    const { gameId } = req.params as { gameId: string };
    const config = toPlayConfig(gameId);
    if (!config) return reply.code(404).send(fail(40402, "游戏不存在"));
    if (config.status === "draft") return reply.code(403).send(fail(40301, "该游戏尚未发布"));
    return ok({ ...config, demo: true });
  }

  app.get("/api/ar/play/:gameId", playConfig);
  app.get("/api/ar/games/:id/play", async (req, reply) => {
    const { id } = req.params as { id: string };
    (req.params as Record<string, string>).gameId = id;
    return playConfig(req, reply);
  });

  app.post("/api/ar/play/:gameId/checkin", async (req, reply) => {
    const { gameId } = req.params as { gameId: string };
    const game = getArGame(gameId);
    if (!game) return reply.code(404).send(fail(40402, "游戏不存在"));
    const body = (req.body || {}) as Record<string, unknown>;
    const poiId = String(body.poi_id ?? "");
    const point = game.points.find((p) => p.poi_id === poiId);
    if (!point) return reply.code(404).send(fail(40403, "点位不存在"));
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return reply.code(400).send(fail(40005, "缺少定位坐标"));
    }
    const fence = checkFence(lat, lng, point, point.geofence_radius_m);
    const { key, name } = playerOf(req);
    const recordId = ensureArRecord(gameId, key, name, game.points.length);
    recordArCheckin(recordId, gameId, poiId, fence.distance_m, "enter");
    return ok({
      poi_id: poiId,
      poi_name: point.poi_name,
      ...fence,
      can_play: fence.inside,
      tip: fence.inside
        ? `已进入「${point.poi_name}」围栏，虚拟物出现`
        : `再走近 ${Math.max(0, fence.gap_m)} 米即可解锁（演示态可一键模拟到位）`,
    });
  });

  app.post("/api/ar/play/:gameId/submit", async (req, reply) => {
    const { gameId } = req.params as { gameId: string };
    const game = getArGame(gameId);
    if (!game) return reply.code(404).send(fail(40402, "游戏不存在"));
    const body = (req.body || {}) as Record<string, unknown>;
    const poiId = String(body.poi_id ?? "");
    const point = game.points.find((p) => p.poi_id === poiId);
    if (!point) return reply.code(404).send(fail(40403, "点位不存在"));
    const answer = String(body.answer ?? "").trim();
    if (!answer) return reply.code(400).send(fail(40006, "请输入答案"));

    const correct = judgeAnswer(answer, point.answer);
    const { key, name } = playerOf(req);
    const recordId = ensureArRecord(gameId, key, name, game.points.length);
    recordArCheckin(recordId, gameId, poiId, Number(body.distance_m ?? 0), "submit");

    let progress = getArRecord(gameId, key);
    if (correct) progress = { ...(progress ?? { solved: [], claimed: [], points_done: 0, total_points: game.points.length, completed: false, score: 0 }), ...recordArSubmit(gameId, key, poiId, true) };

    const coupon = getArCoupon(point.reward_coupon_id);
    return ok({
      poi_id: poiId,
      correct,
      expected: correct ? point.answer : undefined,
      explanation: correct ? point.explanation : undefined,
      hint: correct ? undefined : point.hint,
      reward: {
        coupon_id: point.reward_coupon_id,
        name: point.reward_name,
        type: point.reward_type,
        claimable: correct && Boolean(point.reward_coupon_id),
      },
      progress,
      coupon_image: correct && coupon ? `/assets/ar/${coupon.image}` : null,
      demo: true,
    });
  });

  app.post("/api/ar/play/:gameId/claim", async (req, reply) => {
    const { gameId } = req.params as { gameId: string };
    const game = getArGame(gameId);
    if (!game) return reply.code(404).send(fail(40402, "游戏不存在"));
    const body = (req.body || {}) as Record<string, unknown>;
    const couponId = String(body.coupon_id ?? "");
    const coupon = getArCoupon(couponId);
    if (!coupon) return reply.code(404).send(fail(40404, "券不存在"));
    const { key, name } = playerOf(req);
    const recordId = ensureArRecord(gameId, key, name, game.points.length);
    recordArCheckin(recordId, gameId, coupon.poi_id, Number(body.distance_m ?? 0), "claim");
    const claimed = recordArClaim(gameId, key, couponId);
    return ok({
      is_demo: true,
      demo_label: "演示模拟 · DEMO",
      voucher_no: `YJZY-AR-${String(Date.now()).slice(-8)}`,
      coupon,
      coupon_image: `/assets/ar/${coupon.image}`,
      qr_text: `永嘉新游 AR 互动演示券 · ${coupon.name} · ${game.name}`,
      claimed,
      progress: getArRecord(gameId, key),
      notice: "本券为大赛演示数据，不构成真实优惠，核销流程为模拟。",
    });
  });

  app.get("/api/ar/play/:gameId/records", async (req) => {
    const { gameId } = req.params as { gameId: string };
    return ok({ ...arPlayRecords(gameId), demo: true });
  });

  app.get("/api/ar/play/:gameId/me", async (req) => {
    const { gameId } = req.params as { gameId: string };
    const q = req.query as Record<string, string | undefined>;
    return ok({ progress: getArRecord(gameId, String(q.playerKey ?? q.sessionId ?? DEFAULT_PLAYER)) });
  });
}
