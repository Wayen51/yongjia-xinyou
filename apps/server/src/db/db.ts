import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { config } from "../lib/config.ts";
import type {
  KnowledgeItem,
  VideoFlowLog,
  VideoOutput,
  VideoProjectDetail,
  VideoProjectMeta,
  VideoProjectStatus,
  VideoSettings,
  VideoShot,
  VideoStats,
} from "@zhiyou/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: DatabaseSync;

function loadJson<T>(name: string): T {
  const p = path.join(config.seedDir, name);
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

export function getDb() {
  return db;
}

export function initDb() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const dbPath = path.join(config.dataDir, "zhiyou.db");
  db = new DatabaseSync(dbPath);
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  db.exec(schema);

  seedKnowledgeIfEmpty();
  backfillKnowledgeNumbers();
  seedArIfEmpty();
  seedScenesIfEmpty();
}

/**
 * 知识库数值字段回填（缺口 B-04）
 *
 * seed 里的 avg_cost_cny / avg_duration_min 由 scripts/normalize-knowledge.mjs 从
 * ticket / duration / price_range 字符串归一化而来。老库（已 seed 过、这两列为 NULL）
 * 不会自动更新 —— 这里幂等地把 NULL 补上，避免为了一个数据订正必须删库重建。
 * 只填 NULL，绝不覆盖任何已有值，可反复执行。
 */
