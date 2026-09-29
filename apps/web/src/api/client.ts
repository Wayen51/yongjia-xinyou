import type {
  ArClaimResp,
  ArCoupon,
  ArFenceResp,
  ArGameDetail,
  ArGamesResp,
  ArGeneratedStory,
  ArPoi,
  ArPlayConfig,
  ArRecordsResp,
  ArStats,
  ArSubmitResp,
  ArTemplatesResp,
  AgentStep,
  BookingVoucher,
  CompanionRecommendResp,
  DemoDashboard,
  DemoInsight,
  DemoPlan,
  HealthData,
  KbDetailResp,
  KbItem,
  KbSearchResp,
  PanoHotspot,
  PlanDiffPayload,
  Quest,
  SceneAgentScript,
  SceneHotspot,
  SceneRecord,
  SceneStats,
  ScenesResp,
  ShortcutResp,
  SseEvent,
  VideoEnhanceResult,
  VideoListResp,
  VideoProjectDetail,
  VideoStatusResp,
  VideoStyleResp,
} from "@/types/api";
import { loadSnapshot, offlineRequest, pickChatScenario, replayChat } from "./demo-offline";

const API_BASE = (import.meta.env.VITE_API_BASE || "/api").replace(/\/$/, "");
export const DEMO_CONSOLE = (import.meta.env.VITE_DEMO_CONSOLE ?? "true") !== "false";

/**
 * 访问令牌：与服务端 .env 的 CHAT_API_TOKEN 保持一致。
 * 仅用于挡住脚本批量调用 LLM 接口，不是生产级鉴权；
 * 不消耗 LLM 的接口会忽略该头。
 */
const API_TOKEN = "c0657c95db99508363f8366fad971762";

export class ApiError extends Error {
  code: number;
  fallback?: boolean;
  constructor(code: number, message: string, fallback = false) {
    super(message);
    this.code = code;
    this.fallback = fallback;
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  let body: { code?: number; data?: T; message?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok || body.code !== 0) {
    throw new ApiError(body.code ?? res.status, body.message || `请求失败(${res.status})`, false);
  }
  return body.data as T;
}

/**
 * 统一请求层：先真后假。
 * 真实服务端可用时（本地 dev / 线上部署）行为与之前完全一致；
 * 只有在 fetch 抛错或响应不合法（APK 里没有服务端）时，
 * 才回落到 demo-offline 的离线快照。同一份构建产物三处通用。
 */
async function request<T>(method: string, path: string, payload?: unknown): Promise<T> {
  try {
    const headers: Record<string, string> = { "x-api-token": API_TOKEN };
    const init: RequestInit = { method, headers };
    if (method !== "GET" && method !== "DELETE") {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(payload ?? {});
    }
    const res = await fetch(`${API_BASE}${path}`, init);
    return await unwrap<T>(res);
  } catch (err) {
    const offline = await offlineRequest(method, path, payload);
    if (offline.handled) return offline.data as T;
    throw err;
  }
}

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, payload: unknown) => request<T>("POST", path, payload);
const put = <T>(path: string, payload: unknown) => request<T>("PUT", path, payload);
const patch = <T>(path: string, payload: unknown) => request<T>("PATCH", path, payload);
const del = <T>(path: string) => request<T>("DELETE", path);

