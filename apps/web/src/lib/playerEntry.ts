/**
 * 手机端入口地址（跨工程跳转）
 *
 * 网站（apps/web, :5173）与手机端 APP（apps/mobile, :5174）是两个独立工程，
 * 运营端的「玩家端预览 / 二维码」必须跨工程跳转。
 *
 * 地址来源优先级：
 *   1) VITE_MOBILE_ORIGIN —— 构建期配置（生产环境建议显式指定）
 *   2) dev 默认「当前访问主机的 :5174」—— 与 scripts/dev.mjs 启动的端口一致。
 *      用 hostname 而非 localhost：手机通过局域网 IP 打开网站时，
 *      localhost 会指向手机自己，导致入口 / 二维码打不开。
 *   3) 生产回落同域 /app —— 手机端作为网站的子路径部署时无需配置
 */

/** 手机端应用根地址（不含结尾斜杠） */
export function playerEntryBase(): string {
  const configured = import.meta.env.VITE_MOBILE_ORIGIN as string | undefined;
  if (configured !== undefined && configured.trim() !== "") {
    return configured.trim().replace(/\/$/, "");
  }
  if (import.meta.env.DEV) {
    // 跟随浏览者所在主机：PC 上是 localhost，手机走局域网 IP 时自动用同一个 IP
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname || "localhost"}:5174`;
  }
  return `${window.location.origin}/app`;
}

/** 手机端入口地址：传 gameId 则直达该游戏寻宝页（hash 路由） */
export function playerEntryUrl(gameId?: string): string {
  const base = playerEntryBase();
  return gameId ? `${base}/#/play/${encodeURIComponent(gameId)}` : `${base}/`;
}

/** 新标签页打开手机端（保留运营端当前页面状态） */
export function openPlayerEntry(gameId?: string): void {
  window.open(playerEntryUrl(gameId), "_blank", "noopener");
}
