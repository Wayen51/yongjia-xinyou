/**
 * LLM 消耗接口的轻量防护：固定 Token 校验 + 单 IP 滑动窗口限流。
 *
 * 定位：大赛演示防白嫖，不是生产级鉴权。
 * - Token 写在 .env（CHAT_API_TOKEN），前端请求头 x-api-token 携带相同值；
 *   留空时跳过 token 校验，便于本地调试。
 * - 限流：每个 IP 在 WINDOW_MS 内最多 MAX 次，超限返回 429。
 */
import type { FastifyRequest, FastifyReply } from "fastify";
import { config } from "./config.js";

const WINDOW_MS = 60_000;
const MAX = 15;

/** key=ip, value=该 IP 最近 N 次调用的时间戳（已裁剪到窗口内） */
const hits = new Map<string, number[]>();

function clientIp(req: FastifyRequest): string {
  // 反代/同机部署下取 X-Forwarded-For 第一段；没有则用 socket 远端
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  if (Array.isArray(fwd) && fwd.length) return String(fwd[0]).split(",")[0].trim();
  return req.ip || "unknown";
}

function tooMany(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  return false;
}

/** 校验 token + 限流；未通过时直接写响应并返回 false，由调用方 return。 */
export function guardLlmRoute(req: FastifyRequest, reply: FastifyReply): boolean {
  if (config.chatToken) {
    const token = req.headers["x-api-token"];
    if (token !== config.chatToken) {
      reply.code(401).send({ code: 40101, message: "访问令牌无效" });
      return false;
    }
  }
  const ip = clientIp(req);
  if (tooMany(ip)) {
    reply.code(429).send({ code: 42901, message: "操作过于频繁，请稍后再试" });
    return false;
  }
  return true;
}
