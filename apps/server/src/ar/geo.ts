/**
 * 板块二 · AR 互动：地理围栏与答案判定
 * Demo 口径：浏览器模拟定位 + 服务端 Haversine 校验，不做真实室内定位。
 */

const EARTH_RADIUS_M = 6371000;

/** 两点间距离（米） */
export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface FenceResult {
  distance_m: number;
  radius_m: number;
  inside: boolean;
  /** 距离围栏边界还有多少米（负数表示已在围栏内） */
  gap_m: number;
}

export function checkFence(
  lat: number,
  lng: number,
  poi: { lat: number; lng: number },
  radiusM: number,
): FenceResult {
  const distance = haversine(lat, lng, poi.lat, poi.lng);
  const radius = Math.max(5, Number(radiusM) || 50);
  return {
    distance_m: Math.round(distance),
    radius_m: radius,
    inside: distance <= radius,
    gap_m: Math.round(distance - radius),
  };
}

/** 答案归一化：去空格/标点、统一大小写，兼容「306米」「306 米」「306m」等写法 */
function normalize(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[\s，。、,.!！?？"'“”‘’（）()【】\[\]·:：;；\-—_/\\]/g, "");
}

/**
 * 宽松判定（演示态）：
 * 1) 归一化后完全一致；
 * 2) 玩家答案与标准答案互相包含；
 * 3) 标准答案括号内的补充说明可直接匹配（如 "南宋（1178年）" → "南宋"/"1178年"）。
 * 演示以「能被评委一遍答对」优先，不做严格校验。
 */
export function judgeAnswer(input: string, expected: string): boolean {
  const a = normalize(input);
  const b = normalize(expected);
  if (!a || !b) return false;
  if (a === b) return true;
  if (b.includes(a) && a.length >= 2) return true;
  if (a.includes(b)) return true;
  const inner = String(expected).match(/[（(]([^）)]+)[）)]/g) || [];
  for (const seg of inner) {
    const key = normalize(seg);
    if (key && (a === key || a.includes(key) || key.includes(a))) return true;
  }
  // 纯数字答案（如海拔、级数）单独放行
  const numA = a.match(/\d+(\.\d+)?/g);
  const numB = b.match(/\d+(\.\d+)?/g);
  if (numA?.length && numB?.length && numA.some((n) => numB.includes(n))) return true;
  return false;
}
