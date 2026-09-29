/**
 * 板块三 · 智能伴侣「位置 / 节日 / 意图」推荐服务
 *
 * 输入：当前位置（lat/lng，可为演示模拟坐标）+ 节令（festival）+ 出行意图（intent）+ 上下文话术
 * 输出：从永嘉智库（knowledge_items 106 条）实时检索打分后的 4~6 条推荐，
 *       覆盖「美食 / 非遗体验 / 山水景点 / 休闲住宿」，均带推荐理由。
 *
 * 定位：真实计算（Haversine 近邻 + 关键词命中 + 分类加成），数据底座 = 知识库，与 Agent 共用。
 */
import type { KnowledgeItem } from "@zhiyou/shared";
import { searchKnowledge } from "../db/db.ts";

export interface RecommendInput {
  lat?: number | null;
  lng?: number | null;
  location_name?: string; // 演示点位名称，如“石桅岩”
  festival?: string; // mid_autumn | national_day | spring_festival | daily
  intent?: string; // food | craft | sight | relax | explore
  context?: string; // 自由场景话术（如“刚赏完月，想吃点热乎的”）
}

export interface RecommendItem {
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

export interface RecommendResult {
  demo: boolean;
  festival_label: string;
  location_name: string;
  intent_label: string;
  total_candidates: number;
  items: RecommendItem[];
}

const FESTIVAL: Record<string, { label: string; words: string[] }> = {
  mid_autumn: { label: "中秋", words: ["中秋", "赏月", "月亮", "夜游", "月饼", "麦饼", "灯谜"] },
  national_day: { label: "国庆", words: ["国庆", "秋游", "山水", "慢生活"] },
  spring_festival: { label: "春节", words: ["春节", "年俗", "花灯", "灯会", "团圆"] },
  daily: { label: "日常", words: [] },
};

const INTENT: Record<string, { label: string; words: string[]; bonus: RecommendItem["type"][] }> = {
  food: { label: "想吃当地美食", words: ["美食", "小吃", "麦饼", "素面", "金粉饺", "烤全羊", "杨梅", "蜂蜜", "粉干", "茶"] , bonus: ["美食"] },
  craft: { label: "体验非遗手作", words: ["体验", "工坊", "手工", "研学", "瓯窑", "木雕", "乌牛早", "扎染", "手艺", "非遗"], bonus: ["非遗体验"] },
  sight: { label: "逛山水景点", words: ["景点", "山水", "风景", "拍照", "峡谷", "古村", "漂流", "竹筏", "徒步"], bonus: ["山水景点"] },
  relax: { label: "歇脚与住宿", words: ["住宿", "民宿", "客栈", "驿站", "休息", "茶馆"], bonus: ["休闲住宿"] },
  explore: { label: "边走边逛", words: ["老街", "市集", "夜游", "古镇", "集市"], bonus: ["山水景点", "美食"] },
};

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function itemText(item: KnowledgeItem): string {
  return [item.name, item.category ?? "", item.summary, (item.tags ?? []).join(" ")].join(" ").toLowerCase();
}

function typeOf(item: KnowledgeItem): RecommendItem["type"] {
  const c = `${item.category ?? ""} ${item.name}`;
  if (/美食|餐饮|小吃|饼|面|粉|羊肉|杨梅|蜂蜜|酒/.test(c)) return "美食";
  if (/体验|工坊|研学|手作|非遗|技艺|馆|窑|茶园/.test(c)) return "非遗体验";
  if (/民宿|客栈|酒店|住宿/.test(c)) return "休闲住宿";
  return "山水景点";
}

export function recommendCompanion(input: RecommendInput): RecommendResult {
  const festival = FESTIVAL[input.festival ?? "daily"] ?? FESTIVAL.daily;
  const intent = INTENT[input.intent ?? "explore"] ?? INTENT.explore;
  const text = `${input.context ?? ""} ${festival.label} ${intent.label}`;

  const candidates: KnowledgeItem[] = [
    ...(searchKnowledge({ domain: "business", limit: 100 }).items ?? []),
    ...(searchKnowledge({ domain: "poi", limit: 100 }).items ?? []),
  ];

  const needGeo = input.lat != null && input.lng != null;
  const kw = new Set<string>([...festival.words, ...intent.words]);
  const kwArray = Array.from(kw).filter((w) => w.length > 0);

  const scored = candidates.map((item) => {
    const hay = itemText(item);
    let kwScore = 0;
    let hitWords: string[] = [];
    for (const w of kwArray) {
      if (hay.includes(w)) {
        kwScore += 1;
        hitWords.push(w);
      }
    }
    // context 长文本：只挑与候选关键词库重合的可信词，避免整句误匹配
    if (input.context) {
      for (const w of kwArray) {
        if (w.length >= 2 && input.context.includes(w) && !hitWords.includes(w)) {
          kwScore += 1;
          hitWords.push(w);
        }
      }
    }
    let typeBonus = 0;
    const t = typeOf(item);
    if (intent.bonus.includes(t)) typeBonus += 2;
    else if (intent.bonus.length) typeBonus -= 0.5;

    let dist: number | null = null;
    let distScore = 0;
    if (needGeo && item.geo_lat != null && item.geo_lng != null) {
      dist = haversineKm(input.lat as number, input.lng as number, item.geo_lat, item.geo_lng);
      if (dist <= 30) distScore = (1 - dist / 30) * 1.5;
    }
    const score = kwScore * 1.6 + distScore + typeBonus + (item.rating ?? 4.5) * 0.06;
    return { item, t, score, dist, hitWords };
  });

  // 无坐标 or 候选太少时保证按评分稳定输出（演示数据本身为预设坐标，km 可能不准 → 弱化距离占比）
  scored.sort((a, b) => b.score - a.score || (b.item.rating ?? 0) - (a.item.rating ?? 0));

  const TYPE_POOL: RecommendItem["type"][] = ["美食", "非遗体验", "山水景点", "休闲住宿"];
  const picked: typeof scored = [];
  const typeCount = new Map<RecommendItem["type"], number>();
  const LIMIT_PER_TYPE = 2;
  for (const s of scored) {
    const c = typeCount.get(s.t) ?? 0;
    if (c >= LIMIT_PER_TYPE) continue;
    picked.push(s);
    typeCount.set(s.t, c + 1);
    if (picked.length >= 6) break;
  }
  // 若同类型过密导致不足 4 条，则放宽限制补足
  for (const s of scored) {
    if (picked.length >= 6) break;
    if (!picked.includes(s)) picked.push(s);
  }
  if (picked.length < 4 && scored.length) {
    for (const s of scored) {
      if (picked.length >= 4) break;
      if (!picked.includes(s)) picked.push(s);
    }
  }

  const items: RecommendItem[] = picked.map(({ item, t, dist, hitWords }) => {
    const near = dist != null && dist <= 25 ? `距你约 ${dist.toFixed(1)}km` : "";
    const hits = hitWords.slice(0, 2);
    const festivalHit = hits.some((w) => festival.words.includes(w));
    const tagLine = festivalHit && festival.label !== "日常" ? `${festival.label}应景` : hits.join("·");
    const summary = item.summary || "";
    const summaryLead = summary.length > 40 ? `${summary.slice(0, 40)}…` : summary;
    const reason = [tagLine, near, summaryLead || `本地${t}`].filter(Boolean).join(" · ") || `评分 ${item.rating}`;
    return {
      id: item.id,
      // 候选集仅来自 business / poi 两类检索，安全收窄类型
      domain: (item.domain === "poi" ? "poi" : "business") as "poi" | "business",
      name: item.name,
      category: item.category ?? null,
      tags: item.tags ?? [],
      type: t,
      indoor: item.indoor,
      avg_cost_cny: item.avg_cost_cny,
      avg_duration_min: item.avg_duration_min,
      distance_km: dist,
      rating: item.rating,
      reason,
    };
  });

  return {
    demo: true,
    festival_label: festival.label,
    location_name: input.location_name || "永嘉",
    intent_label: intent.label,
    total_candidates: candidates.length,
    items,
  };
}
