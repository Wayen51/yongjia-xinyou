/** 把 Agent 回复中的 [来源:条目名] 切分成可点击片段 */

export interface RichSeg {
  t: "txt" | "src";
  v: string;
}

const SRC_RE = /\[来源[:：]([^\]]+)\]/g;

export function parseSourceSegments(text: string): RichSeg[] {
  const segs: RichSeg[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  SRC_RE.lastIndex = 0;
  while ((m = SRC_RE.exec(text)) !== null) {
    if (m.index > last) segs.push({ t: "txt", v: text.slice(last, m.index) });
    segs.push({ t: "src", v: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ t: "txt", v: text.slice(last) });
  return segs;
}

export function fmtCost(cny: number | null | undefined): string {
  if (cny == null) return "—";
  return cny === 0 ? "免费" : `¥${cny}`;
}

export function fmtDuration(min: number | null | undefined): string {
  if (!min) return "";
  if (min >= 60) {
    const h = min / 60;
    return Number.isInteger(h) ? `${h} 小时` : `${Math.floor(h)}.${Math.round((h % 1) * 10)} 小时`;
  }
  return `${min} 分钟`;
}

export function clampText(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
