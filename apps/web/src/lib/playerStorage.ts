/**
 * 玩家端本机存储
 *
 * Demo 阶段不做账号体系：玩家的游玩足迹存本机，换设备不互通（已在界面标注演示口径）。
 * 生产接入登录后，这里可直接替换为服务端 user_id 维度。
 */

export const PLAYER_HISTORY_KEY = "yjm:history";

export interface PlayerHistoryItem {
  id: string;
  name: string;
  at: number;
}

/** 读取本机游玩足迹（按时间倒序） */
export function readHistory(): PlayerHistoryItem[] {
  try {
    const raw = localStorage.getItem(PLAYER_HISTORY_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as PlayerHistoryItem[];
    return Array.isArray(list) ? list.filter((x) => x && typeof x.id === "string") : [];
  } catch {
    return [];
  }
}

/** 记一笔游玩足迹（同游戏去重后置顶，最多保留 12 条） */
export function rememberGame(id: string, name: string): void {
  try {
    const next: PlayerHistoryItem[] = [
      { id, name, at: Date.now() },
      ...readHistory().filter((x) => x.id !== id),
    ].slice(0, 12);
    localStorage.setItem(PLAYER_HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* 本机存储不可用时忽略，不影响游玩 */
  }
}

/* ---------------- 本机券包（模拟券领取记录） ---------------- */

export const PLAYER_CLAIMS_KEY = "yjm:claims";

/** couponId → 领取时间戳（ms） */
export type PlayerClaims = Record<string, number>;

/** 读取本机已领取的奖励券 */
export function readClaims(): PlayerClaims {
  try {
    const raw = localStorage.getItem(PLAYER_CLAIMS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as PlayerClaims;
    if (!obj || typeof obj !== "object") return {};
    const out: PlayerClaims = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k && typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** 整体写入本机券包（调用方负责增删改，这里只落盘） */
export function saveClaims(claims: PlayerClaims): void {
  try {
    localStorage.setItem(PLAYER_CLAIMS_KEY, JSON.stringify(claims));
  } catch {
    /* 本机存储不可用时忽略，不影响游玩 */
  }
}