export const api = {
  health: () => get<HealthData>("/health"),

  /* 知识库 */
  searchKnowledge: (p: { q?: string; domain?: string; tag?: string; indoor?: string; limit?: number }) => {
    const sp = new URLSearchParams();
    if (p.q) sp.set("q", p.q);
    if (p.domain) sp.set("domain", p.domain);
    if (p.tag) sp.set("tag", p.tag);
    if (p.indoor) sp.set("indoor", p.indoor);
    sp.set("limit", String(p.limit ?? 24));
    return get<KbSearchResp>(`/knowledge?${sp.toString()}`);
  },
  knowledgeById: (id: string) => get<KbDetailResp>(`/knowledge/${encodeURIComponent(id)}`),

  /* 快捷指令 */
  shortcuts: () => get<ShortcutResp>("/shortcuts"),

  /* 演示控制台 / 天气 */
  demoWeather: (sessionId: string, mock: "rain" | "normal") =>
    post<{ sessionId: string; mock: string }>("/demo/weather", { sessionId, mock }),

  /* 行程 */
  /** message 用于按口味/天数选线（如「一日亲子游」）；key 可直接点名某条方案 */
  generateItinerary: (sessionId: string, message?: string, key?: string) =>
    post<Record<string, unknown>>("/itinerary/generate", { sessionId, message, key }),
  replanItinerary: (p: { sessionId: string; itineraryId?: string; reason?: string }) =>
    post<{ itinerary: unknown; changes: PlanDiffPayload; reason: string }>("/itinerary/replan", p),

  /* 看板 */
  dashboardOverview: () => get<DemoDashboard>("/dashboard/overview"),
  dashboardInsight: () => get<{ insight: DemoInsight; latestDate: string | null; poolSize: number; demo: boolean }>("/dashboard/insight"),

  /* 游戏 / 空间 */
  gameTask: (questId?: string) => post<Record<string, unknown>>("/game/task", { questId }),
  spaceHotspots: () => get<{ hotspots: PanoHotspot[]; meta: Record<string, string> }>("/space/hotspots"),

  quests: () => get<Quest[]>("/game/quests"), // 见 server routes；若未实现则 404 → 调用方兜底本地注入

  /* 板块三 · 智能伴侣：位置/节日/意图推荐 */
  companionRecommend: (p: { lat?: number; lng?: number; location_name?: string; festival?: string; intent?: string; context?: string }) => {
    const sp = new URLSearchParams();
    if (p.lat != null) sp.set("lat", String(p.lat));
    if (p.lng != null) sp.set("lng", String(p.lng));
    if (p.location_name) sp.set("location_name", p.location_name);
    if (p.festival) sp.set("festival", p.festival);
    if (p.intent) sp.set("intent", p.intent);
    if (p.context) sp.set("context", p.context);
    return get<CompanionRecommendResp>(`/companion/recommend?${sp.toString()}`);
  },

  /* 板块一 · AIGC 视频生成 */
  videoStyles: () => get<VideoStyleResp>("/video/styles"),
  videoEnhance: (p: { prompt: string; style?: string; shot_count?: number; local?: boolean }) =>
    post<VideoEnhanceResult>("/video/enhance", p),
  createVideo: (p: { title?: string; user_prompt: string; style: string; shot_count: number }) =>
    post<{ id: string; status: string; title: string }>("/video/projects", p),
  listVideos: (status?: string) => {
    const sp = status ? `?status=${encodeURIComponent(status)}` : "";
    return get<VideoListResp>(`/video/projects${sp}`);
  },
  videoById: (id: string) => get<VideoProjectDetail>(`/video/projects/${encodeURIComponent(id)}`),
  videoStatus: (id: string) => get<VideoStatusResp>(`/video/projects/${encodeURIComponent(id)}/status`),
  videoRegenerate: (id: string) => post<{ id: string; status: string }>(`/video/projects/${id}/regenerate`, {}),
  videoDelete: (id: string) =>
    fetch(`${API_BASE}/video/projects/${encodeURIComponent(id)}`, { method: "DELETE" }).then((res) => unwrap<{ id: string; deleted: boolean }>(res)),

  /* 板块二 · AR 互动游戏 */
  arTemplates: () => get<ArTemplatesResp>("/ar/templates"),
  arPois: () => get<{ points: ArPoi[] }>("/ar/points"),
  arCoupons: () => get<{ coupons: ArCoupon[] }>("/ar/coupons"),
  arStats: () => get<ArStats>("/ar/stats"),
  arGames: (status?: string) => {
    const sp = status ? `?status=${encodeURIComponent(status)}` : "";
    return get<ArGamesResp>(`/ar/games${sp}`);
  },
  arGame: (id: string) => get<ArGameDetail>(`/ar/games/${encodeURIComponent(id)}`),
  arCreateGame: (p: Record<string, unknown>) => post<ArGameDetail>("/ar/games", p),
  arUpdateGame: (id: string, p: Record<string, unknown>) => put<ArGameDetail>(`/ar/games/${encodeURIComponent(id)}`, p),
  arPublishGame: (id: string) =>
    post<{ id: string; status: string; play_url: string; qr_text: string }>(`/ar/games/${id}/publish`, {}),
  arPauseGame: (id: string) => post<{ id: string; status: string }>(`/ar/games/${id}/pause`, {}),
  arDeleteGame: (id: string) => del<{ id: string; deleted: boolean }>(`/ar/games/${id}`),
  arGenerateStory: (p: { template_id: string; theme_name?: string; difficulty?: string; poi_ids?: string[]; point_count?: number }) =>
    post<ArGeneratedStory>("/ar/ai/generate", p),

  /* 板块二 · 玩家端 */
  arPlay: (gameId: string) => get<ArPlayConfig>(`/ar/play/${encodeURIComponent(gameId)}`),
  arCheckin: (gameId: string, p: { poi_id: string; lat: number; lng: number; playerKey?: string; userName?: string }) =>
    post<ArFenceResp>(`/ar/play/${gameId}/checkin`, p),
  arSubmit: (gameId: string, p: { poi_id: string; answer: string; distance_m?: number; playerKey?: string; userName?: string }) =>
    post<ArSubmitResp>(`/ar/play/${gameId}/submit`, p),
  arClaim: (gameId: string, p: { coupon_id: string; distance_m?: number; playerKey?: string; userName?: string }) =>
    post<ArClaimResp>(`/ar/play/${gameId}/claim`, p),
  arRecords: (gameId: string) => get<ArRecordsResp>(`/ar/play/${gameId}/records`),

  /* 场景底座 · 永嘉 3D 景点场景（3D 云游 / 效果展示 / AR 寻宝共用） */
  scenes: (enabled?: boolean) => get<ScenesResp>(`/scenes${enabled ? "?enabled=1" : ""}`),
  sceneStats: () => get<SceneStats>("/scenes/stats"),
  scene: (id: string) => get<{ scene: SceneRecord; agent_script: AgentStep[] }>(`/scenes/${encodeURIComponent(id)}`),
  sceneAgentScripts: () => get<{ scripts: SceneAgentScript[] }>("/scenes/agent-scripts"),
  sceneCreate: (p: Record<string, unknown>) => post<{ scene: SceneRecord }>("/scenes", p),
  sceneUpdate: (id: string, p: Record<string, unknown>) =>
    patch<{ scene: SceneRecord }>(`/scenes/${encodeURIComponent(id)}`, p),
  sceneSaveHotspots: (id: string, hotspots: SceneHotspot[] | null) =>
    put<{ scene: SceneRecord }>(`/scenes/${encodeURIComponent(id)}/hotspots`, { hotspots }),
  sceneDelete: (id: string) => del<{ id: string; deleted: boolean }>(`/scenes/${encodeURIComponent(id)}`),
  /** 浏览埋点上报：展示端每打开一个场景调一次，source 标明来源（space / cruise） */
  sceneVisit: (id: string, source: string) =>
    post<{
      scene_id: string;
      scene_name: string;
      visit_count: number;
      visit_baseline: number;
      real_visits: number;
      visit_today: number;
    }>(`/scenes/${encodeURIComponent(id)}/visit`, { source }),

  /* 模拟预订凭证 · FR-AGT-08（演示模拟，不产生真实预订） */
  issueVoucher: (p: {
    sessionId?: string;
    itinerary?: DemoPlan;
    itineraryId?: string;
    guests?: number;
    startDate?: string;
  }) => post<{ voucher: BookingVoucher }>("/booking/voucher", p),
  lookupVoucher: (no: string) => get<{ voucher: BookingVoucher }>(`/booking/voucher/${encodeURIComponent(no)}`),
};

