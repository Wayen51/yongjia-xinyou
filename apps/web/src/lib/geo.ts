/**
 * 板块二 · AR 互动：离线底图 ↔ 经纬度换算
 * 底图为自绘 WebP（无在线瓦片），用控制点做线性拟合，保证断网演示可用。
 * 对齐依据：assets/ar/map/geo-anchors.json 的 control_points。
 */

export interface GeoAnchorPoint {
  lat: number;
  lng: number;
  px: number;
  py: number;
}

export interface AnchorSet {
  image: string;
  width: number;
  height: number;
  control_points: GeoAnchorPoint[];
}

export interface GeoAnchors {
  overview_map: AnchorSet;
  shiweiyan_map: AnchorSet;
}

let cache: GeoAnchors | null = null;

export async function loadAnchors(): Promise<GeoAnchors> {
  if (cache) return cache;
  const res = await fetch("/assets/ar/map/geo-anchors.json");
  cache = (await res.json()) as GeoAnchors;
  return cache;
}

interface Fit {
  lngMin: number;
  lngSpan: number;
  pxMin: number;
  pxSpan: number;
  latMax: number;
  latSpan: number;
  pyMin: number;
  pySpan: number;
}

const fitCache = new WeakMap<AnchorSet, Fit>();

function fitOf(set: AnchorSet): Fit {
  const cached = fitCache.get(set);
  if (cached) return cached;
  const cps = set.control_points;
  const lngs = cps.map((c) => c.lng);
  const pxs = cps.map((c) => c.px);
  const lats = cps.map((c) => c.lat);
  const pys = cps.map((c) => c.py);
  const lngMin = Math.min(...lngs);
  const latMax = Math.max(...lats);
  const fit: Fit = {
    lngMin,
    lngSpan: Math.max(...lngs) - lngMin || 1,
    pxMin: Math.min(...pxs),
    pxSpan: Math.max(...pxs) - Math.min(...pxs) || 1,
    latMax,
    latSpan: latMax - Math.min(...lats) || 1,
    pyMin: Math.min(...pys),
    pySpan: Math.max(...pys) - Math.min(...pys) || 1,
  };
  fitCache.set(set, fit);
  return fit;
}

/** 经纬度 → 底图像素 */
export function latLngToPx(set: AnchorSet, lat: number, lng: number): { x: number; y: number } {
  const f = fitOf(set);
  return {
    x: f.pxMin + ((lng - f.lngMin) / f.lngSpan) * f.pxSpan,
    y: f.pyMin + ((f.latMax - lat) / f.latSpan) * f.pySpan,
  };
}

/** 底图像素 → 经纬度 */
export function pxToLatLng(set: AnchorSet, x: number, y: number): { lat: number; lng: number } {
  const f = fitOf(set);
  return {
    lng: f.lngMin + ((x - f.pxMin) / f.pxSpan) * f.lngSpan,
    lat: f.latMax - ((y - f.pyMin) / f.pySpan) * f.latSpan,
  };
}

/** 底图 1 像素 ≈ 多少米（按当前纬度换算），用于按米画围栏半径 */
export function metersPerPx(set: AnchorSet, lat: number): number {
  const f = fitOf(set);
  const metersPerDegLng = 111320 * Math.cos((lat * Math.PI) / 180);
  const pxPerDegLng = f.pxSpan / f.lngSpan;
  return metersPerDegLng / pxPerDegLng;
}

/** 两点距离（米），与后端 haversine 一致的近似实现 */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** 按方位把点从原点偏移 distM 米（用于「模拟走近」） */
export function offsetPoint(lat: number, lng: number, eastM: number, northM: number): { lat: number; lng: number } {
  return {
    lat: lat + northM / 110574,
    lng: lng + eastM / (111320 * Math.cos((lat * Math.PI) / 180)),
  };
}

/** 朝目标点前进 ratio 比例（0=原地，1=到达） */
export function stepToward(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  ratio: number,
): { lat: number; lng: number } {
  const r = Math.min(1, Math.max(0, ratio));
  return { lat: from.lat + (to.lat - from.lat) * r, lng: from.lng + (to.lng - from.lng) * r };
}

/** 方位角（度，正北为 0，顺时针增大），用于指南针与「东南西北」提示 */
export function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180) / Math.PI + 360;
}

const COMPASS_8 = ["正北", "东北", "正东", "东南", "正南", "西南", "正西", "西北"];

/** 方位角 → 八向中文方位 */
export function compassLabel(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  return COMPASS_8[Math.round(d / 45) % 8];
}

export const fmtDistance = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
