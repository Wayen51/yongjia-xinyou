/** 资源 URL 解析：seed 里 cover 以 "assets/img/kb/..." 相对形式存储，统一加 "/" 前缀 */
export function assetUrl(p?: string | null): string {
  if (!p) return "";
  return p.startsWith("/") ? p : `/${p}`;
}

/**
 * 板块一 · 视频生成：演示成片。
 * 流水线为模拟流程（不调用真实视频大模型），无论输入什么提示词，
 * 生成完成后的成片统一指向这条由运营内容组提供的正式成片。
 */
export const DEMO_FINAL_VIDEO = "/assets/videos/yongjia-master.mp4";

/**
 * 板块二 · AR 互动：POI 语音导览。
 * 运营内容组已提供以下点位的导览音频（assets/audio/guide-poi-*.mp3），其余点位返回 null。
 */
const GUIDE_AUDIO_POI = new Set([
  "POI-001",
  "POI-003",
  "POI-009",
  "POI-010",
  "POI-011",
  "POI-012",
  "POI-028",
  "POI-029",
]);

/** 该 POI 的语音导览地址；无对应音频时返回 null */
export function guideAudioUrl(poiId?: string | null): string | null {
  const key = (poiId || "").trim().toUpperCase();
  if (!GUIDE_AUDIO_POI.has(key)) return null;
  return `/assets/audio/guide-${key.toLowerCase()}.mp3`;
}

/** 图片加载失败时兜底到占位图 */
export function onImgError(e: Event) {
  const el = e.currentTarget as HTMLImageElement | null;
  if (!el) return;
  const fb = el.dataset.fallback || "/assets/img/placeholders/poi-cover.webp";
  if (el.src.endsWith(fb)) return; // 已兜底，防止死循环
  el.src = fb;
}