/* ---------------- SSE 对话流 ---------------- */
export interface SseHandlers {
  onToken: (text: string) => void;
  onToolCall: (d: Record<string, unknown>) => void;
  onPlan: (d: DemoPlan) => void;
  onPlanDiff: (d: PlanDiffPayload) => void;
  onDone: (d: Record<string, unknown>) => void;
  /** fallback=true 表示服务端真实 LLM 链路失败、已回落演示剧本；reason 为技术原因，供排查 */
  onError: (code: number, message: string, fallback: boolean, reason?: string) => void;
}

function parseSseBlock(raw: string): SseEvent | null {
  let event = "message";
  const datas: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) datas.push(line.slice(5).trim());
  }
  if (!datas.length) return null;
  let data: unknown = null;
  try {
    data = JSON.parse(datas.join("\n"));
  } catch {
    data = datas.join("\n");
  }
  return { event: event as SseEvent["event"], data: data as never };
}

export async function chatSse(
  sessionId: string,
  message: string,
  handlers: SseHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let emitted = false;

  const handle = (event: string, data: unknown) => {
    emitted = true;
    switch (event) {
      case "token":
        handlers.onToken((data as { text?: string }).text ?? "");
        break;
      case "tool_call":
        handlers.onToolCall(data as Record<string, unknown>);
        break;
      case "plan":
        handlers.onPlan(data as DemoPlan);
        break;
      case "plan_diff":
        handlers.onPlanDiff(data as PlanDiffPayload);
        break;
      case "done":
        handlers.onDone(data as Record<string, unknown>);
        break;
      case "error": {
        const d = data as { code?: number; message?: string; fallback?: boolean; reason?: string };
        handlers.onError(d.code ?? 0, d.message ?? "未知错误", !!d.fallback, d.reason);
        break;
      }
      default:
        break;
    }
  };

  try {
    const res = await fetch(`${API_BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", "x-api-token": API_TOKEN },
      body: JSON.stringify({ sessionId, message }),
      signal,
    });
    if (!res.ok || !res.body) {
      throw new ApiError(res.status, `对话通道不可用(${res.status})`, false);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const ev = parseSseBlock(block);
        if (ev) handle(ev.event, ev.data);
      }
    }
    // 尾部残余
    if (buf.trim()) {
      const ev = parseSseBlock(buf);
      if (ev) handle(ev.event, ev.data);
    }
  } catch (err) {
    // 用户主动取消不回落
    if ((err as Error)?.name === "AbortError") throw err;
    // 已经吐过内容就不再回落，避免重复输出
    if (emitted) throw err;
    // APK 离线：回放抓取时录下的真实 SSE 事件流
    const snap = await loadSnapshot();
    const scenario = snap ? pickChatScenario(snap, message) : null;
    if (!scenario) throw err;
    await replayChat(scenario, (event, data) => handle(event as never, data), signal);
  }
}
