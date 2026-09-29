/**
 * 跨端共享类型契约（网站端 / 手机端 / 服务端）
 *
 * 本文件是**纯声明文件**（.d.ts）：只描述类型，不产生任何运行时代码。
 * 之所以用 .d.ts 而非 .ts——服务端用 tsc 编译（rootDir=apps/server/src），
 * 若共享类型是 .ts 源码，会被拉进同一个编译程序并触发 rootDir 越界报错。
 * 声明文件只参与类型解析、不参与编译产出，同时所有引用方均为 `import type`，
 * 运行时会整条擦除，因此不引入任何打包/运行时依赖。
 */
export type Domain = "culture" | "poi" | "business";

export interface KnowledgeAssets {
  cover?: string;
  fallback?: string;
  image?: string;
}

export interface KnowledgeItem {
  id: string;
  domain: Domain;
  name: string;
  category?: string | null;
  summary: string;
  content: string;
  tags: string[];
  indoor: boolean;
  suitable_for: string[];
  avg_cost_cny: number | null;
  avg_duration_min: number | null;
  geo_lat: number | null;
  geo_lng: number | null;
  assets: KnowledgeAssets;
  source: string;
  source_url?: string;
  rating: number;
}

export interface ApiEnvelope<T> {
  code: number;
  data?: T;
  message?: string;
}

export interface ChatRequest {
  sessionId: string;
  message: string;
  context?: { itineraryId?: string };
}

export type SseEventType =
  | "token"
  | "tool_call"
  | "plan"
  | "plan_diff"
  | "done"
  | "error";

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

export interface PlanDiffChange {
  type: "remove" | "add" | "modify";
  itemId: string;
  reason?: string;
  item?: Partial<PlanItem> & { name?: string; from?: string; to?: string };
}

export interface PlanDiffPayload {
  banner: string;
  changes: PlanDiffChange[];
  removed?: Array<{ id: string; name: string; reason: string }>;
  added?: Array<PlanItem>;
  rescheduled?: Array<{ id: string; name: string; from: string; to: string; reason: string }>;
  budget_recheck?: {
    before_cny: number;
    after_cny: number;
    delta_cny: number;
    note: string;
  };
  change_summary?: string;
  sources?: string[];
}

export interface ItineraryItem {
  id: string;
  time: string;
  type: "scenic" | "meal" | "hotel" | "transport" | "experience";
  refId: string;
  title: string;
  location: string;
  durationMin: number;
  costCny: number;
  indoor: boolean;
  note?: string;
}

export interface DayPlan {
  date: string;
  theme?: string;
  items: ItineraryItem[];
}

export interface ChangeRecord {
  version: number;
  reason: string;
  changes: { type: "remove" | "add" | "modify"; itemId: string; desc: string }[];
}

export interface Itinerary {
  id: string;
  title: string;
  version: number;
  party: { adults: number; children: number; elders: number };
  budget: { limitCny: number; estimatedCny: number };
  days: DayPlan[];
  status: "draft" | "confirmed" | "replanned";
  changeLog: ChangeRecord[];
}

export interface WeatherSlot {
  time: string;
  weather: string;
  temp: number;
  precipProb: number;
}

export interface HealthStatus {
  status: string;
  llm: string;
  db: string;
  weather: string;
  mockLlm: boolean;
}

/* ---------- 板块一：AIGC 视频生成 ---------- */
export type VideoProjectStatus = "scripting" | "generating" | "stitching" | "done" | "failed";

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
  /** 示意封面（演示态占位，非真实生成帧） */
  cover?: string;
}

export interface VideoSettings {
  resolution: string;
  fps: number;
  aspect: string;
  total_duration_sec: number;
  note?: string;
}

export interface KbHit {
  id: string;
  name: string;
  domain: string;
}

/** 提示词美化结果（AI 辅助提示词的核心产出） */
export interface VideoEnhanceResult {
  mode: "local" | "llm";
  enriched_prompt: string;
  negative_prompt: string;
  settings: VideoSettings;
  /** 逐镜头主题描述（供拆分为分镜脚本） */
  shot_topics: string[];
  kb_hits: KbHit[];
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

export interface VideoProjectMeta {
  id: string;
  title: string;
  user_prompt: string;
  style: string;
  shot_count: number;
  status: VideoProjectStatus;
  progress_pct: number;
  stage_label: string;
  created_at: string;
}

export interface VideoProjectDetail extends VideoProjectMeta {
  enriched_prompt: string;
  negative_prompt: string;
  settings: VideoSettings;
  shots: VideoShot[];
  flow_log: VideoFlowLog[];
  output?: VideoOutput;
}

export interface VideoStyle {
  id: string;
  name: string;
  desc: string;
  resolution: string;
  fps: number;
  aspect: string;
  keywords: string[];
  /** 风格示例片段（演示用，位于 assets/videos/ 下），无对应素材时省略 */
  sample_clip?: string;
}

export interface VideoStats {
  total: number;
  done: number;
  generating: number;
  total_duration_sec: number;
  avg_shots: number;
  by_style: Array<{ style: string; count: number }>;
}
