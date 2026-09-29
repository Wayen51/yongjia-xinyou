/** 前端领域/API 类型 —— 与服务端返回对齐（seed 实际字段为准，兼容设计稿契约） */

export type Domain = "culture" | "poi" | "business";

export interface KbAssets {
  cover?: string;
  fallback?: string;
}

export interface KbItem {
  id: string;
  domain: Domain;
  name: string;
  category: string | null;
  summary: string;
  content: string;
  tags: string[];
  indoor: boolean;
  suitable_for: string[];
  avg_cost_cny: number | null;
  avg_duration_min: number | null;
  geo_lat: number | null;
  geo_lng: number | null;
  assets: KbAssets;
  source: string;
  source_url?: string;
  rating: number;
}

export interface KbSearchResp {
  total: number;
  items: KbItem[];
}
export interface KbDetailResp {
  item: KbItem;
  related: KbItem[];
}

export interface ShortcutItem {
  id: string;
  title: string;
  icon: string;
  prompt: string;
  scenario: string;
  expected_output: string;
}
export interface ShortcutResp {
  shortcuts: ShortcutItem[];
  default_display: string[];
}

export interface HealthData {
  status: string;
  llm: string;
  db: string;
  weather: string;
  mockLlm: boolean;
}

/* ---------- 行程（plan 事件） ---------- */
export interface PlanItem {
  id: string;
  name: string;
  start: string;
  end: string;
  cost_cny: number;
  indoor: boolean;
  reason?: string;
}
export interface PlanDay {
  day: number;
  theme: string;
  items: PlanItem[];
}
export interface DemoPlan {
  title: string;
  days: PlanDay[];
  budget_total_cny: number;
  budget_note?: string;
  sources?: string[];
}

/* ---------- 重规划差异（plan_diff 事件） ---------- */
export interface PlanDiffPayload {
  banner: string;
  changes?: { type: "remove" | "add" | "modify"; itemId: string; reason?: string; item?: unknown }[];
  removed?: Array<{ id: string; name: string; reason: string }>;
  added?: Array<{ id: string; name: string; start?: string; end?: string; cost_cny?: number; indoor?: boolean; reason?: string }>;
  rescheduled?: Array<{ id: string; name: string; from: string; to: string; reason: string }>;
  budget_recheck?: { before_cny: number; after_cny: number; delta_cny: number; note: string };
  change_summary?: string;
  sources?: string[];
}

/* ---------- 看板 ---------- */
export interface DemoDaily {
  date: string;
  weekday: string;
  exposure: number;
  clicks: number;
  consultations: number;
  plannings: number;
  conversions: number;
  gmv: number;
  new_visitors: number;
}
export interface DemoInsight {
  id: string;
  date: string;
  category?: "video" | "ar" | "coupon" | "companion" | "overview";
  title: string;
  insight: string;
  confidence: number;
  signals?: Array<{ label: string; value: string; delta?: string; dir?: "up" | "down" | "flat" }>;
  actions?: string[];
}
export interface DemoDashboard {
  video_stats?: VideoStats;
  meta: { description?: string; period?: string; note?: string; generated_at?: string };
  kpi: {
    total_exposure: number;
    total_visitors: number;
    total_plannings: number;
    total_gmv: number;
    avg_daily_exposure: number;
    conversion_rate: number;
    avg_order_value: number;
  };
  daily_data: DemoDaily[];
  source_cities_top10: Array<{ city: string; visitors: number; percentage: number }>;
  conversion_funnel: Array<{ stage: string; value: number; rate: number }>;
  content_effect: Array<{ type: string; exposure: number; clicks: number; conversion_rate: number }>;
  scenic_heat: Array<{ name: string; visitors: number; heat_score: number; conversion: number }>;
  ai_insights: DemoInsight[];

  /* —— B 端运营扩展（seed v2.0-platform-extended，板块一/二/三口径） —— */
  platform_kpi?: {
    video_total: number;
    video_this_week: number;
    ar_games_active: number;
    ar_participants: number;
    ar_completion_rate: number;
    coupons_issued: number;
    coupons_redeemed: number;
    coupon_redeem_rate: number;
    companion_chats: number;
    companion_avg_msg: number;
    total_gmv_platform: number;
    tax_contribution_est: number;
  };
  video_metrics?: {
    by_style: Array<{ style: string; count: number; avg_views: number; conversion: number }>;
    weekly_trend: Array<{ week: string; videos: number; views: number }>;
    top_videos: Array<{ title: string; style: string; views: number; shares: number; conversion: number }>;
  };
  ar_metrics?: {
    games_list: Array<{ id: string; name: string; festival: string; points: number; participants: number; completion: number; status: string }>;
    daily_participation: Array<{ date: string; participants: number; checkins: number }>;
    point_heat: Array<{ poi: string; checkins: number; avg_time_min: number }>;
  };
  coupon_metrics?: {
    by_type: Array<{ type: string; issued: number; redeemed: number; redeem_rate: number; avg_value: number }>;
    top_redeem_poi: Array<{ poi: string; redeemed: number; gmv: number }>;
  };
  companion_metrics?: {
    daily_chats: Array<{ date: string; chats: number; satisfaction: number }>;
    top_intents: Array<{ intent: string; count: number; pct: number }>;
    festival_recommendations: Array<{ festival: string; recommended: string; clicks: number; conversion: number }>;
  };
}

