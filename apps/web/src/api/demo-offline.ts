/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 离线演示数据层（APK 用）
 * ---------------------------------------------------------------------------
 * 解决的唯一问题：
 *   手机端 4 个屏 + SpaceView + AgentView 共调用 14 个后端接口。
 *   打包成 APK 后 WebView 里**没有 Fastify 服务端**，/api/* 全部拿不到，
 *   寻宝大厅、AR 寻宝、攻略、我的券包会直接空白 —— 演示当场就崩了。
 *
 * 策略：先真后假（而不是用编译开关硬切）
 *   client.ts 里的每个请求都先尝试真实服务端；
 *   只有在请求失败（网络不可达 / 非 2xx / 返回的不是合法 JSON）时，
 *   才回落到这里。好处是**同一份构建产物**在三处都能用：
 *     - 本地 `pnpm dev`      → 走真服务端（此层不参与）
 *     - 部署到服务器          → 走真服务端
 *     - 装成 APK 离线运行     → 自动回落本层
 *   因此不需要维护两套构建配置，也不会出现「打了离线包却连不上线上」的错配。
 *
 * 数据从哪来：
 *   scripts/snapshot-api.mjs 启动真实服务端抓取全部接口响应，
 *   写入 apps/web/public/demo-offline/snapshot.json。
 *   即 APK 里的数据就是服务端的真实输出，不是手写的假数据。
 *
 * 哪些是本地模拟的（服务端逻辑在前端重算）：
 *   - 围栏判定 checkin：haversine 距离，逻辑与 apps/server/src/ar/geo.ts 一致
 *   - 答案判定 submit ：宽松判定规则，同样对齐 geo.ts 的 judgeAnswer
 *     之所以要在本地重算，是因为玩家端接口不下发答案；
 *     而快照里额外存了运营端 /ar/games/:id 的完整数据（含答案），
 *     仅供本地判题使用，绝不会返回给页面。
 *   - 领券 claim / 进度累积：纯前端内存态，刷新即重置（演示可重复跑）
 *   - 楠楠对话 chat：回放抓取时录下的真实 SSE 事件流，含暴雨重排剧本
 */
import type { ArGameDetail, ArPlayPoint } from "@/types/api";

/** 快照文件位置（public 目录下，随 www/ 一起打进 APK） */
const SNAPSHOT_URL = "/demo-offline/snapshot.json";

export interface ChatScenario {
  /** 命中这些关键词时选用该剧本 */
  keys: string[];
  label: string;
  events: { event: string; data: any }[];
}

export interface Snapshot {
  generatedAt: string;
  get: { path: string; query?: Record<string, string>; loose?: boolean; data: any }[];
  post: { path: string; query?: Record<string, string>; loose?: boolean; data: any }[];
  /** 含答案的运营端游戏数据，仅用于本地判题 */
  arGamesFull: ArGameDetail[];
  chat: ChatScenario[];
}

interface PendingResult {
  handled: boolean;
  data?: any;
}

let snapshotPromise: Promise<Snapshot | null> | null = null;

/** 懒加载快照；文件缺失或解析失败时返回 null，由调用方继续抛原始错误 */
export function loadSnapshot(): Promise<Snapshot | null> {
  if (!snapshotPromise) {
    snapshotPromise = fetch(SNAPSHOT_URL, { cache: "force-cache" })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
  }
  return snapshotPromise;
}

/* ------------------------------------------------------------------ *
 * 一、AR 玩法本地状态（刷新即重置 —— 演示可反复跑同一条线）
 * ------------------------------------------------------------------ */

interface ArLocalProgress {
  solved: string[];
  claimed: string[];
  score: number;
}

const arState = new Map<string, ArLocalProgress>();

function progressOf(gameId: string): ArLocalProgress {
  let s = arState.get(gameId);
  if (!s) {
    s = { solved: [], claimed: [], score: 0 };
    arState.set(gameId, s);
  }
  return s;
}

/** 与 apps/server/src/db/db.ts 的 score 口径保持一致：每题 100 分 */
function toArProgress(gameId: string, totalPoints: number) {
  const s = progressOf(gameId);
  return {
    solved: [...s.solved],
    claimed: [...s.claimed],
    points_done: s.solved.length,
    total_points: totalPoints,
    completed: totalPoints > 0 && s.solved.length >= totalPoints,
    score: s.score,
  };
}