function backfillKnowledgeNumbers() {
  const seed = loadJson<{ items: Record<string, unknown>[] }>("knowledge_seed_v3.json");
  const setCost = db.prepare(
    "UPDATE knowledge_items SET avg_cost_cny = ? WHERE id = ? AND avg_cost_cny IS NULL",
  );
  const setDuration = db.prepare(
    "UPDATE knowledge_items SET avg_duration_min = ? WHERE id = ? AND avg_duration_min IS NULL",
  );
  db.exec("BEGIN");
  try {
    for (const item of seed.items) {
      const id = String(item.id);
      if (item.avg_cost_cny != null) setCost.run(Number(item.avg_cost_cny), id);
      if (item.avg_duration_min != null) setDuration.run(Number(item.avg_duration_min), id);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function seedKnowledgeIfEmpty() {
  const count = db.prepare("SELECT COUNT(*) AS c FROM knowledge_items").get() as { c: number };
  if (count.c > 0) return;

  const seed = loadJson<{ items: Record<string, unknown>[] }>("knowledge_seed_v3.json");
  const insert = db.prepare(`
    INSERT INTO knowledge_items (
      id, domain, name, category, summary, content, tags, indoor, suitable_for,
      avg_cost_cny, avg_duration_min, geo_lat, geo_lng, assets, source, source_url, rating
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec("BEGIN");
  for (const item of seed.items) {
    if (!item.source) continue;
    const indoor = item.indoor === true || item.indoor === 1 ? 1 : 0;
    insert.run(
      String(item.id),
      String(item.domain),
      String(item.name),
      item.category ? String(item.category) : null,
      String(item.summary ?? ""),
      String(item.content ?? item.summary ?? ""),
      JSON.stringify(item.tags ?? []),
      indoor,
      JSON.stringify(item.suitable_for ?? []),
      item.avg_cost_cny == null ? null : Number(item.avg_cost_cny),
      item.avg_duration_min == null ? null : Number(item.avg_duration_min),
      item.geo_lat == null ? null : Number(item.geo_lat),
      item.geo_lng == null ? null : Number(item.geo_lng),
      JSON.stringify(item.assets ?? {}),
      String(item.source),
      item.source_url ? String(item.source_url) : null,
      item.rating == null ? 4.5 : Number(item.rating),
    );
  }
  db.exec("COMMIT");
}

function rowToItem(row: Record<string, unknown>): KnowledgeItem {
  return {
    id: String(row.id),
    domain: row.domain as KnowledgeItem["domain"],
    name: String(row.name),
    category: row.category ? String(row.category) : null,
    summary: String(row.summary),
    content: String(row.content),
    tags: JSON.parse(String(row.tags || "[]")),
    indoor: Number(row.indoor) === 1,
    suitable_for: JSON.parse(String(row.suitable_for || "[]")),
    avg_cost_cny: row.avg_cost_cny == null ? null : Number(row.avg_cost_cny),
    avg_duration_min: row.avg_duration_min == null ? null : Number(row.avg_duration_min),
    geo_lat: row.geo_lat == null ? null : Number(row.geo_lat),
    geo_lng: row.geo_lng == null ? null : Number(row.geo_lng),
    assets: JSON.parse(String(row.assets || "{}")),
    source: String(row.source ?? ""),
    source_url: row.source_url ? String(row.source_url) : undefined,
    rating: Number(row.rating ?? 4.5),
  };
}

export function searchKnowledge(opts: {
  q?: string;
  domain?: string;
  tag?: string;
  indoor?: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(Number(opts.limit || 20), 1), 100);
  let sql = "SELECT * FROM knowledge_items WHERE 1=1";
  const params: Array<string | number | null> = [];
  if (opts.domain) {
    sql += " AND domain = ?";
    params.push(opts.domain);
  }
  if (opts.indoor === "1" || opts.indoor === "true") {
    sql += " AND indoor = 1";
  }
  if (opts.q) {
    sql += " AND (name LIKE ? OR summary LIKE ? OR content LIKE ? OR tags LIKE ?)";
    const like = `%${opts.q}%`;
    params.push(like, like, like, like);
  }
  if (opts.tag) {
    sql += " AND tags LIKE ?";
    params.push(`%${opts.tag}%`);
  }
  sql += " ORDER BY rating DESC LIMIT ?";
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  const totalRow = db.prepare("SELECT COUNT(*) AS c FROM knowledge_items").get() as { c: number };
  return { total: Number(totalRow.c), items: rows.map(rowToItem) };
}

/**
 * 全量取回知识库条目（不走 SQL 模糊匹配）。
 * 条目仅百余条，把候选集整体取回内存做打分检索，召回率远高于逐词 LIKE。
 */
export function listAllKnowledge(): KnowledgeItem[] {
  const rows = db.prepare("SELECT * FROM knowledge_items").all() as Record<string, unknown>[];
  return rows.map(rowToItem);
}

export function getKnowledge(id: string) {
  const row = db.prepare("SELECT * FROM knowledge_items WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToItem(row) : null;
}

export function relatedByDomain(domain: string, excludeId: string, limit = 4) {
  const rows = db
    .prepare("SELECT * FROM knowledge_items WHERE domain = ? AND id != ? ORDER BY rating DESC LIMIT ?")
    .all(domain, excludeId, limit) as Record<string, unknown>[];
  return rows.map(rowToItem);
}

export function upsertSession(id: string) {
  db.prepare("INSERT OR IGNORE INTO chat_sessions (id, history, mock_weather) VALUES (?, '[]', NULL)").run(id);
}

export function setSessionWeather(id: string, mock: string | null) {
  upsertSession(id);
  db.prepare("UPDATE chat_sessions SET mock_weather = ? WHERE id = ?").run(mock, id);
}

export function getSessionWeather(id: string): string | null {
  const row = db.prepare("SELECT mock_weather FROM chat_sessions WHERE id = ?").get(id) as { mock_weather: string | null } | undefined;
  return row?.mock_weather ?? null;
}

export function saveItinerary(id: string, sessionId: string, payload: unknown, version = 1) {
  db.prepare(
    "INSERT OR REPLACE INTO itineraries (id, session_id, version, payload) VALUES (?, ?, ?, ?)",
  ).run(id, sessionId, version, JSON.stringify(payload));
}

export function getItinerary(id: string) {
  const row = db.prepare("SELECT * FROM itineraries WHERE id = ?").get(id) as { payload: string; version: number } | undefined;
  return row ? { ...JSON.parse(row.payload), version: row.version } : null;
}

/**
 * 取某会话**最近一次**落库的方案（P2-2 暴雨重规划要用它算 diff）。
 *
 * 注意排序依据：`created_at` 由 `datetime('now')` 生成，只到**秒级**——
 * 同一秒内连落两条会并列，故追加 `rowid DESC` 兜底（INSERT OR REPLACE 会拿新 rowid），
 * 保证「最后写入的那条」稳定胜出，而不是随机取一条。
 */
export function getLatestItinerary(sessionId: string) {
  const row = db
    .prepare("SELECT * FROM itineraries WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(sessionId) as { payload: string; version: number } | undefined;
  return row ? { ...JSON.parse(row.payload), version: row.version } : null;
}

/* ================= 板块一：视频生成项目 ================= */

type VideoRow = Record<string, unknown>;

function jsonParse<T>(s: unknown, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(String(s)) as T;
  } catch {
    return fallback;
  }
}

const nowIso = () => new Date().toISOString();

function rowToVideoMeta(row: VideoRow): VideoProjectMeta {
  return {
    id: String(row.id),
    title: String(row.title),
    user_prompt: String(row.user_prompt ?? ""),
    style: String(row.style),
    shot_count: Number(row.shot_count ?? 3),
    status: String(row.status ?? "scripting") as VideoProjectStatus,
    progress_pct: Number(row.progress_pct ?? 0),
    stage_label: String(row.stage_label ?? ""),
    created_at: String(row.created_at ?? ""),
  };
}

function rowToVideoDetail(row: VideoRow): VideoProjectDetail {
  const script = jsonParse<{ shots?: VideoShot[] }>(row.script_json, { shots: [] });
  const shots = script.shots ?? [];
  const flow_log = jsonParse<VideoFlowLog[]>(row.flow_log, []);
  const settings = jsonParse<VideoSettings | null>(row.settings_json, null);
  const output = row.output_json ? jsonParse<VideoOutput | null>(row.output_json, null) ?? undefined : undefined;
  return {
    ...rowToVideoMeta(row),
    enriched_prompt: String(row.enriched_prompt ?? ""),
    negative_prompt: String(row.negative_prompt ?? ""),
    settings:
      settings ??
      ({
        resolution: "1920x1080",
        fps: 24,
        aspect: "16:9",
        total_duration_sec: shots.reduce((s, x) => s + (x.duration_sec ?? 0), 0),
      } as VideoSettings),
    shots,
    flow_log,
    output,
  };
}

export function createVideoProject(init: {
  id: string;
  title: string;
  user_prompt: string;
  style: string;
  shot_count: number;
}) {
  const t = nowIso();
  db.prepare(
    `INSERT INTO video_projects (id, title, user_prompt, style, shot_count, status, progress_pct, stage_label, script_json, flow_log, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'scripting', 0, '解析并增强提示词', '{"shots":[]}', '[]', ?, ?)`,
  ).run(init.id, init.title, init.user_prompt, init.style, init.shot_count, t, t);
}

export function getVideoProject(id: string): VideoProjectDetail | null {
  const row = db.prepare("SELECT * FROM video_projects WHERE id = ?").get(id) as VideoRow | undefined;
  return row ? rowToVideoDetail(row) : null;
}

export function listVideoProjects(status?: string): VideoProjectMeta[] {
  const rows = status
    ? (db.prepare("SELECT * FROM video_projects WHERE status = ? ORDER BY created_at DESC").all(status) as VideoRow[])
    : (db.prepare("SELECT * FROM video_projects ORDER BY created_at DESC").all() as VideoRow[]);
  return rows.map(rowToVideoMeta);
}

export function updateVideoProject(
  id: string,
  patch: {
    status?: VideoProjectStatus;
    progress_pct?: number;
    stage_label?: string;
    enriched_prompt?: string;
    negative_prompt?: string;
    settings_json?: string;
    script_json?: string;
    flow_log?: string;
    output_json?: string;
  },
) {
  const fields: string[] = [];
  const vals: Array<string | number | null> = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) {
      fields.push(`${k} = ?`);
      vals.push(v);
    }
  }
  if (!fields.length) return;
  vals.push(nowIso(), id);
  db.prepare(`UPDATE video_projects SET ${fields.join(", ")}, updated_at = ? WHERE id = ?`).run(...vals);
}

export function deleteVideoProject(id: string) {
  db.prepare("DELETE FROM video_projects WHERE id = ?").run(id);
}

export function videoStats(): VideoStats {
  const counts = db.prepare("SELECT status, COUNT(*) AS c FROM video_projects GROUP BY status").all() as Array<{
    status: string;
    c: number;
  }>;
  const total = counts.reduce((s, r) => s + Number(r.c), 0);
  const done = counts.find((r) => r.status === "done")?.c ?? 0;
  const generating = counts.find((r) => r.status === "generating" || r.status === "stitching" || r.status === "scripting")?.c ?? 0;
  const rows = db.prepare("SELECT style, shot_count FROM video_projects").all() as Array<{
    style: string;
    shot_count: number;
  }>;
  const byStyle = new Map<string, number>();
  let total_duration_sec = 0;
  let shotSum = 0;
  for (const r of rows) {
    byStyle.set(String(r.style), (byStyle.get(String(r.style)) ?? 0) + 1);
    shotSum += Number(r.shot_count);
  }
  const doneRows = db.prepare("SELECT shot_count FROM video_projects WHERE status = 'done'").all() as Array<{
    shot_count: number;
  }>;
  total_duration_sec = doneRows.reduce((s, r) => s + Number(r.shot_count) * 8, 0);
  return {
    total,
    done,
    generating,
    total_duration_sec,
    avg_shots: total ? Math.round((shotSum / total) * 10) / 10 : 0,
    by_style: Array.from(byStyle.entries()).map(([style, count]) => ({ style, count })),
  };
}

/* ================= 板块二：AR 互动游戏 ================= */

export interface ArPoi {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: string;
  radius: number;
}

export interface ArCoupon {
  id: string;
  name: string;
  type: string;
  value: number;
  value_label: string;
  poi_id: string;
  business_id: string;
  image: string;
  valid_days: number;
  desc: string;
}

export interface ArTemplateStation {
  poi_id: string;
  name: string;
  task: string;
  question: string;
  answer: string;
  hint: string;
  reward: { type: string; name: string; value: number };
}

export interface ArTemplate {
  id: string;
  name: string;
  subtitle: string;
  festival: string;
  color: Record<string, string>;
  intro: string;
  outro: string;
  stations: ArTemplateStation[];
}

export interface ArGamePoint {
  order_index: number;
  poi_id: string;
  poi_name: string;
  poi_type: string;
  lat: number;
  lng: number;
  geofence_radius_m: number;
  billboard: string;
  billboard_url: string;
  task_type: string;
  npc: string;
  question: string;
  answer: string;
  hint: string;
  explanation: string;
  reward_coupon_id: string | null;
  reward_name: string;
  reward_type: string;
  coupon_image: string | null;
}

export interface ArGameDetail {
  id: string;
  name: string;
  template_id: string;
  status: string;
  intro: string;
  outro: string;
  theme: Record<string, string>;
  cover: string;
  start_date: string;
  end_date: string;
  total_rewards: number;
  completion_badge: string;
  qr_text: string;
  ai_mode: string;
  created_at: string;
  updated_at: string;
  points: ArGamePoint[];
  play_url: string;
  participants: number;
  completion_rate: number;
}

export interface ArGameMeta {
  id: string;
  name: string;
  template_id: string;
  status: string;
  cover: string;
  theme: Record<string, string>;
  point_count: number;
  total_rewards: number;
  start_date: string;
  end_date: string;
  created_at: string;
  participants: number;
  completion_rate: number;
}

let arCache: { pois: ArPoi[]; coupons: ArCoupon[]; templates: ArTemplate[] } | null = null;

function arData() {
  if (!arCache) {
    const poiFile = loadJson<{ points: ArPoi[] }>("ar_points_seed.json");
    const couponFile = loadJson<{ coupons: ArCoupon[] }>("ar_coupons_seed.json");
    const tplFile = loadJson<{ templates: ArTemplate[] }>("ar_templates.json");
    arCache = { pois: poiFile.points, coupons: couponFile.coupons, templates: tplFile.templates };
  }
  return arCache;
}

export function listArPois(): ArPoi[] {
  return arData().pois;
}
export function getArPoi(id: string): ArPoi | null {
  return arData().pois.find((p) => p.id === id) ?? null;
}
export function listArCoupons(): ArCoupon[] {
  return arData().coupons;
}
export function getArCoupon(id: string | null | undefined): ArCoupon | null {
  if (!id) return null;
  return arData().coupons.find((c) => c.id === id) ?? null;
}
export function listArTemplates(): ArTemplate[] {
  return arData().templates;
}
export function getArTemplate(id: string | null | undefined): ArTemplate | null {
  if (!id) return null;
  return arData().templates.find((t) => t.id === id) ?? null;
}

const billboardUrl = (file: string) => (file ? `/assets/ar/billboard/${file}` : "");
const couponImageUrl = (file: string | null | undefined) => (file ? `/assets/ar/${file}` : null);

function seedArIfEmpty() {
  const count = db.prepare("SELECT COUNT(*) AS c FROM ar_games").get() as { c: number };
  if (count.c > 0) return;

  const { templates } = arData();
  const games = loadJson<{ games: Array<Record<string, unknown>> }>("ar_games_seed.json");
  const play = loadJson<{ records: Array<Record<string, unknown>> }>("ar_play_seed.json");

  const insertGame = db.prepare(
    `INSERT INTO ar_games (id, name, template_id, status, intro, outro, theme_json, cover, start_date, end_date,
      total_rewards, completion_badge, qr_text, ai_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertPoint = db.prepare(
    `INSERT INTO ar_points (game_id, poi_id, order_index, billboard, task_type, npc, question, answer, hint, explanation,
      reward_coupon_id, reward_name, reward_type, geofence_radius_m)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  db.exec("BEGIN");
  for (const g of games.games) {
    const tpl = templates.find((t) => t.id === String(g.template_id));
    const created = String(g.created_at ?? nowIso().slice(0, 10));
    insertGame.run(
      String(g.id),
      String(g.name),
      String(g.template_id),
      String(g.status ?? "draft"),
      tpl?.intro ?? "",
      tpl?.outro ?? "",
      JSON.stringify(tpl?.color ?? {}),
      `/assets/ar/theme/${g.template_id}/card.webp`,
      String(g.start_date ?? ""),
      String(g.end_date ?? ""),
      Number(g.total_rewards ?? 0),
      String(g.completion_badge ?? ""),
      `永嘉新游 AR 互动 · ${String(g.name)} · 玩家入口 /play/${String(g.id)}`,
      String(g.ai_mode ?? "mock"),
      created,
      nowIso(),
    );
    for (const p of (g.points as Array<Record<string, unknown>>) ?? []) {
      const poi = getArPoi(String(p.poi_id));
      const coupon = getArCoupon(p.reward_coupon_id ? String(p.reward_coupon_id) : null);
      insertPoint.run(
        String(g.id),
        String(p.poi_id),
        Number(p.order ?? 1),
        String(p.billboard ?? ""),
        String(p.task_type ?? "quiz"),
        String(p.npc ?? "楠楠"),
        String(p.question ?? ""),
        String(p.answer ?? ""),
        String(p.hint ?? ""),
        String(p.explanation ?? ""),
        p.reward_coupon_id ? String(p.reward_coupon_id) : null,
        coupon?.name ?? "",
        coupon?.type ?? "coupon",
        Number(poi?.radius ?? 50),
      );
    }
  }

  const insertRecord = db.prepare(
    `INSERT OR IGNORE INTO ar_play_records (id, game_id, user_name, points_done, total_points, completed,
      duration_min, rewards_claimed, score, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of play.records) {
    insertRecord.run(
      String(r.id),
      String(r.game_id),
      String(r.user_name ?? "游客"),
      Number(r.points_done ?? 0),
      Number(r.total_points ?? 0),
      r.completed ? 1 : 0,
      Number(r.duration_min ?? 0),
      Number(r.rewards_claimed ?? 0),
      Number(r.score ?? 0),
      String(r.date ?? nowIso().slice(0, 10)),
      nowIso(),
    );
  }
  db.exec("COMMIT");
}

function gameStats(gameId: string) {
  const row = db
    .prepare("SELECT COUNT(*) AS c, SUM(completed) AS done FROM ar_play_records WHERE game_id = ?")
    .get(gameId) as { c: number; done: number | null };
  const participants = Number(row.c ?? 0);
  const completed = Number(row.done ?? 0);
  return {
    participants,
    completion_rate: participants ? Math.round((completed / participants) * 100) : 0,
  };
}

function rowToPoint(row: Record<string, unknown>): ArGamePoint {
  const poi = getArPoi(String(row.poi_id));
  const coupon = getArCoupon(row.reward_coupon_id ? String(row.reward_coupon_id) : null);
  return {
    order_index: Number(row.order_index ?? 1),
    poi_id: String(row.poi_id),
    poi_name: poi?.name ?? String(row.poi_id),
    poi_type: poi?.type ?? "scenic",
    lat: Number(poi?.lat ?? 0),
    lng: Number(poi?.lng ?? 0),
    geofence_radius_m: Number(row.geofence_radius_m ?? poi?.radius ?? 50),
    billboard: String(row.billboard ?? ""),
    billboard_url: billboardUrl(String(row.billboard ?? "")),
    task_type: String(row.task_type ?? "quiz"),
    npc: String(row.npc ?? ""),
    question: String(row.question ?? ""),
    answer: String(row.answer ?? ""),
    hint: String(row.hint ?? ""),
    explanation: String(row.explanation ?? ""),
    reward_coupon_id: row.reward_coupon_id ? String(row.reward_coupon_id) : null,
    reward_name: String(row.reward_name ?? coupon?.name ?? ""),
    reward_type: String(row.reward_type ?? coupon?.type ?? "coupon"),
    coupon_image: couponImageUrl(coupon?.image),
  };
}

function arPoints(gameId: string): ArGamePoint[] {
  const rows = db
    .prepare("SELECT * FROM ar_points WHERE game_id = ? ORDER BY order_index ASC")
    .all(gameId) as Record<string, unknown>[];
  return rows.map(rowToPoint);
}

function rowToArGame(row: Record<string, unknown>, withPoints: boolean): ArGameDetail {
  const id = String(row.id);
  const stats = gameStats(id);
  const points = withPoints ? arPoints(id) : [];
  const pointCount = withPoints ? points.length : Number(row_point_count(row));
  return {
    id,
    name: String(row.name),
    template_id: String(row.template_id ?? "culture"),
    status: String(row.status ?? "draft"),
    intro: String(row.intro ?? ""),
    outro: String(row.outro ?? ""),
    theme: jsonParse<Record<string, string>>(row.theme_json, {}),
    cover: String(row.cover ?? ""),
    start_date: String(row.start_date ?? ""),
    end_date: String(row.end_date ?? ""),
    total_rewards: Number(row.total_rewards ?? pointCount ?? 0),
    completion_badge: String(row.completion_badge ?? ""),
    qr_text: String(row.qr_text ?? ""),
    ai_mode: String(row.ai_mode ?? "mock"),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
    points,
    play_url: `/play/${id}`,
    participants: stats.participants,
    completion_rate: stats.completion_rate,
  };
}

function row_point_count(row: Record<string, unknown>) {
  const r = db
    .prepare("SELECT COUNT(*) AS c FROM ar_points WHERE game_id = ?")
    .get(String(row.id)) as { c: number };
  return Number(r.c ?? 0);
}

export function listArGames(status?: string): ArGameMeta[] {
  const rows = (
    status
      ? db.prepare("SELECT * FROM ar_games WHERE status = ? ORDER BY created_at DESC").all(status)
      : db.prepare("SELECT * FROM ar_games ORDER BY created_at DESC").all()
  ) as Record<string, unknown>[];
  return rows.map((row) => {
    const g = rowToArGame(row, false);
    return {
      id: g.id,
      name: g.name,
      template_id: g.template_id,
      status: g.status,
      cover: g.cover,
      theme: g.theme,
      point_count: g.total_rewards,
      total_rewards: g.total_rewards,
      start_date: g.start_date,
      end_date: g.end_date,
      created_at: g.created_at,
      participants: g.participants,
      completion_rate: g.completion_rate,
    };
  });
}

export function getArGame(id: string): ArGameDetail | null {
  const row = db.prepare("SELECT * FROM ar_games WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToArGame(row, true) : null;
}

export function createArGame(init: {
  id?: string;
  name: string;
  template_id: string;
  intro?: string;
  outro?: string;
  theme?: Record<string, string>;
  cover?: string;
  start_date?: string;
  end_date?: string;
  completion_badge?: string;
  ai_mode?: string;
  points?: Array<Record<string, unknown>>;
}) {
  const id = init.id || `AR-${randomUUID().slice(0, 8).toUpperCase()}`;
  const t = nowIso();
  const theme = init.theme ?? getArTemplate(init.template_id)?.color ?? {};
  db.prepare(
    `INSERT INTO ar_games (id, name, template_id, status, intro, outro, theme_json, cover, start_date, end_date,
      total_rewards, completion_badge, qr_text, ai_mode, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    init.name,
    init.template_id,
    init.intro ?? getArTemplate(init.template_id)?.intro ?? "",
    init.outro ?? getArTemplate(init.template_id)?.outro ?? "",
    JSON.stringify(theme),
    init.cover || `/assets/ar/theme/${init.template_id}/card.webp`,
    init.start_date ?? "",
    init.end_date ?? "",
    init.points?.length ?? 0,
    init.completion_badge ?? "",
    "",
    init.ai_mode ?? "mock",
    t,
    t,
  );
  if (init.points?.length) replaceArPoints(id, init.points);
  return id;
}

export function replaceArPoints(gameId: string, points: Array<Record<string, unknown>>) {
  db.prepare("DELETE FROM ar_points WHERE game_id = ?").run(gameId);
  const insert = db.prepare(
    `INSERT INTO ar_points (game_id, poi_id, order_index, billboard, task_type, npc, question, answer, hint, explanation,
      reward_coupon_id, reward_name, reward_type, geofence_radius_m)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.exec("BEGIN");
  points.forEach((p, i) => {
    const poi = getArPoi(String(p.poi_id));
    const coupon = getArCoupon(p.reward_coupon_id ? String(p.reward_coupon_id) : null);
    insert.run(
      gameId,
      String(p.poi_id),
      Number(p.order ?? i + 1),
      String(p.billboard ?? "billboard-lantern.webp"),
      String(p.task_type ?? "quiz"),
      String(p.npc ?? "楠楠"),
      String(p.question ?? ""),
      String(p.answer ?? ""),
      String(p.hint ?? ""),
      String(p.explanation ?? ""),
      p.reward_coupon_id ? String(p.reward_coupon_id) : null,
      coupon?.name ?? String(p.reward_name ?? ""),
      coupon?.type ?? "coupon",
      Number(p.geofence_radius_m ?? poi?.radius ?? 50),
    );
  });
  db.prepare("UPDATE ar_games SET total_rewards = ?, updated_at = ? WHERE id = ?").run(points.length, nowIso(), gameId);
  db.exec("COMMIT");
}

export function updateArGame(
  id: string,
  patch: {
    name?: string;
    intro?: string;
    outro?: string;
    theme_json?: string;
    cover?: string;
    start_date?: string;
    end_date?: string;
    completion_badge?: string;
    ai_mode?: string;
  },
) {
  const fields: string[] = [];
  const vals: Array<string | number | null> = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) {
      fields.push(`${k} = ?`);
      vals.push(v);
    }
  }
  if (!fields.length) return;
  vals.push(nowIso(), id);
  db.prepare(`UPDATE ar_games SET ${fields.join(", ")}, updated_at = ? WHERE id = ?`).run(...vals);
}

export function setArGameStatus(id: string, status: string) {
  db.prepare("UPDATE ar_games SET status = ?, qr_text = ?, updated_at = ? WHERE id = ?").run(
    status,
    `永嘉新游 AR 互动 · 玩家入口 /play/${id}`,
    nowIso(),
    id,
  );
}

export function deleteArGame(id: string) {
  db.prepare("DELETE FROM ar_points WHERE game_id = ?").run(id);
  db.prepare("DELETE FROM ar_games WHERE id = ?").run(id);
}

/* ---- 玩家记录 ---- */

function recordId(gameId: string, playerKey: string) {
  return `${gameId}:${playerKey}`;
}

export function ensureArRecord(gameId: string, playerKey: string, userName: string, totalPoints: number) {
  const id = recordId(gameId, playerKey);
  db.prepare(
    `INSERT OR IGNORE INTO ar_play_records (id, game_id, user_name, total_points, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, gameId, userName, totalPoints, nowIso());
  db.prepare("UPDATE ar_play_records SET total_points = ?, updated_at = ? WHERE id = ?").run(totalPoints, nowIso(), id);
  return id;
}

export function recordArCheckin(recordIdValue: string, gameId: string, poiId: string, distanceM: number, action: string) {
  db.prepare(
    `INSERT INTO ar_checkins (record_id, game_id, poi_id, action, distance_m) VALUES (?, ?, ?, ?, ?)`,
  ).run(recordIdValue, gameId, poiId, action, distanceM);
}

export function recordArSubmit(gameId: string, playerKey: string, poiId: string, correct: boolean) {
  const id = recordId(gameId, playerKey);
  const row = db.prepare("SELECT * FROM ar_play_records WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  const solved = jsonParse<string[]>(row?.solved_json, []);
  const total = Number(row?.total_points ?? 0);
  if (correct && !solved.includes(poiId)) solved.push(poiId);
  const pointsDone = solved.length;
  const completed = total > 0 && pointsDone >= total;
  const score = total ? Math.min(100, Math.round((pointsDone / total) * 80) + (completed ? 20 : 0)) : 0;
  db.prepare(
    `UPDATE ar_play_records SET solved_json = ?, points_done = ?, completed = ?, score = ?, updated_at = ? WHERE id = ?`,
  ).run(JSON.stringify(solved), pointsDone, completed ? 1 : 0, score, nowIso(), id);
  return { solved, points_done: pointsDone, total_points: total, completed, score };
}

export function recordArClaim(gameId: string, playerKey: string, couponId: string) {
  const id = recordId(gameId, playerKey);
  const row = db.prepare("SELECT * FROM ar_play_records WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  const claimed = jsonParse<string[]>(row?.claimed_json, []);
  if (!claimed.includes(couponId)) claimed.push(couponId);
  db.prepare(
    `UPDATE ar_play_records SET claimed_json = ?, rewards_claimed = ?, updated_at = ? WHERE id = ?`,
  ).run(JSON.stringify(claimed), claimed.length, nowIso(), id);
  return claimed;
}

export function getArRecord(gameId: string, playerKey: string) {
  const row = db
    .prepare("SELECT * FROM ar_play_records WHERE id = ?")
    .get(recordId(gameId, playerKey)) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    solved: jsonParse<string[]>(row.solved_json, []),
    claimed: jsonParse<string[]>(row.claimed_json, []),
    points_done: Number(row.points_done ?? 0),
    total_points: Number(row.total_points ?? 0),
    completed: Number(row.completed ?? 0) === 1,
    score: Number(row.score ?? 0),
  };
}

export function arPlayRecords(gameId: string) {
  const rows = db
    .prepare("SELECT * FROM ar_play_records WHERE game_id = ? ORDER BY score DESC, updated_at ASC")
    .all(gameId) as Record<string, unknown>[];
  const records = rows.map((r) => ({
    id: String(r.id),
    game_id: String(r.game_id),
    user_name: String(r.user_name ?? "游客"),
    points_done: Number(r.points_done ?? 0),
    total_points: Number(r.total_points ?? 0),
    completed: Number(r.completed ?? 0) === 1,
    duration_min: Number(r.duration_min ?? 0),
    rewards_claimed: Number(r.rewards_claimed ?? 0),
    score: Number(r.score ?? 0),
    date: String(r.updated_at ?? r.created_at ?? "").slice(0, 10),
  }));
  const completed = records.filter((r) => r.completed).length;
  return {
    records,
    leaderboard: records.slice(0, 8).map((r, i) => ({
      rank: i + 1,
      user_name: r.user_name,
      score: r.score,
      badge: r.completed ? "永嘉文化达人" : "-",
    })),
    summary: {
      participants: records.length,
      completed,
      completion_rate: records.length ? Math.round((completed / records.length) * 100) : 0,
      avg_score: records.length ? Math.round(records.reduce((s, r) => s + r.score, 0) / records.length) : 0,
      coupons_claimed: records.reduce((s, r) => s + r.rewards_claimed, 0),
    },
  };
}

export function arStats() {
  const games = listArGames();
  const active = games.filter((g) => g.status === "active");
  const participants = games.reduce((s, g) => s + g.participants, 0);
  const done = db.prepare("SELECT COUNT(*) AS c FROM ar_play_records WHERE completed = 1").get() as { c: number };
  const claimed = db.prepare("SELECT SUM(rewards_claimed) AS c FROM ar_play_records").get() as { c: number | null };
  return {
    total_games: games.length,
    active_games: active.length,
    draft_games: games.filter((g) => g.status === "draft").length,
    total_points: games.reduce((s, g) => s + g.point_count, 0),
    participants,
    completed: Number(done.c ?? 0),
    completion_rate: participants ? Math.round((Number(done.c ?? 0) / participants) * 100) : 0,
    coupons_claimed: Number(claimed.c ?? 0),
  };
}

/* =========================================================================
   3D 景点场景（scenes）
   —— 3D 云游 / 效果展示 / AR 寻宝 三处共用的场景底座。
   热点默认从 public 下的 hotspots_file 读取；管理端编辑后写 hotspots_json 覆盖。
   ========================================================================= */

export interface SceneHotspot {
  id: string;
  name: string;
  position: { yaw: number; pitch: number };
  icon?: string;
  title: string;
  content: string;
  source?: string;
  action?: { type: string; target: string };
}

export interface SceneRecord {
  id: string;
  name: string;
  poi_id: string;
  description: string;
  panorama: string;
  thumbnail: string;
  hotspots_file: string;
  hotspots: SceneHotspot[];
  /** file = 读自素材文件；custom = 已被管理端编辑覆盖 */
  hotspots_source: "file" | "custom";
  model_3d: string;
  ar_lat: number | null;
  ar_lng: number | null;
  ar_radius_m: number;
  default_yaw: number;
  default_pitch: number;
  default_fov: number;
  tags: string[];
  theme_color: string;
  enabled: boolean;
  sort_order: number;
  /** 对外访问量 = visit_baseline（演示基线）+ 真实埋点计数（scene_views） */
  visit_count: number;
  /** 种子阶段写死的演示基线：让空库演示也有合理观感，真实埋点在其上累加 */
  visit_baseline: number;
  /** 真实埋点：今日（本地日期）浏览数 */
  visit_today: number;
  updated_at: string;
}

/** Agent 在场景中的运行步骤（效果展示模块的「运行效果」时间轴） */
export interface AgentStep {
  id: string;
  kind: "perceive" | "decide" | "act";
  label: string;
  detail: string;
  hotspot_id?: string;
  hotspot_name?: string;
  /** 该步骤对应的相机朝向，展示页据此转动全景 */
  yaw?: number;
  pitch?: number;
  dwell_ms: number;
}

/**
 * 本地日期 YYYY-MM-DD。
 *
 * 刻意不用 `toISOString().slice(0,10)`：那是 UTC，在东八区会把 **08:00 之前的访问记到前一天**，
 * 「今日浏览 +N」会在早上看起来漏数。按日聚合的口径必须与演示现场（本地时区）一致。
 */
function todayStr(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 演示基线访问量：由场景 id 派生 FNV-1a 哈希，保证稳定（不随时间乱跳），量级贴合 Demo 观感。
 *
 * 只作为**基线**：真实访问量落在 `scene_views` 流水表，对外口径 = 基线 + 真实计数。
 * 这样空库演示不会出现「浏览 0」，同时游客每次打开场景都会让数字真实增长。
 */
function demoVisitBaseline(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (Math.abs(h) % 2400) + 600;
}

function seedScenesIfEmpty() {
  const count = db.prepare("SELECT COUNT(*) AS c FROM scenes").get() as { c: number };
  if (count.c > 0) return;
  const seed = loadJson<{ scenes: Array<Record<string, unknown>> }>("scenes_seed.json");
  const insert = db.prepare(
    `INSERT INTO scenes (id, name, poi_id, description, panorama, thumbnail, hotspots_file, hotspots_json,
      model_3d, ar_lat, ar_lng, ar_radius_m, default_yaw, default_pitch, default_fov, tags_json, theme_color,
      enabled, sort_order, visit_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
  );
  db.exec("BEGIN");
  const t = nowIso();
  for (const s of seed.scenes) {
    insert.run(
      String(s.id),
      String(s.name),
      String(s.poi_id ?? ""),
      String(s.description ?? ""),
      String(s.panorama ?? ""),
      String(s.thumbnail ?? ""),
      String(s.hotspots_file ?? ""),
      String(s.model_3d ?? ""),
      s.ar_lat == null ? null : Number(s.ar_lat),
      s.ar_lng == null ? null : Number(s.ar_lng),
      Number(s.ar_radius_m ?? 60),
      Number(s.default_yaw ?? 0),
      Number(s.default_pitch ?? -10),
      Number(s.default_fov ?? 75),
      JSON.stringify(s.tags ?? []),
      String(s.theme_color ?? "#3ec6b8"),
      Number(s.sort_order ?? 0),
      demoVisitBaseline(String(s.id)),
      t,
      t,
    );
  }
  db.exec("COMMIT");
}

/** 从 public 目录读热点文件；文件缺失或损坏时返回空数组，不抛错 */
function readHotspotFile(rel: string): SceneHotspot[] {
  if (!rel) return [];
  try {
    const p = path.join(config.webPublicDir, rel.replace(/^\/+/, ""));
    if (!fs.existsSync(p)) return [];
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as { hotspots?: SceneHotspot[] };
    return Array.isArray(raw.hotspots) ? raw.hotspots : [];
  } catch {
    return [];
  }
}

/** 场景浏览埋点：一次取全量按场景统计（列表页用，避免 N+1 查询） */
function sceneViewCounts(): Map<string, { total: number; today: number }> {
  const rows = db
    .prepare(
      `SELECT scene_id, COUNT(*) AS c,
              SUM(CASE WHEN view_date = ? THEN 1 ELSE 0 END) AS t
         FROM scene_views GROUP BY scene_id`,
    )
    .all(todayStr()) as Array<Record<string, unknown>>;
  return new Map(rows.map((r) => [String(r.scene_id), { total: Number(r.c ?? 0), today: Number(r.t ?? 0) }]));
}

/** 单场景浏览埋点统计（详情页用） */
function sceneViewCount(sceneId: string): { total: number; today: number } {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c, SUM(CASE WHEN view_date = ? THEN 1 ELSE 0 END) AS t
         FROM scene_views WHERE scene_id = ?`,
    )
    .get(todayStr(), sceneId) as Record<string, unknown> | undefined;
  return { total: Number(row?.c ?? 0), today: Number(row?.t ?? 0) };
}

function rowToScene(row: Record<string, unknown>, view: { total: number; today: number }): SceneRecord {
  const custom = JSON.parse(String(row.hotspots_json || "[]")) as SceneHotspot[];
  const file = custom.length ? [] : readHotspotFile(String(row.hotspots_file ?? ""));
  // 列里存的只是演示基线，对外访问量要把真实埋点加上
  const baseline = Number(row.visit_count ?? 0);
  return {
    id: String(row.id),
    name: String(row.name),
    poi_id: String(row.poi_id ?? ""),
    description: String(row.description ?? ""),
    panorama: String(row.panorama ?? ""),
    thumbnail: String(row.thumbnail ?? ""),
    hotspots_file: String(row.hotspots_file ?? ""),
    hotspots: custom.length ? custom : file,
    hotspots_source: custom.length ? "custom" : "file",
    model_3d: String(row.model_3d ?? ""),
    ar_lat: row.ar_lat == null ? null : Number(row.ar_lat),
    ar_lng: row.ar_lng == null ? null : Number(row.ar_lng),
    ar_radius_m: Number(row.ar_radius_m ?? 60),
    default_yaw: Number(row.default_yaw ?? 0),
    default_pitch: Number(row.default_pitch ?? -10),
    default_fov: Number(row.default_fov ?? 75),
    tags: JSON.parse(String(row.tags_json || "[]")),
    theme_color: String(row.theme_color ?? "#3ec6b8"),
    enabled: Number(row.enabled ?? 1) === 1,
    sort_order: Number(row.sort_order ?? 0),
    visit_count: baseline + view.total,
    visit_baseline: baseline,
    visit_today: view.today,
    updated_at: String(row.updated_at ?? ""),
  };
}

export function listScenes(opts: { enabled?: string } = {}): SceneRecord[] {
  const rows = (
    opts.enabled === "1" || opts.enabled === "true"
      ? db.prepare("SELECT * FROM scenes WHERE enabled = 1 ORDER BY sort_order ASC, id ASC").all()
      : db.prepare("SELECT * FROM scenes ORDER BY sort_order ASC, id ASC").all()
  ) as Record<string, unknown>[];
  const views = sceneViewCounts();
  return rows.map((r) => rowToScene(r, views.get(String(r.id)) ?? { total: 0, today: 0 }));
}

export function getScene(id: string): SceneRecord | null {
  const row = db.prepare("SELECT * FROM scenes WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToScene(row, sceneViewCount(String(row.id))) : null;
}

export interface SceneViewResult {
  scene_id: string;
  scene_name: string;
  /** 对外访问量（含演示基线） */
  visit_count: number;
  visit_baseline: number;
  /** 真实埋点累计（不含演示基线） */
  real_visits: number;
  visit_today: number;
}

/**
 * 记录一次场景浏览（真实埋点入口）。
 *
 * 展示端每「打开 / 切换到一个」场景调一次即可，不做会话级去重：
 * 游客来回切换场景就是多次浏览，与运营口径一致。
 * 场景不存在 / id 为空时返回 null，由路由层转 404，避免脏 id 进流水表。
 */
export function recordSceneView(sceneId: string, source = "unknown"): SceneViewResult | null {
  const id = String(sceneId ?? "").trim();
  if (!id || !getScene(id)) return null;
  db.prepare("INSERT INTO scene_views (scene_id, source, view_date, created_at) VALUES (?, ?, ?, ?)").run(
    id,
    String(source || "unknown").slice(0, 32),
    todayStr(),
    nowIso(),
  );
  const next = getScene(id);
  if (!next) return null;
  return {
    scene_id: next.id,
    scene_name: next.name,
    visit_count: next.visit_count,
    visit_baseline: next.visit_baseline,
    real_visits: next.visit_count - next.visit_baseline,
    visit_today: next.visit_today,
  };
}

/** 埋点总览：按来源拆分，用于确认上报链路真的在走（管理端 / 校验脚本） */
export function sceneVisitBreakdown() {
  const date = todayStr();
  const total = db.prepare("SELECT COUNT(*) AS c FROM scene_views").get() as { c: number };
  const today = db.prepare("SELECT COUNT(*) AS c FROM scene_views WHERE view_date = ?").get(date) as { c: number };
  const bySource = db
    .prepare("SELECT source, COUNT(*) AS c FROM scene_views GROUP BY source")
    .all() as Array<Record<string, unknown>>;
  return {
    date,
    total: Number(total?.c ?? 0),
    today: Number(today?.c ?? 0),
    by_source: Object.fromEntries(bySource.map((r) => [String(r.source ?? "unknown"), Number(r.c ?? 0)])),
  };
}

export function updateScene(
  id: string,
  patch: Partial<Omit<SceneRecord, "id" | "hotspots" | "hotspots_source" | "updated_at">> & {
    hotspots?: SceneHotspot[] | null;
  },
) {
  const cur = getScene(id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  db.prepare(
    `UPDATE scenes SET name = ?, poi_id = ?, description = ?, panorama = ?, thumbnail = ?, hotspots_file = ?,
      hotspots_json = ?, model_3d = ?, ar_lat = ?, ar_lng = ?, ar_radius_m = ?, default_yaw = ?, default_pitch = ?,
      default_fov = ?, tags_json = ?, theme_color = ?, enabled = ?, sort_order = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    next.name,
    next.poi_id,
    next.description,
    next.panorama,
    next.thumbnail,
    next.hotspots_file,
    patch.hotspots === null ? "[]" : patch.hotspots ? JSON.stringify(patch.hotspots) : JSON.stringify(cur.hotspots_source === "custom" ? cur.hotspots : []),
    next.model_3d,
    next.ar_lat,
    next.ar_lng,
    next.ar_radius_m,
    next.default_yaw,
    next.default_pitch,
    next.default_fov,
    JSON.stringify(next.tags),
    next.theme_color,
    next.enabled ? 1 : 0,
    next.sort_order,
    nowIso(),
    id,
  );
  return getScene(id);
}

export function createScene(init: Record<string, unknown>) {
  const id = String(init.id ?? "").trim() || `scene-${randomUUID().slice(0, 6)}`;
  if (getScene(id)) return null;
  const t = nowIso();
  db.prepare(
    `INSERT INTO scenes (id, name, poi_id, description, panorama, thumbnail, hotspots_file, hotspots_json,
      model_3d, ar_lat, ar_lng, ar_radius_m, default_yaw, default_pitch, default_fov, tags_json, theme_color,
      enabled, sort_order, visit_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    id,
    String(init.name ?? id),
    String(init.poi_id ?? ""),
    String(init.description ?? ""),
    String(init.panorama ?? ""),
    String(init.thumbnail ?? ""),
    String(init.hotspots_file ?? ""),
    JSON.stringify(init.hotspots ?? []),
    String(init.model_3d ?? ""),
    init.ar_lat == null ? null : Number(init.ar_lat),
    init.ar_lng == null ? null : Number(init.ar_lng),
    Number(init.ar_radius_m ?? 60),
    Number(init.default_yaw ?? 0),
    Number(init.default_pitch ?? -10),
    Number(init.default_fov ?? 75),
    JSON.stringify(init.tags ?? []),
    String(init.theme_color ?? "#3ec6b8"),
    init.enabled === false ? 0 : 1,
    Number(init.sort_order ?? 99),
    t,
    t,
  );
  return getScene(id);
}

export function deleteScene(id: string): boolean {
  const r = db.prepare("DELETE FROM scenes WHERE id = ?").run(id);
  return Number(r.changes ?? 0) > 0;
}

/**
 * 把场景的热点编排成 Agent 运行步骤：
 * 每个热点 → 感知（发现可讲解物）→ 决策（判定兴趣与策略）→ 动作（播报/推送）
 * 供效果展示模块逐帧回放，数据全部来自场景热点，不另造内容。
 */
/** 热点 icon 键 → 中文讲解策略名（热点素材里的 icon 是英文键，展示端不应直接透出） */
const HOTSPOT_STRATEGY: Record<string, string> = {
  mountain: "山景深讲",
  water: "水景漫谈",
  field: "田园导览",
  building: "古建解读",
  cave: "洞天探秘",
  tree: "古木物语",
  bridge: "桥渡故事",
};

export function buildAgentScript(scene: SceneRecord): AgentStep[] {
  const steps: AgentStep[] = [
    {
      id: "perceive-scene",
      kind: "perceive",
      label: "场景感知",
      detail: `载入「${scene.name}」全景，识别到 ${scene.hotspots.length} 个可讲解点位`,
      yaw: scene.default_yaw,
      pitch: scene.default_pitch,
      dwell_ms: 2200,
    },
  ];
  scene.hotspots.slice(0, 3).forEach((h, i) => {
    steps.push(
      {
        id: `perceive-${h.id}`,
        kind: "perceive",
        label: "视觉定位",
        detail: `视野内出现「${h.title}」，置信度 ${(0.93 - i * 0.04).toFixed(2)}`,
        hotspot_id: h.id,
        hotspot_name: h.name,
        yaw: h.position.yaw,
        pitch: h.position.pitch,
        dwell_ms: 2600,
      },
      {
        id: `decide-${h.id}`,
        kind: "decide",
        label: "意图决策",
        detail: `游客停留超过 6 秒，判定为深度兴趣 → 切换「${HOTSPOT_STRATEGY[h.icon ?? ""] ?? "深度讲解"}」策略`,
        hotspot_id: h.id,
        hotspot_name: h.name,
        yaw: h.position.yaw,
        pitch: h.position.pitch,
        dwell_ms: 2200,
      },
      {
        id: `act-${h.id}`,
        kind: "act",
        label: "内容投送",
        detail: h.content,
        hotspot_id: h.id,
        hotspot_name: h.name,
        yaw: h.position.yaw,
        pitch: h.position.pitch,
        dwell_ms: 5200,
      },
    );
  });
  steps.push({
    id: "act-wrap",
    kind: "act",
    label: "行程续接",
    detail: `本场景结束，Agent 已把「${scene.name}」写入游客行程，并规划下一站推荐`,
    yaw: scene.default_yaw,
    pitch: scene.default_pitch,
    dwell_ms: 2600,
  });
  return steps;
}

/** 场景总览：供管理端顶部指标卡与地图分布使用 */
export function sceneStats() {
  const scenes = listScenes();
  const games = listArGames();
  const anchoredPois = scenes.filter((s) => s.ar_lat != null && s.ar_lng != null).map((s) => s.poi_id).filter(Boolean);
  const referenced = db
    .prepare("SELECT DISTINCT poi_id FROM ar_points")
    .all()
    .map((r) => String((r as Record<string, unknown>).poi_id));
  const covered = anchoredPois.filter((p) => referenced.includes(p)).length;
  return {
    total: scenes.length,
    enabled: scenes.filter((s) => s.enabled).length,
    hotspot_count: scenes.reduce((s, x) => s + x.hotspots.length, 0),
    anchored: anchoredPois.length,
    covered_by_games: covered,
    games: games.length,
    /** 对外访问量 = 演示基线 + 真实埋点 */
    total_visits: scenes.reduce((s, x) => s + x.visit_count, 0),
    /** 其中来自真实埋点的部分（对比 total_visits 可看出数字是否在真实增长） */
    real_visits: scenes.reduce((s, x) => s + (x.visit_count - x.visit_baseline), 0),
    today_visits: scenes.reduce((s, x) => s + x.visit_today, 0),
  };
}

/* ================= 板块五：模拟预订凭证（FR-AGT-08） ================= */

export interface VoucherRecord {
  voucher_no: string;
  issue_date: string;
  seq: number;
  session_id: string;
  itinerary_id: string;
  title: string;
  total_cny: number;
  guests: number;
  status: string;
  created_at: string;
}

/**
 * 领一个当日流水号。
 *
 * 从表里取 MAX(seq) 续号：服务重启后接着发（当天已有 0003 就发 0004），
 * 不会因为重启把演示中的凭证号打回 0001。演示量级下不担心并发。
 */
export function nextVoucherSeq(issueDate: string): number {
  const row = db
    .prepare("SELECT MAX(seq) AS m FROM booking_vouchers WHERE issue_date = ?")
    .get(issueDate) as { m: number | null } | undefined;
  return Number(row?.m ?? 0) + 1;
}

export function insertVoucher(v: VoucherRecord, payload: unknown): VoucherRecord {
  db.prepare(
    `INSERT INTO booking_vouchers
       (voucher_no, issue_date, seq, session_id, itinerary_id, title, total_cny, guests, status, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    v.voucher_no,
    v.issue_date,
    v.seq,
    v.session_id,
    v.itinerary_id,
    v.title,
    v.total_cny,
    v.guests,
    v.status,
    JSON.stringify(payload),
    v.created_at,
  );
  return v;
}

/** 取凭证正文（发出时的快照） */
export function getVoucher(no: string): { record: VoucherRecord; payload: Record<string, unknown> } | null {
  const row = db.prepare("SELECT * FROM booking_vouchers WHERE voucher_no = ?").get(no) as
    | (VoucherRecord & { payload: string })
    | undefined;
  if (!row) return null;
  return { record: row, payload: JSON.parse(row.payload) as Record<string, unknown> };
}

/** 凭证列表（运营端/调试用）：只回摘要字段，不在列表里塞整份正文 */
export function listVouchers(sessionId?: string, limit = 20) {
  const rows = (
    sessionId
      ? db
          .prepare("SELECT * FROM booking_vouchers WHERE session_id = ? ORDER BY created_at DESC, seq DESC LIMIT ?")
          .all(sessionId, limit)
      : db.prepare("SELECT * FROM booking_vouchers ORDER BY created_at DESC, seq DESC LIMIT ?").all(limit)
  ) as Record<string, unknown>[];
  return rows.map((r) => ({
    voucher_no: String(r.voucher_no),
    seq: Number(r.seq),
    title: String(r.title ?? ""),
    total_cny: Number(r.total_cny ?? 0),
    guests: Number(r.guests ?? 0),
    status: String(r.status ?? ""),
    created_at: String(r.created_at ?? ""),
  }));
}

export { loadJson };