/* ---------- 板块三 · 智能伴侣推荐 ---------- */
export interface CompanionRecommendItem {
  id: string;
  domain: "business" | "poi";
  name: string;
  category: string | null;
  tags: string[];
  type: "美食" | "非遗体验" | "山水景点" | "休闲住宿";
  indoor: boolean;
  avg_cost_cny: number | null;
  avg_duration_min: number | null;
  distance_km: number | null;
  rating: number;
  reason: string;
}
export interface CompanionRecommendResp {
  demo: boolean;
  festival_label: string;
  location_name: string;
  intent_label: string;
  total_candidates: number;
  items: CompanionRecommendItem[];
}

/* ---------- 游戏/全景 ---------- */
export interface Quest {
  id: string;
  npc: string;
  location: string;
  difficulty: string;
  category: string;
  related_culture_id: string;
  question: string;
  options: string[];
  answer: number;
  explanation: string;
  reward: string;
}

export interface NpcConfig {
  sprite: string;
  location: string;
  greeting: string;
  intro: string;
  correct: string;
  wrong: string;
  idle: string[];
}

export interface PanoHotspot {
  id: string;
  name: string;
  position: { yaw: number; pitch: number };
  icon: string;
  title: string;
  content: string;
  source: string;
  action: { type: string; target: string };
}

/* ---------- 板块一：AIGC 视频生成 ---------- */
export type VideoStatus = "scripting" | "generating" | "stitching" | "done" | "failed";
export type VideoShotStatus = "pending" | "generating" | "done" | "failed";

export interface VideoFlowLog {
  stage: string;
  msg: string;
  ts: string;
}
export interface VideoShot {
  shot_id: number;
  description: string;
  duration_sec: number;
  prompt: string;
  kb_refs: string[];
  status: VideoShotStatus;
  video_url?: string;
}
export interface VideoOutput {
  duration_sec: number;
  format: string;
  resolution: string;
  fps: number;
  aspect: string;
  mode: "demo-sim";
  deliverable: string;
  notice: string;
}
export interface VideoEnhanceResult {
  mode: "local" | "llm";
  enriched_prompt: string;
  negative_prompt: string;
  settings: {
    resolution: string;
    fps: number;
    aspect: string;
    total_duration_sec: number;
    note?: string;
  };
  shot_topics: string[];
  kb_hits: Array<{ id: string; name: string; domain: string }>;
}
export interface VideoProjectMeta {
  id: string;
  title: string;
  user_prompt: string;
  style: string;
  shot_count: number;
  status: VideoStatus;
  progress_pct: number;
  stage_label: string;
  created_at: string;
}
export interface VideoProjectDetail extends VideoProjectMeta {
  enriched_prompt: string;
  negative_prompt: string;
  settings: {
    resolution: string;
    fps: number;
    aspect: string;
    total_duration_sec: number;
    note?: string;
  };
  shots: VideoShot[];
  flow_log: VideoFlowLog[];
  output?: VideoOutput;
}
export interface VideoStats {
  total: number;
  done: number;
  generating: number;
  total_duration_sec: number;
  avg_shots: number;
  by_style: Array<{ style: string; count: number }>;
}
export interface VideoListResp {
  items: VideoProjectMeta[];
  stats: VideoStats;
}
export interface VideoStatusResp {
  id: string;
  title: string;
  status: VideoStatus;
  progress_pct: number;
  stage_label: string;
  shots: VideoShot[];
  flow_log: VideoFlowLog[];
  output?: VideoOutput;
}
export interface VideoStyleResp {
  styles: Array<{
    id: string;
    name: string;
    desc: string;
    resolution: string;
    fps: number;
    aspect: string;
    keywords: string[];
    /** 风格示例片段（演示用，位于 assets/videos/ 下） */
    sample_clip?: string;
  }>;
  default_style: string;
}

/* ---------- 板块二 · AR 互动游戏 ---------- */
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

export interface ArStationReward {
  type: string;
  name: string;
  value: number;
}