/* ------------------------------------------------------------------ *
 * 二、围栏与判题：与 apps/server/src/ar/geo.ts 对齐
 * ------------------------------------------------------------------ */

const EARTH_RADIUS_M = 6371000;

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function checkFence(lat: number, lng: number, poi: { lat: number; lng: number }, radiusM: number) {
  const distance = haversine(lat, lng, poi.lat, poi.lng);
  const radius = Math.max(5, Number(radiusM) || 50);
  return {
    distance_m: Math.round(distance),
    radius_m: radius,
    inside: distance <= radius,
    gap_m: Math.round(distance - radius),
  };
}

function normalizeAnswer(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[\s，。、,.!！?？"'“”‘’（）()【】\[\]·:：;；\-—_/\\]/g, "");
}

/** 宽松判定（演示优先「一遍答对」），逐条对齐 geo.ts 的 judgeAnswer */
function judgeAnswer(input: string, expected: string): boolean {
  const a = normalizeAnswer(input);
  const b = normalizeAnswer(expected);
  if (!a || !b) return false;
  if (a === b) return true;
  if (b.includes(a) && a.length >= 2) return true;
  if (a.includes(b)) return true;
  const inner = String(expected).match(/[（(]([^）)]+)[）)]/g) || [];
  for (const seg of inner) {
    const key = normalizeAnswer(seg);
    if (key && (a === key || a.includes(key) || key.includes(a))) return true;
  }
  const numA = a.match(/\d+(\.\d+)?/g);
  const numB = b.match(/\d+(\.\d+)?/g);
  if (numA?.length && numB?.length && numA.some((n) => numB.includes(n))) return true;
  return false;
}

/* ------------------------------------------------------------------ *
 * 三、快照匹配
 * ------------------------------------------------------------------ */

function parseQuery(qs: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(qs)) out[k] = v;
  return out;
}

function queryMatches(want: Record<string, string> | undefined, got: Record<string, string>): boolean {
  if (!want) return true;
  return Object.entries(want).every(([k, v]) => got[k] === v);
}

function fromGet(snap: Snapshot, path: string, query: Record<string, string>): any | undefined {
  const hit = snap.get.find(
    (e) => !e.loose && e.path === path && queryMatches(e.query, query),
  );
  if (hit) return hit.data;
  const loose = snap.get.find((e) => e.loose && e.path === path);
  return loose?.data;
}

/** 路径形如 /ar/play/:gameId/checkin 的解析 */
function segs(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * 四、入口：拦截并作答
 * ------------------------------------------------------------------ */

export async function offlineRequest(method: string, path: string, payload: any): Promise<PendingResult> {
  const snap = await loadSnapshot();
  if (!snap) return { handled: false };

  const [rawPath, rawQuery = ""] = path.split("?");
  const query = parseQuery(rawQuery);
  const s = segs(rawPath);
  const body = (payload ?? {}) as Record<string, any>;

  /* ---------- 知识库（攻略页「景点介绍」/ 3D 云游景点详情） ---------- */

  if (method === "GET" && s[0] === "knowledge") {
    // 详情：/knowledge/:id
    if (s.length >= 2) {
      const id = decodeURIComponent(s[1]);
      // 优先用抓取到的真实响应，其形状即 KbDetailResp，无需猜测
      const byId = fromGet(snap, "/knowledge/:id", { id });
      if (byId) return { handled: true, data: byId };
      // 快照里没有该 id 时，退回从列表池里捞（仅兜底）
      const pool: any[] = snap.get
        .filter((e) => e.path === "/knowledge")
        .flatMap((e) => e.data?.items ?? []);
      const item = pool.find((it) => it.id === id);
      return item ? { handled: true, data: { item, demo: true } } : { handled: false };
    }

    // 列表：优先精确命中抓取的 query 组合
    const exact = fromGet(snap, "/knowledge", query);
    if (exact) return { handled: true, data: exact };

    // 兜底：拿全集在本地按 q / domain / limit 过滤
    const pool: any[] = snap.get
      .filter((e) => e.path === "/knowledge")
      .flatMap((e) => e.data?.items ?? []);
    const uniq = [...new Map(pool.map((it) => [it.id, it])).values()];
    const q = (query.q ?? "").trim().toLowerCase();
    const limit = Number(query.limit ?? 24) || 24;
    const filtered = uniq.filter((it) => {
      if (query.domain && it.domain !== query.domain) return false;
      if (!q) return true;
      const hay = `${it.name ?? ""} ${it.summary ?? ""} ${it.content ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
    return { handled: true, data: { items: filtered.slice(0, limit), total: filtered.length, demo: true } };
  }

  /* ---------- 快捷指令 / 天气（楠楠页） ---------- */

  if (method === "GET" && rawPath === "/shortcuts") {
    const d = fromGet(snap, "/shortcuts", query);
    return d ? { handled: true, data: d } : { handled: false };
  }

  if (method === "POST" && rawPath === "/demo/weather") {
    // 纯前端演示开关，无需数据
    return { handled: true, data: { sessionId: body.sessionId ?? "demo", mock: body.mock ?? "normal" } };
  }

  /* ---------- 智能伴侣推荐 ---------- */

  if (method === "GET" && rawPath === "/companion/recommend") {
    const exact = fromGet(snap, "/companion/recommend", query);
    if (exact) return { handled: true, data: exact };
    // 参数组合没抓到时，按 intent 就近匹配，再退到通用推荐
    const byIntent = snap.get.find(
      (e) => e.path === "/companion/recommend" && e.query?.intent && e.query.intent === query.intent,
    );
    if (byIntent) return { handled: true, data: byIntent.data };
    const generic = snap.get.find((e) => e.path === "/companion/recommend" && e.loose);
    return generic ? { handled: true, data: generic.data } : { handled: false };
  }

  /* ---------- 行程生成（攻略页「路线引导」） ---------- */

  if (method === "POST" && rawPath === "/itinerary/generate") {
    const msg = String(body.message ?? "");
    const byMsg = snap.post.find(
      (e) => e.path === "/itinerary/generate" && e.query?.message && msg.includes(e.query.message),
    );
    if (byMsg) return { handled: true, data: byMsg.data };
    const generic = snap.post.find((e) => e.path === "/itinerary/generate" && e.loose);
    return generic ? { handled: true, data: generic.data } : { handled: false };
  }

  /* ---------- AR：游戏列表 / 券包 / 场景 ---------- */

  if (method === "GET" && rawPath === "/ar/games") {
    const d = fromGet(snap, "/ar/games", { ...query });
    if (d) return { handled: true, data: d };
    // 状态筛不到就退回全量快照，但仍在本地按 status 过滤，
    // 否则草稿态游戏会混进玩家端的「寻宝大厅」
    const all = snap.get.find((e) => e.path === "/ar/games" && e.loose);
    if (!all) return { handled: false };
    const games = (all.data?.games ?? []).filter((g: any) => !query.status || g.status === query.status);
    return { handled: true, data: { ...all.data, games } };
  }

  if (method === "GET" && rawPath === "/ar/coupons") {
    const d = fromGet(snap, "/ar/coupons", query);
    return d ? { handled: true, data: d } : { handled: false };
  }

  if (method === "GET" && rawPath === "/scenes") {
    const d = fromGet(snap, "/scenes", query);
    if (d) return { handled: true, data: d };
    const all = snap.get.find((e) => e.path === "/scenes" && e.loose);
    return all ? { handled: true, data: all.data } : { handled: false };
  }

  /* ---------- AR 玩家端 ---------- */

  if (s[0] === "ar" && s[1] === "play" && s.length >= 3) {
    const gameId = decodeURIComponent(s[2]);
    const game = snap.arGamesFull.find((g) => g.id === gameId);
    if (!game) return { handled: false };

    /** 剥离答案，与运营端 toPlayConfig 的口径一致 */
    const playConfig = () => {
      const { points, ...rest } = game;
      const safePoints: ArPlayPoint[] = points.map((p) => ({
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
      }));
      return { ...rest, points: safePoints, demo: true };
    };

    // GET /ar/play/:gameId
    if (method === "GET" && s.length === 3) return { handled: true, data: playConfig() };

    const action = s[3];

    // GET /ar/play/:gameId/records
    if (method === "GET" && action === "records") {
      const d = fromGet(snap, "/ar/play/:gameId/records", { gameId });
      return d ? { handled: true, data: { ...d, demo: true } } : { handled: false };
    }

    const point = game.points.find((p) => p.poi_id === String(body.poi_id ?? "")) ?? null;

    // POST /ar/play/:gameId/checkin
    if (method === "POST" && action === "checkin") {
      if (!point) return { handled: true, data: null };
      const lat = Number(body.lat);
      const lng = Number(body.lng);
      const fence = checkFence(lat, lng, point, point.geofence_radius_m);
      return {
        handled: true,
        data: {
          poi_id: point.poi_id,
          poi_name: point.poi_name,
          ...fence,
          can_play: fence.inside,
          tip: fence.inside
            ? `已进入「${point.poi_name}」围栏，虚拟物出现`
            : `再走近 ${Math.max(0, fence.gap_m)} 米即可解锁（演示态可一键模拟到位）`,
        },
      };
    }

    // POST /ar/play/:gameId/submit
    if (method === "POST" && action === "submit") {
      if (!point) return { handled: true, data: null };
      const answer = String(body.answer ?? "").trim();
      const correct = judgeAnswer(answer, point.answer);
      const st = progressOf(gameId);
      if (correct && !st.solved.includes(point.poi_id)) {
        st.solved.push(point.poi_id);
        st.score += 100;
      }
      const coupons: any[] = snap.get.find((e) => e.path === "/ar/coupons")?.data?.coupons ?? [];
      const coupon = coupons.find((c) => c.id === point.reward_coupon_id) ?? null;
      return {
        handled: true,
        data: {
          poi_id: point.poi_id,
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
          progress: toArProgress(gameId, game.points.length),
          coupon_image: correct && coupon ? `/assets/ar/${coupon.image}` : null,
          demo: true,
        },
      };
    }

    // POST /ar/play/:gameId/claim
    if (method === "POST" && action === "claim") {
      const coupons: any[] = snap.get.find((e) => e.path === "/ar/coupons")?.data?.coupons ?? [];
      const coupon = coupons.find((c) => c.id === String(body.coupon_id ?? ""));
      if (!coupon) return { handled: false };
      const st = progressOf(gameId);
      if (!st.claimed.includes(coupon.id)) st.claimed.push(coupon.id);
      return {
        handled: true,
        data: {
          is_demo: true,
          demo_label: "演示模拟 · DEMO",
          voucher_no: `YJZY-AR-${String(Date.now()).slice(-8)}`,
          coupon,
          coupon_image: `/assets/ar/${coupon.image}`,
          qr_text: `永嘉新游 AR 互动演示券 · ${coupon.name} · ${game.name}`,
          claimed: [...st.claimed],
          progress: toArProgress(gameId, game.points.length),
          notice: "本券为大赛演示数据，不构成真实优惠，核销流程为模拟。",
        },
      };
    }
  }

  return { handled: false };
}

/* ------------------------------------------------------------------ *
 * 五、楠楠对话：回放录制下来的真实 SSE 事件流
 * ------------------------------------------------------------------ */

/** 按关键词选取剧本；都不命中时用最后一条（通用行程） */
export function pickChatScenario(snap: Snapshot, message: string): ChatScenario | null {
  if (!snap.chat?.length) return null;
  const msg = message ?? "";
  for (const sc of snap.chat) {
    if (sc.keys?.some((k) => msg.includes(k))) return sc;
  }
  return snap.chat[snap.chat.length - 1] ?? null;
}

/**
 * 回放事件流。token 事件按原顺序逐字推送并带节流，
 * 视觉上与在线流式输出一致；其余事件（tool_call / plan / plan_diff / done）原样派发。
 */
export async function replayChat(
  scenario: ChatScenario,
  emit: (event: string, data: any) => void,
  signal?: AbortSignal,
): Promise<void> {
  const TOKEN_DELAY_MS = 28;
  for (const ev of scenario.events) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    emit(ev.event, ev.data);
    if (ev.event === "token") {
      await new Promise((r) => setTimeout(r, TOKEN_DELAY_MS));
    }
  }
}