export interface ArTemplateStation {
  poi_id: string;
  name: string;
  task: string;
  question: string;
  answer: string;
  hint: string;
  reward: ArStationReward;
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

export interface ArTemplatesResp {
  templates: ArTemplate[];
  themes: Record<string, Record<string, string>>;
  default: string;
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

/** 玩家端点位：服务端不下发 answer / explanation */
export type ArPlayPoint = Omit<ArGamePoint, "answer" | "explanation"> & { answer_len: number };

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

export interface ArStats {
  total_games: number;
  active_games: number;
  draft_games: number;
  total_points: number;
  participants: number;
  completed: number;
  completion_rate: number;
  coupons_claimed: number;
}

export interface ArGamesResp {
  games: ArGameMeta[];
  stats: ArStats;
}

export interface ArGeneratedStory {
  mode: "mock" | "llm";
  template_id: string;
  theme_name: string;
  intro: string;
  outro: string;
  stations: ArTemplateStation[];
  notice: string;
  demo?: boolean;
}

export interface ArFenceResp {
  poi_id: string;
  poi_name: string;
  distance_m: number;
  radius_m: number;
  inside: boolean;
  gap_m: number;
  can_play: boolean;
  tip: string;
}

export interface ArProgress {
  solved: string[];
  claimed: string[];
  points_done: number;
  total_points: number;
  completed: boolean;
  score: number;
}

export interface ArSubmitResp {
  poi_id: string;
  correct: boolean;
  expected?: string;
  explanation?: string;
  hint?: string;
  reward: { coupon_id: string | null; name: string; type: string; claimable: boolean };
  progress: ArProgress | null;
  coupon_image: string | null;
  demo: boolean;
}

export interface ArClaimResp {
  is_demo: boolean;
  demo_label: string;
  voucher_no: string;
  coupon: ArCoupon;
  coupon_image: string;
  qr_text: string;
  claimed: string[];
  progress: ArProgress | null;
  notice: string;
}

export interface ArLeaderRow {
  rank: number;
  user_name: string;
  score: number;
  badge: string;
}

export interface ArRecordsResp {
  records: Array<{
    id: string;
    game_id: string;
    user_name: string;
    points_done: number;
    total_points: number;
    completed: boolean;
    duration_min: number;
    rewards_claimed: number;
    score: number;
    date: string;
  }>;
  leaderboard: ArLeaderRow[];
  summary: {
    participants: number;
    completed: number;
    completion_rate: number;
    avg_score: number;
    coupons_claimed: number;
  };
  demo: boolean;
}

export interface ArPlayConfig extends Omit<ArGameDetail, "points"> {
  points: ArPlayPoint[];
  demo: boolean;
}

/* ---------- 永嘉 3D 景点场景 ---------- */
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
  /** file = 读自素材文件；custom = 已被运营端编辑覆盖 */
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
  /** 对外访问量 = visit_baseline（演示基线）+ 真实埋点计数 */
  visit_count: number;
  /** 演示基线：种子阶段写死，让空库演示也有合理观感 */
  visit_baseline: number;
  /** 真实埋点：今日（本地日期）浏览数 */
  visit_today: number;
  updated_at: string;
}

/* ---------- 模拟预订凭证（FR-AGT-08） ---------- */

export interface VoucherBooking {
  type: "hotel" | "restaurant" | "experience";
  name: string;
  poi_id: string;
  guests: number;
  price_cny: number;
  /** hotel 专用 */
  check_in?: string;
  check_out?: string;
  /** restaurant / experience 专用 */
  date?: string;
  time?: string;
  indoor?: boolean;
  note?: string;
}

export interface BookingVoucher {
  voucher_no: string;
  status: string;
  /** 恒为 true：本凭证为大赛演示模拟数据，不构成真实预订 */
  is_demo: boolean;
  demo_label: string;
  created_at: string;
  session_id: string;
  itinerary: {
    id: string;
    title: string;
    days: number;
    total_budget_cny: number;
    sources: string[];
  };
  bookings: VoucherBooking[];
  payment: { method: string; total_cny: number; status: string };
  qr_code_text: string;
  footer: string;
  disclaimer: string;
}

/** Agent 在场景中的运行步骤（效果展示模块逐帧回放） */
export interface AgentStep {
  id: string;
  kind: "perceive" | "decide" | "act";
  label: string;
  detail: string;
  hotspot_id?: string;
  hotspot_name?: string;
  yaw?: number;
  pitch?: number;
  dwell_ms: number;
}

export interface SceneAgentScript {
  scene_id: string;
  scene_name: string;
  theme_color?: string;
  steps: AgentStep[];
}

export interface ScenesResp {
  scenes: SceneRecord[];
}

export interface SceneStats {
  total: number;
  enabled: number;
  hotspot_count: number;
  anchored: number;
  covered_by_games: number;
  games: number;
  /** 对外访问量 = 演示基线 + 真实埋点 */
  total_visits: number;
  /** 其中来自真实埋点的部分 */
  real_visits: number;
  /** 今日（本地日期）真实埋点数 */
  today_visits: number;
}

/* ---------- SSE ---------- */
export type SseEvent =
  | { event: "token"; data: { text: string } }
  | { event: "tool_call"; data: Record<string, unknown> }
  | { event: "plan"; data: DemoPlan }
  | { event: "plan_diff"; data: PlanDiffPayload }
  | { event: "done"; data: Record<string, unknown> }
  | { event: "error"; data: { code?: number; message?: string; fallback?: boolean; reason?: string } };
